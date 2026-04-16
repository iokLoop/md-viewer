#!/usr/bin/env bash
# md-viewer — setup script
# Installs Python deps, creates a launchd agent (starts on login, auto-restart),
# and optionally sets up a friendly local hostname.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.md-viewer.app"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo ""
echo "┌─────────────────────────────┐"
echo "│       md-viewer setup       │"
echo "└─────────────────────────────┘"
echo ""

# ── Python check ─────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "✗ python3 not found. Install it from https://python.org or via Homebrew."
  exit 1
fi
PYTHON="$(command -v python3)"

# ── Workspace ─────────────────────────────────────────────────────────────────
DEFAULT_WS="$(dirname "$SCRIPT_DIR")"
echo "Workspace = the folder that CONTAINS your projects (md-viewer's parent)."
read -rp "Workspace directory [$DEFAULT_WS]: " WORKSPACE
WORKSPACE="${WORKSPACE:-$DEFAULT_WS}"
WORKSPACE="$(cd "$WORKSPACE" && pwd)"   # resolve to absolute path

if [ ! -d "$WORKSPACE" ]; then
  echo "✗ '$WORKSPACE' is not a directory. Aborting."
  exit 1
fi

# Warn if workspace == md-viewer itself (common mistake when running with . or cd)
if [ "$WORKSPACE" = "$SCRIPT_DIR" ]; then
  echo ""
  echo "  ⚠  The workspace you chose is the md-viewer folder itself."
  echo "     md-viewer needs to be INSIDE the workspace, not BE the workspace."
  echo "     Switching to the parent: $(dirname "$SCRIPT_DIR")"
  WORKSPACE="$(dirname "$SCRIPT_DIR")"
fi

echo "  Workspace: $WORKSPACE"

# ── Port ─────────────────────────────────────────────────────────────────────
read -rp "Port [7700]: " PORT
PORT="${PORT:-7700}"

# ── Local hostname ────────────────────────────────────────────────────────────
echo ""
echo "Local URL — choose one option or type a hostname directly:"
echo "  1) mdviewer.localhost   (no sudo, works in modern browsers)"
echo "  2) docs.home            (added to /etc/hosts, requires sudo)"
echo "  or type your own hostname, e.g. mdviewer.torstrong.org"
echo ""
read -rp "Choice or hostname [1]: " HOST_INPUT
HOST_INPUT="${HOST_INPUT:-1}"

if [ "$HOST_INPUT" = "1" ]; then
  CUSTOM_HOST="mdviewer.localhost"
  NEEDS_HOSTS=false
elif [ "$HOST_INPUT" = "2" ]; then
  CUSTOM_HOST="docs.home"
  NEEDS_HOSTS=true
else
  # User typed a hostname directly
  CUSTOM_HOST="$HOST_INPUT"
  NEEDS_HOSTS=true
fi

if $NEEDS_HOSTS; then
  if grep -qF "$CUSTOM_HOST" /etc/hosts 2>/dev/null; then
    echo "  '$CUSTOM_HOST' already in /etc/hosts — skipping."
  else
    echo "  Adding '$CUSTOM_HOST' to /etc/hosts (requires sudo)..."
    echo "127.0.0.1  $CUSTOM_HOST" | sudo tee -a /etc/hosts > /dev/null
    echo "  Done."
  fi
fi

FRIENDLY_URL="http://$CUSTOM_HOST:$PORT"

# ── Install Python deps ───────────────────────────────────────────────────────
echo ""
echo "Installing Python dependencies..."
"$PYTHON" -m pip install flask markdown --quiet
echo "  Done."

# ── Create LaunchAgent plist ─────────────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>

  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$SCRIPT_DIR/app.py</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>MDVIEWER_WORKSPACE</key>
    <string>$WORKSPACE</string>
    <key>MDVIEWER_PORT</key>
    <string>$PORT</string>
  </dict>

  <!-- Start on login, restart on crash -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/md-viewer.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/md-viewer-error.log</string>
</dict>
</plist>
PLIST

# Load (unload first if already registered)
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  ✓ md-viewer is running!                         │"
echo "│                                                  │"
printf "│  URL      : %-37s│\n" "$FRIENDLY_URL"
printf "│  Workspace: %-37s│\n" "$WORKSPACE"
echo "│  Logs     : ~/Library/Logs/md-viewer.log         │"
echo "│                                                  │"
echo "│  Commands:                                       │"
echo "│  Stop  → launchctl unload $PLIST_NAME.plist  │"
echo "│  Start → launchctl load   $PLIST_NAME.plist  │"
echo "│  Logs  → tail -f ~/Library/Logs/md-viewer.log   │"
echo "└──────────────────────────────────────────────────┘"
echo ""
