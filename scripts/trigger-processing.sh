#!/bin/bash

# Personal OS — Trigger Vercel email report processing job
# Runs at 6:05am via launchd (com.personalos.process)
# Also safe to run manually: bash ~/personal-os/scripts/trigger-processing.sh

LOG_FILE="$HOME/personal-os/logs/processing.log"
TODAY=$(date +%Y-%m-%d)
VERCEL_JOB="https://personal-os-five-black.vercel.app/api/jobs/process-email-report"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Read credentials from .env (skip comments and blank lines)
set -a
while IFS='=' read -r key val; do
  [[ "$key" =~ ^[[:space:]]*# ]] && continue
  [[ -z "$key" ]] && continue
  val="${val%%#*}"
  val="${val%"${val##*[![:space:]]}"}"
  export "$key=$val"
done < "$HOME/personal-os/api/.env"
set +a

echo "[$TODAY $(date +%H:%M:%S)] Triggering Vercel processing job..." >> "$LOG_FILE"

# Validate secret loaded
if [ -z "$TRIGGER_SECRET" ]; then
  echo "[$TODAY $(date +%H:%M:%S)] ERROR: Missing TRIGGER_SECRET in api/.env" >> "$LOG_FILE"
  exit 1
fi

# Wait briefly for upload to fully settle in Supabase storage
echo "[$TODAY $(date +%H:%M:%S)] Waiting 10s for upload to settle..." >> "$LOG_FILE"
sleep 10

RESPONSE=$(curl -s -X POST \
  "$VERCEL_JOB" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: $TRIGGER_SECRET" \
  -w "\nHTTP_STATUS:%{http_code}" \
  --max-time 60 2>&1)

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

echo "[$TODAY $(date +%H:%M:%S)] Response (HTTP $HTTP_STATUS): $RESPONSE_BODY" >> "$LOG_FILE"

if echo "$RESPONSE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)" 2>/dev/null; then
  PUSHED=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('summary',{}).get('total_pushed','?'))" 2>/dev/null)
  echo "[$TODAY $(date +%H:%M:%S)] SUCCESS: $PUSHED records pushed to database" >> "$LOG_FILE"
  exit 0
else
  echo "[$TODAY $(date +%H:%M:%S)] ERROR: Processing failed or returned unexpected response" >> "$LOG_FILE"
  exit 1
fi
