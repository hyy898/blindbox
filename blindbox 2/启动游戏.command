#!/bin/bash
# macOS 启动器：运行 C++ 游戏服务器（同时提供网页、模型和存档），并自动打开浏览器
cd "$(dirname "$0")"
case "$(uname -m)" in
  arm64) BIN=./blindbox-server-mac-arm64 ;;
  *)     BIN=./blindbox-server-mac-x64 ;;
esac
if [ ! -f "$BIN" ]; then
  echo "[错误] 找不到 $BIN，请重新解压完整的游戏包。"
  read -r _
  exit 1
fi
# 从网上下载的文件会被加"隔离"标记，去掉后才能运行（程序未签名）
xattr -d com.apple.quarantine "$BIN" 2>/dev/null
chmod +x "$BIN" 2>/dev/null
echo "正在启动开盲盒…（玩的时候不要关闭本窗口；关闭本窗口 = 退出游戏）"
if ! "$BIN" --open; then
  echo
  echo "[错误] 游戏没能启动，请把上面的信息截图发给开发者。按回车关闭。"
  read -r _
fi
