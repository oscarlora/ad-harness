#!/bin/bash
# setup.sh — install and first-run setup on macOS and Linux: idempotent, no admin password, no keys.
# Downloads the kit when run outside it, installs Node (and on macOS ffmpeg 8) under ~/.local when
# missing, the npm deps, the shared library and the git hooks, then prints the welcome (tools/welcome.txt). Any failure
# stops it with a plain-language fix.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash
#        … | bash -s -- <folder>     to install somewhere other than ~/ad-production-kit
#        bash tools/setup.sh         inside the kit
# Everything sits in functions run by the last line, so a piped download runs only once it's complete.
set -u

REPO_URL=https://github.com/oscarlora/ad-production-kit
INSTALL_CMD="curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash"
SELF=${BASH_SOURCE[0]:-}
LOG=$(mktemp "${TMPDIR:-/tmp}/ad-production-kit-setup.XXXXXX")
PATH_LINE='export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"'
NEW_PATH=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m•\033[0m %s\n" "$1"; }
# fail [-l] <problem> [fix lines…]: print (-l: and the tail of $LOG), then stop.
fail() {
  local log=0; [ "$1" = -l ] && { log=1; shift; }
  printf "  \033[31m✗\033[0m %s\n" "$1"; shift
  for line in "$@"; do printf "    %s\n" "$line"; done
  [ "$log" = 1 ] && [ -s "$LOG" ] && { echo "    What went wrong:"; tail -n 8 "$LOG" | sed 's/^/      /'; }
  printf "\nSetup stopped. Once that's fixed, run the same command again: it picks up where it left off.\n"
  exit 1
}
pretty() { case "$1" in "$HOME"/*) echo "~${1#"$HOME"}" ;; *) echo "$1" ;; esac; }
is_kit() { grep -qs '"name": "ad-production-kit-tools"' "$1/package.json"; }
sha256() { { command -v sha256sum >/dev/null && sha256sum "$1" || shasum -a 256 "$1"; } | cut -d' ' -f1; }
progress() { [ -t 2 ] && echo --progress-bar || echo -sS; }
offline="Check your internet connection."

# ── git (downloads the kit and its updates) ─────────────────────────────────
need_git() {
  if [ "$(uname)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1
    echo "  A window asks to install Apple's command line tools (they include git): click Install."
    echo "  Setup carries on by itself once they're installed (a few minutes)…"
    local waited=0
    until xcode-select -p >/dev/null 2>&1; do
      sleep 5; waited=$((waited + 5))
      [ "$waited" -ge 3600 ] && fail "Apple's command line tools didn't finish installing." \
        "Install them with: xcode-select --install"
    done
    ok "Installed Apple's command line tools"
  fi
  command -v git >/dev/null 2>&1 || fail "git is missing (it downloads the kit and its updates)." \
    "Install it: sudo apt install git (Ubuntu, Debian) or sudo dnf install git (Fedora)."
}

# ── the kit itself: this checkout, or a clone into the chosen folder ────────
get_kit() {
  if [ -f "$SELF" ] && is_kit "$(dirname "$SELF")/.."; then
    cd "$(dirname "$SELF")/.." && return
  fi
  local dir=${1:-$HOME/ad-production-kit}
  if is_kit "$dir"; then
    ok "The kit is already in $(pretty "$dir")"
  elif [ -e "$dir" ]; then
    fail "$(pretty "$dir") already exists and isn't the kit." "Pick another folder: $INSTALL_CMD -s -- ~/another-folder"
  else
    need_git
    git clone -q "$REPO_URL" "$dir" </dev/null >"$LOG" 2>&1 || fail -l "Couldn't download the kit." "$offline"
    ok "Downloaded the kit to $(pretty "$dir")"
  fi
  cd "$dir" || fail "Couldn't open $(pretty "$dir")."
}

# ── Node 22.15+ (else the latest v24 under ~/.local/node) ───────────────────
node_ok() {
  command -v npm >/dev/null 2>&1 && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 15) ? 0 : 1)' >/dev/null 2>&1
}
install_node() {
  if node_ok; then ok "Node $(node -v) ready"; return; fi
  local os arch base=https://nodejs.org/dist/latest-v24.x tmp line name
  local manual="Install Node 22.15 or newer yourself: https://nodejs.org/en/download"
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) fail "This setup runs on macOS and Linux." "On Windows, ask your AI agent to set up the kit (see the README)." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64)  arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "Node has no ready-made build for this processor ($(uname -m))." "$manual" ;;
  esac
  [ "$os" = linux ] && ls /lib/ld-musl-* >/dev/null 2>&1 \
    && fail "This Linux (musl, e.g. Alpine) can't run Node's ready-made build." "$manual"
  echo "  Installing Node to ~/.local/node (no admin password needed)…"
  line=$(curl -fsSL "$base/SHASUMS256.txt" 2>>"$LOG" | grep -E "  node-v24\.[0-9]+\.[0-9]+-$os-$arch\.tar\.gz$" | head -1)
  [ -n "$line" ] || fail -l "Couldn't reach nodejs.org to download Node." "$offline"
  name=${line##* }
  tmp=$(mktemp -d)
  curl -fL "$(progress)" "$base/$name" -o "$tmp/$name" 2>>"$LOG" || fail -l "The Node download failed." "$offline"
  [ "$(sha256 "$tmp/$name")" = "${line%% *}" ] || fail "The Node download arrived damaged." "$offline"
  tar -xzf "$tmp/$name" -C "$tmp" 2>>"$LOG" || fail -l "Couldn't unpack Node." "$manual"
  "$tmp/${name%.tar.gz}/bin/node" -v >"$LOG" 2>&1 \
    || fail -l "Node's $os-$arch build doesn't run on this computer." "$manual"
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local" && mv "$tmp/${name%.tar.gz}" "$HOME/.local/node"
  rm -rf "$tmp"; hash -r
  node_ok || fail "Node installed but doesn't run." "$manual"
  ok "Installed Node $(node -v)"
}

# ── PATH: new terminals find ~/.local installs through the user's own shell startup files ──
add_to_path() {
  local files f line=$PATH_LINE added=""
  case "$(basename "${SHELL:-}")" in
    zsh)  files=".zprofile .zshrc" ;;
    bash) files=".bashrc .profile"; [ -f "$HOME/.bash_profile" ] && files=".bashrc .bash_profile" ;;
    fish) files=".config/fish/conf.d/ad-production-kit.fish"; line='fish_add_path -g ~/.local/node/bin ~/.local/bin' ;;
    *)    files=".profile" ;;
  esac
  for f in $files; do
    grep -qsF "$line" "$HOME/$f" && continue
    if mkdir -p "$(dirname "$HOME/$f")" && echo "$line" >>"$HOME/$f"; then added="$added ~/$f"
    else warn "Couldn't update ~/$f: add this line to it yourself: $line"; fi
  done
  [ -n "$added" ] && { NEW_PATH=1; ok "Added the kit's tools to your PATH (${added# })"; }
  return 0
}

# ── npm deps: again whenever package.json changed ───────────────────────────
npm_deps() {  # <folder> <what it installs> <name>
  if ! [ "$1/node_modules/.package-lock.json" -nt "$1/package.json" ]; then
    echo "  Installing $2…"
    npm install --prefix "$1" --no-fund --no-audit </dev/null >"$LOG" 2>&1 \
      || fail -l "Couldn't install $2." "$offline"
  fi
  ok "$3 ready"
}

# ── ffmpeg 8+ on macOS (static builds from ffmpeg.martin-riedl.de, linked by ffmpeg.org) ──
# Elsewhere the media tools say how to get it when first used (tools/lib/catalog.mjs).
install_ffmpeg() {
  local maj
  maj=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE 'version [nN]?[0-9]+' | grep -oE '[0-9]+' | head -1)
  [ "$(uname)" = Darwin ] && [ "${maj:-0}" -lt 8 ] || return 0
  echo "  Installing ffmpeg 8 (video and audio) to ~/.local/bin…"
  local arch dir tmp bin old all=1
  arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64
  # The redirect endpoint answers GET only (HEAD and .sha256 paths 404 there), so follow it once
  # and fetch everything from the resolved versioned dir.
  dir=$(curl -s -o /dev/null -w '%{redirect_url}' "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$arch/release/ffmpeg.zip")
  dir=${dir%/ffmpeg.zip}
  tmp=$(mktemp -d)
  for bin in ffmpeg ffprobe; do
    if [ -n "$dir" ] \
      && curl -fL "$(progress)" "$dir/$bin.zip" -o "$tmp/$bin.zip" \
      && curl -fsSL "$dir/$bin.zip.sha256" -o "$tmp/$bin.zip.sha256" \
      && (cd "$tmp" && shasum -a 256 -c "$bin.zip.sha256" >/dev/null 2>&1) \
      && unzip -oq "$tmp/$bin.zip" -d "$tmp" \
      && "$tmp/$bin" -version >/dev/null 2>&1 \
      && mkdir -p "$HOME/.local/bin"; then
      if [ -x "$HOME/.local/bin/$bin" ]; then   # keep the binary being replaced as e.g. ffmpeg-7.1.bak
        old=$("$HOME/.local/bin/$bin" -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)
        mv "$HOME/.local/bin/$bin" "$HOME/.local/bin/$bin-${old:-old}.bak"
      fi
      mv "$tmp/$bin" "$HOME/.local/bin/$bin"
      chmod +x "$HOME/.local/bin/$bin"
      xattr -d com.apple.quarantine "$HOME/.local/bin/$bin" 2>/dev/null || true
    else
      all=0
    fi
  done
  rm -rf "$tmp"; hash -r
  if [ "$all" = 1 ]; then
    ok "Installed ffmpeg $("$HOME/.local/bin/ffmpeg" -version 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)"
  else
    warn "ffmpeg didn't install (video and audio tools need it): run this setup again later to retry."
  fi
}

main() {
  echo "Ad Production Kit setup"
  command -v curl >/dev/null 2>&1 || fail "curl is missing (it downloads what the kit needs)." \
    "Install it: sudo apt install curl (Ubuntu, Debian) or sudo dnf install curl (Fedora)."
  get_kit "$@"
  export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
  install_node
  install_ffmpeg
  case "$(command -v node) $(command -v ffmpeg)" in *"$HOME/.local/"*) add_to_path ;; esac
  npm_deps . "the kit's tools" "Kit tools"
  npm_deps studio "the studio app" "Studio app"
  node tools/sync-brand.mjs --pull workspaces/Shared/Library --originals </dev/null >"$LOG" 2>&1 \
    && ok "Shared library ready (music, sound effects, references)" \
    || warn "Couldn't download the shared library (music, sound effects): run this setup again later to retry."
  # Blocks commits that mention a client workspace or brand (the repo is public).
  git config core.hooksPath .githooks 2>/dev/null
  rm -f "$LOG"
  echo
  sed "s|{folder}|$(pretty "$PWD")|g" tools/welcome.txt
  [ "$NEW_PATH" = 1 ] && printf "\nOpen a new terminal window first, so it finds the tools setup just installed.\n"
  return 0
}

main "$@"
