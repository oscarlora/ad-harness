#!/bin/bash
# setup.sh — Ad Harness machine setup. Idempotent: run it on a fresh machine, or any time
# something seems off. Installs Node LTS into ~/.local/node, and the GitHub CLI and ffmpeg 8 into
# ~/.local/bin when missing (no admin password or Homebrew needed), installs npm deps, points git at
# the repo's hooks (.githooks: the never-commit-client-data check), then prints a plain-language
# health check.
#
# Usage: bash tools/setup.sh
set -u
cd "$(dirname "$0")/.."

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m•\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; }

# One PATH line in ~/.zprofile makes new terminals see the local installs (Node + ~/.local/bin).
PATH_LINE='export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"'
ensure_path_line() {
  grep -qsF "$PATH_LINE" "$HOME/.zprofile" 2>/dev/null && return 0
  { echo "$PATH_LINE" >> "$HOME/.zprofile"; } 2>/dev/null && return 0
  warn "couldn't update ~/.zprofile — add this line to ~/.zprofile yourself: $PATH_LINE"
  return 1
}

echo "Ad Harness setup"

# ── Node (>= 22.15; installs latest v24 LTS locally when missing or older) ───
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"   # pick up previous local installs
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_OK=$(node -p 'const [a, b] = process.versions.node.split(".").map(Number); a > 22 || (a === 22 && b >= 15) ? 1 : 0' 2>/dev/null || echo 0)
  [ "$NODE_OK" = 1 ] && { ok "Node $(node -v) present"; NEED_NODE=0; }
fi
if [ "$NEED_NODE" = 1 ]; then
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=x64
  if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x64" ]; then
    bad "Unsupported architecture: $ARCH"; exit 1
  fi
  echo "  Installing Node LTS to ~/.local/node (no admin password needed)…"
  TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt 2>/dev/null \
    | grep -oE "node-v24\.[0-9]+\.[0-9]+-darwin-${ARCH}\.tar\.gz" | head -1)
  if [ -z "${TARBALL:-}" ]; then
    bad "Could not resolve the Node download (no internet?). Install Node 22.15+ from https://nodejs.org and re-run."
    exit 1
  fi
  curl -fL --progress-bar "https://nodejs.org/dist/latest-v24.x/$TARBALL" -o /tmp/ad-harness-node.tar.gz || {
    bad "Node download failed. Install Node 22.15+ from https://nodejs.org and re-run."; exit 1; }
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  tar -xzf /tmp/ad-harness-node.tar.gz -C "$HOME/.local/node" --strip-components 1
  rm -f /tmp/ad-harness-node.tar.gz
  ensure_path_line && NOTE=" (PATH set in ~/.zprofile)" || NOTE=""
  ok "Installed Node $(node -v)$NOTE"
fi

# ── npm deps (the Vercel AI Gateway: media library + third generation provider after Segmind, kie) ──
if [ -d node_modules ]; then
  ok "npm deps present"
else
  npm install --no-fund --no-audit >/dev/null 2>&1 \
    && ok "npm deps installed" \
    || warn "npm install failed — the media library and the Vercel AI Gateway provider won't work until it succeeds"
fi

# ── git hooks (only inside the repo; repeating it is harmless) ───────────────
if [ -d .githooks ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git config core.hooksPath .githooks && ok "git hooks on (blocks commits that mention a client workspace or brand)"
fi

# ── studio app deps (only when the app exists) ──────────────────────────────
if [ -f studio/package.json ] && [ ! -d studio/node_modules ]; then
  npm install --prefix studio --no-fund --no-audit >/dev/null 2>&1 \
    && ok "studio app deps installed" \
    || warn "npm install for studio failed — the studio app won't run until it succeeds"
fi

# ── GitHub CLI (optional; installs to ~/.local/bin when missing — no Homebrew needed) ──
if ! command -v gh >/dev/null 2>&1; then
  echo "  Installing the GitHub CLI to ~/.local/bin (no admin password needed)…"
  GH_ARCH=$(uname -m); [ "$GH_ARCH" = "x86_64" ] && GH_ARCH=amd64
  GHV=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null \
    | grep -oE '"tag_name": *"v[0-9.]+"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  GH_TMP=$(mktemp -d)
  if [ -n "${GHV:-}" ] \
    && curl -fL --progress-bar "https://github.com/cli/cli/releases/download/v${GHV}/gh_${GHV}_macOS_${GH_ARCH}.zip" -o "$GH_TMP/gh.zip" \
    && unzip -q "$GH_TMP/gh.zip" -d "$GH_TMP" \
    && mkdir -p "$HOME/.local/bin" \
    && mv "$GH_TMP/gh_${GHV}_macOS_${GH_ARCH}/bin/gh" "$HOME/.local/bin/gh" \
    && chmod +x "$HOME/.local/bin/gh"; then
    ensure_path_line
    ok "Installed GitHub CLI v$GHV to ~/.local/bin"
  else
    warn "GitHub CLI install didn't finish — it's optional; you can install it later from https://cli.github.com"
  fi
  rm -rf "$GH_TMP"
fi

# ── ffmpeg 8+ (static builds into ~/.local/bin when missing or old — no Homebrew needed) ──
# Media tools (cataloging, video edit, captions) need ffmpeg + ffprobe 8+. macOS builds
# come from ffmpeg.martin-riedl.de (one of the providers ffmpeg.org links to; native arm64 +
# amd64). Linux machines skip this and get the health-check hint below instead.
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
    ensure_path_line
    ok "Installed ffmpeg $("$HOME/.local/bin/ffmpeg" -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1) to ~/.local/bin"
  else
    warn "ffmpeg install didn't finish — video/audio tools need it; re-run setup to retry, or brew install ffmpeg"
  fi
fi

# ── Health check ─────────────────────────────────────────────────────────────
echo "Health check"
if [ -f .env ]; then
  ok ".env present"
else
  bad ".env missing — create a file named .env here and paste your block from the team vault"
fi
# The GitHub CLI is optional — updates work without it; it's only needed to propose harness changes (PRs).
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    ok "GitHub CLI signed in"
  else
    warn "GitHub CLI not signed in — optional, only needed to propose harness changes (PRs)"
    printf "    signing in is a human step — run gh auth login yourself in Terminal (it needs a real keyboard; agents can't drive it)\n"
  fi
else
  warn "GitHub CLI missing — optional, only needed to propose harness changes (PRs): https://cli.github.com"
fi
FF_V=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)
if [ -z "$FF_V" ]; then
  warn "ffmpeg missing (video/audio work): on Linux install it with your package manager, or drop a static build into ~/.local/bin (media tools already look there)"
elif [ "${FF_V%%.*}" -ge 8 ]; then
  ok "ffmpeg $FF_V present"
else
  warn "ffmpeg $FF_V is older than 8 — video tools may misbehave; on macOS re-run this setup, on Linux update it with your package manager"
fi
command -v yt-dlp  >/dev/null 2>&1 && ok "yt-dlp present"  || warn "yt-dlp missing (optional — URL/social pulls): brew install yt-dlp, or drop a static build into ~/.local/bin (media tools already look there)"
# Python + Pillow (brand type sheets: make-type-sheet.py; song/animation captions: song-edit.py).
if PYV=$(python3 --version 2>&1) && [[ "$PYV" == "Python 3"* ]]; then
  ok "$PYV present"
  python3 -c 'import PIL' >/dev/null 2>&1 && ok "Pillow present" \
    || warn "Pillow missing (needed for type sheets and song-edit.py): python3 -m pip install --user pillow"
else
  warn "Python 3 missing (needed for type sheets and song-edit.py): install it from https://www.python.org, then: python3 -m pip install --user pillow"
fi

echo "Done."
