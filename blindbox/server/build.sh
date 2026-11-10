#!/bin/sh
# Linux / macOS 一键编译（不需要 CMake，只要 gcc/g++ 或 clang）
#   ./build.sh            -> 生成 ./blindbox-server
# 可用环境变量覆盖编译器：CC=clang CXX=clang++ ./build.sh
# 发布时去掉调试信息减小体积：EXTRA_FLAGS=-s ./build.sh
# 交叉编译 Windows exe（在 Linux 上）：
#   CC=x86_64-w64-mingw32-gcc CXX=x86_64-w64-mingw32-g++ TARGET=windows ./build.sh
set -e
cd "$(dirname "$0")"
CC=${CC:-cc}
CXX=${CXX:-c++}
OUT=${OUT:-blindbox-server}
mkdir -p build

INC="-Isrc -Ithird_party/httplib -Ithird_party/nlohmann -Ithird_party/sqlite"
SQLITE_DEFS="-DSQLITE_THREADSAFE=1 -DSQLITE_OMIT_LOAD_EXTENSION"

if [ "$TARGET" = "windows" ]; then
  OBJ=${SQLITE_OBJ:-build/sqlite3-win.o}
  DEFS="-DNOMINMAX -DWIN32_LEAN_AND_MEAN"
  LIBS="-static -lws2_32 -lshell32"
  case "$OUT" in *.exe) ;; *) OUT="$OUT.exe" ;; esac
else
  OBJ=${SQLITE_OBJ:-build/sqlite3.o}
  DEFS=""
  LIBS="-lpthread"
fi

# SQLite 只需编译一次（约 20 秒），之后改游戏代码不用再编它
if [ ! -f "$OBJ" ]; then
  echo "[1/2] 编译 SQLite（只需要第一次）…"
  $CC -O2 -c $SQLITE_DEFS third_party/sqlite/sqlite3.c -o "$OBJ"
fi

echo "[2/2] 编译游戏服务器…"
$CXX -std=c++17 -O2 -Wall -Wextra $EXTRA_FLAGS $DEFS $INC src/*.cpp "$OBJ" $LIBS -o "$OUT"
echo "完成: $OUT"
