@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 启动 C++ 游戏服务器：它同时提供网页、模型和存档，并自动打开浏览器。
if not exist "blindbox-server.exe" (
  echo [错误] 找不到 blindbox-server.exe，请重新解压完整的游戏包。
  pause
  exit /b 1
)
echo 正在启动开盲盒…（玩的时候不要关闭本窗口；关闭本窗口 = 退出游戏）
"%~dp0blindbox-server.exe" --open
if errorlevel 1 (
  echo.
  echo [错误] 游戏没能启动，请把上面的信息截图发给开发者。
  pause
)
