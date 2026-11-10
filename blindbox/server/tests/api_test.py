#!/usr/bin/env python3
"""
blindbox-server 接口测试（只用 Python 标准库）

用法：
    python3 server/tests/api_test.py [服务器可执行文件路径]
默认找 server/blindbox-server。脚本会用临时数据库、固定种子启动服务器，测完自动关闭。
"""
import json, os, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
EXE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'blindbox-server')
PORT = 9311
BASE = f'http://127.0.0.1:{PORT}'
results = []


def check(name, cond, extra=None):
    results.append((name, bool(cond)))
    print(('PASS' if cond else 'FAIL'), name, '' if extra is None else json.dumps(extra, ensure_ascii=False)[:300])


def req(method, path, body=None, token=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    if headers: h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.startswith('{') else txt), dict(resp.headers)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try: j = json.loads(txt)
        except Exception: j = txt
        return e.code, j, dict(e.headers)


def new_player(nick='测试'):
    s, j, _ = req('POST', '/api/player', {'nickname': nick})
    assert s == 200, j
    return j['token'], j


def start_server(db, web):
    p = subprocess.Popen([EXE, '--port', str(PORT), '--db', db, '--seed', '20261110', '--web', web],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(50):
        try:
            if req('GET', '/api/health')[0] == 200: return p
        except Exception:
            time.sleep(0.1)
    raise SystemExit('服务器没启动起来')


tmp = tempfile.mkdtemp()
db = os.path.join(tmp, 'test.db')
web = os.path.join(HERE, '..', '..', 'dist')
proc = start_server(db, web)

try:
    # ---------- 基础 ----------
    s, h, hdr = req('GET', '/api/health')
    check('health', s == 200 and h['ok'] and h['name'] == 'blindbox-server', h)
    check('cors_header', hdr.get('Access-Control-Allow-Origin') == '*')
    s, cfg, _ = req('GET', '/api/config')
    items = {it['id']: it for se in cfg['series'] for it in se['items']}
    SER = [se['id'] for se in cfg['series']]
    PITY = cfg['economy']['pity']['secretGuaranteeAfter']
    check('config_from_cpp', s == 200 and PITY == 12 and len(SER) == 3 and len(items) == 21
          and cfg['economy']['startCoins'] == 500 and cfg['economy']['bailout']['coins'] == 200, {'pity': PITY})
    s, _, _ = req('OPTIONS', '/api/open')
    check('cors_preflight', s == 204)

    # ---------- 非法请求 ----------
    tok, pj = new_player('老板')
    check('create_player', pj['state']['coins'] == 500 and len(tok) >= 32 and pj['player']['nickname'] == '老板', pj['player'])
    check('reject_no_token', req('POST', '/api/open', {'seriesId': SER[0]})[0] == 401)
    check('reject_bad_token', req('POST', '/api/open', {'seriesId': SER[0]}, token='x' * 48)[0] == 401)
    check('reject_bad_json', req('POST', '/api/open', raw=b'{oops', token=tok)[0] == 400)
    check('reject_missing_param', req('POST', '/api/open', {}, token=tok)[0] == 400)
    check('reject_wrong_type', req('POST', '/api/open', {'seriesId': 123}, token=tok)[0] == 400)
    check('reject_unknown_series', req('POST', '/api/open', {'seriesId': 'nope'}, token=tok)[0] == 404)
    s, j, _ = req('POST', '/api/open', {'seriesId': SER[1]}, token=tok)
    check('reject_locked_series', s == 409 and j['error'] == 'locked', j)
    check('reject_showcase_no_pending', req('POST', '/api/showcase', {}, token=tok)[0] == 409)
    check('reject_sell_bad_from', req('POST', '/api/sell', {'from': 'market'}, token=tok)[0] == 400)
    check('reject_sell_missing_uid', req('POST', '/api/sell', {'from': 'storage', 'uid': 'u999'}, token=tok)[0] == 404)
    check('reject_sell_not_in_showcase', req('POST', '/api/sell', {'from': 'showcase', 'seriesId': SER[0], 'itemId': 'ms-07'}, token=tok)[0] == 404)
    s, j, _ = req('POST', '/api/bailout', {}, token=tok)
    check('reject_bailout_when_rich', s == 409 and j['error'] == 'not_eligible', j)
    check('unknown_api_404', req('GET', '/api/nope')[0] == 404)
    check('db_not_downloadable', req('GET', '/data/blindbox-save.db')[0] == 404)
    check('reject_huge_body', req('POST', '/api/open', raw=b'{"seriesId":"' + b'a' * 70000 + b'"}', token=tok)[0] in (400, 413))

    # ---------- 开盒 / 卖 / 展柜 ----------
    s, o, _ = req('POST', '/api/open', {'seriesId': SER[0]}, token=tok)
    check('open_deducts_coins', s == 200 and o['state']['coins'] == 400 and o['state']['pending']['itemId'] == o['entry']['itemId'], o['entry'])
    s, j, _ = req('POST', '/api/open', {'seriesId': SER[0]}, token=tok)
    check('reject_open_while_pending', s == 409 and j['error'] == 'pending')
    s, sc, _ = req('POST', '/api/showcase', {}, token=tok)
    first_id = o['entry']['itemId']
    check('showcase_puts_item', s == 200 and sc['where'] == 'showcase' and sc['state']['showcase'][SER[0]].get(first_id), sc.get('where'))
    s, o2, _ = req('POST', '/api/open', {'seriesId': SER[0]}, token=tok)
    price = items[o2['entry']['itemId']]['sellPrice']
    s, sp, _ = req('POST', '/api/sell', {'from': 'pending'}, token=tok)
    check('sell_pending_adds_price', s == 200 and sp['price'] == price and sp['state']['coins'] == 300 + price, {'price': price})
    check('ever_owned_after_sell', sp['state']['everOwned'].get(o2['entry']['itemId']) is True)
    s, sv, _ = req('POST', '/api/sell', {'from': 'showcase', 'seriesId': SER[0], 'itemId': first_id}, token=tok)
    check('sell_from_showcase', s == 200 and not sv['state']['showcase'][SER[0]].get(first_id))

    # ---------- 金币不会变负数 ----------
    tok2, _ = new_player('穷鬼')
    for _ in range(5):
        req('POST', '/api/open', {'seriesId': SER[0]}, token=tok2)
        req('POST', '/api/storage', {}, token=tok2)
    s, j, _ = req('POST', '/api/open', {'seriesId': SER[0]}, token=tok2)
    st = req('GET', '/api/state', token=tok2)[1]['state']
    check('coins_never_negative', s == 409 and j['error'] == 'broke' and st['coins'] == 0 and len(st['storage']) == 5, {'coins': st['coins']})
    check('no_bailout_with_sellables', req('POST', '/api/bailout', {}, token=tok2)[0] == 409)
    uid = st['storage'][0]['uid']
    s, ro, _ = req('POST', '/api/reopen', {'uid': uid}, token=tok2)
    check('reopen_from_storage', s == 200 and ro['state']['pending']['uid'] == uid and len(ro['state']['storage']) == 4)
    req('POST', '/api/storage', {}, token=tok2)

    # ---------- 破产补助 ----------
    got_bailout = None
    for _ in range(400):
        st = req('GET', '/api/state', token=tok2)[1]['state']
        for e in st['storage']:
            req('POST', '/api/sell', {'from': 'storage', 'uid': e['uid']}, token=tok2)
        st = req('GET', '/api/state', token=tok2)[1]['state']
        if st['coins'] < 100:
            s, b, _ = req('POST', '/api/bailout', {}, token=tok2)
            got_bailout = (s, b.get('coins'), b['state']['coins'] if s == 200 else None, st['coins'])
            break
        req('POST', '/api/open', {'seriesId': SER[0]}, token=tok2)
        req('POST', '/api/sell', {'from': 'pending'}, token=tok2)
    check('bailout_when_broke', got_bailout and got_bailout[0] == 200 and got_bailout[1] == 200
          and got_bailout[2] == got_bailout[3] + 200, got_bailout)
    s, j, _ = req('POST', '/api/bailout', {}, token=tok2)
    check('bailout_not_twice', s == 409)

    # ---------- 并发：同时发 20 个开盒，只能成功 1 个（不能刷）----------
    tok3, _ = new_player('并发')
    codes = []
    def hit():
        codes.append(req('POST', '/api/open', {'seriesId': SER[0]}, token=tok3)[0])
    ts = [threading.Thread(target=hit) for _ in range(20)]
    [t.start() for t in ts]; [t.join() for t in ts]
    st = req('GET', '/api/state', token=tok3)[1]['state']
    check('concurrent_open_once', codes.count(200) == 1 and st['coins'] == 400 and st['boxesOpened'] == 1, {'ok': codes.count(200)})

    # ---------- 完整通关：保底、防重复、记录、排行榜 ----------
    def playthrough(nick):
        t, _ = new_player(nick)
        run = 0; max_run = 0; forced = 0; forced_ok = True; dupe_violation = 0; boxes = 0
        owned = set()
        for _ in range(3000):
            st = req('GET', '/api/state', token=t)[1]['state']
            if st['won']: break
            target = next(sid for sid in SER if st['unlocked'][sid] and not all(
                st['showcase'].get(sid, {}).get(i) for i in [x['id'] for se in cfg['series'] if se['id'] == sid for x in se['items']]))
            if st['coins'] < 100:
                # 钱不够：先卖仓库；仓库空了就卖展柜里最便宜的（优先已集齐的系列，奖励不会收回）；
                # 都没有才领破产补助 —— 和真人玩法一样
                if st['storage']:
                    req('POST', '/api/sell', {'from': 'storage', 'uid': st['storage'][0]['uid']}, token=t); continue
                cands = [(sid in st['rewarded'], -items[i]['sellPrice'], sid, i)
                         for sid, o in st['showcase'].items() for i, v in o.items() if v]
                if cands:
                    _, _, sid, i = max(cands)
                    req('POST', '/api/sell', {'from': 'showcase', 'seriesId': sid, 'itemId': i}, token=t); continue
                s, _, _ = req('POST', '/api/bailout', {}, token=t)
                assert s == 200
                continue
            pity_before = st['pity'][target]
            s, o, _ = req('POST', '/api/open', {'seriesId': target}, token=t)
            assert s == 200, o
            boxes += 1
            e = o['entry']
            # 防重复：同稀有度还有没拥有过的，就不能开出已拥有的
            pool = [x['id'] for se in cfg['series'] if se['id'] == target for x in se['items'] if x['rarity'] == e['rarity']]
            if e['itemId'] in owned and any(i not in owned for i in pool): dupe_violation += 1
            owned.add(e['itemId'])
            if e['forcedByPity']:
                forced += 1
                forced_ok &= (pity_before == PITY - 1 and e['rarity'] == 'secret')
            if e['rarity'] == 'secret': run = 0
            else: run += 1
            max_run = max(max_run, run)
            if o['state']['showcase'].get(target, {}).get(e['itemId']):
                req('POST', '/api/sell', {'from': 'pending'}, token=t)
            else:
                req('POST', '/api/showcase', {}, token=t)
        st = req('GET', '/api/state', token=t)[1]['state']
        return t, st, dict(boxes=boxes, forced=forced, forced_ok=forced_ok, max_run=max_run, dupe=dupe_violation)

    stats = [playthrough(f'通关{i}') for i in range(4)]
    check('playthrough_wins', all(st['won'] for _, st, _ in stats), [x for _, _, x in stats])
    # 注意：pity 按系列分别计数，所以"连续不出隐藏"要按系列看；这里 max_run 跨系列只是参考
    check('pity_triggers_by_12', all(x['forced_ok'] for _, _, x in stats) and sum(x['forced'] for _, _, x in stats) > 0,
          {'forced': [x['forced'] for _, _, x in stats]})
    check('pity_counter_never_exceeds', all(max(st['pity'].values()) < PITY for _, st, _ in stats))
    check('no_dupe_rule', all(x['dupe'] == 0 for _, _, x in stats))
    check('records_fastest_win', all(st['records']['fastestWinBoxes'] == st['boxesOpened'] for _, st, _ in stats))
    check('records_best_value', all(st['records']['bestShowcaseValue'] >= 3 * (3*30 + 2*80 + 250 + 1000) for _, st, _ in stats))
    s, lb, _ = req('GET', '/api/leaderboard?limit=5')
    fw = [r['boxes'] for r in lb['fastestWin']]
    check('leaderboard', s == 200 and len(lb['fastestWin']) == 4 and fw == sorted(fw) and len(lb['showcaseValue']) >= 4
          and lb['showcaseValue'][0]['value'] >= lb['showcaseValue'][-1]['value'], {'fastest': fw})
    check('leaderboard_hides_token', 'token' not in json.dumps(lb))

    # 严格保底检查：单个系列内，连续不出隐藏款最多 11 个
    t5, _ = new_player('保底')
    seq = []
    for _ in range(60):
        st = req('GET', '/api/state', token=t5)[1]['state']
        if st['coins'] < 100:
            if st['storage']:
                req('POST', '/api/sell', {'from': 'storage', 'uid': st['storage'][0]['uid']}, token=t5); continue
            req('POST', '/api/bailout', {}, token=t5); continue
        s, o, _ = req('POST', '/api/open', {'seriesId': SER[0]}, token=t5)
        seq.append(o['entry']['rarity'])
        req('POST', '/api/sell', {'from': 'pending'}, token=t5)
    longest = 0; cur = 0
    for r in seq:
        cur = 0 if r == 'secret' else cur + 1
        longest = max(longest, cur)
    check('pity_single_series_max_11', longest <= PITY - 1 and seq.count('secret') >= 60 // PITY, {'longest': longest, 'secrets': seq.count('secret')})

    # ---------- 重置保留记录 ----------
    t_win, st_win, _ = stats[0]
    s, r, _ = req('POST', '/api/reset', {}, token=t_win)
    check('reset_keeps_records', s == 200 and r['state']['coins'] == 500 and not r['state']['won']
          and r['state']['records']['fastestWinBoxes'] == st_win['records']['fastestWinBoxes'])

    # ---------- 网页 + 前端检测头 ----------
    s, html, hdr = req('GET', '/')
    check('serves_web', s == 200 and 'X-Blindbox-Server' in hdr)

    # ---------- 重启后存档还在 ----------
    proc.terminate(); proc.wait(5)
    proc = start_server(db, web)
    s, j, _ = req('GET', '/api/state', token=tok2)
    check('persists_across_restart', s == 200 and j['player']['nickname'] == '穷鬼')
finally:
    proc.terminate()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f"; FAILED: {failed}" if failed else ''))
sys.exit(1 if failed else 0)
