#!/usr/bin/env python3
"""使用隔离 SQLite 存档验证纯抽盒、收藏流转、已移除接口和重启迁移。
先 npm run build:server，再 python3 server/tests/api_test.py [可执行文件]。
不修改 game_config.cpp、不访问个人存档；仅依赖 Python 标准库。
"""
import concurrent.futures
import json
import os
import platform
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = ('blindbox-server.exe' if os.name == 'nt' else
        'blindbox-server-mac-arm64' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else
        'blindbox-server-mac-x64' if platform.system() == 'Darwin' else 'server/blindbox-server')
EXE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / NAME
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    PORT = sock.getsockname()[1]
BASE = f'http://127.0.0.1:{PORT}'
checks = 0
proc = None


def check(condition, message):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def state():
    return request('/api/state')[1]['state']


def stop():
    global proc
    if proc is not None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        proc = None


with tempfile.TemporaryDirectory(prefix='blindbox-draw-api-') as directory:
    temp = Path(directory)
    db = temp / 'test.db'
    web = temp / 'web'
    web.mkdir()
    (web / 'index.html').write_text('<!doctype html><title>Isolated test</title>')
    models = temp / 'models'
    models.mkdir()
    output = (temp / 'server.log').open('w+')

    def start():
        global proc
        proc = subprocess.Popen([str(EXE), '--port', str(PORT), '--db', str(db), '--web', str(web),
                                 '--models', str(models), '--seed', '20261110'], stdout=output, stderr=output)
        for _ in range(100):
            if proc.poll() is not None:
                output.seek(0)
                raise RuntimeError(output.read())
            try:
                if request('/api/health')[0] == 200:
                    return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(.05)
        raise RuntimeError('Test server did not start')

    def inject(value):
        stop()
        with sqlite3.connect(db) as connection:
            connection.execute('UPDATE players SET state = ?', (json.dumps(value, ensure_ascii=False),))
        start()

    try:
        start()
        cfg = request('/api/config')[1]
        initial = state()
        series = cfg['series']
        items = {i['id']: dict(i, seriesId=s['id']) for s in series for i in s['items']}
        check(not any(key in cfg or key in initial for key in ('shop', 'tokens', 'pity')), 'retired features absent from configuration and state')
        check(initial['coins'] == cfg['economy']['startCoins'], 'new game uses current starting coins')
        for s in series:
            check(abs(sum(s['dropRates'].values()) - 1) < 1e-9, 'independent distribution exported')
            for item in s['items']:
                weight = sum(i['weight'] for i in s['items'] if i['rarity'] == item['rarity'])
                check(abs(item['drawChance'] - s['dropRates'][item['rarity']] * item['weight'] / weight) < 1e-12, 'item chance includes weight')
            secret = [i['drawChance'] for i in s['items'] if i['rarity'] == 'secret']
            other = [i['drawChance'] for i in s['items'] if i['rarity'] != 'secret' and i['drawChance'] > 0]
            check(not secret or not other or max(secret) <= min(other), 'hidden item no more likely than another item')
        for path in ('/api/commission/accept', '/api/commission/draw', '/api/commission/end', '/api/shop/decorate', '/api/tokens/redeem'):
            check(request(path, {'offerId': 'flex:0', 'seriesId': series[0]['id'], 'itemId': series[0]['items'][0]['id']})[0] == 404, 'retired endpoint unavailable: ' + path)
        check(state() == initial, 'retired endpoints cannot modify state')
        check(request('/api/open', {'seriesId': 123})[0] == 400, 'typed parameter required')
        check(request('/api/open', {'seriesId': 'unknown'})[0] == 404 and state() == initial, 'unknown box has no cost')
        funded = dict(initial)
        funded['coins'] = max(100000, max(s['boxPrice'] for s in series) * 10)
        inject(funded)
        s0 = series[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(lambda _: request('/api/open', {'seriesId': s0['id']}), range(8)))
        check(sum(status == 200 for status, _ in replies) == 1, 'concurrent requests draw exactly one box')
        pending = state()
        check(pending['coins'] == funded['coins'] - s0['boxPrice'] and pending['boxesOpened'] == 1, 'cost and counters updated once')
        check(not any('tokenReward' in body for _, body in replies), 'no token rewards')
        check(request('/api/open', {'seriesId': s0['id']})[0] == 409 and state() == pending, 'pending cannot be overwritten')
        entry = pending['pending']
        stored = request('/api/storage', {})[1]['state']
        check(stored['storage'] == [entry] and stored['pending'] is None, 'collectible goes to storage')
        reopened = request('/api/reopen', {'uid': entry['uid']})[1]['state']
        check(reopened['pending'] == entry and not reopened['storage'] and reopened['boxesOpened'] == 1, 'storage reopening is not a draw')
        showcased = request('/api/showcase', {})[1]['state']
        check(showcased['showcase'][s0['id']][entry['itemId']], 'collectible enters showcase')
        check(request('/api/sell', {'from': 'showcase', 'uid': entry['uid']})[0] == 400 and state() == showcased, 'showcase cannot sell directly')
        returned = request('/api/unshowcase', {'seriesId': s0['id'], 'itemId': entry['itemId']})[1]['state']
        check(not returned['showcase'][s0['id']] and len(returned['storage']) == 1, 'showcase returns to storage')
        uid = returned['storage'][0]['uid']
        price = items[entry['itemId']]['sellPrice']
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            sales = list(pool.map(lambda _: request('/api/sell', {'from': 'storage', 'uid': uid}), range(8)))
        check(sum(status == 200 for status, _ in sales) == 1, 'concurrent sale credits once')
        sold = state()
        check(sold['coins'] == returned['coins'] + price and not sold['storage'], 'sale uses configured price')
        check(sold['everOwned'][entry['itemId']], 'sale retains ownership history')
        stop(); start()
        check(state() == sold, 'save persists after restart')
        legacy = dict(stored)
        legacy['coins'] = 1000
        legacy['tokens'] = {s0['id']: 50}
        legacy['pity'] = {s0['id']: 7}
        legacy['shop'] = {'served': 2, 'contract': {'id': 'legacy', 'rulesVersion': 2, 'budget': 800, 'remaining': 500,
            'attempts': 3, 'status': 'active', 'personalSpent': 250}}
        inject(legacy)
        migrated = state()
        check(migrated['coins'] == 1250, 'own advances refunded without customer remaining budget')
        check(migrated['storage'] == stored['storage'] and migrated['everOwned'] == stored['everOwned'], 'collectibles preserved')
        check(not any(key in migrated for key in ('shop', 'tokens', 'pity')), 'retired progression removed from save')
        with sqlite3.connect(db) as connection:
            persisted = json.loads(connection.execute('SELECT state FROM players').fetchone()[0])
        check(persisted == migrated, 'migration persisted before response')
        stop(); start()
        check(state() == migrated, 'refund not replayed after restart')
        legacy['shop']['contract']['rulesVersion'] = 1
        legacy['shop']['contract']['deposit'] = 160
        inject(legacy)
        check(state()['coins'] == 1160, 'old frozen deposit refunded')
        for status in ('succeeded', 'failed', 'cancelled'):
            legacy['shop']['contract']['status'] = status
            inject(legacy)
            check(state()['coins'] == 1000, 'ended contract not refunded')
        reset = request('/api/reset', {})[1]['state']
        check(reset['coins'] == cfg['economy']['startCoins'] and not reset['storage'] and reset['boxesOpened'] == 0, 'reset uses current configuration')
        check(not any(key in reset for key in ('shop', 'tokens', 'pity')), 'reset cannot restore retired progression')
        print(f'PASS {checks} HTTP, SQLite, concurrency and legacy migration checks')
    finally:
        stop()
        output.close()
