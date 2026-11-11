# 开盲盒 C++ 后端（blindbox-server）

一个 exe 搞定：**提供网页 + 模型文件 + 游戏接口 + 存档**。双击 `启动游戏.bat` 就会启动它并打开浏览器。

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
│   ├── game_config.cpp   ★ 游戏全部内容配置（盒子、手办、掉率、价格、保底……）只改这里
│   ├── config.h / .cpp   配置的数据结构、启动时校验、导出 JSON
│   ├── economy.h / .cpp  游戏规则：开盒、保底、防重复、展柜/仓库、卖出、破产补助、通关
│   ├── simulate.h / .cpp 通关模拟（--simulate，验证数值能不能通关、要玩多久）
│   ├── store.h / .cpp    SQLite 存档（本机一份，存档整体是 JSON）
│   ├── routes.h / .cpp   HTTP 接口 /api/*（读档 → 调规则 → 存档 → 回复）
│   └── main.cpp          入口：命令行参数、目录、启动服务器
├── third_party/          httplib.h、json.hpp、sqlite3.c/.h
├── tests/api_test.py     接口测试（Python 标准库）
├── 编译.bat              Windows 一键编译（自动找 g++ 或 MSVC）
├── build.sh              Linux / macOS 编译
└── CMakeLists.txt        可选：用 CMake / Visual Studio 打开
```

代码分层：`routes`（网络）→ `economy`（规则，不碰网络和数据库）→ `store`（数据库）。
看规则只看 `economy.cpp`；改数值只改 `game_config.cpp`。

## 改游戏内容

1. 打开 `src/game_config.cpp`，按注释改：
   - 经济：开局金币、保底次数和稀有度、破产补助、防重复开关
   - 稀有度：掉率（加起来必须 = 1）、基础卖价、颜色
   - 盒子（系列）：id、名字、盒价、卖价倍率（卖价 = 基础卖价 × 倍率）；顺序 = 商店里的顺序
   - 手办：id、中文名、稀有度、描述、权重、模型文件名
2. 重新编译（双击 `编译.bat`，或 VS Code 里 `Ctrl+Shift+B`）
3. 跑一次通关模拟，看看改完还好不好玩：`blindbox-server --simulate 2000`
4. 重新运行服务器。配置有错会列出所有问题并拒绝启动，例如：

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
第一次会花半分钟编 SQLite（之后不会重复编），然后生成 `blindbox-server.exe` 并检查配置。
在游戏包里编译时，会自动把 exe 复制到上一级（如果游戏正在运行，先关掉黑窗口再编译）。

还没装编译器：
- **MSYS2**（主推）：装 <https://www.msys2.org> → 打开 "MSYS2 UCRT64" 运行
  `pacman -S mingw-w64-ucrt-x86_64-gcc` → 把 `C:\msys64\ucrt64\bin` 加进系统 PATH →
  新开 cmd 运行 `g++ --version` 确认
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
EXTRA_FLAGS=-s ./build.sh     # 发布用：去掉调试信息，体积更小
```

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
  --check-config        只检查配置
  --dump-config [文件]  导出配置 JSON
  --models-readme       只生成 models/README.txt
  --simulate <局数>     通关模拟：两种策略各跑 N 局，输出开盒数/花费/补助次数/预计时长
  --seconds-per-box <秒> 模拟时每开一盒按多少秒算，默认 20
```

开发时（项目源码里）：先 `npm run build`，再 `server/blindbox-server --web dist --open`。

存档在 `data/blindbox-save.db`，删掉它 = 所有进度清零。网页上无法下载 `data/`、`.db`、`.exe`、脚本。

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

防作弊：金币、掉率、保底、防重复、卖价全部服务器计算；所有参数都校验；全局一把锁保证同一时间只改一份存档
（测试里同时发 20 个开盒请求只会成功 1 个）；SQL 全部参数绑定。

## 测试

```bash
npm run build:server   # 编译（Linux）
npm run test:api       # 48 项接口测试：开盒/展柜/仓库/卖/补助/保底/防重复/通关/非法请求/并发/重启后存档
npm test               # 浏览器测试（Playwright，真实点击 UI，连真服务器，包括玩到通关）
npm run simulate       # 通关模拟
```

## 部署

1. **本机（比赛默认）**：游戏包里已经带了 `blindbox-server.exe`，双击 `启动游戏.bat`。
   评委电脑不需要装任何东西。
2. **Docker（可选）**：在项目根目录
   ```bash
   docker build -t blindbox .
   docker run -d -p 8080:8080 -v blindbox-data:/data --name blindbox blindbox
   ```
   最终镜像基于 alpine，只有一个静态 exe + 网页。浏览器打开 `http://127.0.0.1:8080/`。

## 通关模拟结果（当前配置，2000 局 × 2 种策略，每盒按 20 秒）

| 策略 | 开盒数 中位/P90 | 买盒花费 中位/P90 | 领补助次数 中位/P90 | 预计时长 中位/P90 |
|---|---|---|---|---|
| A 先买便宜的 | 81 / 110 | 13200 / 18900 | 18 / 24 | 27 / 37 分钟 |
| B 先买贵的 | 68 / 96 | 12000 / 17400 | 22 / 27 | 23 / 32 分钟 |

所有模拟局都能通关。三种盒子回本率都是 98%，所以收入里很大一部分来自破产补助。

## 已知限制

- Windows exe 是在 Linux 上用 Zig（clang + MinGW-w64）交叉编译的，`编译.bat` 也还没在真 Windows 上跑过
- macOS 版本同样是交叉编译、未签名，未在真 Mac 上测试；`启动游戏.command` 会尝试去掉隔离标记
- Dockerfile 没有在本环境实际构建（没有 Docker）
