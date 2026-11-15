#!/usr/bin/env python3
"""Read-only user data: every mutated model and database lives in a temp directory."""
import json, os, platform, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
name = 'blindbox-server-mac-arm64' if platform.machine() == 'arm64' else 'blindbox-server-mac-x64'
checks = 0
def check(label, value):
    global checks
    assert value, label
    checks += 1
    print('PASS ' + label, flush=True)
with tempfile.TemporaryDirectory(prefix='qiwu-model-test-') as tmp:
    root = Path(tmp); models = root / 'models'; models.mkdir()
    (root / 'index.html').write_text('<h1>model test</h1>')
    binary = root / name; shutil.copy2(ROOT / 'blindbox' / name, binary); binary.chmod(0o755)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}/'
    def request(path, headers=None, method='GET'):
        req = urllib.request.Request(base + path, headers=headers or {}, method=method)
        try: response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error: response = error
        with response: return response.status, response.headers, response.read()
    def catalog():
        code, headers, body = request('api/models')
        assert code == 200 and headers['Cache-Control'] == 'no-store'
        return json.loads(body)['models']
    with (root / 'server.log').open('w') as log:
        proc = subprocess.Popen([str(binary), '--port', str(port), '--db', str(root / 'test.db'), '--models', str(models), '--web', str(root)], stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                try:
                    if request('api/health')[0] == 200: break
                except OSError: pass
                time.sleep(.05)
            initial = catalog()
            check('all 31 configured identities reported', len(initial) == 31)
            check('missing assets explicitly unavailable', all(v['available'] is False and v['url'] is None for v in initial.values()))
            model = models / 'ms-06.glb'; model.write_bytes(b'first-model')
            first = catalog()['ms-06']
            check('new file visible without service restart', first['available'] and first['bytes'] == 11)
            code, headers, body = request(first['url'])
            etag = headers['ETag']
            check('versioned model GET yields real bytes', code == 200 and body == b'first-model')
            check('model caching requires revalidation', headers['Cache-Control'] == 'private, no-cache')
            check('matching ETag returns 304 without body', request(first['url'], {'If-None-Match': etag})[::2] == (304, b''))
            check('HEAD returns model size', request(first['url'], method='HEAD')[1]['Content-Length'] == '11')
            old_stat = model.stat(); model.write_bytes(b'other-model'); os.utime(model, ns=(old_stat.st_atime_ns, old_stat.st_mtime_ns + 1000000000))
            second = catalog()['ms-06']
            check('same-length edited model changes version', second['version'] != first['version'])
            check('stale version cannot receive replacement bytes', request(first['url'])[0] == 409)
            code, headers, body = request(second['url'], {'If-None-Match': etag})
            check('updated model bypasses old ETag', code == 200 and body == b'other-model')
            model.unlink()
            check('removed asset immediately reported missing', catalog()['ms-06']['available'] is False)
            check('removed asset URL returns 404', request(second['url'])[0] == 404)
            outside = root / 'outside.glb'; outside.write_bytes(b'private')
            model.symlink_to(outside)
            check('symlink outside model root is unavailable', not catalog()['ms-06']['available'] and request('models/ms-06.glb')[0] == 404)
            check('unconfigured file is not exposed', request('models/README.txt')[0] == 404)
            check('API state is not cacheable', request('api/state')[1]['Cache-Control'] == 'no-store')
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
print(f'{checks} model checks passed; test files removed.')
