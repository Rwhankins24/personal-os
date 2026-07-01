#!/bin/bash
# Complete pipeline finisher: Supabase storage upload + Vercel webhook push + nightly AI trigger
# Run from Mac terminal: bash ~/personal-os/data/upload-and-trigger.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/api/.env"
TODAY=$(date +%Y-%m-%d)
REPORT="$SCRIPT_DIR/last-email-report.json"

# Load .env
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env"
  exit 1
fi

if [ ! -f "$REPORT" ]; then
  echo "ERROR: Report not found at $REPORT"
  exit 1
fi

echo "── Step 1: Uploading last-email-report.json to Supabase ──"
echo "  File: $REPORT ($(wc -c < "$REPORT") bytes)"
echo "  URL:  ${SUPABASE_URL}/storage/v1/object/daily-reports/${TODAY}.json"

HTTP_STATUS=$(curl -s -o /tmp/sb_resp.txt -w "%{http_code}" \
  -X PUT \
  "${SUPABASE_URL}/storage/v1/object/daily-reports/${TODAY}.json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary "@$REPORT")

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "  ✓ Upload success (HTTP $HTTP_STATUS)"
else
  echo "  ✗ Upload failed (HTTP $HTTP_STATUS)"
  cat /tmp/sb_resp.txt
  exit 1
fi

echo ""
echo "── Step 2: Push threads to Vercel webhook (emails table) ──"
python3 "$SCRIPT_DIR/push_email_report.py"

echo ""
echo "── Step 3: Triggering nightly AI job ──"
echo "  Repo: Rwhankins24/personal-os"
echo "  Workflow: nightly-ai.yml"
echo "  Inputs: force_run=true"

if command -v gh &>/dev/null; then
  gh workflow run nightly-ai.yml \
    --repo Rwhankins24/personal-os \
    --field force_run=true
  echo "  ✓ Workflow dispatch sent"
  echo ""
  echo "  Check status at:"
  echo "  https://github.com/Rwhankins24/personal-os/actions/workflows/nightly-ai.yml"
else
  echo "  ⚠ gh CLI not found — trigger manually:"
  echo "  https://github.com/Rwhankins24/personal-os/actions/workflows/nightly-ai.yml"
  echo "  → Run workflow → force_run: true"
fi

echo ""
echo "Done. Pipeline complete for $TODAY."
