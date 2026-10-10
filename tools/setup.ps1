# setup.ps1 — Ad Harness machine setup (Windows twin of setup.sh). Idempotent: run it on a fresh
# machine, or any time something seems off. Installs Node LTS via winget when missing, installs
# npm deps, points git at the repo's hooks (.githooks: the never-commit-client-data check), then
# prints a plain-language health check.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\setup.ps1
# (Works in stock Windows PowerShell 5.1 on Windows 10/11; PowerShell 7 works too.)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)   # repo root (this script lives in tools\)

function Ok($msg)   { Write-Host '  ' -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green  -NoNewline; Write-Host " $msg" }
function Warn($msg) { Write-Host '  ' -NoNewline; Write-Host ([char]0x2022) -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
function Bad($msg)  { Write-Host '  ' -NoNewline; Write-Host ([char]0x2717) -ForegroundColor Red    -NoNewline; Write-Host " $msg" }
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host 'Ad Harness setup'

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

# ── npm deps (the Vercel AI Gateway: media library + third generation provider after Segmind, kie) ──
if (Test-Path 'node_modules') {
  Ok 'npm deps present'
} else {
  npm install --no-fund --no-audit 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'npm deps installed' }
  else { Warn "npm install failed — the media library and the Vercel AI Gateway provider won't work until it succeeds" }
}

# ── git hooks (only inside the repo; repeating it is harmless) ────────────────
if ((Test-Path '.githooks') -and (Has 'git')) {
  git rev-parse --is-inside-work-tree 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    git config core.hooksPath .githooks
    if ($LASTEXITCODE -eq 0) { Ok 'git hooks on (blocks commits that mention a client workspace or brand)' }
  }
}

# ── studio app deps (only when the app exists) ───────────────────────────────
if ((Test-Path 'studio\package.json') -and -not (Test-Path 'studio\node_modules')) {
  npm install --prefix studio --no-fund --no-audit 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'studio app deps installed' }
  else { Warn "npm install for studio failed — the studio app won't run until it succeeds" }
}

# ── Health check ──────────────────────────────────────────────────────────────
Write-Host 'Health check'
if (Test-Path '.env') {
  Ok '.env present'
} else {
  Bad '.env missing — create a file named .env here and paste your block from the team vault'
}

# The GitHub CLI is optional — updates work without it; it's only needed to propose harness changes (PRs).
if (Has 'gh') {
  gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'GitHub CLI signed in' }
  else {
    Warn 'GitHub CLI not signed in — optional, only needed to propose harness changes (PRs)'
    Write-Host "    signing in is a human step — run gh auth login yourself in a terminal (it needs a real keyboard; agents can't drive it)"
  }
} else {
  Warn 'GitHub CLI missing — optional, only needed to propose harness changes (PRs): winget install GitHub.cli'
}

# ffmpeg is required on Windows: images and video both catalog through it (macOS has sips, Windows doesn't).
if (Has 'ffmpeg')   { Ok 'ffmpeg present' }   else { Bad 'ffmpeg missing (needed for media cataloging): winget install Gyan.FFmpeg' }
if (Has 'yt-dlp')   { Ok 'yt-dlp present' }   else { Warn 'yt-dlp missing (optional — URL/social pulls): winget install yt-dlp.yt-dlp' }

# Python + Pillow (brand type sheets: make-type-sheet.py; song/animation captions: song-edit.py).
# The bare "python" on Windows can be the Microsoft Store stub, so check that it actually runs.
$pyv = ''
try { $pyv = (& python --version 2>&1 | Out-String).Trim() } catch { }
if ($LASTEXITCODE -eq 0 -and $pyv -match '^Python 3') {
  Ok "$pyv present"
  python -c 'import PIL' 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok 'Pillow present' }
  else { Warn 'Pillow missing (needed for type sheets and song-edit.py): pip install pillow' }
} else {
  Warn 'Python missing (needed for type sheets and song-edit.py): winget install Python.Python.3.12   (then: pip install pillow)'
}

Write-Host 'Done.'
