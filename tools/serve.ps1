# Minimal static file server for local development (no Node/Python needed).
# Usage: powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Root . -Port 8765
#
# Also serves POST /api/modelica (used by the "Open in OpenModelica" button):
#   body JSON { name, files: { "<file>": "<text>", ... }, open: true|false, check: true|false }
#   → writes the files to <repo>/modelica/<name>/, optionally runs omc checkModel and starts OMEdit.
#   Only same-origin requests with the header X-Gerotor-Request: 1 are accepted (a cross-site page
#   cannot send that header without a CORS preflight, which this server never grants).
param([string]$Root = ".", [int]$Port = 8765)
$Root = (Resolve-Path $Root).Path
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
            '.json'='application/json'; '.svg'='image/svg+xml'; '.pdf'='application/pdf'; '.md'='text/markdown; charset=utf-8';
            '.mo'='text/plain; charset=utf-8'; '.mos'='text/plain; charset=utf-8'; '.csv'='text/csv; charset=utf-8' }

function Find-OpenModelica {
  $cands = @()
  if ($env:OPENMODELICAHOME) { $cands += $env:OPENMODELICAHOME }
  $cands += (Get-ChildItem 'C:\Program Files\OpenModelica*' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object FullName)
  foreach ($c in $cands) { if (Test-Path (Join-Path $c 'bin\OMEdit.exe')) { return $c } }
  return $null
}

function Send-Json($ctx, [int]$status, $obj) {
  $json = $obj | ConvertTo-Json -Depth 5 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Handle-Modelica($ctx) {
  $req = $ctx.Request
  $origin = $req.Headers['Origin']
  if ($req.Headers['X-Gerotor-Request'] -ne '1' -or ($origin -and $origin -ne "http://localhost:$Port")) {
    Send-Json $ctx 403 @{ ok = $false; error = 'forbidden' }; return
  }
  $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
  $body = $reader.ReadToEnd() | ConvertFrom-Json
  $name = ($body.name -replace '[^A-Za-z0-9_]', '_')
  if (-not $name) { $name = 'GerotorPump' }
  $dir = Join-Path $RepoRoot (Join-Path 'modelica' $name)
  New-Item -ItemType Directory -Force $dir | Out-Null
  $written = @()
  foreach ($prop in $body.files.PSObject.Properties) {
    $fname = ($prop.Name -replace '[^A-Za-z0-9_.-]', '_')
    if ($fname -notmatch '\.(mo|mos|csv|txt)$') { continue }
    $path = Join-Path $dir $fname
    [IO.File]::WriteAllText($path, [string]$prop.Value, (New-Object Text.UTF8Encoding($false)))
    $written += $path
  }
  $om = Find-OpenModelica
  $result = @{ ok = $true; dir = $dir; files = $written; openModelica = $om }
  $mo = Join-Path $dir "$name.mo"
  if ($body.check -and $om -and (Test-Path $mo)) {
    $script = Join-Path $dir 'check.mos'
    $moFwd = $mo -replace '\\', '/'
    "loadModel(Modelica, {`"4.1.0`"}); getErrorString();`nloadFile(`"$moFwd`"); getErrorString();`ncheckModel($name.Examples.PumpSystem); getErrorString();" |
      Set-Content -Path $script -Encoding ascii
    $result.check = (& (Join-Path $om 'bin\omc.exe') $script 2>&1 | Out-String)
  }
  if ($body.open) {
    if ($om -and (Test-Path $mo)) {
      Start-Process -FilePath (Join-Path $om 'bin\OMEdit.exe') -ArgumentList "`"$mo`"" | Out-Null
      $result.opened = $true
    } else { $result.opened = $false; $result.error = 'OpenModelica (OMEdit) not found' }
  }
  Send-Json $ctx 200 $result
}

$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serving $Root on http://localhost:$Port/"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq 'api/modelica') {
      if ($ctx.Request.HttpMethod -eq 'POST') { Handle-Modelica $ctx } else { $ctx.Response.StatusCode = 405 }
    } else {
      if ($path -eq '' -or $path.EndsWith('/')) { $path = $path + 'index.html' }
      $file = Join-Path $Root $path
      if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($Root))) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file)
        $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $ctx.Response.StatusCode = 404 }
    }
  } catch {
    try { Send-Json $ctx 500 @{ ok = $false; error = $_.Exception.Message } } catch { }
  }
  $ctx.Response.Close()
}
