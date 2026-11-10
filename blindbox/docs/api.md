# 开盲盒后端接口文档（blindbox-server v3）

- 地址：本机默认 `http://127.0.0.1:8765`（端口被占用会自动往后试 9 个）
- 格式：请求和响应都是 JSON（UTF-8）
- 跨域：已开启 CORS（`Access-Control-Allow-Origin: *`），前端放在别处也能调用
- 登录：`POST /api/player` 拿到 `token`，之后在请求头带 `Authorization: Bearer <token>`（也可以用 `X-Player-Token: <token>`）
- 成功：`{"ok": true, ...数据..., "player": {...}, "state": {...最新存档...}}`
- 失败：`{"ok": false, "error": "错误码", "message": "中文说明"}`，HTTP 状态码 4xx/5xx
- 所有规则都在服务器上判断（扣钱、掉率、保底、防重复、卖价、补助），前端传什么都只是"请求"
- 游戏内容（盒子、手办、掉率、价格）全部来自 `server/src/game_config.cpp`

## 接口一览

| 方法 | 路径 | 需要 token | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | 健康检查。前端靠它判断后端在不在 |
| GET | `/api/config` | 否 | 游戏配置（盒子、手办、稀有度、经济数值） |
| GET | `/items.json` | 否 | 同 `/api/config`（兼容旧前端） |
| POST | `/api/player` | 否 | 创建匿名玩家 |
| GET | `/api/state` | 是 | 读取自己的存档 |
| POST | `/api/open` | 是 | 买一个盲盒并打开 |
| POST | `/api/showcase` | 是 | 展示中的手办放进展柜 |
| POST | `/api/storage` | 是 | 展示中的手办放进仓库（点空白处） |
| POST | `/api/reopen` | 是 | 仓库里的手办重新打开展示 |
| POST | `/api/sell` | 是 | 卖给系统（展示中 / 仓库 / 展柜） |
| POST | `/api/bailout` | 是 | 申请破产补助 |
| POST | `/api/reset` | 是 | 重置进度（个人记录保留） |
| GET | `/api/leaderboard` | 否 | 排行榜（展柜最高总价值、最快通关） |

## 详细说明

### GET /api/health
```json
{"ok": true, "name": "blindbox-server", "version": "3.0.0", "players": 3}
```

### GET /api/config
返回格式和 `items.json` 相同：
```json
{
  "version": 1,
  "economy": {"startCoins": 500, "boxPrice": 100,
              "pity": {"secretGuaranteeAfter": 12, "rarity": "secret"},
              "bailout": {"coins": 200}, "noDuplicateWithinRarityUntilOwned": true},
  "rarities": {"common": {"label": "普通", "dropRate": 0.6, "sellPrice": 30, "color": "#9aa0a6"}, "...": {}},
  "series": [{"id": "midnight-snack", "name": "深夜食堂", "boxPrice": 100, "unlockedAtStart": true,
              "completeReward": 1500,
              "items": [{"id": "ms-01", "name": "打瞌睡的饭团", "rarity": "common", "desc": "...",
                         "sellPrice": 30, "weight": 1, "model": "models/ms-01.glb"}]}]
}
```

### POST /api/player
请求（可选昵称，最多约 8 个汉字）：`{"nickname": "老板"}`
```json
{"ok": true, "id": "p3621ccecdedb", "token": "48 位十六进制", "player": {"id": "...", "nickname": "老板"}, "state": {...}}
```
`id` 是公开的（会出现在排行榜），`token` 相当于密码，前端保存在 localStorage。

### 存档 state 字段
| 字段 | 说明 |
|---|---|
| `coins` | 金币 |
| `unlocked` | `{系列id: true/false}` |
| `pity` | `{系列id: 连续没出隐藏款的次数}` |
| `showcase` | `{系列id: {手办id: true}}` 展柜 |
| `storage` | `[{uid, itemId, seriesId, rarity, forcedByPity, preferredNew}]` 仓库 |
| `pending` | 正在展示界面里、还没决定去向的手办（同上结构）或 `null` |
| `everOwned` | `{手办id: true}` 开出过的（卖掉也算，用于防重复） |
| `rewarded` / `completedOnce` | `{系列id: true}` 已领过集齐奖励 |
| `boxesOpened` / `bailoutCount` | 开盒数 / 领补助次数 |
| `won` | 是否全部集齐 |
| `records` | `{bestShowcaseValue, fastestWinBoxes}` 个人记录 |

### POST /api/open
请求：`{"seriesId": "midnight-snack"}`
```json
{"ok": true, "entry": {"uid": "u1", "itemId": "ms-04", "seriesId": "midnight-snack", "rarity": "rare",
 "forcedByPity": false, "preferredNew": true}, "price": 100, "bailout": 0, "state": {...}}
```
- 钱不够但满足破产补助条件时，会先自动发补助再开（`bailout` 字段 = 补助金额）
- 规则：先按掉率抽稀有度（连续 11 个没出隐藏款，第 12 个必出），再在该盒子同稀有度里抽；防重复开启时优先抽没拥有过的；同稀有度内按 `weight` 加权

错误：`unknown_series`(404)、`locked`(409 未解锁)、`pending`(409 先处理展示中的)、`broke`(409 金币不足)

### POST /api/showcase
无参数。展柜已有同款时自动进仓库：
```json
{"ok": true, "where": "showcase", "entry": {...},
 "completed": {"seriesId": "midnight-snack", "name": "深夜食堂", "reward": 1500, "firstTime": true}}
```
`completed` 不为 `null` 表示这次放入让系列集齐了；第一次集齐发奖励并解锁下一个盒子。错误：`no_pending`(409)

### POST /api/storage
无参数。返回 `{"ok": true, "entry": {...}}`。错误：`no_pending`(409)

### POST /api/reopen
请求：`{"uid": "u3"}`。错误：`pending`(409)、`missing`(404)

### POST /api/sell
三种写法：
```json
{"from": "pending"}
{"from": "storage", "uid": "u3"}
{"from": "showcase", "seriesId": "midnight-snack", "itemId": "ms-03"}
```
返回 `{"ok": true, "price": 30, ...}`。从展柜卖掉会让该系列变回未集齐，但已领的奖励不收回，以后也不重复发。
错误：`bad_param`(400)、`no_pending`(409)、`missing`(404)、`not_in_showcase`(404)

### POST /api/bailout
条件：所有已解锁盒子都买不起 + 仓库和展柜都空 + 没有展示中的手办。返回 `{"ok": true, "coins": 200}`。
错误：`not_eligible`(409)

### POST /api/reset
重置为新开局，个人记录（展柜最高总价值、最快通关）保留。

### GET /api/leaderboard?limit=10
```json
{"ok": true,
 "showcaseValue": [{"rank": 1, "id": "p...", "nickname": "老板", "value": 4080}],
 "fastestWin":    [{"rank": 1, "id": "p...", "nickname": "老板", "boxes": 36}]}
```
返回本机存档里的个人记录（单机游戏，只有本机玩家）。不会返回 token。

## 通用错误码
| 错误码 | HTTP | 含义 |
|---|---|---|
| `bad_json` | 400 | 请求体不是 JSON 对象 |
| `bad_param` | 400 | 缺少参数或类型不对（字符串最长 64） |
| `no_token` / `bad_token` | 401 | 没带 token / token 无效 |
| `not_found` | 404 | 没有这个接口 |
| `server_error` | 500 | 服务器内部错误（不会崩溃） |
| — | 413 | 请求体超过 64KB |
