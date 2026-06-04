#!/bin/bash
LOG_FILE="$HOME/personal-os/logs/plaud-upload.log"
JSON_FILE="$HOME/personal-os/data/last-plaud-report.json"
TODAY=$(date +%Y-%m-%d)

export $(grep -v '^#' "$HOME/personal-os/api/.env" | xargs)

echo "[$TODAY $(date +%H:%M:%S)] Plaud upload starting..." >> "$LOG_FILE"

MAX_WAIT=1800
WAITED=0
POLL_INTERVAL=120

while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS=$(curl -s \
    "https://personal-os-five-black.vercel.app/api/pipeline/status" \
    -H "x-trigger-secret: $TRIGGER_SECRET")

  UPLOAD_DONE=$(echo "$STATUS" | python3 -c \
    "import json,sys
d=json.load(sys.stdin)
print(d.get('plaud_processing_completed_at') or '')" 2>/dev/null)

  if [ -n "$UPLOAD_DONE" ]; then
    echo "[$TODAY $(date +%H:%M:%S)] Already uploaded today." >> "$LOG_FILE"
    exit 0
  fi

  if [ -f "$JSON_FILE" ]; then
    REPORT_DATE=$(python3 -c "
import json, sys
try:
  data = json.load(open('$JSON_FILE'))
  print(data.get('report_date',''))
except:
  print('')
")
    if [ "$REPORT_DATE" = "$TODAY" ]; then
      echo "[$TODAY $(date +%H:%M:%S)] Uploading Plaud report..." >> "$LOG_FILE"

      RESPONSE=$(curl -s -X POST \
        "$SUPABASE_URL/storage/v1/object/daily-reports/plaud-$TODAY.json" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @"$JSON_FILE" \
        -w "\nHTTP_STATUS:%{http_code}")

      HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)

      if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
        echo "[$TODAY $(date +%H:%M:%S)] Upload SUCCESS" >> "$LOG_FILE"
        curl -s -X POST \
          "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
          -H "Content-Type: application/json" \
          -H "x-trigger-secret: $TRIGGER_SECRET" \
          -d "{\"step\":\"plaud_processing\",\"run_date\":\"$TODAY\"}" \
          >> "$LOG_FILE" 2>&1
        exit 0
      else
        # Retry with PUT
        RESPONSE=$(curl -s -X PUT \
          "$SUPABASE_URL/storage/v1/object/daily-reports/plaud-$TODAY.json" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
          -H "Content-Type: application/json" \
          --data-binary @"$JSON_FILE" \
          -w "\nHTTP_STATUS:%{http_code}")
        HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
        if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
          echo "[$TODAY $(date +%H:%M:%S)] Upload SUCCESS (PUT)" >> "$LOG_FILE"
          curl -s -X POST \
            "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
            -H "Content-Type: application/json" \
            -H "x-trigger-secret: $TRIGGER_SECRET" \
            -d "{\"step\":\"plaud_processing\",\"run_date\":\"$TODAY\"}" \
            >> "$LOG_FILE" 2>&1
          exit 0
        fi
      fi
    fi
  fi

  sleep $POLL_INTERVAL
  WAITED=$((WAITED + POLL_INTERVAL))
  echo "[$TODAY $(date +%H:%M:%S)] Waiting... (${WAITED}s)" >> "$LOG_FILE"
done

echo "[$TODAY $(date +%H:%M:%S)] TIMEOUT" >> "$LOG_FILE"
exit 1
