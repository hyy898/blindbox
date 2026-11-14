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
