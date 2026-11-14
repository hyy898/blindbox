# 第二轮后端与保底核对

核对日期：2026-11-14，北京时间。来源提交：`0e83f6f700f143ab34cb38bd854c6f525a696aca`。本记录针对补传源码与第一版实际使用的 macOS arm64 服务，测试全部使用临时目录、独立端口和临时 SQLite；未替换项目服务程序，未访问个人存档。

## 补传与版本对应

上游新增了 `blindbox/server/src/` C++ 源码、SQLite/HTTP/JSON 依赖、macOS/Linux/Windows 构建脚本，以及经济规则、HTTP、浏览器会话和启动器测试。此次提交没有替换已有三平台二进制，也没有提供新数据库供迁移覆盖。旧前端源码在 `blindbox/web/`，不应覆盖第一版的根 `web/`。

已用 Apple clang 17.0.0、arm64-apple-darwin24.6.0 在 `/private/tmp/qiwu-v2-backend-audit/` 编译补传源码。源码与现行程序均报告 HTTP 版本 `4.1.0`、配置版本 `1`。完整 `--dump-config` 输出经 `cmp` 比较完全一致，包括四系列、31 款、价格、掉率、权重、卖价、模型路径与开局配置。

| 对照 | 实际结果 |
| --- | --- |
| 源码编译及内置配置检查 | 通过，4 个系列、31 款 |
| 上游经济规则测试 | 157 项检查通过（独立概率、防重复、收藏流转、旧状态迁移等） |
| 上游 HTTP/SQLite 测试：现行程序 | 73 项通过 |
| 同一 HTTP/SQLite 测试：新编译程序 | 73 项通过 |
| 同种子逐步对照 | 以 `20261114` 为种子，80 次四系列轮换抽取，以及重复开盒拒绝、安置、重看、售回和移除旧接口等，共 330 个 HTTP 响应完全一致 |
| 数据库结构与续档 | 两程序生成的 `sqlite_master` 结构相同；各自重启后，完整 state 保持一致 |

现行程序 SHA256：`d0b12bb1f12bea820e3bf27b9f6ef7b48bd18290aed262418043ff3c191b90d1`。
新编译程序 SHA256：`f8d7f3de255af48b6c909060075311eccb48a6e2e0954ec0d32da6858d121ab3`。

**结论：补传源码已通过本轮业务与存档兼容性对照，可纳入工程维护；这不是二进制字节级复现证明。** 两份可执行文件哈希不同。本轮无需为视觉与模型接入替换默认稳定服务；保留现行程序作为运行基线更便于回退。Intel macOS、Windows 与 Linux 没有在本轮分别编译实测。

## 当前保底事实

| 问题 | 实际实现 |
| --- | --- |
| 是否存在连续次数保底 | 不存在。`Economy::open()` 每次独立调用 `rollRarity(series)`。没有硬保底，也没有随抽数提高概率的软保底。 |
| 当前保证什么 | 启用同稀有度防重复：先按当前系列的固定掉率抽稀有度，再在该系列、该稀有度的“从未拥有过”款式中按 weight 抽取。不是保证下一盒的稀有度，也不是保证特定款。 |
| 范围 | 候选池按系列和稀有度划分。`everOwned` 虽是全局 ID 集合，每个 ID 唯一属于一个系列，筛选仅作用于当前候选池。 |
| 何时出现重复 | 当前系列该稀有度的所有款都曾拥有后，使用完整候选池继续按权重抽。不会清空 everOwned 开始新轮。 |
| 计数 | `boxesOpened` 是全部系列合计的成功付费抽盒数；`coinsSpent` 是总支出。没有按系列的连续未中计数或任何保底计数器。仓库重新查看不增加这两个值。 |
| 重置条件 | 售回、入仓、入展柜及从展柜取回都不清除 everOwned。仅显式 `/api/reset` 新开局会清空历史与统计；正常刷新/重启不清除。 |
| 持久化 | coins、boxesOpened、coinsSpent、everOwned、pending、storage、showcase 等序列化到 SQLite `players.state` JSON。 |
| 权威位置 | 配置位于 `game_config.cpp`；随机抽取与规则位于 `economy.cpp`。前端仅读取 `/api/config` 和 `/api/state`，不应制造保底承诺或另算计数。 |

实际四系列分布（普通／稀有／史诗／隐藏款）仍为：深夜食堂 `60% / 30% / 8.5% / 1.5%`，打工动物 `60% / 25% / 12% / 3%`，怪奇家电 `68% / 22% / 6% / 4%`，奶蛙一家 `73% / 20% / 5% / 2%`。未修改任何值。

另有破产补助，和抽取保底无关：金币少于最便宜盒价、仓库为空且无 pending 时，原配置发放 200 金币并增加 `bailoutCount`；展柜归属不影响领取。该值是核对到的现行配置，并非本轮新决定。

相关源文件：`blindbox/server/src/game_config.cpp`、`economy.cpp`、`economy.h`、`routes.cpp`、`store.cpp`。

## 存档与旧版本边界

服务通过一把进程内互斥锁串行处理“读档—操作—成功保存—响应”。成功开盒将扣费、抽取结果、统计与 pending 一起写入同一份 state；失败操作不保存。有 pending 时再次 `/api/open` 被拒绝。SQLite 使用 WAL，`players` 表保存完整 JSON，而不是额外建立保底表。

`GET /api/state` 本身会经过保存流程，可能落盘旧状态迁移，因此不能把对用户原存档的 GET 一概当作无写入操作。本次对照只使用隔离存档。

旧 `pity`、`tokens`、`shop` 字段不会写回。旧进行中委托只退还个人垫款（rulesVersion ≥ 2）或更旧保证金，不发顾客余款；结束的委托不退款；迁移保存后不重复退款。两份程序的 73 项 HTTP 检查均覆盖这部分。

锁仅在同一服务进程内生效。不要启动多个可写服务共用同一 SQLite 文件；隔离预览必须使用独立数据库。此边界不是本轮新增行为。

## 团队待确定事项

如后续确实要增加保底，需要团队确定：保证目标（稀有度、指定款或未拥有款）、硬保底还是概率递增、按系列还是全局累计、哪些抽取计入、何时重置、与防重复的先后关系、老档如何初始化。具体阈值与概率尚未确定，本轮没有自行设定，也没有新增前端保底计数器。这不阻塞视觉和真实模型接入。

## 可重复验证

下列路径为本轮审计临时目录；编译输出始终与项目二进制分离：

```sh
OUT=/private/tmp/qiwu-v2-backend-audit/rebuilt-server \
  sh /private/tmp/qiwu-v2-backend-audit/blindbox/server/build.sh
node --test /private/tmp/qiwu-v2-backend-audit/blindbox/tests/economy.test.mjs
python3 /private/tmp/qiwu-v2-backend-audit/blindbox/server/tests/api_test.py \
  /private/tmp/qiwu-v2-backend-audit/rebuilt-server
python3 /private/tmp/qiwu-v2-backend-audit/blindbox/server/tests/api_test.py \
  /private/tmp/qiwu-v2-backend-audit/shipped-server
python3 /private/tmp/qiwu-v2-backend-audit/compare.py
```
