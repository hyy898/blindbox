#!/bin/bash
# macOS：自动编译已修改的源码，再启动最新游戏。
set -u
cd "$(dirname "$0")" || exit 1
ROOT=$(pwd -P)
# 奇物百货源码入口位于仓库根目录；保留下面的独立试玩包启动方式。
if [ -f "$ROOT/../package.json" ] && [ -f "$ROOT/../web/index.html" ] && [ -f "$ROOT/../启动奇物百货.command" ]; then
  exec /bin/bash "$ROOT/../启动奇物百货.command" "$@"
fi
case "$(uname -m)" in
  arm64) BIN=./blindbox-server-mac-arm64 ;;
  *)     BIN=./blindbox-server-mac-x64 ;;
esac
fail() {
  echo
  echo "[错误] $1"
  if [ -t 0 ]; then read -r -p "按回车关闭。" _; fi
  exit 1
}

# 源码仓库中的试玩网页由 web/ 构建；纯试玩包直接使用已有网页。
WEB="$ROOT"
if [ -f dist/index.html ]; then WEB="$ROOT/dist"; fi
if [ -f web/index.html ]; then
  command -v node >/dev/null 2>&1 || fail "源码版需要 Node.js 22.12 或更高版本。"
  if [ ! -f node_modules/vite/package.json ]; then
    npm ci || fail "安装前端依赖失败，请检查网络和上面的信息。"
  fi
  node scripts/build-web.mjs --if-needed || fail "前端构建失败，请修正上面的错误。"
  WEB="$ROOT/dist"
fi

# 记录当前这个游戏包的旧进程；编译失败时让旧游戏继续运行。
OLD_PIDS=""
if [ -f "$BIN" ] && command -v lsof >/dev/null 2>&1; then
  OLD_PIDS=$(lsof -a -d txt -t "$ROOT/${BIN#./}" 2>/dev/null || true)
fi
if [ -f server/src/game_config.cpp ]; then
  [ -f server/build.sh ] || fail "缺少 server/build.sh，请恢复完整的源码目录。"
  OUT="../${BIN#./}" /bin/sh server/build.sh || fail "自动编译或配置检查失败。请修正上面的错误后再次启动。"
fi
[ -f "$BIN" ] || fail "找不到 $BIN，请恢复完整的游戏包。"
xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
chmod +x "$BIN" || fail "无法运行 $BIN，请检查文件权限。"
"$BIN" --check-config || fail "游戏配置有误，请检查 server/src/game_config.cpp。"

# 重复双击会重启同一游戏包的旧服务，浏览器会打开新服务的地址。
for pid in $OLD_PIDS; do
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -TERM "$pid" 2>/dev/null || true
done
echo "正在启动开盲盒…（关闭所有游戏网页后会自动退出，无需按 Ctrl+C）"
"$BIN" --web "$WEB" --models "$ROOT/models" --db "$ROOT/data/blindbox-save.db" --exit-on-close --open "$@" || fail "游戏没能启动，请查看上面的错误信息。"

# Finder 双击的独立 Terminal 窗口在 shell 结束后自动关闭；已有 shell/其他标签页不受影响。
if [ "$#" -eq 0 ] && [ "${TERM_PROGRAM:-}" = Apple_Terminal ] && [ -t 0 ] && [ -f "$ROOT/server/close-terminal.applescript" ]; then
  GAME_TTY=$(tty)
  nohup /usr/bin/osascript "$ROOT/server/close-terminal.applescript" "$GAME_TTY" >/dev/null 2>&1 </dev/null &
fi
