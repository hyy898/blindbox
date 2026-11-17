# 开盲盒 C++ 后端（blindbox-server）

一个 exe 搞定：**提供网页 + 模型文件 + 游戏接口 + 存档**。保存 `src/game_config.cpp` 后，双击根目录的 `启动游戏.command`（macOS）或 `启动游戏.bat`（Windows），会自动编译更新并打开浏览器。

- C++17，依赖全部在 `third_party/`（单头文件），不用装任何库
  - [cpp-httplib](https://github.com/yhirose/cpp-httplib) v0.18.3 —— HTTP 服务器
  - [nlohmann/json](https://github.com/nlohmann/json) v3.11.3 —— JSON
  - [SQLite](https://sqlite.org) 3.47.2 amalgamation —— 存档数据库
- 单人游戏：没有市场和交易，"卖掉"就是按固定价卖给系统
- 游戏只通过这个服务器运行；网页里不包含任何游戏规则和数值

## 目录结构

```
server/
├── src/
│   ├── game_config.cpp   ★ 游戏全部内容配置（盒子、手办、掉率、价格……）只改这里
│   ├── config.h / .cpp   配置的数据结构、启动时校验、导出 JSON
│   ├── economy.h / .cpp  游戏规则：开盒、防重复、展柜/仓库、卖出、破产补助、通关
│   ├── simulate.h / .cpp 通关模拟（--simulate，验证数值能不能通关、要玩多久）
│   ├── store.h / .cpp    SQLite 存档（本机一份，存档整体是 JSON）
│   ├── routes.h / .cpp   HTTP 接口 /api/*（读档 → 调规则 → 存档 → 回复）
│   └── main.cpp          入口：命令行参数、目录、启动服务器
├── third_party/          httplib.h、json.hpp、sqlite3.c/.h
├── tests/api_test.py     接口测试（Python 标准库）
├── 编译.bat / build.ps1  Windows 自动增量编译（自动找 g++ 或 MSVC）
├── build.sh              Linux / macOS 编译
└── CMakeLists.txt        可选：用 CMake / Visual Studio 打开
```

代码分层：`routes`（网络）→ `economy`（规则，不碰网络和数据库）→ `store`（数据库）。
看规则只看 `economy.cpp`；改数值只改 `game_config.cpp`。

## 团队开发模式

在项目根目录运行 `npm ci`、`npm run dev`，或双击 `开发模式.command` / `开发模式.bat`。启动一次后，保存 C++ 源码会自动编译并重启开发服务器，当前网页自动刷新。编译或配置检查失败时保留上一版服务，并在终端和网页显示错误；修正后保存会自动恢复。

前端可编辑源码在 `web/src/`，由 Vite 自动更新；模型放在根目录 `models/`，更新模型也会刷新网页。开发可执行文件放在 `server/build/dev/`，开发存档在 `data/dev-save.db`，不会替换试玩服务器或清空试玩进度。

开发模式常驻，关闭网页后仍继续监听源码；结束开发时按 Ctrl+C，会一并结束它创建的子进程。原试玩启动器继续支持关闭最后一页后自动退出。完整协作流程见根目录 `README.md`。

## 改游戏内容

1. 打开 `src/game_config.cpp`，按注释改：
   - 经济：开局金币、破产补助、防重复开关
   - 稀有度：默认掉率、基础卖价、颜色；每个系列末尾的 dropRates 独立配置概率，合计必须 = 1
   - 盒子（系列）：id、名字、盒价、卖价倍率（卖价 = 基础卖价 × 倍率）；顺序 = 商店里的顺序
   - 手办：id、中文名、稀有度、描述、权重、模型文件名
2. 保存后，双击**游戏根目录**的 `启动游戏.command`（Mac）或 `启动游戏.bat`（Windows）。不用再单独编译、复制程序或重建网页。
3. 启动器会按源码内容判断是否需要编译；只改 `game_config.cpp` 时会复用其他对象文件和 SQLite。编译和配置检查都成功后，才更新启动器使用的程序。
4. 同一个游戏包再次启动会关闭旧服务器；网页、模型和存档始终指向游戏根目录，新增盲盒无需删除 `data/`。开局金币只对新开局生效，已有金币和进度会保留。
5. 可选：用根目录对应平台的程序运行 `--simulate 2000` 检查数值。

配置有错会列出问题并拒绝启动，例如：

   ```
   [配置错误] game_config.cpp 有 2 个问题：
     - 所有稀有度的掉率加起来必须等于 1（现在是 1.020000）
     - 手办 id 重复: ms-01
   ```

网页不写死任何手办，全部从 `GET /api/config` 读取。想看导出的配置：`blindbox-server --dump-config config.json`。

**模型**：`.glb` 放进 exe 旁边的 `models/`，文件名 = 配置里的 `model`（默认 `<id>.glb`）。
缺的自动用占位体。服务器每次启动会重新生成 `models/README.txt`，列出所有应有的文件名和是否已放入。

## 编译

### Windows（推荐 MSYS2 的 g++）

已经有编译器就直接双击 `编译.bat`。它会按顺序找：`g++` → `cl.exe` → 自动定位 Visual Studio。
第一次会编译 SQLite 和 C++ 文件；之后只编译内容有变化的文件。
在游戏包中直接更新**根目录**的 `blindbox-server.exe`，不会再出现编译了 `server/` 中的程序、启动器却运行旧版的问题。
程序先在临时位置生成并检查配置，通过后才关闭本包的旧服务器并更新程序；失败会返回错误，不会误报成功。
启动器和编译按钮都调用同一套流程。`build.ps1` 使用 Windows 自带的 Windows PowerShell 5.1，无需另装 PowerShell。

还没装编译器：
- **MSYS2**（主推）：装 <https://www.msys2.org> → 打开 "MSYS2 UCRT64" 运行
  `pacman -S mingw-w64-ucrt-x86_64-gcc` （启动器会查找 `C:\msys64\ucrt64\bin` / `C:\msys64\mingw64\bin`）
- **WinLibs**（备选，免安装）：<https://winlibs.com> 下载 UCRT 版 zip，解压后把里面的 `mingw64\bin` 加进 PATH
- 也可以用 Visual Studio（勾选"使用 C++ 的桌面开发"），`编译.bat` 会自动找到

编出来的 exe 是静态链接的，只依赖 Windows 自带的 DLL，拷到别的电脑也能跑。

### VS Code

用 VS Code 打开**游戏根目录**（含 `server/` 的那一层）：
- `Ctrl+Shift+B`：编译（调用 `server\编译.bat`）
- 终端 → 运行任务 → "运行服务器（打开游戏）"
- `.vscode/c_cpp_properties.json` 已配好 include 路径，装 C/C++ 插件后跳转、补全都能用

### Linux / macOS

```bash
cd server
./build.sh                    # 需要 gcc/g++ 或 clang
# 游戏包中 macOS 自动更新 ../blindbox-server-mac-arm64 或 ../blindbox-server-mac-x64
# 源码目录 / Linux 默认输出 ./blindbox-server；可通过 OUT 覆盖
OUT=./blindbox-server ./build.sh  # 如需显式生成 server/ 下的程序
```

macOS 如果没有编译器，先在终端执行 `xcode-select --install`，安装完成后再次双击启动器。

内容指纹和对象文件在 `server/build/`。删除这个目录会触发一次完整编译，不会影响 `data/` 中的存档。
只有预编译程序、没有 `server/src/game_config.cpp` 的纯试玩包，仍可直接启动。

### CMake（可选）

```bash
cmake -S server -B server/build-cmake -DCMAKE_BUILD_TYPE=Release
cmake --build server/build-cmake --config Release
```
Windows 上也可以直接用 Visual Studio "打开文件夹" 选 `server/`。

## 运行

```
blindbox-server [选项]
  --host <地址>         默认 127.0.0.1（只允许本机）
  --port <端口>         默认 8765，被占用自动往后试
  --web <目录>          网页目录（含 index.html），默认 exe 所在目录
  --models <目录>       模型目录，默认 <网页目录>/models
  --db <文件>           存档，默认 <exe 目录>/data/blindbox-save.db
  --seed <数字>         固定随机种子（测试用）
  --open                启动后打开浏览器
  --exit-on-close       关闭最后一个游戏网页后自动退出（启动器默认使用）
  --check-config        只检查配置
  --dump-config [文件]  导出配置 JSON
  --models-readme       只生成 models/README.txt
  --simulate <局数>     通关模拟：两种策略各跑 N 局，输出开盒数/花费/补助次数/预计时长
  --seconds-per-box <秒> 模拟时每开一盒按多少秒算，默认 20
```

开发时（项目源码里）：先 `npm run build`，再 `server/blindbox-server --web dist --open`。

存档在 `data/blindbox-save.db`，删掉它 = 所有进度清零。网页上无法下载 `data/`、`.db`、`.exe`、脚本。

## 网页关闭后自动退出

两个根目录启动器都会加上 `--exit-on-close`。新版网页通过仓库根目录 `web/src/session.js` 保持一条 SSE 连接，服务端跟踪连接数量；最后一页断开约 5 秒后正常退出并关闭数据库。刷新有 5 秒宽限，后台页不依赖 JavaScript 定时器，不会因后台降频而误退出。仓库根目录的 `npm start -- --keep-alive` 可让开发服务常驻。

如果浏览器没有成功打开，90 秒无网页连接后也会退出。手工运行服务器时不加这个参数，仍然保持常驻，便于开发和部署。`GET /api/session` 在普通模式下返回 204。

Windows 的批处理会随程序结束。macOS 会尝试关闭 Finder 双击打开的、shell 已结束且只有一个标签页的 Terminal 窗口；不会退出整个 Terminal 应用或关闭其他工作窗口。

## 接口

完整说明见 [`docs/api.md`](../docs/api.md)。摘要：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 游戏配置（来自 game_config.cpp） |
| GET | `/api/state` | 读本机存档（没有则自动新建） |
| POST | `/api/open` | 开盒 `{seriesId}` |
| POST | `/api/showcase` | 展示中 → 展柜 |
| POST | `/api/storage` | 展示中 → 仓库 |
| POST | `/api/reopen` | 仓库 → 展示 `{uid}` |
| POST | `/api/unshowcase` | 展柜 → 仓库 `{seriesId, itemId}` |
| POST | `/api/sell` | 卖给系统 `{from: pending}` 或 `{from: storage, uid}`（展柜里的不能卖） |
| POST | `/api/bailout` | 破产补助 |
| POST | `/api/reset` | 重置本局进度 |

防作弊：金币、掉率、防重复、卖价全部服务器计算；所有参数都校验；全局一把锁保证同一时间只改一份存档
（测试里同时发 20 个开盒请求只会成功 1 个）；SQL 全部参数绑定。

## 测试

```sh
npm run build:server
npm test
python3 server/tests/api_test.py
python3 server/tests/session_test.py
```

测试使用临时源码或临时数据库，不访问个人存档。涵盖独立掉率、防重复、收藏流转、并发开盒/卖出、旧存档迁移、开发自动更新和关闭网页后退出。

## 纯抽盒版

本版已删除顾客委托、代抽、自费履约、小店装扮和代币商店，对应接口均不再提供。新配置和新存档没有 `shop`、`tokens` 或 `pity` 字段。

兼容旧存档时仅保留退款迁移：进行中旧单的个人垫款或冻结保证金退回一次，随后移除旧单。现有金币、藏品和开盒统计保留。具体掉率与玩法见根目录 `README.md`。
