@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
REM 先检查内容指纹：没有变化时不需要寻找或运行编译器。
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" -CheckOnly
if not errorlevel 1 goto :success
if errorlevel 11 goto :fail
if not errorlevel 10 goto :fail

where g++ >nul 2>nul && goto :build
where cl >nul 2>nul && goto :build
REM 已安装 MSYS2 / WinLibs，但尚未手动设置 PATH 时，尝试常见位置。
for %%D in ("C:\msys64\ucrt64\bin" "C:\msys64\mingw64\bin" "C:\mingw64\bin") do (
  if exist "%%~D\g++.exe" set "PATH=%%~D;%PATH%"
)
where g++ >nul 2>nul && goto :build

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
)
if defined VSDIR if exist "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" (
  call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul
  goto :build
)
echo.
echo [错误] 修改 C++ 源码后需要 C++ 编译器。
echo 推荐安装 MSYS2，执行 pacman -S mingw-w64-ucrt-x86_64-gcc
echo 也可安装 Visual Studio，并勾选“使用 C++ 的桌面开发”。
echo 安装完成后重新双击启动游戏。详见 server\README.md。
goto :fail

:build
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 goto :fail
:success
if /i not "%~1"=="nopause" pause
exit /b 0
:fail
echo.
echo ===== 自动编译失败，请修正上面的错误后再次启动 =====
if /i not "%~1"=="nopause" pause
exit /b 1
