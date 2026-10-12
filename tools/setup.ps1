# setup.ps1 — Windows twin of setup.sh, idempotent: Node LTS via winget when missing, npm deps and
# the git hooks, then a health check. Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\setup.ps1

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)   # repo root (this script lives in tools\)

function Ok($msg)   { Write-Host '  ' -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green  -NoNewline; Write-Host " $msg" }
function Warn($msg) { Write-Host '  ' -NoNewline; Write-Host ([char]0x2022) -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
function Bad($msg)  { Write-Host '  ' -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red    -NoNewline; Write-Host " $msg" }
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
  Ok "Node $(& node -v) present"
} else {
  if (-not (Has 'winget')) {
    Bad 'winget is not available on this machine — install Node 22.15+ from https://nodejs.org, then re-run this script.'
    exit 1
  }
  Write-Host '  Installing Node LTS with winget...'
  winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
  # The new PATH only reaches new terminals, so also look in the standard install location.
  if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
  if (Test-NodeOk) {
    Ok "Installed Node $(& node -v) (open a new terminal if other windows can't find node)"
  } else {
    Bad 'Node install failed — install Node 22.15+ from https://nodejs.org, then re-run this script.'
    exit 1
  }
}

# ── npm deps (Vercel AI Gateway, the video export) — again whenever package.json changed ──
$fresh = { param($dir) (Test-Path "$dir\node_modules\.package-lock.json") -and ((Get-Item "$dir\node_modules\.package-lock.json").LastWriteTime -gt (Get-Item "$dir\package.json").LastWriteTime) }
if (& $fresh '.') {
  Ok 'npm deps present'
} else {
  npm install --no-fund --no-audit 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'npm deps installed' }
  else { Warn "npm install failed — the media library and the Vercel AI Gateway provider won't work until it succeeds" }
}

# ── git hooks ─────────────────────────────────────────────────────────────────
if ((Test-Path '.githooks') -and (Has 'git')) {
  git rev-parse --is-inside-work-tree 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    git config core.hooksPath .githooks
    if ($LASTEXITCODE -eq 0) { Ok 'git hooks on (blocks commits that mention a client workspace or brand)' }
  }
}

# ── studio app deps ───────────────────────────────────────────────────────────
if ((Test-Path 'studio\package.json') -and -not (& $fresh 'studio')) {
  npm install --prefix studio --no-fund --no-audit 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'studio app deps installed' }
  else { Warn "npm install for studio failed — the studio app won't run until it succeeds" }
}

# ── video export browser: an installed Chrome or Edge, else Playwright's Chromium ──
node -e "import('playwright-core').then(async({chromium})=>{for(const channel of['chrome','msedge','chromium'])try{await(await chromium.launch({channel})).close();process.exit(0)}catch{}process.exit(1)})" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Ok 'video export browser present' }
else {
  npx --no-install playwright-core install --no-shell chromium 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'Chromium installed for video export' }
  else { Warn 'Chromium install failed (video export needs it): install Google Chrome, or run: npx playwright-core install chromium' }
}

# ── Health check ──────────────────────────────────────────────────────────────
Write-Host 'Health check'
if (Test-Path '.env') {
  Ok '.env present'
} else {
  Bad '.env missing — copy .env.example to .env and add your keys'
}

# Required on Windows: images catalog through ffmpeg too (no sips).
if (Has 'ffmpeg')   { Ok 'ffmpeg present' }   else { Bad 'ffmpeg missing (needed for media cataloging): winget install Gyan.FFmpeg' }
if (Has 'yt-dlp')   { Ok 'yt-dlp present' }   else { Warn 'yt-dlp missing (optional — URL/social pulls): winget install yt-dlp.yt-dlp' }

# Python (pull-fonts.py, edit-song.py) + Pillow (pull-fonts.py).
# The bare "python" on Windows can be the Microsoft Store stub, so check that it actually runs.
$pyv = ''
try { $pyv = (& python --version 2>&1 | Out-String).Trim() } catch { }
if ($LASTEXITCODE -eq 0 -and $pyv -match '^Python 3') {
  Ok "$pyv present"
  python -c 'import PIL' 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'Pillow present' }
  else { Warn 'Pillow missing (needed for pull-fonts.py): pip install pillow' }
} else {
  Warn 'Python missing (needed for pull-fonts.py and edit-song.py): winget install Python.Python.3.12   (then: pip install pillow)'
}

Write-Host 'Done.'
