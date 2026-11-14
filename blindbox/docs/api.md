# 本机游戏接口：纯抽盒版

所有接口使用 UTF-8 JSON，无登录。每次成功的存档操作返回 `{ok:true,state,progress,...}`；失败返回 `{ok:false,error,message}`，不保存失败操作。所有存档操作由同一把锁串行处理。

| 方法 | 路径 | 参数与用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 游戏配置 |
| GET | `/api/state` | 读取或新建本机存档 |
| GET | `/api/session` | 关闭网页自动退出使用的 SSE；普通模式返回 204 |
| POST | `/api/open` | `{seriesId}`，扣金币开一盒 |
| POST | `/api/showcase` | 待安置手办放进展柜 |
| POST | `/api/storage` | 待安置手办放入仓库 |
| POST | `/api/reopen` | `{uid}`，重新查看仓库手办 |
| POST | `/api/unshowcase` | `{seriesId,itemId}`，展柜手办取回仓库 |
| POST | `/api/sell` | `{from:"pending"}` 或 `{from:"storage",uid}` |
| POST | `/api/bailout` | 条件满足时发破产补助 |
| POST | `/api/reset` | 按当前开局配置重置本机存档 |

## 配置与抽取

`config` 包含 `version`、`economy`、`rarities`、`series`。每个系列输出实际使用的 `dropRates`；每件手办输出 `weight`、`drawChance`、`sellPrice` 和模型路径。

每盒独立抽稀有度，没有连续次数保底。单款基础概率 `drawChance = dropRates[rarity] × weight / 同稀有度总权重`。启用防重复时，在同稀有度内先从从未拥有的款式里按权重抽；全部拥有过后恢复完整候选池。隐藏款的单款概率不得高于其他可抽款式。

开盒成功返回 `entry`、`price`、`bailout`、`alreadyInShowcase` 和最新存档。有待安置手办时不能继续开盒；每次只扣所选系列的盒价，不再发代币。

## 存档

`state` 包含 `coins`、`showcase`、`storage`、`everOwned`、`boxesOpened`、`coinsSpent`、`bailoutCount`、`pending`、`won`、`uidSeq`。

同款在展柜中最多一件，仓库中每个实物有独立 `uid`。仓库重开不扣金币、不增加抽盒数；卖出不清除曾拥有记录。展柜中的手办要先取回仓库才能卖出。

`progress` 包含展柜收藏进度 `owned`、`total`、`bySeries`。所有配置的款式都在展柜时完成收藏。

## 旧存档兼容与已移除功能

不需要重置。金币、藏品、待安置手办、曾拥有记录和开盒统计保留。旧进行中委托取消：规则版本 2 退回 `personalSpent`，更旧版本退回冻结的 `deposit`；均只处理非负金额，不支付顾客剩余预算。已结束委托不退款。

读取后保存时移除旧 `shop`、`tokens`、`pity`，因此重启不重复退款。新存档和配置不包含这些字段。

旧 `/api/commission/*`、`/api/shop/decorate`、`/api/tokens/redeem` 返回 404。

## 验证

`npm test` 验证抽盒规则、收藏流转、迁移及开发模式。`npm run build:server` 后运行 `python3 server/tests/api_test.py` 验证真实 HTTP、并发操作和 SQLite 重启续档。
