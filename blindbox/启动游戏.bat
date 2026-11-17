@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if exist "..\启动奇物百货.bat" if exist "..\web\index.html" (
  call "..\启动奇物百货.bat" %*
  exit /b
)
set "WEB=%~dp0."
if exist "dist\index.html" set "WEB=%~dp0dist"
if exist "web\index.html" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [错误] 源码版需要 Node.js 22.12 或更高版本。
    goto :fail
  )
  if not exist "node_modules\vite\package.json" (
    call npm ci
    if errorlevel 1 goto :fail
  )
  node scripts\build-web.mjs --if-needed
  if errorlevel 1 goto :fail
  set "WEB=%~dp0dist"
)
REM 有源码时自动编译；纯试玩包仍可直接使用预编译程序。
if exist "server\src\game_config.cpp" (
  if not exist "server\编译.bat" goto :missingbuild
  call "server\编译.bat" nopause
  if errorlevel 1 goto :fail
  cd /d "%~dp0"
)
if not exist "blindbox-server.exe" (
  echo [错误] 找不到 blindbox-server.exe，请恢复完整的游戏包。
  goto :fail
)
"%~dp0blindbox-server.exe" --check-config
if errorlevel 1 goto :fail
if exist "server\build.ps1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\build.ps1" -StopRunning
  if errorlevel 1 goto :fail
)
echo 正在启动开盲盒…（关闭所有游戏网页后会自动退出，无需按 Ctrl+C）
"%~dp0blindbox-server.exe" --web "%WEB%" --models "%~dp0models" --db "%~dp0data\blindbox-save.db" --exit-on-close --open %*
if errorlevel 1 goto :fail
exit /b 0
:missingbuild
echo [错误] 缺少 server\编译.bat，请恢复完整的源码目录。
:fail
echo.
echo [错误] 游戏未能更新或启动，请查看上面的错误信息。
pause
exit /b 1
