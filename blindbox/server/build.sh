#!/bin/sh
# Linux / macOS 增量编译。游戏包中直接更新启动器使用的程序。
# 可覆盖 CC / CXX / OUT / EXTRA_FLAGS；交叉编译 Windows 时设置 TARGET=windows。
set -eu
cd "$(dirname "$0")"
CC=${CC:-cc}
CXX=${CXX:-c++}
TARGET=${TARGET:-native}
EXTRA_FLAGS=${EXTRA_FLAGS:-}
PLATFORM=$(uname -s)
ARCH=$(uname -m)

if [ -z "${OUT:-}" ]; then
  if [ "$PLATFORM" = Darwin ] && [ "$TARGET" = native ] && [ -f ../启动游戏.command ]; then
    case "$ARCH" in arm64) OUT=../blindbox-server-mac-arm64 ;; *) OUT=../blindbox-server-mac-x64 ;; esac
  else
    OUT=blindbox-server
  fi
fi
if [ "$TARGET" = windows ]; then
  case "$OUT" in *.exe) ;; *) OUT="$OUT.exe" ;; esac
fi

CACHE="build/$TARGET-$PLATFORM-$ARCH"
mkdir -p "$CACHE" "$(dirname "$OUT")"
STAMP="$CACHE/$(basename "$OUT").stamp"
TEMP=""
LOCK="$CACHE/compile.lock"
LOCKED=false
cleanup() {
  [ -z "$TEMP" ] || rm -f "$TEMP"
  if [ "$LOCKED" = true ]; then rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 内容指纹不依赖文件时间：复制、解压或恢复旧时间戳后也能识别修改。
tool_settings() { printf '%s\n' "$CC" "$CXX" "$TARGET" "$PLATFORM" "$ARCH" "$EXTRA_FLAGS"; cksum build.sh; }
settings() { tool_settings; printf '%s\n' "$OUT"; }
inputs() {
  { settings; cksum src/*.cpp src/*.h third_party/httplib/httplib.h \
      third_party/nlohmann/json.hpp third_party/sqlite/sqlite3.c third_party/sqlite/sqlite3.h; } | cksum
}
is_current() {
  [ -f "$OUT" ] && [ -f "$STAMP" ] &&
    [ "$(cat "$STAMP")" = "$(printf '%s\n%s' "$INPUTS" "$(cksum < "$OUT")")" ]
}
INPUTS=$(inputs)
if is_current; then
  echo "源码没有变化，直接使用已更新的程序。"
  exit 0
fi

# 两次双击不能同时写入编译缓存；进程意外中断留下的锁可自动清理。
waited=0
while ! mkdir "$LOCK" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt 180 ]; then
    echo "[错误] 等待编译超时，请关闭其他编译窗口后重试。锁目录：$LOCK" >&2
    exit 1
  fi
  if [ -f "$LOCK/pid" ]; then
    owner=$(cat "$LOCK/pid")
    case "$owner" in ''|*[!0-9]*) echo "[错误] 无效的编译锁：$LOCK" >&2; exit 1 ;; esac
    if ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$LOCK/pid"
      rmdir "$LOCK" 2>/dev/null || true
      continue
    fi
  fi
  echo "另一个启动窗口正在编译，等待完成…"
  sleep 1
done
LOCKED=true
printf '%s\n' "$$" > "$LOCK/pid"
INPUTS=$(inputs)
if is_current; then exit 0; fi

if ! command -v "$CC" >/dev/null 2>&1 || ! command -v "$CXX" >/dev/null 2>&1; then
  echo "[错误] 修改 C++ 源码后需要 C/C++ 编译器。" >&2
  echo "macOS：在终端执行 xcode-select --install，安装完成后再次双击启动游戏。" >&2
  exit 1
fi
if [ "$PLATFORM" = Darwin ] && ! xcrun --find clang++ >/dev/null 2>&1; then
  echo "[错误] 请先执行 xcode-select --install，安装 Apple 命令行工具后重新启动。" >&2
  exit 1
fi

echo "检测到源码更新，正在自动编译（首次较慢，之后只编译改过的文件）…"
INC="-Isrc -Ithird_party/httplib -Ithird_party/nlohmann -Ithird_party/sqlite"
SQLITE_DEFS="-DSQLITE_THREADSAFE=1 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_DEFAULT_FOREIGN_KEYS=1"
if [ "$TARGET" = windows ]; then
  DEFS="-DNOMINMAX -DWIN32_LEAN_AND_MEAN"
  LIBS="-static -lws2_32 -lshell32"
else
  DEFS=""
  LIBS="-lpthread"
fi
TOOLS=$({ tool_settings; "$CC" --version; "$CXX" --version; } | cksum)
HEADERS=$({ printf '%s\n' "$TOOLS"; cksum src/*.h third_party/httplib/httplib.h third_party/nlohmann/json.hpp third_party/sqlite/sqlite3.h; } | cksum)
SQLSIG=$({ printf '%s\n' "$TOOLS"; cksum third_party/sqlite/sqlite3.c third_party/sqlite/sqlite3.h; } | cksum)
OBJ="$CACHE/sqlite3.o"
if [ ! -f "$OBJ" ] || [ "$(cat "$OBJ.stamp" 2>/dev/null || true)" != "$SQLSIG" ]; then
  echo "编译 SQLite（只在首次或依赖变化时执行）…"
  "$CC" -O2 -c $SQLITE_DEFS third_party/sqlite/sqlite3.c -o "$OBJ.tmp"
  mv -f "$OBJ.tmp" "$OBJ"
  printf '%s' "$SQLSIG" > "$OBJ.stamp"
fi
for source in src/*.cpp; do
  object="$CACHE/$(basename "$source" .cpp).o"
  signature=$({ printf '%s\n' "$HEADERS"; cksum "$source"; } | cksum)
  if [ ! -f "$object" ] || [ "$(cat "$object.stamp" 2>/dev/null || true)" != "$signature" ]; then
    echo "编译 $source …"
    "$CXX" -std=c++17 -O2 -Wall -Wextra $EXTRA_FLAGS $DEFS $INC -c "$source" -o "$object.tmp"
    mv -f "$object.tmp" "$object"
    printf '%s' "$signature" > "$object.stamp"
  fi
done

TEMP=$(mktemp "$OUT.tmp.XXXXXX")
# 使用显式列表，删除过的 .cpp 不会残留在下一次链接中。
set -- "$OBJ"
for source in src/*.cpp; do set -- "$@" "$CACHE/$(basename "$source" .cpp).o"; done
"$CXX" -std=c++17 -O2 $EXTRA_FLAGS "$@" $LIBS -o "$TEMP"
chmod +x "$TEMP"
if [ "$TARGET" != windows ]; then "$TEMP" --check-config; fi
if [ "$INPUTS" != "$(inputs)" ]; then
  echo "[错误] 编译期间源码再次变化，请保存后重新启动。" >&2
  exit 1
fi
# 只有编译和配置检查都通过，才替换启动器真正使用的程序。
mv -f "$TEMP" "$OUT"
TEMP=""
printf '%s\n%s' "$INPUTS" "$(cksum < "$OUT")" > "$STAMP.tmp"
mv -f "$STAMP.tmp" "$STAMP"
echo "已更新: $OUT"
