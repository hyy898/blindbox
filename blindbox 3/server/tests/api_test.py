#!/usr/bin/env python3
"""
blindbox-server 接口测试（只用 Python 标准库）

用法：
    python3 server/tests/api_test.py [服务器可执行文件路径]
默认找 server/blindbox-server。脚本会用临时数据库、固定种子启动服务器，测完自动关闭。
单机只有一份存档，各段测试之间用 /api/reset 清进度。
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


def req(method, path, body=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'Content-Type': 'application/json'}
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


def reset():
    s, j, _ = req('POST', '/api/reset', {})
    assert s == 200, j
    return j


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
# 网页目录：项目源码里是 dist/，游戏包里就是根目录（index.html 所在处）
web = os.path.join(HERE, '..', '..', 'dist')
if not os.path.exists(os.path.join(web, 'index.html')):
    web = os.path.join(HERE, '..', '..')
proc = start_server(db, web)

try:
    # ---------- 基础 ----------
    s, h, hdr = req('GET', '/api/health')
    check('health', s == 200 and h['ok'] and h['name'] == 'blindbox-server' and h.get('version') == '4.1.0'
          and 'players' not in h, h)
    check('cors_header', hdr.get('Access-Control-Allow-Origin') == '*')
    s, cfg, _ = req('GET', '/api/config')
    items = {it['id']: dict(it, seriesId=se['id']) for se in cfg['series'] for it in se['items']}
    SERIES = {se['id']: se for se in cfg['series']}
    SER = [se['id'] for se in cfg['series']]
    PITY = cfg['economy']['pity']['secretGuaranteeAfter']
    PRICE = {sid: SERIES[sid]['boxPrice'] for sid in SER}
    check('config_from_cpp', s == 200 and PITY == 12 and len(SER) == 3 and len(items) == 21
          and cfg['economy']['startCoins'] == 500 and cfg['economy']['bailout']['coins'] == 200
          and cfg['economy']['totalItems'] == 21, {'prices': PRICE})
    check('box_prices_100_200_400', [PRICE[x] for x in SER] == [100, 200, 400])
    mult = {sid: SERIES[sid]['sellMultiplier'] for sid in SER}
    base = {k: v['sellPrice'] for k, v in cfg['rarities'].items()}
    check('sell_price_is_base_x_multiplier', all(it['sellPrice'] == round(base[it['rarity']] * mult[it['seriesId']]) for it in items.values()),
          {'wd-07': items['wd-07']['sellPrice'], 'wa-01': items['wa-01']['sellPrice']})
    check('return_ratio_98', all(abs(SERIES[sid]['expectedSellPerBox'] / PRICE[sid] - 0.98) < 1e-9 for sid in SER))
    check('no_items_json', req('GET', '/items.json')[0] == 404)
    s, _, _ = req('OPTIONS', '/api/open')
    check('cors_preflight', s == 204)

    # ---------- 自动建档，没有登录接口 ----------
    s, st0, _ = req('GET', '/api/state')
    check('auto_local_save', s == 200 and st0['ok'] and st0['state']['coins'] == 500
          and st0['progress'] == {'owned': 0, 'total': 21, 'bySeries': {sid: {'owned': 0, 'total': 7} for sid in SER}}
          and 'player' not in st0 and 'token' not in st0 and 'nickname' not in json.dumps(st0, ensure_ascii=False),
          {'keys': list(st0.keys())})
    check('player_endpoint_gone', req('POST', '/api/player', {})[0] == 404)
    check('leaderboard_endpoint_gone', req('GET', '/api/leaderboard')[0] == 404)

    # ---------- 非法请求 ----------
    check('reject_bad_json', req('POST', '/api/open', raw=b'{oops')[0] == 400)
    check('reject_missing_param', req('POST', '/api/open', {})[0] == 400)
    check('reject_wrong_type', req('POST', '/api/open', {'seriesId': 123})[0] == 400)
    check('reject_unknown_series', req('POST', '/api/open', {'seriesId': 'nope'})[0] == 404)
    check('reject_showcase_no_pending', req('POST', '/api/showcase', {})[0] == 409)
    s, j, _ = req('POST', '/api/sell', {'from': 'showcase', 'seriesId': SER[0], 'itemId': 'ms-01'})
    check('reject_sell_from_showcase', s == 400, j)
    check('reject_sell_missing_uid', req('POST', '/api/sell', {'from': 'storage', 'uid': 'u999'})[0] == 404)
    check('reject_unshowcase_missing', req('POST', '/api/unshowcase', {'seriesId': SER[0], 'itemId': 'ms-07'})[0] == 404)
    s, j, _ = req('POST', '/api/bailout', {})
    check('reject_bailout_when_rich', s == 409 and j['error'] == 'not_eligible', j)
    check('unknown_api_404', req('GET', '/api/nope')[0] == 404)
    check('db_not_downloadable', req('GET', '/data/blindbox-save.db')[0] == 404)
    check('reject_huge_body', req('POST', '/api/open', raw=b'{"seriesId":"' + b'a' * 70000 + b'"}')[0] in (400, 413))

    # ---------- 三种盲盒开局都能买 ----------
    s, o, _ = req('POST', '/api/open', {'seriesId': SER[2]})
    check('all_series_open_at_start', s == 200 and o['state']['coins'] == 100 and o['price'] == 400, o.get('entry'))
    s, sc, _ = req('POST', '/api/showcase', {})
    first = o['entry']
    check('showcase_puts_item', s == 200 and sc['state']['showcase'][SER[2]].get(first['itemId'])
          and sc['progress']['owned'] == 1 and sc['progress']['bySeries'][SER[2]]['owned'] == 1, sc.get('progress'))
    s, j, _ = req('POST', '/api/open', {'seriesId': SER[1]})
    check('coins_never_negative_expensive', s == 409 and j['error'] == 'broke')
    s, o2, _ = req('POST', '/api/open', {'seriesId': SER[0]})
    check('reject_open_while_pending', req('POST', '/api/open', {'seriesId': SER[0]})[1]['error'] == 'pending')
    price = items[o2['entry']['itemId']]['sellPrice']
    s, sp, _ = req('POST', '/api/sell', {'from': 'pending'})
    check('sell_pending_adds_price', s == 200 and sp['price'] == price and sp['state']['coins'] == price, {'price': price})
    check('ever_owned_after_sell', sp['state']['everOwned'].get(o2['entry']['itemId']) is True)
    # 展柜 -> 仓库 -> 卖
    s, us, _ = req('POST', '/api/unshowcase', {'seriesId': SER[2], 'itemId': first['itemId']})
    check('unshowcase_to_storage', s == 200 and not us['state']['showcase'][SER[2]].get(first['itemId'])
          and len(us['state']['storage']) == 1 and us['progress']['owned'] == 0)
    uid = us['state']['storage'][0]['uid']
    s, ro, _ = req('POST', '/api/reopen', {'uid': uid})
    check('reopen_from_storage', s == 200 and ro['state']['pending']['uid'] == uid and not ro['alreadyInShowcase'])
    req('POST', '/api/storage', {})
    coins_before = req('GET', '/api/state')[1]['state']['coins']
    s, ss, _ = req('POST', '/api/sell', {'from': 'storage', 'uid': uid})
    check('sell_from_storage_x4', s == 200 and ss['price'] == items[first['itemId']]['sellPrice']
          and ss['state']['coins'] == coins_before + ss['price'], {'price': ss['price']})

    # 重复款不能再放进展柜
    reset()
    req('POST', '/api/open', {'seriesId': SER[0]}); req('POST', '/api/showcase', {})
    dupe_seen = False
    for _ in range(60):
        st = req('GET', '/api/state')[1]['state']
        if st['coins'] < 100:
            req('POST', '/api/bailout', {}); continue
        s, o, _ = req('POST', '/api/open', {'seriesId': SER[0]})
        if o['alreadyInShowcase']:
            s2, j2, _ = req('POST', '/api/showcase', {})
            dupe_seen = s2 == 409 and j2['error'] == 'already_in_showcase'
            req('POST', '/api/sell', {'from': 'pending'})
            break
        req('POST', '/api/showcase', {})
    check('dupe_cannot_enter_showcase', dupe_seen)

    # ---------- 金币不会变负数 / 破产补助 ----------
    reset()
    for _ in range(5):
        req('POST', '/api/open', {'seriesId': SER[0]})
        req('POST', '/api/storage', {})
    s, j, _ = req('POST', '/api/open', {'seriesId': SER[0]})
    st = req('GET', '/api/state')[1]['state']
    check('coins_never_negative', s == 409 and j['error'] == 'broke' and st['coins'] == 0 and len(st['storage']) == 5, {'coins': st['coins']})
    check('no_bailout_with_storage', req('POST', '/api/bailout', {})[0] == 409)
    for e in st['storage']:  # 全放展柜（新款）或卖掉（重复）
        req('POST', '/api/reopen', {'uid': e['uid']})
        if req('POST', '/api/showcase', {})[0] != 200:
            req('POST', '/api/sell', {'from': 'pending'})
    got = None
    for _ in range(400):
        st = req('GET', '/api/state')[1]['state']
        if st['coins'] < 100 and not st['storage']:
            s, b, _ = req('POST', '/api/bailout', {})
            got = (s, b.get('coins'), b['state']['coins'] if s == 200 else None, st['coins'],
                   sum(len(v) for v in st['showcase'].values()))
            break
        req('POST', '/api/open', {'seriesId': SER[0]})
        req('POST', '/api/sell', {'from': 'pending'})
    check('bailout_when_broke_even_with_showcase', got and got[0] == 200 and got[1] == 200 and got[2] == got[3] + 200 and got[4] > 0, got)
    check('bailout_not_twice', req('POST', '/api/bailout', {})[0] == 409)

    # ---------- 并发：同时发 20 个开盒，只能成功 1 个 ----------
    reset()
    codes = []
    def hit():
        codes.append(req('POST', '/api/open', {'seriesId': SER[0]})[0])
    ts = [threading.Thread(target=hit) for _ in range(20)]
    [t.start() for t in ts]; [t.join() for t in ts]
    st = req('GET', '/api/state')[1]['state']
    check('concurrent_open_once', codes.count(200) == 1 and st['coins'] == 400 and st['boxesOpened'] == 1, {'ok': codes.count(200)})

    # ---------- 保底 / 防重复按盲盒分别算 ----------
    reset()
    seqs = {sid: [] for sid in SER}
    owned = set(); dupe_violation = 0; forced_bad = 0; forced_n = 0
    order = [SER[0]] * 3 + [SER[1]] * 2 + [SER[2]]
    for i in range(150):
        st = req('GET', '/api/state')[1]['state']
        sid = order[i % len(order)]
        if st['coins'] < PRICE[sid]:
            sid = SER[0]
            if st['coins'] < 100:
                req('POST', '/api/bailout', {}); continue
        pity_before = st['pity'][sid]
        s, o, _ = req('POST', '/api/open', {'seriesId': sid})
        e = o['entry']
        pool = [x for x, it in items.items() if it['seriesId'] == sid and it['rarity'] == e['rarity']]
        if e['itemId'] in owned and any(x not in owned for x in pool): dupe_violation += 1
        owned.add(e['itemId'])
        if e['forcedByPity']:
            forced_n += 1
            forced_bad += not (pity_before == PITY - 1 and e['rarity'] == 'secret')
        seqs[sid].append(e['rarity'])
        req('POST', '/api/sell', {'from': 'pending'})
    def longest(seq):
        best = cur = 0
        for r in seq:
            cur = 0 if r == 'secret' else cur + 1
            best = max(best, cur)
        return best
    check('pity_per_series_max_11', all(longest(v) <= PITY - 1 for v in seqs.values()) and forced_bad == 0,
          {sid: longest(v) for sid, v in seqs.items()} | {'forced': forced_n})
    st = req('GET', '/api/state')[1]['state']
    check('pity_counters_separate', set(st['pity']) == set(SER) and all(v < PITY for v in st['pity'].values()), st['pity'])
    check('no_dupe_per_series', dupe_violation == 0)

    # ---------- 完整通关：21 个全进展柜 ----------
    def playthrough():
        reset()
        won_flag = False
        for _ in range(5000):
            st = req('GET', '/api/state')[1]['state']
            todo = [sid for sid in sorted(SER, key=lambda x: PRICE[x])
                    if len(st['showcase'].get(sid, {})) < 7]
            if not todo: break
            target = todo[0]
            if st['coins'] >= PRICE[target]: sid = target
            elif st['coins'] >= 100: sid = SER[0]
            else:
                assert req('POST', '/api/bailout', {})[0] == 200; continue
            s, o, _ = req('POST', '/api/open', {'seriesId': sid})
            assert s == 200, o
            if o['alreadyInShowcase']:
                req('POST', '/api/sell', {'from': 'pending'})
            else:
                s, r, _ = req('POST', '/api/showcase', {})
                won_flag = won_flag or r['won']
        return req('GET', '/api/state')[1], won_flag

    st, wf = playthrough()
    check('win_when_all_21_in_showcase', st['state']['won'] and st['progress']['owned'] == 21 and wf,
          {'boxes': st['state']['boxesOpened']})
    check('coins_spent_tracked', st['state']['coinsSpent'] > 0)
    check('state_has_no_records', 'records' not in st['state'])
    win_boxes = st['state']['boxesOpened']
    win_coins = st['state']['coins']

    # ---------- 网页 ----------
    s, html, hdr = req('GET', '/')
    check('serves_web', s == 200 and '请双击' in html)
    check('web_has_no_records_tab', 'data-tab="records"' not in html and 'player-badge' not in html)

    # ---------- 重启后存档还在 ----------
    proc.terminate(); proc.wait(5)
    proc = start_server(db, web)
    s, j, _ = req('GET', '/api/state')
    check('persists_across_restart', s == 200 and j['state']['won'] and j['progress']['owned'] == 21
          and j['state']['boxesOpened'] == win_boxes and j['state']['coins'] == win_coins
          and 'player' not in j and 'records' not in j['state'])

    # ---------- 重置进度 ----------
    s, r, _ = req('POST', '/api/reset', {})
    check('reset_clears_progress', s == 200 and r['state']['coins'] == 500 and not r['state']['won']
          and r['progress']['owned'] == 0 and r['state']['boxesOpened'] == 0
          and not r['state']['storage'] and 'records' not in r['state'])
finally:
    proc.terminate()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f"; FAILED: {failed}" if failed else ''))
sys.exit(1 if failed else 0)
