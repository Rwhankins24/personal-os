#!/bin/bash

# Personal OS — Daily report upload to Supabase storage
# Runs at 6:15am via launchd (com.personalos.upload)
# Also safe to run manually: bash ~/personal-os/scripts/upload-report.sh

LOG_FILE="$HOME/personal-os/logs/upload.log"
JSON_FILE="$HOME/personal-os/data/last-email-report.json"
TODAY=$(date +%Y-%m-%d)

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Read credentials from .env (skip comments and blank lines)
set -a
while IFS='=' read -r key val; do
  [[ "$key" =~ ^[[:space:]]*# ]] && continue
  [[ -z "$key" ]] && continue
  val="${val%%#*}"          # strip inline comments
  val="${val%"${val##*[![:space:]]}"}"  # strip trailing whitespace
  export "$key=$val"
done < "$HOME/personal-os/api/.env"
set +a

echo "[$TODAY $(date +%H:%M:%S)] Starting upload..." >> "$LOG_FILE"

# Validate credentials loaded
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "[$TODAY $(date +%H:%M:%S)] ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in api/.env" >> "$LOG_FILE"
  exit 1
fi

# Wait up to 10 minutes for today's report file to appear
MAX_WAIT=600
WAITED=0
while [ ! -f "$JSON_FILE" ]; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "[$TODAY $(date +%H:%M:%S)] ERROR: Timed out waiting for report file after ${MAX_WAIT}s" >> "$LOG_FILE"
    exit 1
  fi
  sleep 30
  WAITED=$((WAITED + 30))
  echo "[$TODAY $(date +%H:%M:%S)] Waiting for report file... (${WAITED}s elapsed)" >> "$LOG_FILE"
done

echo "[$TODAY $(date +%H:%M:%S)] File found: $JSON_FILE ($(wc -c < "$JSON_FILE") bytes)" >> "$LOG_FILE"

# Verify report date matches today
REPORT_DATE=$(python3 -c "
import json, sys
try:
    data = json.load(open('$JSON_FILE'))
    print(data.get('report_date',''))
except Exception as e:
    print('')
" 2>/dev/null)

if [ "$REPORT_DATE" != "$TODAY" ]; then
  echo "[$TODAY $(date +%H:%M:%S)] ERROR: File exists but report_date '$REPORT_DATE' does not match today '$TODAY' — aborting" >> "$LOG_FILE"
  exit 1
fi

echo "[$TODAY $(date +%H:%M:%S)] Report date: $REPORT_DATE — uploading to daily-reports/$TODAY.json" >> "$LOG_FILE"

# --- PRIMARY: POST with x-upsert ---
RESPONSE=$(curl -s -X POST \
  "$SUPABASE_URL/storage/v1/object/daily-reports/$TODAY.json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary @"$JSON_FILE" \
  -w "\nHTTP_STATUS:%{http_code}" \
  --max-time 30 2>&1)

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

echo "[$TODAY $(date +%H:%M:%S)] POST response (HTTP $HTTP_STATUS): $RESPONSE_BODY" >> "$LOG_FILE"

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "[$TODAY $(date +%H:%M:%S)] SUCCESS: daily-reports/$TODAY.json uploaded" >> "$LOG_FILE"
  exit 0
fi

# --- FALLBACK: PUT ---
echo "[$TODAY $(date +%H:%M:%S)] POST returned $HTTP_STATUS — trying PUT fallback..." >> "$LOG_FILE"

RESPONSE2=$(curl -s -X PUT \
  "$SUPABASE_URL/storage/v1/object/daily-reports/$TODAY.json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary @"$JSON_FILE" \
  -w "\nHTTP_STATUS:%{http_code}" \
  --max-time 30 2>&1)

HTTP_STATUS2=$(echo "$RESPONSE2" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY2=$(echo "$RESPONSE2" | grep -v "HTTP_STATUS:")

echo "[$TODAY $(date +%H:%M:%S)] PUT response (HTTP $HTTP_STATUS2): $RESPONSE_BODY2" >> "$LOG_FILE"

if [ "$HTTP_STATUS2" = "200" ] || [ "$HTTP_STATUS2" = "201" ]; then
  echo "[$TODAY $(date +%H:%M:%S)] SUCCESS via PUT: daily-reports/$TODAY.json uploaded" >> "$LOG_FILE"
  exit 0
else
  echo "[$TODAY $(date +%H:%M:%S)] ERROR: Both POST and PUT failed (last status: $HTTP_STATUS2)" >> "$LOG_FILE"
  exit 1
fi
