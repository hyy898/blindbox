#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.12 或更高版本，再打开奇物百货。'
  read -r -p '按回车关闭。' _
  exit 1
fi
if [ ! -f node_modules/vite/package.json ]; then npm ci; fi
npm run build
npm start -- --open "$@"

# 只收起 Finder 双击打开、且任务已经结束的独立终端窗口。
if [ "${TERM_PROGRAM:-}" = Apple_Terminal ] && [ -t 0 ]; then
  GAME_TTY=$(tty)
  nohup /usr/bin/osascript "$PWD/blindbox/server/close-terminal.applescript" "$GAME_TTY" >/dev/null 2>&1 </dev/null &
fi
