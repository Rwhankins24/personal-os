#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Personal OS — Backfill June 23–26 Command Sheet
# Run in your terminal. Requires: curl, gh CLI logged in.
# ─────────────────────────────────────────────────────────────────────────────

SUPABASE_URL="https://dvevqwhphrcboyjpvnlz.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"

# ── STEP 1: DOWNLOAD ARCHIVES FROM THIS COWORK SESSION ───────────────────────
# The 4 archive files were built by Claude and need to be saved to your machine.
# Claude will present them as downloadable files via the Cowork UI.
# Once downloaded, update ARCHIVE_DIR below to point to where you saved them.

ARCHIVE_DIR="$HOME/Downloads"   # ← update if you saved elsewhere

# ── STEP 2: UPLOAD ARCHIVES TO SUPABASE STORAGE ──────────────────────────────
# Each file uploads to: daily-reports/{DATE}.json
# The --upload-file flag uploads with correct content-type.

for DATE in 2026-06-23 2026-06-24 2026-06-25 2026-06-26; do
  FILE="${ARCHIVE_DIR}/${DATE}.json"
  if [ ! -f "$FILE" ]; then
    echo "⚠️  Missing: $FILE — skipping"
    continue
  fi
  echo "⬆️  Uploading ${DATE}.json..."
  curl -s -X POST \
    "${SUPABASE_URL}/storage/v1/object/daily-reports/${DATE}.json" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-upsert: true" \
    --data-binary "@${FILE}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✅ OK:', r.get('Key','?')) if 'Key' in r else print('  ❌ Error:', r)"
done

echo ""
echo "─────────────────────────────────────────────────────────"
echo "✅ Uploads complete. Now run the backfill workflow:"
echo "─────────────────────────────────────────────────────────"

# ── STEP 3: TRIGGER BACKFILL WORKFLOW ────────────────────────────────────────
# This processes all 8 days: Jun 21–28
# process-email-report + process-otter-report + nightly-ai-local per date

echo ""
echo "gh workflow run backfill.yml \\"
echo "  --repo Rwhankins24/personal-os \\"
echo "  --field dates=\"2026-06-21,2026-06-22,2026-06-23,2026-06-24,2026-06-25,2026-06-26,2026-06-27,2026-06-28\" \\"
echo "  --field skip_email=false \\"
echo "  --field skip_otter=false"
echo ""
echo "Run the above gh command in your terminal."
echo ""
echo "── STEP 4: CHECK WORKFLOW STATUS ───────────────────────"
echo "gh run list --repo Rwhankins24/personal-os --workflow=backfill.yml --limit 3"
echo ""
echo "── STEP 5 (OPTIONAL): Plaud pull for individual dates ──"
for DATE in 2026-06-21 2026-06-22 2026-06-23 2026-06-24 2026-06-25 2026-06-26; do
  echo "gh workflow run plaud-pull.yml --repo Rwhankins24/personal-os --field date_override=${DATE}"
done
