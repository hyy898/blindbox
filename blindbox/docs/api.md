# 本机游戏接口：纯抽盒版

所有接口使用 UTF-8 JSON，无登录。每次成功的存档操作返回 `{ok:true,state,progress,...}`；失败返回 `{ok:false,error,message}`，不保存失败操作。所有存档操作由同一把锁串行处理。

| 方法 | 路径 | 参数与用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 游戏配置 |
| GET | `/api/state` | 读取或新建本机存档 |
| GET | `/api/session` | 关闭网页自动退出使用的 SSE；普通模式返回 204 |
| GET | `/api/saves` | `{ok,saves}`：列出手动记录及读档前备份摘要 |
| GET | `/api/saves/:slot` | `{ok,save}`：读取单份快照详情，不改变当前游戏 |
| POST | `/api/saves/save` | `{slot,name,revision,presentation}`，将当前服务端进度保存到 1～3 号位 |
| POST | `/api/saves/load` | `{slot,revision,presentation}`，备份当前进度后恢复选中记录 |
| POST | `/api/saves/delete` | `{slot,revision}`，删除记录，保留当前游戏进度 |
| POST | `/api/saves/new` | `{presentation}`，备份后开启全新游戏；新前端使用此路径 |
| POST | `/api/open` | `{seriesId}`，扣金币开一盒 |
| POST | `/api/showcase` | 待安置手办放进展柜 |
| POST | `/api/storage` | 待安置手办放入仓库 |
| POST | `/api/reopen` | `{uid}`，重新查看仓库手办 |
| POST | `/api/unshowcase` | `{seriesId,itemId}`，展柜手办取回仓库 |
| POST | `/api/sell` | `{from:"pending"}` 或 `{from:"storage",uid}` |
| POST | `/api/bailout` | 条件满足时发破产补助 |
| POST | `/api/reset` | `{presentation}`，备份当前进度后按当前配置重新开局，保留手动存档 |

## 配置与抽取

`config` 包含 `version`、`economy`、`rarities`、`series`。每个系列输出实际使用的 `dropRates`；每件手办输出 `weight`、`drawChance`、`sellPrice` 和模型路径。

每盒独立抽稀有度，没有连续次数保底。单款基础概率 `drawChance = dropRates[rarity] × weight / 同稀有度总权重`。启用防重复时，在同稀有度内先从从未拥有的款式里按权重抽；全部拥有过后恢复完整候选池。隐藏款的单款概率不得高于其他可抽款式。

开盒成功返回 `entry`、`price`、`bailout`、`alreadyInShowcase` 和最新存档。有待安置手办时不能继续开盒；每次只扣所选系列的盒价，不再发代币。

## 存档

`state` 包含 `coins`、`showcase`、`storage`、`everOwned`、`boxesOpened`、`coinsSpent`、`bailoutCount`、`pending`、`won`、`uidSeq`。

同款在展柜中最多一件，仓库中每个实物有独立 `uid`。仓库重开不扣金币、不增加抽盒数；卖出不清除曾拥有记录。展柜中的手办要先取回仓库才能卖出。

`progress` 包含展柜收藏进度 `owned`、`total`、`bySeries`。所有配置的款式都在展柜时完成收藏。

手动记录独立保存在同一数据库的 `save_slots` 表中，不随自动保存改变。1～3 为手动存档位，0 为最近一次读档前的备份；0 可读取或删除，不能手动覆盖。存档摘要包含名称、毫秒时间戳 `updatedAt`、`revision`、金币、藏品件数和拆封数；详情另外包含完整 `state` 与 `presentation`。

保存空位时 `revision` 传空字符串；覆盖、读档或删除时传列表返回的版本。版本不匹配返回 409 `save_changed`，不会写入。已删除记录返回 404 `save_not_found`；记录包含当前配置已移除的藏品时，读档返回 409 `save_incompatible`。

`presentation` 的格式为 `{layout:[null,null,null],preferences:{muted:true,reduced:false}}`。每个陈列位置可以是 `null` 或 `{itemId,rotation}`（角度 −180～180）。读档响应中的 `presentation` 是目标记录的设置，请求中的设置用于读档前备份。恢复与备份在同一 SQLite 事务中完成，恢复 0 号备份会交换两份进度。

`POST /api/saves/new` 在一个事务中将当前完整进度和设置保存到 0 号备份，名称为「重新开局前的进度」，随后以 `economy.newPlayer()` 替换当前进度。响应包含 `reset:true` 和新 `presentation`：三个陈列位置清空，声音与动效偏好保留。1～3 号手动记录不变。`POST /api/reset` 是兼容别名，仍接受原有空请求。新前端使用新路径，避免尚未重启的旧服务执行不含备份的重置。

## 旧存档兼容与已移除功能

不需要重置。金币、藏品、待安置手办、曾拥有记录和开盒统计保留。旧进行中委托取消：规则版本 2 退回 `personalSpent`，更旧版本退回冻结的 `deposit`；均只处理非负金额，不支付顾客剩余预算。已结束委托不退款。

读取后保存时移除旧 `shop`、`tokens`、`pity`，因此重启不重复退款。新存档和配置不包含这些字段。

旧 `/api/commission/*`、`/api/shop/decorate`、`/api/tokens/redeem` 返回 404。

## 验证

在当前仓库根目录运行 `npm test` 验证客户端操作与页面连接；`npm run test:api`、`npm run test:saves`、`npm run test:session` 和 `npm run test:start` 验证真实服务及启动器。测试自动编译源码，只使用临时数据库，并检查原有数据库的校验值。
