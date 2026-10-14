# setup.ps1 — Windows twin of setup.sh, idempotent, no keys: Node LTS via winget when missing, npm deps,
# the shared library and the git hooks, then the welcome (tools\welcome.txt). Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\setup.ps1

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)   # repo root (this script lives in tools\)

function Ok($msg)   { Write-Host '  ' -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green  -NoNewline; Write-Host " $msg" }
function Warn($msg) { Write-Host '  ' -NoNewline; Write-Host ([char]0x2022) -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
# Bad <problem> [details]: print, then stop.
function Bad($msg, $details = @()) {
  Write-Host '  ' -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red -NoNewline; Write-Host " $msg"
  $details | ForEach-Object { Write-Host "      $_" }
  Write-Host "`nSetup stopped. Once that's fixed, run it again."; exit 1
}
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host 'Ad Production Kit setup'

# ── Node (>= 22.15; installs the LTS via winget when missing or older) ───────
$nodeDir = Join-Path $env:ProgramFiles 'nodejs'
# Pick up an install this terminal hasn't seen yet (PATH refreshes only in new terminals).
if (-not (Has 'node') -and (Test-Path (Join-Path $nodeDir 'node.exe'))) { $env:Path = "$nodeDir;$env:Path" }

function Test-NodeOk {
  if (-not (Has 'node')) { return $false }
  try { $v = & node -v 2>$null; if ("$v" -match '^v(\d+)\.(\d+)') { return ([int]$Matches[1] -gt 22) -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 15) } } catch { }
  return $false
}

if (Test-NodeOk) {
  Ok "Node $(& node -v) ready"
} else {
  if (-not (Has 'winget')) {
    Bad 'winget is not available on this machine: install Node 22.15+ from https://nodejs.org'
  }
  Write-Host '  Installing Node LTS with winget...'
  winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
  # The new PATH only reaches new terminals, so also look in the standard install location.
  if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
  if (Test-NodeOk) {
    Ok "Installed Node $(& node -v) (open a new terminal if other windows can't find node)"
  } else {
    Bad 'Node install failed: install Node 22.15+ from https://nodejs.org'
  }
}

# ── npm deps (Vercel AI Gateway, the video export) — again whenever package.json changed ──
$fresh = { param($dir) (Test-Path "$dir\node_modules\.package-lock.json") -and ((Get-Item "$dir\node_modules\.package-lock.json").LastWriteTime -gt (Get-Item "$dir\package.json").LastWriteTime) }
foreach ($d in @(@('.', "the kit's tools", 'Kit tools'), @('studio', 'the studio app', 'Studio app'))) {
  if (-not (& $fresh $d[0])) {
    Write-Host "  Installing $($d[1])..."
    $log = npm ci --prefix $d[0] --no-fund --no-audit 2>&1
    if ($LASTEXITCODE -ne 0) { Bad "Couldn't install $($d[1]): check your internet connection." ($log | Select-Object -Last 8) }
  }
  Ok "$($d[2]) ready"
}

node tools/sync-brand.mjs --pull workspaces/Shared/Library --originals 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Ok 'Shared library ready (music, sound effects, references)' }
else { Warn "Couldn't download the shared library (music, sound effects): run this setup again later to retry." }

# ── git hooks: block commits that mention a client workspace or brand (the repo is public) ──
if (Has 'git') { git config core.hooksPath .githooks 2>&1 | Out-Null }

Write-Host ''
$folder = (Get-Location).Path; if ($folder -match ' ') { $folder = "`"$folder`"" }
Write-Host ((Get-Content 'tools\welcome.txt' -Raw -Encoding UTF8).Replace('{folder}', $folder))
