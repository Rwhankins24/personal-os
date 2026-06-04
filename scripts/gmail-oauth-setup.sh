#!/bin/bash
# Gmail OAuth Setup — one-time credential setup for Plaud pull pipeline
# Run from Mac Terminal: bash ~/personal-os/scripts/gmail-oauth-setup.sh
#
# Prerequisites:
#   1. Go to console.cloud.google.com
#   2. Create a project (or use existing)
#   3. APIs & Services → Enable APIs → search "Gmail API" → Enable
#   4. APIs & Services → Credentials → Create Credentials → OAuth client ID
#      - Application type: Desktop app
#      - Name: personal-os-plaud
#   5. Download the JSON — copy CLIENT_ID and CLIENT_SECRET from it
#   6. APIs & Services → OAuth consent screen → Add test user: ryanhankins.personalos@gmail.com

set -e

OUTPUT_FILE="$HOME/personal-os/data/gmail-credentials.json"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Gmail OAuth Setup — Personal OS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You need your OAuth client credentials from Google Cloud Console."
echo "See the prerequisites at the top of this script."
echo ""

read -p "Enter CLIENT_ID: " CLIENT_ID
read -p "Enter CLIENT_SECRET: " CLIENT_SECRET

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "ERROR: CLIENT_ID and CLIENT_SECRET are required"
  exit 1
fi

# Build the auth URL
SCOPE="https://www.googleapis.com/auth/gmail.readonly"
REDIRECT_URI="urn:ietf:wg:oauth:2.0:oob"
AUTH_URL="https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPE}&access_type=offline&prompt=consent"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 1: Open this URL in your browser"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "$AUTH_URL"
echo ""

# Try to open browser automatically
open "$AUTH_URL" 2>/dev/null || echo "(Could not auto-open — copy the URL above)"

echo ""
echo "Sign in as: ryanhankins.personalos@gmail.com"
echo "Click Allow, then copy the authorization code shown on screen."
echo ""
read -p "Paste authorization code here: " AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
  echo "ERROR: Authorization code is required"
  exit 1
fi

echo ""
echo "Exchanging code for tokens..."

TOKEN_RESPONSE=$(curl -s -X POST \
  "https://oauth2.googleapis.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&code=${AUTH_CODE}&redirect_uri=${REDIRECT_URI}&grant_type=authorization_code")

REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('refresh_token', ''))
" 2>/dev/null)

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('access_token', ''))
" 2>/dev/null)

if [ -z "$REFRESH_TOKEN" ]; then
  echo ""
  echo "ERROR: Failed to get refresh token. Full response:"
  echo "$TOKEN_RESPONSE"
  echo ""
  echo "Common causes:"
  echo "  - Wrong CLIENT_ID or CLIENT_SECRET"
  echo "  - Authorization code expired (they expire in ~10 minutes)"
  echo "  - Test user not added to OAuth consent screen"
  exit 1
fi

# Verify by listing Gmail labels
echo "Verifying access to ryanhankins.personalos@gmail.com..."
VERIFY=$(curl -s \
  "https://gmail.googleapis.com/gmail/v1/users/me/labels" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

INBOX_EXISTS=$(echo "$VERIFY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
labels = [l.get('name','') for l in d.get('labels', [])]
print('yes' if 'INBOX' in labels else 'no')
" 2>/dev/null)

if [ "$INBOX_EXISTS" != "yes" ]; then
  echo "WARNING: Could not verify inbox access. Proceeding anyway."
  echo "Response: $VERIFY"
fi

# Write credentials file
cat > "$OUTPUT_FILE" << JSON
{
  "gmail_account": "ryanhankins.personalos@gmail.com",
  "client_id": "${CLIENT_ID}",
  "client_secret": "${CLIENT_SECRET}",
  "refresh_token": "${REFRESH_TOKEN}",
  "scope": "https://www.googleapis.com/auth/gmail.readonly",
  "created_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
JSON

chmod 600 "$OUTPUT_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Gmail OAuth Setup Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Credentials saved to: $OUTPUT_FILE"
echo "  Account: ryanhankins.personalos@gmail.com"
echo "  Inbox access: ${INBOX_EXISTS}"
echo ""
echo "Next step: load the Plaud pull launchd agent"
echo "  cp ~/personal-os/launchagents/com.personalos.plaud-upload.plist ~/Library/LaunchAgents/"
echo "  chmod +x ~/personal-os/scripts/upload-plaud-report.sh"
echo "  launchctl load ~/Library/LaunchAgents/com.personalos.plaud-upload.plist"
echo ""
echo "IMPORTANT: Add gmail-credentials.json to .gitignore if not already there."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
