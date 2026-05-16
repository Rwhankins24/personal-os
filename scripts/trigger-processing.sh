#!/bin/bash

# Personal OS — Event-driven processing trigger
# Polls pipeline status API until upload is confirmed, then triggers Vercel processing
# Runs at 6:05am via launchd (com.personalos.process)
# Also safe to run manually: bash ~/personal-os/scripts/trigger-processing.sh

LOG_FILE="$HOME/personal-os/logs/processing.log"
TODAY=$(date +%Y-%m-%d)

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

echo "[$TODAY $(date +%H:%M:%S)] Starting processing trigger polling..." >> "$LOG_FILE"

MAX_WAIT=1800     # 30 minutes maximum wait
WAITED=0
POLL_INTERVAL=120 # Check every 2 minutes

while [ $WAITED -lt $MAX_WAIT ]; do
  # Check pipeline status
  STATUS=$(curl -s \
    "https://personal-os-five-black.vercel.app/api/pipeline/status" \
    -H "x-trigger-secret: $TRIGGER_SECRET" \
    --max-time 15 2>/dev/null)

  UPLOAD_DONE=$(echo "$STATUS" | python3 -c \
    "import json,sys; d=json.load(sys.stdin); print(d.get('upload_completed_at') or '')" 2>/dev/null)

  PROCESSING_DONE=$(echo "$STATUS" | python3 -c \
    "import json,sys; d=json.load(sys.stdin); print(d.get('processing_completed_at') or '')" 2>/dev/null)

  if [ -n "$PROCESSING_DONE" ]; then
    echo "[$TODAY $(date +%H:%M:%S)] Processing already complete. Exiting." >> "$LOG_FILE"
    exit 0
  elif [ -n "$UPLOAD_DONE" ]; then
    echo "[$TODAY $(date +%H:%M:%S)] Upload confirmed. Triggering processing..." >> "$LOG_FILE"

    RESPONSE=$(curl -s -X POST \
      "https://personal-os-five-black.vercel.app/api/jobs/process-email-report" \
      -H "Content-Type: application/json" \
      -H "x-trigger-secret: $TRIGGER_SECRET" \
      -w "\nHTTP_STATUS:%{http_code}" \
      --max-time 60 2>&1)

    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
    RESPONSE_BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

    echo "[$TODAY $(date +%H:%M:%S)] Processing response (HTTP $HTTP_STATUS): $RESPONSE_BODY" >> "$LOG_FILE"

    if [ "$HTTP_STATUS" = "200" ]; then
      echo "[$TODAY $(date +%H:%M:%S)] SUCCESS: Processing complete" >> "$LOG_FILE"
      exit 0
    else
      echo "[$TODAY $(date +%H:%M:%S)] ERROR: Processing failed" >> "$LOG_FILE"
      exit 1
    fi
  else
    echo "[$TODAY $(date +%H:%M:%S)] Upload not ready yet. Waiting ${POLL_INTERVAL}s... (${WAITED}s elapsed)" >> "$LOG_FILE"
    sleep $POLL_INTERVAL
    WAITED=$((WAITED + POLL_INTERVAL))
  fi
done

echo "[$TODAY $(date +%H:%M:%S)] TIMEOUT: Upload never completed after ${MAX_WAIT}s" >> "$LOG_FILE"
exit 1
