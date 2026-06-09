#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# upload-email-report.sh
# Uploads last-email-report.json to Supabase storage and triggers
# the email processing pipeline.
#
# Run: bash ~/personal-os/scripts/upload-email-report.sh
# Auto-run: launchd WatchPaths on last-email-report.json
# ─────────────────────────────────────────────────────────────────────

set -e

REPORT_FILE="$HOME/personal-os/data/last-email-report.json"
SUPABASE_URL="https://dvevqwhphrcboyjpvnlz.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
VERCEL_URL="https://personal-os-five-black.vercel.app"
TRIGGER_SECRET="0557601ac4f4c8f0d42923bba2fb083b"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PERSONAL OS — EMAIL REPORT UPLOAD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Check report exists ───────────────────────────────────────────────
if [ ! -f "$REPORT_FILE" ]; then
  echo "✗ Report not found: $REPORT_FILE"
  exit 1
fi

# ── Extract date from report ──────────────────────────────────────────
TODAY=$(python3 -c "
import json
with open('$REPORT_FILE') as f:
    d = json.load(f)
print(d.get('report_date', '$(date +%Y-%m-%d)'))
" 2>/dev/null || date +%Y-%m-%d)

echo "  Report date: $TODAY"
echo "  File size:   $(wc -c < "$REPORT_FILE" | tr -d ' ') bytes"

# ── Upload to Supabase storage (upsert) ───────────────────────────────
echo ""
echo "Step 1: Uploading to Supabase storage..."

UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT \
  "$SUPABASE_URL/storage/v1/object/daily-reports/$TODAY.json" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary "@$REPORT_FILE" \
  --max-time 30)

if [[ "$UPLOAD_STATUS" == "200" || "$UPLOAD_STATUS" == "201" ]]; then
  echo "  ✓ Uploaded: daily-reports/$TODAY.json [HTTP $UPLOAD_STATUS]"
else
  echo "  ✗ Upload failed [HTTP $UPLOAD_STATUS] — trying POST..."
  UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "$SUPABASE_URL/storage/v1/object/daily-reports/$TODAY.json" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "x-upsert: true" \
    --data-binary "@$REPORT_FILE" \
    --max-time 30)
  if [[ "$UPLOAD_STATUS" == "200" || "$UPLOAD_STATUS" == "201" ]]; then
    echo "  ✓ Uploaded via POST [HTTP $UPLOAD_STATUS]"
  else
    echo "  ✗ Both upload methods failed [HTTP $UPLOAD_STATUS]"
    exit 1
  fi
fi

# ── Trigger processing ────────────────────────────────────────────────
echo ""
echo "Step 2: Triggering email processing..."

PROCESS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  "$VERCEL_URL/api/jobs/process-email-report" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: $TRIGGER_SECRET" \
  -d "{\"date\":\"$TODAY\"}" \
  --max-time 60)

if [[ "$PROCESS_STATUS" == "200" || "$PROCESS_STATUS" == "201" || "$PROCESS_STATUS" == "202" ]]; then
  echo "  ✓ Processing triggered [HTTP $PROCESS_STATUS]"
else
  echo "  ⚠ Processing trigger returned HTTP $PROCESS_STATUS (may still work async)"
fi

# ── Mark pipeline upload complete ─────────────────────────────────────
echo ""
echo "Step 3: Marking pipeline step complete..."

PIPELINE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  "$VERCEL_URL/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: $TRIGGER_SECRET" \
  -d "{\"step\":\"upload\",\"run_date\":\"$TODAY\"}" \
  --max-time 15)

echo "  Pipeline step: HTTP $PIPELINE_STATUS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DONE — GitHub Actions AI job will"
echo "  trigger automatically within 10 minutes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
