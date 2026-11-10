@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 优先启动 C++ 游戏服务器（规则和存档由服务器负责）。
REM 服务器启动失败时自动退回单机模式（普通静态服务器，存档在浏览器里）。
if exist "blindbox-server.exe" (
  echo 正在启动开盲盒游戏服务器…（关闭本窗口 = 退出游戏服务器）
  "%~dp0blindbox-server.exe" --open
  if not errorlevel 1 exit /b 0
  echo.
  echo 游戏服务器没能启动，改用单机模式…
)
if exist "staticserver.exe" (
  start "" "%~dp0staticserver.exe"
  exit /b 0
)
REM 再退一步：PowerShell 自带的 HttpListener（免安装）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动游戏.ps1" -LocalOnly
