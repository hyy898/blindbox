@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更高版本。
  goto :fail
)
if not exist "node_modules\vite\package.json" (
  call npm ci
  if errorlevel 1 goto :fail
)
call npm run build
if errorlevel 1 goto :fail
call npm start -- --open %*
if errorlevel 1 goto :fail
exit /b 0
:fail
echo 游戏启动失败，请查看上方提示。
pause
exit /b 1
