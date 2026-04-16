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
read -rp "Workspace directory (parent folder of your projects) [$DEFAULT_WS]: " WORKSPACE
WORKSPACE="${WORKSPACE:-$DEFAULT_WS}"
WORKSPACE="$(cd "$WORKSPACE" && pwd)"   # resolve to absolute path

if [ ! -d "$WORKSPACE" ]; then
  echo "✗ '$WORKSPACE' is not a directory. Aborting."
  exit 1
fi
echo "  Using workspace: $WORKSPACE"

# ── Port ─────────────────────────────────────────────────────────────────────
read -rp "Port [7700]: " PORT
PORT="${PORT:-7700}"

# ── Local hostname ────────────────────────────────────────────────────────────
echo ""
echo "Local URL options:"
echo "  1) http://mdviewer.localhost:$PORT  — works in all modern browsers, no sudo"
echo "  2) Custom name (e.g. docs.home)    — added to /etc/hosts, requires sudo"
echo ""
read -rp "Choice [1]: " HOST_CHOICE
HOST_CHOICE="${HOST_CHOICE:-1}"

if [ "$HOST_CHOICE" = "2" ]; then
  read -rp "  Hostname (e.g. docs.home): " CUSTOM_HOST
  if grep -q "$CUSTOM_HOST" /etc/hosts 2>/dev/null; then
    echo "  '$CUSTOM_HOST' already in /etc/hosts — skipping."
  else
    echo "127.0.0.1  $CUSTOM_HOST" | sudo tee -a /etc/hosts > /dev/null
    echo "  Added '$CUSTOM_HOST' to /etc/hosts"
  fi
  FRIENDLY_URL="http://$CUSTOM_HOST:$PORT"
else
  FRIENDLY_URL="http://mdviewer.localhost:$PORT"
fi

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
echo "┌─────────────────────────────────────────────┐"
echo "│  ✓ md-viewer is running!                    │"
echo "│                                             │"
printf  "│  URL  : %-35s│\n" "$FRIENDLY_URL"
echo "│  Logs : ~/Library/Logs/md-viewer.log        │"
echo "│                                             │"
echo "│  Useful commands:                           │"
printf  "│  Stop   : launchctl unload %-17s│\n" "$PLIST_PATH"
printf  "│  Start  : launchctl load   %-17s│\n" "$PLIST_PATH"
printf  "│  Logs   : tail -f ~/Library/Logs/md-viewer.log │\n"
echo "└─────────────────────────────────────────────┘"
echo ""
