#!/bin/bash

# Personal OS — Wake guard installer
# Creates a launchd job that runs caffeinate for 40 minutes starting at 5:50am
# This keeps the Mac awake long enough for the full pipeline to complete
# Run once: bash ~/personal-os/scripts/install-wake-guard.sh

set -e

USERNAME=$(whoami)
HOME_DIR="/Users/$USERNAME"
LOGS_DIR="$HOME_DIR/personal-os/logs"
LAUNCH_AGENTS="$HOME_DIR/Library/LaunchAgents"
WAKE_PLIST="$LAUNCH_AGENTS/com.personalos.wake.plist"

echo "Installing wake guard for user: $USERNAME"

mkdir -p "$LOGS_DIR"
mkdir -p "$LAUNCH_AGENTS"

cat > "$WAKE_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.personalos.wake</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>caffeinate -t 2400</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>5</integer>
    <key>Minute</key>
    <integer>50</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOGS_DIR/wake-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS_DIR/wake-stderr.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

echo "✓ Created: $WAKE_PLIST"

# Unload if already loaded (ignore errors)
launchctl unload "$WAKE_PLIST" 2>/dev/null || true

launchctl load "$WAKE_PLIST"
echo "✓ Loaded: com.personalos.wake"

echo ""
echo "Verifying all three jobs:"
launchctl list | grep personalos

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Wake guard installed"
echo "  Wake:    5:50am — caffeinate 40min"
echo "  Upload:  6:15am — waits for JSON"
echo "  Process: 6:20am — triggers Vercel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
