param([switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 优先用 C++ 游戏服务器；它启动失败（返回非 0）时再用下面的单机静态服务器
$exe = Join-Path $root 'blindbox-server.exe'
if (-not $LocalOnly -and (Test-Path -LiteralPath $exe)) {
  Write-Host "正在启动开盲盒游戏服务器…（关闭本窗口 = 退出）"
  & $exe --open
  if ($LASTEXITCODE -eq 0) { exit 0 }
  Write-Host "游戏服务器没能启动（代码 $LASTEXITCODE），改用单机模式…"
}
$port = 8765
$prefix = "http://127.0.0.1:$port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "端口 $port 不可用，尝试 8766…"
  $port = 8766
  $prefix = "http://127.0.0.1:$port/"
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add($prefix)
  $listener.Start()
}
$url = $prefix
Write-Host "开盲盒本地服务器已启动: $url"
Write-Host "目录: $root"
Write-Host "不要关闭本窗口。Ctrl+C 结束。"
Start-Process $url
$mime = @{
  '.html'='text/html; charset=utf-8'
  '.js'='application/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8'
  '.json'='application/json; charset=utf-8'
  '.glb'='model/gltf-binary'
  '.png'='image/png'
  '.jpg'='image/jpeg'
  '.svg'='image/svg+xml'
  '.txt'='text/plain; charset=utf-8'
  '.md'='text/plain; charset=utf-8'
  '.ico'='image/x-icon'
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $path = Join-Path $root $rel
    if (-not (Test-Path -LiteralPath $path) -or (Get-Item -LiteralPath $path).PSIsContainer) {
      $res.StatusCode = 404
      $buf = [Text.Encoding]::UTF8.GetBytes('404')
      $res.OutputStream.Write($buf, 0, $buf.Length)
    } else {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
      if ($ext -eq '.json' -or $ext -eq '.glb') { $res.Headers['Cache-Control'] = 'no-store' }
      $bytes = [IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
