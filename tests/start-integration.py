#!/usr/bin/env python3
"""Check the actual Node launcher, with isolated databases and simulated tabs."""
import hashlib
import json
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data_files = [p for p in (ROOT / 'blindbox/data').glob('*') if p.is_file()]
before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in data_files}


def check(name, condition):
    assert condition, name
    print('PASS', name, flush=True)


def run(keep_alive):
    with tempfile.TemporaryDirectory(prefix='qiwu-launcher-test-') as directory:
        log = (Path(directory) / 'launcher.log').open('w+')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        args = ['node', 'scripts/start.mjs', '--isolated', '--port', str(port)]
        if keep_alive:
            args.append('--keep-alive')
        process = subprocess.Popen(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        page = None
        try:
            for _ in range(200):
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError(log.read())
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                        if json.load(response)['ok']:
                            break
                except OSError:
                    time.sleep(.05)
            else:
                raise AssertionError('Launcher did not start.')
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as response:
                check('launcher serves the rebuilt frontend', '奇物百货' in response.read().decode())
            if keep_alive:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/session', timeout=3) as response:
                    check('keep-alive disables browser-following shutdown', response.status == 204)
                time.sleep(6)
                check('development launcher stays alive without a page', process.poll() is None)
            else:
                page = socket.create_connection(('127.0.0.1', port), timeout=3)
                page.sendall(b'GET /api/session HTTP/1.1\r\nHost: localhost\r\n\r\n')
                data = b''
                while b'data: connected' not in data:
                    part = page.recv(4096)
                    assert part, data
                    data += part
                page.shutdown(socket.SHUT_RDWR)
                page.close()
                page = None
                closed_at = time.monotonic()
                check('Node launcher exits after its last tab closes', process.wait(timeout=10) == 0)
                check('launcher retains the five-second grace period', 4.8 <= time.monotonic() - closed_at < 9)
        finally:
            if page:
                page.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            log.seek(0)
            output = log.read()
            log.close()
            match = re.search(r'^存档：(.*)$', output, re.M)
            if match:
                isolated = Path(match[1]).parent.resolve()
                if isolated.parent == Path(tempfile.gettempdir()).resolve() and isolated.name.startswith('qiwu-preview-'):
                    shutil.rmtree(isolated)


run(False)
run(True)
check('original databases remain untouched', before == {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in data_files})
