# Windows PowerShell 5.1（Windows 自带），由两个 .bat 调用。
param([switch]$CheckOnly, [switch]$StopRunning)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $PSScriptRoot 'blindbox-server.exe'
if (Test-Path -LiteralPath (Join-Path $root '启动游戏.bat')) {
    $binary = Join-Path $root 'blindbox-server.exe'
}
# 开发模式使用独立可执行文件，避免更新时结束试玩进程。
if ($env:BLINDBOX_OUTPUT) {
    $binary = if ([IO.Path]::IsPathRooted($env:BLINDBOX_OUTPUT)) { $env:BLINDBOX_OUTPUT } else { Join-Path $PSScriptRoot $env:BLINDBOX_OUTPUT }
}
$cache = 'build\windows'
$stamp = Join-Path $cache $(if ($env:BLINDBOX_OUTPUT) { 'dev-server.stamp.json' } else { 'server.stamp.json' })
$lock = $null
$temp = $null
$installTemp = "$binary.new-$PID"

function Hash-Text([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}
function File-Hash([string]$File) { return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash }
function Inputs-Hash {
    $files = @((Get-ChildItem -LiteralPath 'src' -File | Where-Object { $_.Extension -in '.cpp', '.h' }))
    $files += @(Get-Item -LiteralPath 'build.ps1', '编译.bat', 'third_party\httplib\httplib.h',
        'third_party\nlohmann\json.hpp', 'third_party\sqlite\sqlite3.c', 'third_party\sqlite\sqlite3.h')
    $lines = foreach ($file in ($files | Sort-Object FullName)) {
        $file.FullName.Substring($PSScriptRoot.Length + 1) + '=' + (File-Hash $file.FullName)
    }
    return Hash-Text ($lines -join "`n")
}
function Is-Current([string]$Signature) {
    if (!(Test-Path -LiteralPath $binary) -or !(Test-Path -LiteralPath $stamp)) { return $false }
    try {
        $saved = Get-Content -LiteralPath $stamp -Raw | ConvertFrom-Json
        return $saved.inputs -eq $Signature -and $saved.binary -eq (File-Hash $binary)
    } catch { return $false }
}
function Check-Config([string]$File) {
    & $File --check-config
    if ($LASTEXITCODE -ne 0) { throw '配置检查失败，请修正 server\src\game_config.cpp 后再次启动。' }
}
function Stop-Game {
    foreach ($process in @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($binary)) -ErrorAction SilentlyContinue)) {
        try { $path = $process.Path } catch { continue }
        # 只关闭这个目录的游戏，不影响其他游戏包或无关程序。
        if ([string]::Equals($path, $binary, [StringComparison]::OrdinalIgnoreCase) -and !$process.HasExited) {
            Write-Host '正在关闭这个游戏包的旧服务器…'
            Stop-Process -Id $process.Id -ErrorAction Stop
            if (!$process.WaitForExit(10000)) { throw '旧服务器未能退出，请关闭它的窗口后重试。' }
        }
    }
}
function Compile([string]$Compiler, [string[]]$CompilerArgs) {
    & $Compiler @CompilerArgs
    if ($LASTEXITCODE -ne 0) { throw '编译失败，请查看上面的 C++ 错误信息。' }
}
function Object-Current([string]$Object, [string]$Signature) {
    return (Test-Path -LiteralPath $Object) -and (Test-Path -LiteralPath "$Object.stamp") -and
        ((Get-Content -LiteralPath "$Object.stamp" -Raw) -eq $Signature)
}

try {
    if ($StopRunning) { Stop-Game; exit 0 }
    $inputs = Inputs-Hash
    if (Is-Current $inputs) {
        Write-Host '源码没有变化，直接使用已更新的程序。'
        Check-Config $binary
        exit 0
    }
    # 10 交给 .bat 定位编译器；其他非零值代表真正的错误。
    if ($CheckOnly) { exit 10 }
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $lockPath = Join-Path $PSScriptRoot "$cache\compile.lock"
    $waited = 0
    while ($null -eq $lock) {
        if ($waited++ -ge 180) { throw '等待编译超时，请关闭其他编译窗口后重试。' }
        try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] { Write-Host '另一个启动窗口正在编译，等待完成…'; Start-Sleep -Seconds 1 }
    }
    $inputs = Inputs-Hash
    if (Is-Current $inputs) { Check-Config $binary; exit 0 }

    $gcc = Get-Command 'g++.exe' -ErrorAction SilentlyContinue
    $msvc = Get-Command 'cl.exe' -ErrorAction SilentlyContinue
    if ($gcc) { $compiler = $gcc.Source; $family = 'gcc'; $suffix = 'o' }
    elseif ($msvc) { $compiler = $msvc.Source; $family = 'msvc'; $suffix = 'obj' }
    else { throw '没有找到 C++ 编译器，请通过 server\编译.bat 运行。' }
    Write-Host "检测到源码更新，正在自动编译（$family，首次较慢）…"
    $tools = Hash-Text ((File-Hash $compiler) + (File-Hash 'build.ps1') + (File-Hash '编译.bat') +
        $env:VSCMD_ARG_TGT_ARCH + $env:PROCESSOR_ARCHITECTURE)
    $headerFiles = @((Get-ChildItem -LiteralPath 'src' -Filter '*.h' -File))
    $headerFiles += @(Get-Item -LiteralPath 'third_party\httplib\httplib.h', 'third_party\nlohmann\json.hpp', 'third_party\sqlite\sqlite3.h')
    $headers = Hash-Text ($tools + (($headerFiles | Sort-Object FullName | ForEach-Object { File-Hash $_.FullName }) -join ''))
    $sqlSig = Hash-Text ($tools + (File-Hash 'third_party\sqlite\sqlite3.c') + (File-Hash 'third_party\sqlite\sqlite3.h'))
    $sqlObject = "$cache\sqlite3-$family.$suffix"
    if (!(Object-Current $sqlObject $sqlSig)) {
        Write-Host '编译 SQLite（只在首次或依赖变化时执行）…'
        if ($family -eq 'gcc') {
            Compile $compiler @('-x', 'c', '-O2', '-c', '-DSQLITE_THREADSAFE=1', '-DSQLITE_OMIT_LOAD_EXTENSION',
                '-DSQLITE_DEFAULT_FOREIGN_KEYS=1', 'third_party\sqlite\sqlite3.c', '-o', "$sqlObject.tmp")
        } else {
            Compile $compiler @('/nologo', '/O2', '/MT', '/utf-8', '/c', '/DSQLITE_THREADSAFE=1',
                '/DSQLITE_OMIT_LOAD_EXTENSION', '/DSQLITE_DEFAULT_FOREIGN_KEYS=1', 'third_party\sqlite\sqlite3.c', "/Fo$sqlObject.tmp")
        }
        Move-Item -LiteralPath "$sqlObject.tmp" -Destination $sqlObject -Force
        Set-Content -LiteralPath "$sqlObject.stamp" -Value $sqlSig -Encoding Ascii -NoNewline
    }
    $objects = @($sqlObject)
    foreach ($source in (Get-ChildItem -LiteralPath 'src' -Filter '*.cpp' -File | Sort-Object Name)) {
        $object = "$cache\$($source.BaseName)-$family.$suffix"
        $objects += $object
        $signature = Hash-Text ($headers + (File-Hash $source.FullName))
        if (!(Object-Current $object $signature)) {
            Write-Host "编译 src\$($source.Name) …"
            if ($family -eq 'gcc') {
                Compile $compiler @('-std=c++17', '-O2', '-Wall', '-Wextra', '-DNOMINMAX', '-DWIN32_LEAN_AND_MEAN',
                    '-Isrc', '-Ithird_party\httplib', '-Ithird_party\nlohmann', '-Ithird_party\sqlite',
                    '-c', "src\$($source.Name)", '-o', "$object.tmp")
            } else {
                Compile $compiler @('/nologo', '/std:c++17', '/EHsc', '/O2', '/MT', '/utf-8', '/W3', '/DNOMINMAX',
                    '/DWIN32_LEAN_AND_MEAN', '/Isrc', '/Ithird_party\httplib', '/Ithird_party\nlohmann', '/Ithird_party\sqlite',
                    '/c', "src\$($source.Name)", "/Fo$object.tmp")
            }
            Move-Item -LiteralPath "$object.tmp" -Destination $object -Force
            Set-Content -LiteralPath "$object.stamp" -Value $signature -Encoding Ascii -NoNewline
        }
    }
    $temp = "$cache\blindbox-server-$PID.exe"
    if ($family -eq 'gcc') {
        Compile $compiler (@($objects) + @('-static', '-lws2_32', '-lshell32', '-o', $temp))
    } else {
        Compile $compiler (@('/nologo', '/MT') + @($objects) + @("/Fe:$temp", '/link', 'ws2_32.lib', 'shell32.lib'))
    }
    Check-Config (Join-Path $PSScriptRoot $temp)
    if ($inputs -ne (Inputs-Hash)) { throw '编译期间源码再次变化，请保存后重新启动。' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $binary) -Force | Out-Null
    Copy-Item -LiteralPath $temp -Destination $installTemp -Force
    Stop-Game
    Move-Item -LiteralPath $installTemp -Destination $binary -Force
    @{ inputs = $inputs; binary = (File-Hash $binary) } | ConvertTo-Json |
        Set-Content -LiteralPath $stamp -Encoding Ascii
    Write-Host "已更新: $binary"
    exit 0
} catch {
    Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
    if ($temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $installTemp -Force -ErrorAction SilentlyContinue
}
