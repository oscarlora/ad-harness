#!/bin/bash
# setup.sh — machine setup, idempotent, no admin password or Homebrew. Installs Node and ffmpeg 8
# under ~/.local when missing, npm deps and the git hooks, then a health check and a welcome.
# No API keys needed — those come later, when you generate your first ad.
#
# Usage: bash tools/setup.sh
set -u
cd "$(dirname "$0")/.."

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m•\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; }

# One PATH line in the shell startup files makes new terminals see the local installs (Node + ~/.local/bin).
PATH_LINE='export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"'
ensure_path_line() {  # $1 = file; appends PATH_LINE unless already there
  grep -qsF "$PATH_LINE" "$1" 2>/dev/null && return 0
  { echo "$PATH_LINE" >> "$1"; } 2>/dev/null && return 0
  return 1
}
ensure_path() {  # zsh (the macOS default), bash, and POSIX login shells each read a different file
  local n=0 f
  for f in "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.profile"; do
    ensure_path_line "$f" && n=$((n + 1))
  done
  [ "$n" -gt 0 ] && return 0
  warn "couldn't update your shell startup files — add this line to ~/.profile yourself: $PATH_LINE"
  return 1
}

echo "Ad Production Kit setup"

# ── Node (>= 22.15; installs latest v24 LTS locally when missing or older) ───
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"   # pick up previous local installs
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_OK=$(node -p 'const [a, b] = process.versions.node.split(".").map(Number); a > 22 || (a === 22 && b >= 15) ? 1 : 0' 2>/dev/null || echo 0)
  [ "$NODE_OK" = 1 ] && { ok "Node $(node -v) present"; NEED_NODE=0; }
fi
if [ "$NEED_NODE" = 1 ]; then
  case "$(uname -s)" in
    Darwin) NODE_OS=darwin ;;
    Linux)  NODE_OS=linux ;;
    *) bad "Setup doesn't know this system ($(uname -s)). Install Node 22.15+ from https://nodejs.org and re-run."; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64) NODE_ARCH=x64 ;;
    arm64|aarch64) NODE_ARCH=arm64 ;;
    *) bad "Setup doesn't know this processor ($(uname -m)). Install Node 22.15+ from https://nodejs.org and re-run."; exit 1 ;;
  esac
  echo "  Installing Node LTS to ~/.local/node (no admin password needed)…"
  TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt 2>/dev/null \
    | grep -oE "node-v24\.[0-9]+\.[0-9]+-${NODE_OS}-${NODE_ARCH}\.tar\.gz" | head -1)
  if [ -z "${TARBALL:-}" ]; then
    bad "Could not resolve the Node download (no internet?). Install Node 22.15+ from https://nodejs.org and re-run."
    exit 1
  fi
  curl -fL --progress-bar "https://nodejs.org/dist/latest-v24.x/$TARBALL" -o /tmp/ad-production-kit-node.tar.gz || {
    bad "Node download failed. Install Node 22.15+ from https://nodejs.org and re-run."; exit 1; }
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  tar -xzf /tmp/ad-production-kit-node.tar.gz -C "$HOME/.local/node" --strip-components 1 || {
    rm -rf "$HOME/.local/node"; bad "The Node download didn't unpack. Check your internet and re-run."; exit 1; }
  rm -f /tmp/ad-production-kit-node.tar.gz
  if ! "$HOME/.local/node/bin/node" -v >/dev/null 2>&1; then
    rm -rf "$HOME/.local/node"
    bad "The installed Node won't run on this machine. Install Node 22.15+ from https://nodejs.org and re-run."
    exit 1
  fi
  hash -r
  ensure_path && NOTE=" (new terminals will find it)" || NOTE=""
  ok "Installed Node $("$HOME/.local/node/bin/node" -v)$NOTE"
fi

# ── npm deps (Vercel AI Gateway, the video export) — again whenever package.json changed ──
if [ -d node_modules ] && [ node_modules/.package-lock.json -nt package.json ]; then
  ok "npm deps present"
else
  npm install --no-fund --no-audit >/dev/null 2>&1 \
    && ok "npm deps installed" \
    || warn "couldn't install the helper libraries — check your internet and re-run setup (the media library needs them)"
fi

# ── git hooks ────────────────────────────────────────────────────────────────
if [ -d .githooks ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git config core.hooksPath .githooks && ok "git hooks on (blocks commits that mention a client workspace or brand)"
fi

# ── studio app deps ──────────────────────────────────────────────────────────
if [ -f studio/package.json ] && ! [ studio/node_modules/.package-lock.json -nt studio/package.json ]; then
  npm install --prefix studio --no-fund --no-audit >/dev/null 2>&1 \
    && ok "studio app deps installed" \
    || warn "couldn't install the Studio's libraries — check your internet and re-run setup (the Studio won't open until it succeeds)"
fi

# ── video export browser: an installed Chrome or Edge, else Playwright's Chromium ──
if node -e "import('playwright-core').then(async({chromium})=>{for(const channel of['chrome','msedge','chromium'])try{await(await chromium.launch({channel})).close();process.exit(0)}catch{}process.exit(1)})" >/dev/null 2>&1; then
  ok "video export browser present"
else
  npx --no-install playwright-core install --no-shell chromium >/dev/null 2>&1 \
    && ok "Chromium installed for video export" \
    || warn "Chromium install failed (video export needs it): install Google Chrome, or run: npx playwright-core install chromium"
fi

# ── ffmpeg 8+ (macOS static builds from ffmpeg.martin-riedl.de, linked by ffmpeg.org) ──
# Linux skips this and gets the health-check hint instead.
FF_MAJ=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE 'version [nN]?[0-9]+' | grep -oE '[0-9]+' | head -1)
if [ "$(uname)" = "Darwin" ] && [ "${FF_MAJ:-0}" -lt 8 ]; then
  echo "  Installing ffmpeg 8 + ffprobe to ~/.local/bin (no admin password needed)…"
  FF_ARCH=$(uname -m); [ "$FF_ARCH" = "x86_64" ] && FF_ARCH=amd64
  # Resolve the versioned download directory. The redirect endpoint answers GET only (HEAD and
  # .sha256 paths 404 there), so follow it once and fetch everything from the resolved dir.
  FF_DIR=$(curl -s -o /dev/null -w '%{redirect_url}' "https://ffmpeg.martin-riedl.de/redirect/latest/macos/${FF_ARCH}/release/ffmpeg.zip")
  FF_DIR=${FF_DIR%/ffmpeg.zip}
  FF_TMP=$(mktemp -d); FF_OK=1
  for FF_BIN in ffmpeg ffprobe; do
    if [ -n "$FF_DIR" ] \
      && curl -fL --progress-bar "$FF_DIR/$FF_BIN.zip" -o "$FF_TMP/$FF_BIN.zip" \
      && curl -fsSL "$FF_DIR/$FF_BIN.zip.sha256" -o "$FF_TMP/$FF_BIN.zip.sha256" \
      && (cd "$FF_TMP" && shasum -a 256 -c "$FF_BIN.zip.sha256" >/dev/null 2>&1) \
      && unzip -oq "$FF_TMP/$FF_BIN.zip" -d "$FF_TMP" \
      && [ -f "$FF_TMP/$FF_BIN" ] \
      && mkdir -p "$HOME/.local/bin"; then
      if [ -x "$HOME/.local/bin/$FF_BIN" ]; then   # keep the binary being replaced as e.g. ffmpeg-7.1.bak
        FF_OLD=$("$HOME/.local/bin/$FF_BIN" -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)
        mv "$HOME/.local/bin/$FF_BIN" "$HOME/.local/bin/$FF_BIN-${FF_OLD:-old}.bak"
      fi
      mv "$FF_TMP/$FF_BIN" "$HOME/.local/bin/$FF_BIN"
      chmod +x "$HOME/.local/bin/$FF_BIN"
      xattr -d com.apple.quarantine "$HOME/.local/bin/$FF_BIN" 2>/dev/null || true
    else
      FF_OK=0
    fi
  done
  rm -rf "$FF_TMP"; hash -r
  if [ "$FF_OK" = 1 ]; then
    ensure_path >/dev/null 2>&1 || true
    ok "Installed ffmpeg $("$HOME/.local/bin/ffmpeg" -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1) to ~/.local/bin"
  else
    warn "ffmpeg install didn't finish — video/audio tools need it; re-run setup to retry, or brew install ffmpeg"
  fi
fi

# ── Health check (nothing here blocks you — keys and extras come later) ──────
echo "Health check"
if [ -f .env ]; then
  ok ".env present"
else
  warn "no .env yet — that's fine. Your agent will walk you through keys when you generate your first ad"
fi
FF_V=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)
if [ -z "$FF_V" ]; then
  warn "ffmpeg isn't installed yet (you'll need it to make videos; your agent will help when the time comes)"
elif [ "${FF_V%%.*}" -ge 8 ]; then
  ok "ffmpeg $FF_V present"
else
  warn "ffmpeg $FF_V works for now — version 8 is recommended when you start making videos"
fi
command -v yt-dlp  >/dev/null 2>&1 && ok "yt-dlp present"  || warn "yt-dlp isn't installed (optional — only for pulling videos from links)"
# Python (pull-fonts.py, edit-song.py) + Pillow (pull-fonts.py).
if PYV=$(python3 --version 2>&1) && [[ "$PYV" == "Python 3"* ]]; then
  ok "$PYV present"
  python3 -c 'import PIL' >/dev/null 2>&1 && ok "Pillow present" \
    || warn "Pillow isn't installed (only needed for font work — your agent will install it if you need it)"
else
  warn "Python 3 isn't installed (only needed for font and song work — your agent will help if you need it)"
fi

echo "Done."
echo ""
cat tools/welcome.txt
