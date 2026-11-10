#!/bin/bash
# macOS 启动器：优先运行 C++ 游戏服务器，失败时退回单机（python3 静态服务器）
cd "$(dirname "$0")"
PORT=8765
case "$(uname -m)" in
  arm64) BIN=./blindbox-server-mac-arm64 ;;
  *)     BIN=./blindbox-server-mac-x64 ;;
esac
if [ -f "$BIN" ]; then
  # 从网上下载的文件会被加"隔离"标记，去掉后才能运行（未签名程序）
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null
  chmod +x "$BIN" 2>/dev/null
  echo "正在启动开盲盒游戏服务器…（关闭本窗口 = 退出）"
  "$BIN" --open && exit 0
  echo "游戏服务器没能启动，改用单机模式…"
fi
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "未找到 python3。请安装 Python，或用 VS Code 的 Live Server 打开本文件夹里的 index.html。"
  read -r _
  exit 1
fi
(sleep 0.5; open "http://127.0.0.1:${PORT}/" 2>/dev/null || xdg-open "http://127.0.0.1:${PORT}/" 2>/dev/null &)
echo "开盲盒（单机模式）: http://127.0.0.1:${PORT}/"
echo "不要关闭本窗口。Ctrl+C 结束。"
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
