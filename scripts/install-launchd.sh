#!/bin/bash

# Personal OS — launchd installer
# Run once from your Mac Terminal: bash ~/personal-os/scripts/install-launchd.sh
# Creates and loads both launchd jobs (upload @ 6:02am, process @ 6:05am)

set -e

USERNAME=$(whoami)
HOME_DIR="/Users/$USERNAME"
SCRIPTS_DIR="$HOME_DIR/personal-os/scripts"
LOGS_DIR="$HOME_DIR/personal-os/logs"
LAUNCH_AGENTS="$HOME_DIR/Library/LaunchAgents"

echo "Installing personal-os launchd jobs for user: $USERNAME"
echo "Scripts dir: $SCRIPTS_DIR"
echo "LaunchAgents: $LAUNCH_AGENTS"
echo ""

# Ensure directories exist
mkdir -p "$LOGS_DIR"
mkdir -p "$LAUNCH_AGENTS"

# Verify scripts exist and are executable
if [ ! -x "$SCRIPTS_DIR/upload-report.sh" ]; then
  echo "ERROR: $SCRIPTS_DIR/upload-report.sh not found or not executable"
  echo "Run: chmod +x $SCRIPTS_DIR/upload-report.sh"
  exit 1
fi

if [ ! -x "$SCRIPTS_DIR/trigger-processing.sh" ]; then
  echo "ERROR: $SCRIPTS_DIR/trigger-processing.sh not found or not executable"
  echo "Run: chmod +x $SCRIPTS_DIR/trigger-processing.sh"
  exit 1
fi

# ── Generate upload plist ─────────────────────────────────────────
UPLOAD_PLIST="$LAUNCH_AGENTS/com.personalos.upload.plist"

cat > "$UPLOAD_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.personalos.upload</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPTS_DIR/upload-report.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>6</integer>
    <key>Minute</key>
    <integer>2</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOGS_DIR/upload-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS_DIR/upload-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME_DIR</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

echo "✓ Created: $UPLOAD_PLIST"

# ── Generate processing plist ─────────────────────────────────────
PROCESS_PLIST="$LAUNCH_AGENTS/com.personalos.process.plist"

cat > "$PROCESS_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.personalos.process</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPTS_DIR/trigger-processing.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>6</integer>
    <key>Minute</key>
    <integer>5</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOGS_DIR/processing-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS_DIR/processing-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME_DIR</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

echo "✓ Created: $PROCESS_PLIST"

# ── Unload existing if already loaded (ignore errors) ────────────
launchctl unload "$UPLOAD_PLIST"  2>/dev/null || true
launchctl unload "$PROCESS_PLIST" 2>/dev/null || true

# ── Load both jobs ────────────────────────────────────────────────
launchctl load "$UPLOAD_PLIST"
echo "✓ Loaded: com.personalos.upload"

launchctl load "$PROCESS_PLIST"
echo "✓ Loaded: com.personalos.process"

# ── Verify ────────────────────────────────────────────────────────
echo ""
echo "Verifying loaded jobs:"
launchctl list | grep personalos

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  launchd jobs installed successfully"
echo "  Upload:  daily @ 6:02am"
echo "  Process: daily @ 6:05am"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To test manually:"
echo "  bash ~/personal-os/scripts/upload-report.sh"
echo "  bash ~/personal-os/scripts/trigger-processing.sh"
echo ""
echo "To check logs:"
echo "  tail -f ~/personal-os/logs/upload.log"
echo "  tail -f ~/personal-os/logs/processing.log"
