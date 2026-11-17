#!/usr/bin/env python3
"""Exercise the shipped real server, using a temporary database and no user data.

Run: python3 tests/server-integration.py
All model files, executable copies, logs and database changes stay in a temporary
directory. The test deliberately never calls the reset endpoint.
"""
import concurrent.futures
import hashlib
import json
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'blindbox'
name = 'blindbox-server.exe' if platform.system() == 'Windows' else (
    'blindbox-server-mac-arm64' if platform.machine() == 'arm64' else 'blindbox-server-mac-x64')
if platform.system() not in ('Windows', 'Darwin'):
    raise SystemExit('This repository ships only macOS and Windows server binaries.')
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else GAME / name
protected = [GAME / name, *sorted((GAME / 'data').glob('*'))]
before_hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected if p.is_file()}
checks = []


def check(name, condition):
    checks.append((name, bool(condition)))
    print(('PASS ' if condition else 'FAIL ') + name, flush=True)
    if not condition:
        raise AssertionError(name)


def count(state):
    return len(state['storage']) + sum(sum(bool(v) for v in s.values()) for s in state['showcase'].values()) + bool(state['pending'])


with tempfile.TemporaryDirectory(prefix='qiwu-api-test-') as temp:
    temp = Path(temp)
    executable = temp / name
    shutil.copy2(source, executable)
    executable.chmod(0o755)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    db = temp / 'test.db'
    log = (temp / 'server.log').open('w+')
    process = None

    def request(path, data=None):
        req = urllib.request.Request(base + '/api/' + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Content-Type': 'application/json'}, method='GET' if data is None else 'POST')
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def start():
        global process
        process = subprocess.Popen([str(executable), '--port', str(port), '--db', str(db),
            '--web', str(GAME / 'dist'), '--models', str(temp / 'models'), '--seed', '20261114'],
            stdout=log, stderr=subprocess.STDOUT)
        for _ in range(100):
            if process.poll() is not None:
                log.seek(0)
                raise RuntimeError(log.read())
            try:
                if request('health')[1].get('ok'):
                    return
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        raise RuntimeError('Test server did not become ready.')

    def stop():
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    try:
        start()
        _, config = request('config')
        series = config['series']
        check('four current series and 28 identities', [s['id'] for s in series] == ['midnight-snack', 'working-animals', 'weird-appliances', 'vintage-toys'] and all(len(s['items']) == 7 for s in series))
        check('original series prices', [s['boxPrice'] for s in series] == [100, 200, 400, 1000])
        _, initial = request('state')
        initial = initial['state']
        first_series = series[0]['id']

        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            responses = list(pool.map(lambda _: request('open', {'seriesId': first_series}), range(12)))
        successful = [r for status, r in responses if status == 200 and r.get('ok')]
        check('12 concurrent opens produce exactly one result', len(successful) == 1)
        result = successful[0]
        pending = result['entry']
        state = result['state']
        check('one charge and one pending inventory record', state['coins'] == initial['coins'] - series[0]['boxPrice'] and state['boxesOpened'] == initial['boxesOpened'] + 1 and count(state) == 1)
        check('refresh preserves original pending result', request('state')[1]['state']['pending'] == pending)
        stop()
        start()
        check('server restart preserves pending and balance', request('state')[1]['state'] == state)

        _, stored = request('storage', {})
        check('storing moves result without copying or charging', stored['ok'] and len(stored['state']['storage']) == 1 and count(stored['state']) == 1 and stored['state']['coins'] == state['coins'])
        _, reopened = request('reopen', {'uid': pending['uid']})
        check('warehouse viewing preserves identity and counters', reopened['ok'] and reopened['entry'] == pending and reopened['state']['boxesOpened'] == state['boxesOpened'] and reopened['state']['coins'] == state['coins'] and count(reopened['state']) == 1)
        _, displayed = request('showcase', {})
        check('showcase transfers one record without charge', displayed['ok'] and displayed['state']['showcase'][first_series][pending['itemId']] and count(displayed['state']) == 1 and displayed['state']['coins'] == state['coins'])
        status, _ = request('showcase', {})
        check('repeated showcase call cannot duplicate inventory', status == 409 and count(request('state')[1]['state']) == 1)
        _, removed = request('unshowcase', {'seriesId': first_series, 'itemId': pending['itemId']})
        check('removing display preserves inventory and balance', removed['ok'] and count(removed['state']) == 1 and len(removed['state']['storage']) == 1 and removed['state']['coins'] == state['coins'])
        request('reopen', {'uid': removed['state']['storage'][0]['uid']})
        request('showcase', {})

        for s in series[1:]:
            previous = request('state')[1]['state']
            _, opened = request('open', {'seriesId': s['id']})
            check(f"{s['name']} uses real price and identity", opened['ok'] and opened['entry']['itemId'] in {i['id'] for i in s['items']} and opened['state']['coins'] == previous['coins'] - s['boxPrice'])
            request('storage', {})

        duplicate = None
        for _ in range(100):
            _, opened = request('open', {'seriesId': first_series})
            assert opened['ok'], opened
            if opened.get('alreadyInShowcase'):
                duplicate = opened
                break
            request('showcase', {})
        check('real duplicate draw reached with original rules', duplicate is not None)
        status, response = request('showcase', {})
        check('same-kind second display is rejected', status == 409 and response.get('error') == 'already_in_showcase')
        unchanged = request('state')[1]['state']
        check('duplicate rejection keeps exact pending and inventory', unchanged == duplicate['state'])
        _, stored_duplicate = request('storage', {})
        check('duplicate can be stored as its own physical uid', stored_duplicate['ok'] and any(e['uid'] == duplicate['entry']['uid'] for e in stored_duplicate['state']['storage']) and count(stored_duplicate['state']) == count(unchanged))
        saved = request('state')[1]
        stop()
        start()
        check('restart restores complete storage/showcase/progress', request('state')[1] == saved)
    finally:
        stop()
        log.close()
        after_hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected if p.is_file()}
        check('original databases and shipped binary unchanged', before_hashes == after_hashes)

print(f'{len(checks)} checks passed; all test data was isolated and removed.')
