# Start the Gerotor API + frontend (one server) on http://127.0.0.1:8770
# Usage:  powershell -ExecutionPolicy Bypass -File backend\tools\dev.ps1 [-Port 8770] [-NoReload]
param([int]$Port = 8770, [switch]$NoReload)
$backend = Split-Path -Parent $PSScriptRoot
Set-Location $backend
$args = @("-m", "uvicorn", "api.app:app", "--host", "127.0.0.1", "--port", $Port)
if (-not $NoReload) { $args += @("--reload", "--reload-dir", "api", "--reload-dir", "gerotor_core") }
Write-Host "Gerotor API on http://127.0.0.1:$Port  (health: /api/health)"
python @args
