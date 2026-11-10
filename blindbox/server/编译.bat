@echo off
chcp 65001 >nul
setlocal EnableExtensions
REM ==============================================================
REM  一键编译 blindbox-server.exe
REM  自动找编译器：先找 g++（MSYS2 / WinLibs），再找 MSVC（cl.exe）
REM  不需要 CMake。改完 src\game_config.cpp 后双击本文件即可。
REM  在 VS Code 里按 Ctrl+Shift+B 也会调用本文件。
REM ==============================================================
cd /d "%~dp0"
set "OUT=blindbox-server.exe"
set "SRC=src\main.cpp src\config.cpp src\game_config.cpp src\economy.cpp src\routes.cpp src\store.cpp"
set "SQLDEF=-DSQLITE_THREADSAFE=1 -DSQLITE_OMIT_LOAD_EXTENSION"
if not exist build mkdir build

where g++ >nul 2>nul && goto :gcc
where cl >nul 2>nul && goto :msvc

REM cl.exe 不在 PATH 里时，尝试自动找 Visual Studio 并加载它的环境
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
)
if defined VSDIR if exist "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" (
  call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul
  goto :msvc
)

echo.
echo [错误] 没找到 C++ 编译器。
echo   推荐 MSYS2：pacman -S mingw-w64-ucrt-x86_64-gcc
echo   然后把 C:\msys64\ucrt64\bin 加到 PATH，重新打开窗口，运行 g++ --version 确认。
echo   详见 server\README.md
goto :fail

:gcc
echo 使用编译器：g++
g++ --version | findstr /n "^" | findstr "^1:"
if not exist build\sqlite3-mingw.o (
  echo [1/2] 编译 SQLite（只需要第一次，约半分钟）...
  g++ -x c -O2 -c %SQLDEF% third_party\sqlite\sqlite3.c -o build\sqlite3-mingw.o || goto :fail
)
echo [2/2] 编译游戏服务器...
g++ -std=c++17 -O2 -Wall -Wextra -DNOMINMAX -DWIN32_LEAN_AND_MEAN -Isrc -Ithird_party\httplib -Ithird_party\nlohmann -Ithird_party\sqlite %SRC% build\sqlite3-mingw.o -static -lws2_32 -lshell32 -o %OUT% || goto :fail
goto :built

:msvc
echo 使用编译器：MSVC cl.exe
if not exist build\sqlite3-msvc.obj (
  echo [1/2] 编译 SQLite（只需要第一次）...
  cl /nologo /O2 /MT /c %SQLDEF% third_party\sqlite\sqlite3.c /Fobuild\sqlite3-msvc.obj || goto :fail
)
echo [2/2] 编译游戏服务器...
cl /nologo /std:c++17 /EHsc /O2 /MT /utf-8 /W3 /DNOMINMAX /DWIN32_LEAN_AND_MEAN /Isrc /Ithird_party\httplib /Ithird_party\nlohmann /Ithird_party\sqlite %SRC% build\sqlite3-msvc.obj /Fobuild\ /Fe:%OUT% /link ws2_32.lib shell32.lib || goto :fail
goto :built

:built
echo.
echo 检查配置 game_config.cpp ...
%OUT% --check-config || goto :fail

REM 在游戏包里（上一级有 index.modules.html）：把 exe 复制过去，并重新生成单机备用的 items.json
if exist "..\index.modules.html" (
  copy /y %OUT% "..\%OUT%" >nul
  %OUT% --dump-config "..\items.json" >nul
  echo 已更新 ..\%OUT% 和 ..\items.json
)
echo.
echo ===== 编译成功：%CD%\%OUT% =====
if /i not "%~1"=="nopause" pause
exit /b 0

:fail
echo.
echo ===== 编译失败，请看上面的错误信息 =====
if /i not "%~1"=="nopause" pause
exit /b 1
