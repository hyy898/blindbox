#!/usr/bin/env python3
"""Real save-slot transactions, using only a temporary database and server copy."""
import concurrent.futures
import hashlib
import json
import platform
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'blindbox'
DEFAULT = GAME / ('blindbox-server.exe' if platform.system() == 'Windows' else
                  'blindbox-server-mac-arm64' if platform.machine() == 'arm64' else 'blindbox-server-mac-x64')
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT
protected = [p for p in (GAME / 'data').glob('*') if p.is_file()]
before_hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
checks = 0


def check(name, condition):
    global checks
    assert condition, name
    checks += 1
    print('PASS', name, flush=True)


with tempfile.TemporaryDirectory(prefix='qiwu-saves-test-') as directory:
    temp = Path(directory)
    executable = temp / SOURCE.name
    shutil.copy2(SOURCE, executable)
    executable.chmod(0o755)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    database = temp / 'test.db'
    process = None
    log = (temp / 'server.log').open('w+')

    def request(path, data=None):
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/{path}',
            data=None if data is None else json.dumps(data).encode(),
            headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def start():
        global process
        process = subprocess.Popen([str(executable), '--port', str(port), '--db', str(database),
            '--web', str(GAME / 'dist'), '--models', str(temp / 'models'), '--seed', '20261116'],
            cwd=temp, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(100):
            if process.poll() is not None:
                log.seek(0)
                raise RuntimeError(log.read())
            try:
                if request('health')[1].get('ok'):
                    return
            except OSError:
                time.sleep(.05)
        raise RuntimeError('Temporary server did not start.')

    def stop():
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def state():
        return request('state')[1]['state']

    def detail(slot):
        return request(f'saves/{slot}')[1]['save']

    def save(slot, name, view, revision=''):
        return request('saves/save', {'slot': slot, 'name': name, 'presentation': view, 'revision': revision})

    def load(slot, revision, view):
        return request('saves/load', {'slot': slot, 'revision': revision, 'presentation': view})

    try:
        start()
        initial = state()
        check('existing automatic save opens without changing progress', request('saves')[1]['saves'] == [] and state() == initial)
        stop()
        with sqlite3.connect(database) as db:
            db.execute('DROP TABLE save_slots')
        start()
        check('legacy database gains save slots without resetting its player', state() == initial and request('saves')[1]['saves'] == [])

        series = request('config')[1]['series'][0]
        opened = request('open', {'seriesId': series['id']})[1]
        pending_state = opened['state']
        view_a = {'layout': [None, None, None], 'preferences': {'muted': True, 'reduced': True}}
        status, first = save(1, '第一盒', view_a)
        first = first['save']
        check('manual save records actual server state and pending identity', status == 200 and detail(1)['state'] == pending_state and detail(1)['presentation'] == view_a)

        request('showcase', {})
        display_state = state()
        view_b = {'layout': [{'itemId': opened['entry']['itemId'], 'rotation': 75}, None, None],
                  'preferences': {'muted': False, 'reduced': False}}
        save(2, '我的展柜', view_b)
        request('open', {'seriesId': series['id']})
        request('storage', {})
        latest_state = state()
        view_c = {'layout': [None, None, None], 'preferences': {'muted': True, 'reduced': False}}
        stop()
        start()
        check('restart retains both snapshots and the newer automatic progress', len(request('saves')[1]['saves']) == 2 and state() == latest_state)
        check('snapshots do not follow subsequent automatic saves', detail(1)['state'] == pending_state and detail(2)['state'] == display_state)

        second = detail(2)
        status, loaded = load(2, second['revision'], view_c)
        check('load restores coins, inventory, counters, progress and display settings', status == 200 and state() == display_state and loaded['presentation'] == view_b and loaded['progress']['owned'] == 1)
        backup = detail(0)
        check('pre-load backup contains complete replaced state and layout', backup['state'] == latest_state and backup['presentation'] == view_c)
        status, restored = load(0, backup['revision'], view_b)
        check('restoring backup swaps progress safely in one transaction', status == 200 and state() == latest_state and restored['presentation'] == view_c and detail(0)['state'] == display_state)

        status, _ = load(1, first['revision'], view_c)
        check('loading an unfinished draw preserves its original result', status == 200 and state() == pending_state)
        stop()
        start()
        check('loaded progress and pending draw survive another restart', state() == pending_state)

        status, _ = request('saves/delete', {'slot': 1, 'revision': first['revision']})
        check('deleting snapshot leaves current game and other snapshots intact', status == 200 and request('saves/1')[0] == 404 and state() == pending_state and detail(2)['state'] == display_state)
        check('a deleted snapshot cannot be loaded', load(1, first['revision'], view_a)[0] == 404 and state() == pending_state)
        check('stale overwrite cannot recreate a deleted snapshot', save(1, '过期', view_a, first['revision'])[0] == 409)
        _, created = save(1, "新记录 ' 测试", view_a)
        revision = created['save']['revision']
        check('names are safely parameterized', detail(1)['name'] == "新记录 ' 测试")

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda i: save(1, f'并发 {i}', view_a, revision), range(8)))
        check('concurrent overwrites accept exactly one matching revision', sum(status == 200 for status, _ in responses) == 1 and sum(status == 409 for status, _ in responses) == 7)
        check('stale delete cannot remove a newer snapshot', request('saves/delete', {'slot': 1, 'revision': revision})[0] == 409 and request('saves/1')[0] == 200)
        before_backup = detail(0)
        check('stale load leaves both current progress and backup untouched', load(1, revision, view_a)[0] == 409 and state() == pending_state and detail(0) == before_backup)

        for invalid in [-1, 0, 4, 1.5, '1', 2**62]:
            check(f'invalid manual slot rejected: {invalid}', save(invalid, '无效', view_a)[0] == 400)
        check('invalid view payload cannot corrupt a snapshot', save(3, '无效', {'layout': []})[0] == 400 and request('saves/3')[0] == 404)

        manual_before = [detail(1), detail(2)]
        status, fresh = request('saves/new', {'presentation': view_b})
        check('new game restores configured starting money and clears all game progress', status == 200 and fresh['reset'] and state() == initial and fresh['progress']['owned'] == 0)
        check('new game clears display positions while keeping preferences', fresh['presentation'] == {**view_b, 'layout': [None, None, None]})
        check('new game preserves all named manual save slots', [detail(1), detail(2)] == manual_before)
        reset_backup = detail(0)
        check('pre-reset backup preserves pending result and display layout', reset_backup['name'] == '重新开局前的进度' and reset_backup['state'] == pending_state and reset_backup['presentation'] == view_b)
        stop()
        start()
        check('new game persists after server restart', state() == initial and [detail(1), detail(2)] == manual_before)
        status, _ = load(0, reset_backup['revision'], fresh['presentation'])
        check('pre-reset progress can be restored including its unfinished draw', status == 200 and state() == pending_state)
        before_bad_reset = detail(0)
        check('malformed reset leaves both progress and backup untouched', request('reset', {'presentation': {'layout': []}})[0] == 400 and state() == pending_state and detail(0) == before_bad_reset)

        save(3, '旧版藏品', view_a)
        third = detail(3)
        incompatible = third['state']
        incompatible['storage'].append({'uid': 'legacy', 'itemId': 'removed-item', 'seriesId': series['id'], 'rarity': 'common'})
        stop()
        with sqlite3.connect(database) as db:
            db.execute('UPDATE save_slots SET state=? WHERE slot=3', (json.dumps(incompatible),))
        start()
        status, result = load(3, third['revision'], view_a)
        check('removed configuration items block restore without changing current save', status == 409 and result['error'] == 'save_incompatible' and state() == pending_state)
        request('saves/delete', {'slot': 3, 'revision': third['revision']})
        stop()
        start()
        check('deleted snapshot stays deleted after restart', request('saves/3')[0] == 404 and state() == pending_state)
    finally:
        stop()
        log.close()
        check('original player databases were never modified', before_hashes == {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected})

print(f'{checks} save integration checks passed; temporary data removed.')
