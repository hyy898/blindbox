#!/bin/sh
# 打包 v4.1：玩家包（含预编译服务器）+ 源码包
# 需要：node、python3，以及交叉编译工具（本机用 Zig：/opt/tc/bin/zig-*）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTDIR=${OUTDIR:-/workspace/share}
VER=${VER:-v4.1}
export PATH=/opt/tc/bin:$PATH
cd "$ROOT/server"

echo "== 编译服务器（Linux / Windows / macOS）"
CC=${CC:-zig-cc} CXX=${CXX:-zig-c++} ./build.sh
CC=zig-win-cc CXX=zig-win-c++ TARGET=windows EXTRA_FLAGS=-s OUT=build/blindbox-server.exe ./build.sh
CC=zig-mac-aarch64-cc CXX=zig-mac-aarch64-c++ EXTRA_FLAGS=-s SQLITE_OBJ=build/sqlite3-mac-arm64.o OUT=build/blindbox-server-mac-arm64 ./build.sh
CC=zig-mac-x86_64-cc CXX=zig-mac-x86_64-c++ EXTRA_FLAGS=-s SQLITE_OBJ=build/sqlite3-mac-x64.o OUT=build/blindbox-server-mac-x64 ./build.sh

echo "== 由 C++ 配置生成 models/README.txt，并跑一次通关模拟"
cd "$ROOT"
server/blindbox-server --web public --models-readme --db /tmp/bb-pkg-unused.db >/dev/null
server/blindbox-server --simulate 2000

echo "== 构建网页"
npx vite build >/dev/null

echo "== 组装玩家包"
STAGE=$(mktemp -d)
P="$STAGE/blindbox"
mkdir -p "$P/assets" "$P/models" "$P/server" "$P/docs"
cp dist/index.html "$P/index.html"
cp dist/assets/* "$P/assets/"
cp README.txt 启动游戏.bat 启动游戏.command "$P/"
cp public/models/README.txt "$P/models/"
cp public/models/*.glb "$P/models/" 2>/dev/null || true
cp server/build/blindbox-server.exe server/build/blindbox-server-mac-arm64 server/build/blindbox-server-mac-x64 "$P/"
chmod +x "$P/启动游戏.command" "$P"/blindbox-server-mac-*
cp -r .vscode "$P/.vscode"
cp docs/api.md "$P/docs/"
# 服务器源码（老板改 game_config.cpp 后在这里编译）
cp -r server/src server/third_party server/tests "$P/server/"
cp server/CMakeLists.txt server/README.md server/build.sh server/编译.bat "$P/server/"
rm -f "$OUTDIR/blindbox-$VER.zip"
(cd "$STAGE" && python3 -m zipfile -c "$OUTDIR/blindbox-$VER.zip" blindbox)

echo "== 源码包"
S="$STAGE/src/blindbox"
mkdir -p "$S"
(cd "$ROOT" && tar cf - --exclude=./node_modules --exclude=./dist --exclude=./dist-single \
   --exclude=./server/build --exclude=./server/blindbox-server \
   --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' . ) | (cd "$S" && tar xf -)
rm -f "$OUTDIR/blindbox-source-$VER.zip"
(cd "$STAGE/src" && python3 -m zipfile -c "$OUTDIR/blindbox-source-$VER.zip" blindbox)
echo "STAGE=$STAGE"
ls -la "$OUTDIR/blindbox-$VER.zip" "$OUTDIR/blindbox-source-$VER.zip"
