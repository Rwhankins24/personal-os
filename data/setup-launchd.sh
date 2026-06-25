#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# personal-os — launchd Email Push Setup
# Run ONCE from your Mac terminal to install the automatic email push job.
#
#   bash ~/personal-os/data/setup-launchd.sh
#
# What it does:
#   1. Detects your home directory
#   2. Fills the plist template with correct absolute paths
#   3. Installs to ~/Library/LaunchAgents/
#   4. Loads the job immediately (no reboot needed)
#
# After install, the push fires automatically whenever Task 2 writes
# last-email-report.json, AND again at 5 AM as a safety net.
# ─────────────────────────────────────────────────────────────────────────────

set -e

HOME_DIR="$HOME"
PLIST_NAME="com.personalos.email-push.plist"
PLIST_DEST="$HOME_DIR/Library/LaunchAgents/$PLIST_NAME"
SCRIPT="$HOME_DIR/personal-os/data/push_email_report.py"
REPORT="$HOME_DIR/personal-os/data/last-email-report.json"
LOG="$HOME_DIR/personal-os/data/push-email.log"
ERR_LOG="$HOME_DIR/personal-os/data/push-email.error.log"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  personal-os launchd Email Push Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Home:   $HOME_DIR"
echo "  Script: $SCRIPT"
echo "  Watch:  $REPORT"
echo "  Log:    $LOG"
echo ""

# Verify script exists
if [ ! -f "$SCRIPT" ]; then
    echo "✗ push_email_report.py not found at $SCRIPT"
    echo "  Make sure personal-os/data/ is in your home directory."
    exit 1
fi

# Make script executable
chmod +x "$SCRIPT"

# Create LaunchAgents dir if needed
mkdir -p "$HOME_DIR/Library/LaunchAgents"

# Write plist with real paths substituted
cat > "$PLIST_DEST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>

    <key>Label</key>
    <string>com.personalos.email-push</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>${SCRIPT}</string>
    </array>

    <!-- Fire immediately when Task 2 writes the report file -->
    <key>WatchPaths</key>
    <array>
        <string>${REPORT}</string>
    </array>

    <!-- 5 AM safety net — idempotency check prevents double-push -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>5</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>${LOG}</string>
    <key>StandardErrorPath</key>
    <string>${ERR_LOG}</string>

    <key>RunAtLoad</key>
    <false/>

</dict>
</plist>
PLIST

echo "✓ Plist written to $PLIST_DEST"

# Unload if already loaded (ignore errors)
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Load the job
launchctl load "$PLIST_DEST"
echo "✓ Job loaded into launchd"

# Verify
if launchctl list | grep -q "com.personalos.email-push"; then
    echo "✓ Verified: com.personalos.email-push is registered"
else
    echo "⚠  Job may not be loaded — check: launchctl list | grep personalos"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete."
echo ""
echo "  The push will fire automatically when"
echo "  Task 2 writes last-email-report.json"
echo "  (and again at 5 AM as a fallback)."
echo ""
echo "  Manual push for today:"
echo "  python3 $SCRIPT"
echo ""
echo "  Manual push for a past day:"
echo "  python3 $SCRIPT ~/personal-os/data/archive/2026-06-23-email-report.json"
echo ""
echo "  Check logs:"
echo "  tail -f $LOG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
