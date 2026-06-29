---
name: email-classify-backfill
description: >
  Backfill email classification for a specific past date. Use when: classify
  crashed or was skipped for a historical date, you want to re-classify with
  updated rules, or you need to prepare data for a retroactive nightly AI job run.
  Reads raw email data from storage or local disk, classifies it, uploads the
  classified report, and optionally triggers the nightly AI job for that date.
  Trigger on: "classify emails for June 5", "re-classify [date]", "backfill classify
  for [date]", "run classify backfill", "missed classify for [date]".
  This is NOT the daily classify skill — it's the recovery/backfill path.
  For the primary use case (Plaud uploaded, email missing, AI job not run):
  run email-pull-backfill FIRST, then this skill, then trigger AI job.
---

# Email Classify Backfill

You are the recovery path for email classification. The daily `email-classify` skill
runs at 4:25 AM. This skill is triggered manually when a date needs to be (re)classified.

**Primary use case:** Plaud data is already in the DB for TARGET_DATE, but the email
pull was missed. You need to: (1) classify the email data pulled by `email-pull-backfill`,
(2) upload the classified report to storage, (3) trigger the nightly AI job for that date
so it processes all three legs together.

**Input (in priority order):**
1. `~/personal-os/data/last-email-report.json` — if pull-backfill just ran for TARGET_DATE
2. Supabase storage: `daily-reports/[TARGET_DATE]-raw.json` — if raw was separately uploaded
3. Supabase storage: `daily-reports/[TARGET_DATE].json` — re-classify an existing report

**Output:** `~/personal-os/data/last-email-report.json` + Supabase storage `[TARGET_DATE].json`

**Runtime credentials:**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`

---

## Differences from the daily email-classify skill

| Aspect | Daily classify | Backfill classify |
|--------|---------------|-------------------|
| Input source | `last-email-raw.json` (local) | Local JSON or storage fetch |
| Flag file check | Waits for pull-complete flag | Skipped — manual trigger |
| Crash checkpoint | Writes every 10 threads | Skipped — single manual run |
| Cross-reference | Against prior day storage | Against TARGET_DATE–1 storage |
| Output storage key | `YYYY-MM-DD.json` (today) | `YYYY-MM-DD.json` (TARGET_DATE) |
| AI job trigger | Not included | Offered at end of run |

Everything else (bucket logic, urgency, tags, extraction, dedup) is identical to
`email-classify-skill.md`. Follow those rules throughout.

---

## Step 0 — Detect workspace path

```bash
WORKSPACE_PATH=$(find /sessions -maxdepth 5 -name "personal-os" -type d 2>/dev/null | head -1)
if [ -z "$WORKSPACE_PATH" ]; then
  WORKSPACE_PATH="$HOME/personal-os"
fi
DATA_PATH="${WORKSPACE_PATH}/data"
echo "Data path: $DATA_PATH"
```

---

## Step 1 — Determine target date

Ask Ryan for the target date if not already provided:

> "Which date do you want to classify? (e.g. 2026-06-15)"

Store as `TARGET_DATE` (YYYY-MM-DD). Validate it's in the past.

Compute `PRIOR_DATE` = TARGET_DATE minus 1 day.

---

## Step 1.5 — Load raw input data

Try input sources in order, stopping at the first success:

**Source A — Local last-email-report.json (pull-backfill just ran):**

```bash
REPORT_DATE=$(python3 -c "
import json
try:
    with open('${DATA_PATH}/last-email-report.json') as f:
        print(json.load(f).get('report_date',''))
except: print('')
" 2>/dev/null)
echo "Local report date: $REPORT_DATE"
```

If `REPORT_DATE == TARGET_DATE`, use this file as input. Read it with the Read tool.

**Source B — Fetch from storage:**

If Source A fails or date doesn't match:

```bash
curl -s \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${TARGET_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
```

Parse the response JSON. If empty or HTTP error, fail with:
> "No email data found for [TARGET_DATE]. Run email-pull-backfill first to generate it."

Parse the JSON. Store:
- `threads[]` — all thread records
- `calendar[]` — events (may be empty for backfill dates)
- `pending_invites[]` — invites (may be empty)
- `yesterday_conv_ids[]` — ignored in backfill (computed from PRIOR_DATE storage below)
- `bucket6_count` — from raw or default to 0

---

## Step 2 — Load cross-reference baseline

Fetch PRIOR_DATE's report from storage to get yesterday's conversation IDs:

```bash
curl -s \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${PRIOR_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
```

If found: extract all `conversationId` values → `PRIOR_CONV_IDS[]`
If not found: `PRIOR_CONV_IDS = []` — all threads will be `cross_reference_status: "new"`

Log: `Cross-reference loaded: [N] conversation IDs from [PRIOR_DATE]`

---

## Step 3 — Classify, extract, and build output

Follow `email-classify-skill.md` from Step 2 onward (no flag check, no crash checkpoint):

- **Step 2** — Classify threads into 6 buckets
- **Step 3** — Apply urgency escalation rules
- **Step 4** — Build tags array
- **Step 5 — Phase 1B extraction** — Extract intelligence per thread:
  - For each Bucket 1/2 thread with `full_thread_content` available:
    - Extract: `action_items[]`, `commitments[]`, `pending_decisions[]`, `risk_signals[]`,
      `decisions_made[]`, `key_facts[]`, `ai_summary`, `context_type`
  - Format as `extracted` object attached to each thread record

**When RESUMING is not set** (backfill = always fresh): process all threads from the start.

Use `PRIOR_CONV_IDS[]` instead of the daily `yesterday_conv_ids[]` for cross-reference logic.

---

## Step 4 — Save and upload classified output

**Save to local disk first:**

Read `{DATA_PATH}/last-email-report.json` immediately before writing.
Write the complete classified report with `"report_date": "[TARGET_DATE]"`.

**Upload to Supabase storage (always PUT/upsert):**

```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${TARGET_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

**Trigger database processing** (upserts emails into the `emails` table with `extracted` field):

```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/jobs/process-email-report" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"date": "[TARGET_DATE]"}'
```

Log the response. On success the DB now has email records with `extracted` JSONB populated —
the nightly AI job's Phase 1B fast-path will pick these up when it runs for TARGET_DATE.

---

## Step 5 — Trigger nightly AI job for TARGET_DATE (offered, not automatic)

After upload success, ask Ryan:

> "Email data for [TARGET_DATE] is classified and in the database. Plaud data is
> already there. Want me to trigger the nightly AI job for [TARGET_DATE] now?
> This will run the full intelligence extraction (tasks, commitments, pending decisions,
> observations) using data from that specific date."

If Ryan confirms, trigger via GitHub Actions API:

```bash
curl -s -X POST \
  "https://api.github.com/repos/Rwhankins24/personal-os/actions/workflows/nightly-ai.yml/dispatches" \
  -H "Authorization: Bearer [GITHUB_PAT]" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d '{
    "ref": "main",
    "inputs": {
      "force_run": "true",
      "date_override": "[TARGET_DATE]",
      "force_rerun": "true"
    }
  }'
```

**Where to find `GITHUB_PAT`:**
```bash
cat ~/personal-os/.env | grep GITHUB_PAT
```
Or: check the environment — the PAT is stored as `GITHUB_PAT` in the `.env` file.

`force_run: true` bypasses today's pipeline status check (the workflow normally only
fires after today's email processing — for a historical backfill, we bypass this).
`date_override: TARGET_DATE` tells the nightly job which date to process.
`force_rerun: true` allows re-running even if AI already ran for that date.

Log on success:
```
✓ GitHub Actions workflow dispatched
  date_override: [TARGET_DATE]
  force_run: true
  force_rerun: true
```

The AI job runs in GitHub Actions (~15-20 min). Results appear in your Personal OS
dashboard once it completes.

---

## Step 6 — Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EMAIL CLASSIFY BACKFILL — [TARGET_DATE]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  BUCKETS
  ────────────────────────────────────────────────────
  Bucket 1 — Needs Reply:     X threads
  Bucket 2 — Waiting On:      X threads
  Bucket 3 — Oversight/FYI:   X threads
  Bucket 4 — Documents:       X threads
  Bucket 5 — Pending Invites: X
  Bucket 6 — Filtered:        X

  Phase 1B extraction:        X threads extracted
  Cross-reference source:     [PRIOR_DATE] ([N] IDs)

  JSON saved:     ~/personal-os/data/last-email-report.json  ✓
  Storage upload: daily-reports/[TARGET_DATE].json  [success | failed | sandbox_blocked]
  DB processing:  /api/jobs/process-email-report   [success | failed | skipped]
  AI job:         [triggered | skipped | pending confirmation]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Full backfill sequence (missed pull + Plaud already uploaded)

This is the primary recovery flow. Run these three things in order:

```
1. email-pull-backfill     → pulls email for TARGET_DATE, uploads to storage
2. email-classify-backfill → classifies + extracts, pushes to DB, offers AI trigger
3. (confirm) AI job        → GitHub Actions dispatched with date_override=TARGET_DATE
```

The AI job then runs with all three data sources for TARGET_DATE:
- ✓ Emails (from backfill)
- ✓ Plaud meetings (already in DB)
- ✓ Otter meetings (already in DB if synced)
