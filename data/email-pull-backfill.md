---
name: email-pull-backfill
description: >
  Backfill email pull for a specific past date or date range. Use when: a daily
  pull was missed (travel, crash, launchd failure), you need to re-pull a date
  with better coverage, or you want to retroactively populate the pipeline for
  a historical window. Trigger on: "backfill emails for June 5", "re-pull June 1-7",
  "missed email pull for [date]", "pull emails for [past date]".
  This is NOT the daily pull skill — it's the recovery/backfill path.
---

# Email Pull Backfill

You are the recovery path for Ryan Hankins' email pipeline. The daily `email-pull`
skill runs at 4:15 AM. This skill is triggered manually when a date was missed or
needs to be re-pulled with different parameters.

**Output:**    `~/personal-os/data/last-email-report.json` (handoff for classify)
**Storage:**   `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TARGET_DATE].json`
**Webhook:**   `https://personal-os-five-black.vercel.app/api/webhooks?type=email`

**Runtime credentials:**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`

---

## Differences from the daily email-pull skill

| Aspect | Daily pull | Backfill |
|--------|------------|----------|
| Pull window | Last 48h from now | Midnight–11:59pm of TARGET_DATE |
| Cross-reference | Against yesterday's report | Against TARGET_DATE–1 day from storage |
| Calendar pull | Today's events | Skipped (historical) |
| Flag file | Written on completion | Not written |
| Checkpoint | Not applicable | Not applicable |
| Output file | `last-email-report.json` | `last-email-report.json` (same — for classify handoff) |
| Storage key | `YYYY-MM-DD.json` (today) | `YYYY-MM-DD.json` (TARGET_DATE) |

Everything else (bucket logic, urgency, tags, tiered extraction, resilience rules) is
identical to `email-pull-skill.md`. Follow those rules throughout.

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

## Step 1 — Determine target date(s)

Ask Ryan for the target date if not already provided:

> "Which date do you want to backfill? (e.g. 2026-06-15 or a range like 2026-06-10 to 2026-06-15)"

Parse the response into:

```
TARGET_DATES[] — array of YYYY-MM-DD strings to process
```

For a single date: `TARGET_DATES = ["2026-06-15"]`
For a range: expand to all dates inclusive: `["2026-06-10", "2026-06-11", ..., "2026-06-15"]`

Validate each date is in the past (before today). Warn and skip any future dates.

**Process one date at a time** through Steps 2–8. If multiple dates, repeat Steps 2–8
for each date in chronological order.

For each target date, compute:
- `TARGET_DATE` = `YYYY-MM-DD` (e.g. `2026-06-15`)
- `WINDOW_START` = `TARGET_DATE T00:00:00Z` (midnight UTC)
- `WINDOW_END` = `TARGET_DATE T23:59:59Z` (end of day UTC)

Log: `Backfill target: [TARGET_DATE] — window [WINDOW_START] → [WINDOW_END]`

---

## Step 1.5 — Check if storage already has a report for this date

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${TARGET_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
```

- If HTTP 200 → a report already exists. Ask Ryan: "A report for [TARGET_DATE] already exists
  in storage. Overwrite it?" If yes, continue. If no, skip this date.
- If HTTP 404 → no existing report. Proceed.
- If storage check fails → log warning, assume no existing report, proceed.

---

## Step 2 — Load cross-reference baseline (prior day's report)

Compute `PRIOR_DATE` = TARGET_DATE minus 1 day.

Attempt to fetch prior day's report from storage:

```bash
curl -s \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${PRIOR_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
```

If found: extract all `conversationId` values from all buckets → `PRIOR_CONV_IDS[]`
If not found: `PRIOR_CONV_IDS = []` — all threads will be marked `cross_reference_status: "new"`

Log: `Prior day cross-reference: [PRIOR_DATE] — [N] conversation IDs loaded`

---

## Step 3 — Pull inbox (date-windowed, batched)

Follow the same split-query + batch approach as `email-pull-skill.md` Step 2A, but use
`WINDOW_START` and `WINDOW_END` as the time bounds instead of the rolling pull window.

**Compute 6-hour slices within the TARGET_DATE window:**

```
slices = [
  { start: WINDOW_START,       end: TARGET_DATE T06:00:00Z },
  { start: TARGET_DATE T06:00:00Z, end: TARGET_DATE T12:00:00Z },
  { start: TARGET_DATE T12:00:00Z, end: TARGET_DATE T18:00:00Z },
  { start: TARGET_DATE T18:00:00Z, end: WINDOW_END }
]
```

Run slices in batches of 2 (historical queries are slower — use smaller batches to avoid timeouts):
- Batch 1: slices 0, 1 → wait for both
- Batch 2: slices 2, 3 → wait for both

Then run keyword queries (same as daily pull Step 2A-2/2A-3/2A-4) with
`afterDateTime: WINDOW_START` and `beforeDateTime: WINDOW_END` added.

**Note on keyword queries:** The M365 connector cannot combine `query:` + date params
in the same call. Run keyword queries without date parameters and filter results
client-side to TARGET_DATE using `received_at`.

After all queries: merge + deduplicate by `conversationId`. Keep only threads where
`received_at` falls within `[WINDOW_START, WINDOW_END]`.

Log: `Backfill pull: [N] unique threads found for [TARGET_DATE]`

---

## Step 3.5 — Pull sent items for TARGET_DATE

```
folderName: "sentitems"
afterDateTime: WINDOW_START
beforeDateTime: WINDOW_END
limit: 100
```

Merge with inbox results for thread grouping + `myLastReplyTime` computation.
Same as daily pull Step 2B — just scoped to TARGET_DATE.

---

## Step 4 — Group by thread, classify, tag, extract

Follow `email-pull-skill.md` exactly:
- Step 2.5 (group by thread)
- Step 2.5B (tiered context extraction — Tier 1/2/3)
- Step 3 (classify into 6 buckets)
- Step 4 (cross-reference against `PRIOR_CONV_IDS[]` instead of yesterday's file)
- Urgency escalation rules
- Step 5 (build tags)

No calendar pull. Set `calendar: []` in the output JSON.

---

## Step 5 — Save handoff JSON and upload

**Save to disk first (always):**

Read `{DATA_PATH}/last-email-report.json` immediately before writing, then write the
full classified report with `"report_date": "[TARGET_DATE]"`.

**Upload to Supabase storage:**

Use `PUT` with `x-upsert: true` (backfill always overwrites):

```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${TARGET_DATE}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

On upload success, trigger the Vercel processing job to push threads into the database:

```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/jobs/process-email-report" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"date": "[TARGET_DATE]"}'
```

This upserts the backfilled threads into the `emails` table so the nightly AI job
can process them.

On upload failure: fall back to individual webhook pushes (same as daily pull Step 7
fallback). Log as `sandbox_blocked` if network is unavailable.

**Do NOT write a pull-complete flag file.** This is a manual backfill — the daily
pipeline flag system should not be affected.

---

## Step 6 — Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EMAIL PULL BACKFILL — [TARGET_DATE]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  BUCKETS
  ────────────────────────────────────────────────────
  Bucket 1 — Needs Reply:     X threads
  Bucket 2 — Waiting On:      X threads
  Bucket 3 — Oversight/FYI:   X threads
  Bucket 4 — Documents:       X threads
  Bucket 5 — Pending Invites: 0  (skipped in backfill)
  Bucket 6 — Filtered:        X  (not pushed)

  JSON saved:     ~/personal-os/data/last-email-report.json  ✓
  Storage upload: daily-reports/[TARGET_DATE].json  [success | failed | sandbox_blocked]
  DB trigger:     /api/jobs/process-email-report    [success | failed | skipped]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Next step: run email-classify-backfill for [TARGET_DATE]
  to classify and extract intelligence from this data.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If processing multiple dates in a range, repeat Steps 1.5–6 for each date in sequence
before printing the combined summary.

---

## When to use each backfill skill

| Situation | Use |
|-----------|-----|
| Daily pull missed (launchd crash, travel) | `email-pull-backfill` → then `email-classify-backfill` |
| Pull ran fine, classify crashed or was skipped | `email-classify-backfill` only (reads existing raw JSON) |
| Want to re-classify old data with updated rules | `email-classify-backfill` with `--force` |
| Need to populate the DB for a date range | `email-pull-backfill` for each date → Vercel job auto-triggered |
