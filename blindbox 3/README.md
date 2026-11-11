# 开盲盒（开发说明）

Aholo Lux3D 黑客松原型。运行时不调用 Lux3D API。前端 three.js + Vite，后端 C++（`server/`）。
游戏只通过本机 C++ 服务器运行：服务器提供网页、模型、全部规则计算和存档。

```bash
npm install
npm run build:server    # 编译 C++ 服务器（Linux/mac；Windows 双击 server/编译.bat）
npm run build           # 网页 → dist/
npm start               # server/blindbox-server --web dist --open
npm test                # Playwright 测试（真实 UI + 真服务器，含玩到通关）
npm run test:api        # 后端接口测试
npm run simulate        # 通关模拟（开盒数 / 花费 / 补助 / 预计时长）
sh tools/package.sh     # 打包 /workspace/share/blindbox-v4.1.zip 和 blindbox-source-v4.1.zip
```

- 游戏内容唯一来源：`server/src/game_config.cpp`；网页从 `/api/config` 读取
- 规则（v4 / v4.1）：见 `design.md` 的「v4 改动」和「v4.1 改动」
- 后端说明：`server/README.md`；接口文档：`docs/api.md`
- 把 `*.glb` 按手办 id 放进 `public/models/`（或游戏包的 `models/`），缺了就显示占位体
