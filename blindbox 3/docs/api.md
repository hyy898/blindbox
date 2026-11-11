# 开盲盒后端接口文档（blindbox-server 4.1.0）

游戏只通过本机 C++ 服务器运行：网页、模型文件、规则、存档都由它提供。

- 地址：本机默认 `http://127.0.0.1:8765`（端口被占用会自动往后试 9 个）
- 格式：请求和响应都是 JSON（UTF-8）；已开启 CORS
- 单机只有一份存档：打开游戏后直接读取，不需要名字或凭证。第一次访问会自动建档
- 成功：`{"ok": true, ...数据..., "state": {...最新存档...}, "progress": {...收集进度...}}`
- 失败：`{"ok": false, "error": "错误码", "message": "中文说明"}`，HTTP 状态码 4xx/5xx
- 所有规则都在服务器上判断（扣钱、掉率、保底、防重复、卖价、补助、通关）
- 游戏内容全部来自 `server/src/game_config.cpp`

## 规则摘要

- 三种盲盒开局都能买：深夜食堂 100、打工动物 200、怪奇家电 400
- 卖价 = 稀有度基础卖价（30/80/250/1000）× 盲盒卖价倍率（1/2/4），回本率都是 98%
- 新开出的手办：放进展柜 / 放入仓库 / 卖掉；展柜里的不能卖，只能取回仓库；只有仓库里的能卖
- 保底（12 盒必出隐藏款）和防重复按每种盲盒分别计算
- 21 个手办全部放进展柜 = 通关
- 破产补助 200：买不起最便宜的盲盒 + 仓库空 + 没有展示中的手办（展柜里的不算，因为不能卖）

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 游戏配置（盲盒、手办、稀有度、经济数值） |
| GET | `/api/state` | 读取本机存档（没有则自动新建） |
| POST | `/api/open` | 买一个盲盒并打开 |
| POST | `/api/showcase` | 展示中的手办 → 展柜 |
| POST | `/api/storage` | 展示中的手办 → 仓库（点空白处） |
| POST | `/api/reopen` | 仓库里的手办 → 重新打开展示 |
| POST | `/api/unshowcase` | 展柜里的手办 → 仓库 |
| POST | `/api/sell` | 卖给系统（展示中 / 仓库里） |
| POST | `/api/bailout` | 申请破产补助 |
| POST | `/api/reset` | 重置本局进度 |

## 详细说明

### GET /api/health
```json
{"ok": true, "name": "blindbox-server", "version": "4.1.0"}
```

### GET /api/config
```json
{
  "version": 1,
  "economy": {"startCoins": 500,
              "pity": {"secretGuaranteeAfter": 12, "rarity": "secret"},
              "bailout": {"coins": 200}, "noDuplicateWithinRarityUntilOwned": true, "totalItems": 21},
  "rarities": {"common": {"label": "普通", "dropRate": 0.6, "sellPrice": 30, "color": "#9aa0a6"}, "...": {}},
  "series": [{"id": "working-animals", "name": "打工动物", "boxPrice": 200, "sellMultiplier": 2,
              "expectedSellPerBox": 196,
              "items": [{"id": "wa-01", "name": "送外卖的柯基", "rarity": "common", "desc": "...",
                         "sellPrice": 60, "weight": 1, "model": "models/wa-01.glb"}]}]
}
```
`items[].sellPrice` 是已经乘过倍率的实际卖价。

### 存档 state 字段
| 字段 | 说明 |
|---|---|
| `coins` | 金币 |
| `pity` | `{盲盒id: 连续没出隐藏款的次数}`（每种盲盒分别计） |
| `showcase` | `{盲盒id: {手办id: true}}` 展柜（每款最多 1 个） |
| `storage` | `[{uid, itemId, seriesId, rarity, forcedByPity, preferredNew}]` 仓库 |
| `pending` | 正在展示界面里、还没决定去向的手办，或 `null` |
| `everOwned` | `{手办id: true}` 开出过的（卖掉也算，用于防重复） |
| `boxesOpened` / `coinsSpent` / `bailoutCount` | 开盒数 / 买盒花费 / 领补助次数 |
| `won` | 是否已经集齐全部手办 |

### progress（读档和每个操作接口都会返回）
```json
{"owned": 12, "total": 21,
 "bySeries": {"midnight-snack": {"owned": 7, "total": 7}, "working-animals": {"owned": 4, "total": 7}, "weird-appliances": {"owned": 1, "total": 7}}}
```

### GET /api/state
无参数。没有存档时自动新建（开局 500 金币）。返回 `state` 和 `progress`。

### POST /api/open
请求：`{"seriesId": "midnight-snack"}`
```json
{"ok": true, "entry": {"uid": "u1", "itemId": "ms-04", "seriesId": "midnight-snack", "rarity": "rare",
 "forcedByPity": false, "preferredNew": true}, "price": 100, "bailout": 0, "alreadyInShowcase": false, "state": {...}}
```
- 钱不够但满足补助条件时，会先自动发补助再开（`bailout` = 补助金额）
- 抽取：先按掉率抽稀有度（这种盲盒连续 11 个没出隐藏款，第 12 个必出），再在这种盲盒同稀有度里抽；
  防重复：优先抽这种盲盒里没拥有过的；同稀有度内按 `weight` 加权
- `alreadyInShowcase = true` 表示展柜里已有这款（只能放仓库或卖掉）

错误：`unknown_series`(404)、`pending`(409 先处理展示中的)、`broke`(409 金币不足)

### POST /api/showcase
无参数。
```json
{"ok": true, "entry": {...}, "seriesComplete": false, "won": false}
```
`seriesComplete`：这种盲盒 7 个都在展柜了；`won`：这次放入让 21 个全部集齐（只在第一次为 true）。
错误：`no_pending`(409)、`already_in_showcase`(409 展柜已有同款)

### POST /api/storage
无参数。错误：`no_pending`(409)

### POST /api/reopen
请求：`{"uid": "u3"}`。返回 `entry` 和 `alreadyInShowcase`。错误：`pending`(409)、`missing`(404)

### POST /api/unshowcase
请求：`{"seriesId": "midnight-snack", "itemId": "ms-03"}`。展柜里的手办取回仓库（得到新 uid），之后才能卖。
错误：`not_in_showcase`(404)

### POST /api/sell
```json
{"from": "pending"}
{"from": "storage", "uid": "u3"}
```
返回 `{"ok": true, "price": 120, ...}`。`from` 是其他值（包括 `showcase`）一律 400。
错误：`bad_param`(400)、`no_pending`(409)、`missing`(404)

### POST /api/bailout
返回 `{"ok": true, "coins": 200}`。错误：`not_eligible`(409)

### POST /api/reset
重置为新开局（金币、展柜、仓库、开盒数清零）。通关画面仍显示当次开盒数和用时。

## 通用错误码
| 错误码 | HTTP | 含义 |
|---|---|---|
| `bad_json` | 400 | 请求体不是 JSON 对象 |
| `bad_param` | 400 | 缺少参数或类型不对（字符串最长 64） |
| `not_found` | 404 | 没有这个接口 |
| `server_error` | 500 | 服务器内部错误（不会崩溃） |
| — | 413 | 请求体超过 64KB |
