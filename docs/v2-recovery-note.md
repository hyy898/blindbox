# 第二轮远程与存档保护记录

日期：2026-11-14（北京时间）。所有备份保存在仓库旁的 `../qiwu-v2-backup-20261114/`，未纳入产品数据或 Git 提交。

## 远程获取

命令行 `git fetch origin` 因当前终端没有可用 GitHub 登录凭据失败；GitHub 连接器也未取得该仓库权限。随后使用已登录的 GitHub Desktop，在 `blindbox` / `feat/qiwu-storefront` 上只执行了 **Fetch origin**，界面确认 `fetch complete`。没有切换分支、Pull、Push、恢复暂存或操作凭据。

获取后所有远程分支引用确认只有 `origin/main`（及指向它的 `origin/HEAD`），提交仍为：

`0e83f6f700f143ab34cb38bd854c6f525a696aca`

这是“添加盲盒游戏源码、开发脚本和模型资源”补传提交，提交时间为 2026-11-14 22:33:44 +0800。已到本地的补传就是本次获取时的最新远程状态。

## 回退点

第一版恢复后建立了本地检查点 `ab287be`，标签 `qiwu-v1-checkpoint-20261114`。原 GitHub Desktop stash 未删除。工作区备份和恢复前补丁也保存在上述外部备份目录中。

## 一致存档快照

检查时原 `blindbox/data/` 没有活跃文件使用者。先前复制的原数据库及 WAL 组合在备份目录内打开，再通过 SQLite backup 形成独立快照；没有打开原数据库进行写入，也没有将任何新数据库覆盖回项目。

| 快照文件 | 完整性 | 保存的有效进度 |
| --- | --- | --- |
| `blindbox-save-consistent-copy.db` | `PRAGMA integrity_check = ok` | 500000 金币、0 盒、无 pending、无收藏 |
| `dev-save-consistent-copy.db` | `PRAGMA integrity_check = ok` | 500000 金币、0 盒、无 pending、无收藏 |
| `v1-preview-consistent.db` | `PRAGMA integrity_check = ok` | 498100 金币、6 盒、无 pending、仓库 1 件、展柜 5 款 |

第三份快照通过 SQLite 在线 backup 从仍在运行的第一版隔离服务创建；源路径为 `/private/var/folders/3d/7hrtd1g548jbt4vhydqw3zp40000gn/T/qiwu-preview-h8q6gP/blindbox-save.db`。未停止该服务，未修改金币或收藏。

备份清单及 SHA256 见外部目录中的 `verified-database-snapshots.json`；进度摘要见 `snapshot-state-summary.json`。另已保存已验证的 Apple Silicon 服务到 `verified-v1-service/`，文件内容与项目中的原服务完全相同。

检查结束时，项目原 `blindbox-save.db`、`dev-save.db`、`dev-save.db-wal` 均与 Git HEAD 内对应文件逐字节一致。SQLite 共享内存 `.db-shm` 是派生运行文件，不属于本轮产品代码，也不应作为有效进度替代品。

恢复任何快照前应先停止使用目标数据库的服务，保留目标现状备份，再按 SQLite 的数据库及 sidecar 一致性要求恢复；本轮未执行恢复覆盖。


## 第二轮结束补充

另存 `v2-preview-consistent.db` 与 `v2-recording-consistent.db`，完整性均为 `ok`。前者保留共享试玩的 11 盒、497600 金币、2 件仓库、8 款入柜及 `u11/ms-05` 待安置结果；没有替用户处理该结果。后者是独立录制会话的 1 盒、499900 金币与已入柜辣椒。

最终实际录制的逐帧截图、时间记录与 GIF 转换脚本在 `final-recording/` 和 `make-demo.swift` 中；主预览 8785 保持运行，录制及资源工作台的临时服务已关闭。
