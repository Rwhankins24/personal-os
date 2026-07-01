---
name: pipeline-backfill
description: >
  Master pipeline backfill orchestration. Handles the full stack for any missed date
  range — email pull from M365, Plaud pull from Gmail via GitHub Actions, email
  classification + extraction, and AI intelligence job — all in one pass.
  Trigger on: "run backfill for [date range]", "backfill from [date] to [date]",
  "backfill [date] to today", "missed pipeline for [date/range]",
  "catch up the system for [date range]", "fill in [date] to [date]".
  This is the top-level recovery skill. It calls plaud-pull, email pull, classify,
  and backfill.yml automatically — you do not need to run the individual backfill
  skills separately when using this one.
---

# Pipeline Backfill — Master Orchestration

You are running a full pipeline backfill for Ryan Hankins. This skill audits what data
is missing for each date in a range, then fills it in systematically — email from M365,
Plaud from Gmail via GitHub Actions, classification, and AI intelligence extraction.

**The unit is a date, not a run.** For each date in the range, all three intelligence
legs (email, Plaud, Otter) need to be present before the AI job runs for that date.

**Runtime credentials — read from `.env`, do NOT hardcode:**
```bash
WORKSPACE_PATH=$(find /sessions -maxdepth 5 -name "personal-os" -type d 2>/dev/null | head -1)
if [ -z "$WORKSPACE_PATH" ]; then WORKSPACE_PATH="$HOME/personal-os"; fi
SUPABASE_URL=$(grep '^SUPABASE_URL=' "${WORKSPACE_PATH}/api/.env" | cut -d= -f2-)
SUPABASE_SERVICE_KEY=$(grep '^SUPABASE_SERVICE_KEY=' "${WORKSPACE_PATH}/api/.env" | cut -d= -f2-)
echo "Credentials loaded."
```
- `VERCEL_URL` = `https://personal-os-five-black.vercel.app`
- `TRIGGER_SECRET` = `0557601ac4f4c8f0d42923bba2fb083b`
- `GITHUB_REPO` = `Rwhankins24/personal-os`
- `GITHUB_PAT` — read from `~/personal-os/.env` (key: `GITHUB_PAT`)

**Important:** Email from M365 must be pulled via the Cowork M365 connector (Steps 4-5).
Plaud from Gmail must be pulled via GitHub Actions (`plaud-pull.yml`) — that has the
Gmail OAuth credentials the Cowork environment does not have access to.

---

## Step 0 — Detect workspace path

```bash
WORKSPACE_PATH=$(find /sessions -maxdepth 5 -name "personal-os" -type d 2>/dev/null | head -1)
if [ -z "$WORKSPACE_PATH" ]; then
  WORKSPACE_PATH="$HOME/personal-os"
fi
DATA_PATH="${WORKSPACE_PATH}/data"
echo "Workspace: $WORKSPACE_PATH"
echo "Data path: $DATA_PATH"
```

Load `GITHUB_PAT` from `.env`:
```bash
GITHUB_PAT=$(grep -E '^GITHUB_PAT=' "${WORKSPACE_PATH}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$GITHUB_PAT" ]; then
  echo "⚠ GITHUB_PAT not found in .env — Plaud pull and backfill.yml dispatch will be skipped"
fi
echo "GitHub PAT: ${GITHUB_PAT:+set (${#GITHUB_PAT} chars)}"
```

---

## Step 1 — Parse date range

Parse the user's input into a list of dates. Handle natural language:

| Input | Interpretation |
|-------|---------------|
| "6.21 to today" | June 21, 2026 → today |
| "June 21 to June 25" | 2026-06-21 → 2026-06-25 |
| "last week" | 7 days ago → yesterday |
| "2026-06-21" (single) | Just that one date |
| "June 21, 22, 23" | Those three specific dates |
| "last 5 days" | 5 days ago → yesterday |

```bash
TODAY=$(date '+%Y-%m-%d')
echo "Today: $TODAY"
```

Expand the range into an ordered list of `YYYY-MM-DD` strings:
`TARGET_DATES = [oldest, ..., newest]`

Exclude today (pipeline is still live for today).
Exclude future dates (warn and skip).
Exclude dates before 2026-01-01 (warn as out of Outlook retention range).

Log: `Backfill range: [START_DATE] → [END_DATE] — [N] dates`

---

## Step 2 — Data audit (local archive first, then storage)

For each date in `TARGET_DATES`, check local archive before hitting storage.
Local archive is faster, avoids sandbox network issues, and is the ground truth
for data generated on this Mac.

**Check local archive files first:**

```bash
for DATE in ${TARGET_DATES[@]}; do
  EMAIL_LOCAL="${DATA_PATH}/archive/${DATE}-email-report.json"
  PLAUD_LOCAL="${DATA_PATH}/archive/${DATE}-plaud-report.json"
  echo "Email local ${DATE}: $([ -f "$EMAIL_LOCAL" ] && echo 'EXISTS' || echo 'missing')"
  echo "Plaud local ${DATE}: $([ -f "$PLAUD_LOCAL" ] && echo 'EXISTS' || echo 'missing')"
done
```

For any date where the local archive file EXISTS and is non-empty: mark as
`email_ok` / `plaud_ok` without making a storage request.

For dates where local archive is MISSING: check Supabase storage:

**Email report check** (the classified output — `{DATE}.json`):
```bash
for DATE in ${TARGET_DATES[@]}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${DATE}.json" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")
  echo "Email ${DATE}: HTTP ${HTTP_CODE}"
done
```

**Plaud report check** (`plaud-{DATE}.json`):
```bash
for DATE in ${TARGET_DATES[@]}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/plaud-${DATE}.json" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")
  echo "Plaud ${DATE}: HTTP ${HTTP_CODE}"
done
```

Build result sets:
- `DATES_NEED_EMAIL[]` — dates where email storage check returned 404
- `DATES_NEED_PLAUD[]` — dates where Plaud storage check returned 404
- `DATES_EMAIL_OK[]` — dates that already have email data in storage
- `DATES_PLAUD_OK[]` — dates that already have Plaud data

Print audit table:
```
Date         Email         Plaud
──────────────────────────────────────────
2026-06-21   ✗ MISSING     ✗ MISSING
2026-06-22   ✓ exists      ✗ MISSING
2026-06-23   ✗ MISSING     ✓ exists
2026-06-24   ✓ exists      ✓ exists
...
```

---

## Step 3 — Pull Plaud via GitHub Actions (if any dates need it)

Skip this step if:
- `DATES_NEED_PLAUD[]` is empty (all Plaud data already exists)
- `GITHUB_PAT` is not set

If any dates need Plaud data:

Find `EARLIEST_MISSING_PLAUD` = the oldest date in `DATES_NEED_PLAUD[]`.

Trigger `plaud-pull.yml` once with this date as the override. The workflow's
updated lookback logic (added this session) will automatically extend the Gmail
search window to cover all dates from `EARLIEST_MISSING_PLAUD` to today.

```bash
DISPATCH_RESULT=$(curl -s -X POST \
  "https://api.github.com/repos/Rwhankins24/personal-os/actions/workflows/plaud-pull.yml/dispatches" \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d "{\"ref\": \"main\", \"inputs\": {\"date_override\": \"${EARLIEST_MISSING_PLAUD}\"}}")
echo "Plaud dispatch: $DISPATCH_RESULT"
```

Wait 15 seconds for the workflow to register, then poll for completion:

```bash
POLL_ATTEMPTS=20  # up to ~5 minutes (20 × 15s)
PLAUD_DONE=false

for i in $(seq 1 $POLL_ATTEMPTS); do
  sleep 15
  RUN_INFO=$(curl -s \
    "https://api.github.com/repos/Rwhankins24/personal-os/actions/workflows/plaud-pull.yml/runs?per_page=1" \
    -H "Authorization: Bearer ${GITHUB_PAT}")
  STATUS=$(echo "$RUN_INFO" | python3 -c "import json,sys; r=json.load(sys.stdin)['workflow_runs'][0]; print(r.get('status','unknown'))" 2>/dev/null)
  CONCLUSION=$(echo "$RUN_INFO" | python3 -c "import json,sys; r=json.load(sys.stdin)['workflow_runs'][0]; print(r.get('conclusion') or 'pending')" 2>/dev/null)
  echo "  Plaud pull poll ${i}/${POLL_ATTEMPTS}: status=${STATUS} conclusion=${CONCLUSION}"

  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCLUSION" = "success" ]; then
      echo "  ✓ Plaud pull completed successfully"
      PLAUD_DONE=true
    else
      echo "  ✗ Plaud pull completed with conclusion: ${CONCLUSION}"
      echo "    Check: https://github.com/Rwhankins24/personal-os/actions/workflows/plaud-pull.yml"
    fi
    break
  fi
done

if [ "$PLAUD_DONE" != "true" ]; then
  echo "  ⚠ Plaud pull did not complete within 5 min. Continuing anyway — Plaud data may be partial."
fi
```

Log any dates that still have no Plaud storage file after the workflow completes
(no meetings that day = expected and fine; log as "no Plaud meetings" not "error").

---

## Step 4 — Pull email from M365 connector (for missing dates)

Skip this step if `DATES_NEED_EMAIL[]` is empty.

**Expected time:** approximately 3–5 minutes per date (multiple M365 queries per date).
For 8 dates, this step will take 25–40 minutes. Proceed without rushing.

For each date in `DATES_NEED_EMAIL[]` (process in chronological order):

Print progress: `[N/M] Pulling email for [TARGET_DATE]...`

**4A — Compute pull window:**
- `WINDOW_START` = `{TARGET_DATE}T00:00:00Z`
- `WINDOW_END` = `{TARGET_DATE}T23:59:59Z`
- 4 fixed 6-hour slices (midnight–6am, 6am–noon, noon–6pm, 6pm–midnight)

**4B — Pull inbox slices** (run in batches of 2):

Run the following `outlook_email_search` calls in two concurrent batches:

Batch 1 (run both at the same time):
- `folderName: "inbox"`, `afterDateTime: WINDOW_START`, `beforeDateTime: {TARGET_DATE}T06:00:00Z`, `limit: 100`
- `folderName: "inbox"`, `afterDateTime: {TARGET_DATE}T06:00:00Z`, `beforeDateTime: {TARGET_DATE}T12:00:00Z`, `limit: 100`

Wait for both to complete, then Batch 2:
- `folderName: "inbox"`, `afterDateTime: {TARGET_DATE}T12:00:00Z`, `beforeDateTime: {TARGET_DATE}T18:00:00Z`, `limit: 100`
- `folderName: "inbox"`, `afterDateTime: {TARGET_DATE}T18:00:00Z`, `beforeDateTime: WINDOW_END`, `limit: 100`

Then keyword queries (run all 3 concurrently):
- `query: "urgent OR deadline OR \"action required\" OR approval"`, no date params
- `query: "contract OR agreement OR GMP OR \"change order\" OR indemnity"`, no date params
- `query: "DocuSign OR signature OR submittal OR drawing"`, no date params

Filter keyword query results client-side: keep only where `received_at` falls within `[WINDOW_START, WINDOW_END]`.

After all queries: merge + deduplicate by `conversationId`.
Log: `  [DATE] inbox: [N] unique threads`

**4C — Pull sent items for TARGET_DATE:**
- `folderName: "sentitems"`, `afterDateTime: WINDOW_START`, `beforeDateTime: WINDOW_END`, `limit: 100`

Merge with inbox results for thread grouping.

**4D — Group threads, classify, tag, extract:**

Follow `email-pull-skill.md` thread grouping and classification logic exactly:
- Group by `conversationId`
- Compute `ryanSentLast`, `myLastReplyTime`, `waitingSince`, `days_waiting`
- Classify into buckets 1–6
- Apply urgency escalation rules
- Build `tags[]`
- Tiered context extraction (Tier 1: full thread for Bucket 1/2; Tier 2: extended for Bucket 3/4)

**Phase 1B extraction** (for all Tier 1/2 threads):
For each thread with `full_thread_content`:
Extract: `action_items[]`, `commitments[]`, `pending_decisions[]`, `risk_signals[]`,
`decisions_made[]`, `key_facts[]`, `ai_summary`, `context_type`
Store as `extracted` object on the thread record.

Cross-reference against prior day's storage file (fetch `{TARGET_DATE minus 1 day}.json`)
for `cross_reference_status`. If not found, mark all as `"new"`.

**4E — Upload to storage:**

```bash
# Save local copy first
# (Read last-email-report.json immediately before Writing — required by Write tool)
```

Build output JSON with `"report_date": "[TARGET_DATE]"` and write to:
`{DATA_PATH}/last-email-report.json`

Then upload to storage:
```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/${TARGET_DATE}.json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

On upload failure: log `sandbox_blocked` and continue — the storage file is the critical
handoff for `backfill.yml` Step 1, so if the sandbox blocks the upload, flag this date as
"needs manual upload" and continue to the next date.

Log: `  [DATE] → storage upload [success | sandbox_blocked | failed]`

**4F — Pause before next date:**
```bash
sleep 20
```

Brief pause to avoid M365 rate limits between date pulls.

---

## Step 5 — Trigger backfill.yml for all dates

Trigger one `backfill.yml` workflow run covering all dates in `TARGET_DATES[]`.

`backfill.yml` does three things per date:
1. Calls `POST /api/jobs/process-email-report?date=DATE` — upserts emails into DB
2. Calls `POST /api/jobs/process-otter-report?date=DATE` — upserts Otter meetings into DB
3. Runs `nightly-ai-local.js` with `DATE_OVERRIDE=DATE` — full AI intelligence extraction

```bash
DATES_CSV=$(IFS=','; echo "${TARGET_DATES[*]}")
echo "Triggering backfill.yml for: $DATES_CSV"

BACKFILL_DISPATCH=$(curl -s -X POST \
  "https://api.github.com/repos/Rwhankins24/personal-os/actions/workflows/backfill.yml/dispatches" \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d "{\"ref\": \"main\", \"inputs\": {\"dates\": \"${DATES_CSV}\", \"skip_email\": \"false\", \"skip_otter\": \"false\"}}")
echo "Backfill dispatch: $BACKFILL_DISPATCH"
```

If `GITHUB_PAT` is not available, print the command for Ryan to run manually from terminal:

```
MANUAL TRIGGER (run from terminal):
────────────────────────────────────────────────
gh workflow run backfill.yml \
  --field dates="[DATES_CSV]" \
  --field skip_email=false \
  --field skip_otter=false
────────────────────────────────────────────────
Monitor at: https://github.com/Rwhankins24/personal-os/actions/workflows/backfill.yml
```

Note: `backfill.yml` runs the full AI job for each date sequentially in GitHub Actions.
Each date takes 15–25 minutes. For 8 dates, total runtime is 2–3 hours. This is normal.

---

## Step 6 — Summary report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PIPELINE BACKFILL SUMMARY
  Range: [START_DATE] → [END_DATE] · [N] dates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  STORAGE AUDIT
  ─────────────────────────────────────────────────────
  Email already in storage:  [N] dates  [list dates]
  Plaud already in storage:  [N] dates  [list dates]
  Email needed to pull:      [N] dates  [list dates]
  Plaud needed to pull:      [N] dates  [list dates]

  PLAUD PULL (GitHub Actions)
  ─────────────────────────────────────────────────────
  Status:                    [success | skipped | failed | partial]
  Earliest date covered:     [EARLIEST_MISSING_PLAUD or "n/a"]
  Workflow run:              https://github.com/Rwhankins24/personal-os/actions/workflows/plaud-pull.yml

  EMAIL PULL (M365 Connector)
  ─────────────────────────────────────────────────────
  [DATE]  Bucket1:[N]  Bucket2:[N]  B3:[N]  Upload:[✓|sandbox_blocked|✗]
  [DATE]  Bucket1:[N]  Bucket2:[N]  B3:[N]  Upload:[✓|sandbox_blocked|✗]
  ...

  AI JOB (backfill.yml)
  ─────────────────────────────────────────────────────
  Dates queued:   [N]  ([DATES_CSV])
  Dispatch:       [success | failed | manual required]
  Monitor:        https://github.com/Rwhankins24/personal-os/actions/workflows/backfill.yml
  Est. runtime:   ~[N × 20] minutes for AI job to complete all dates

  WARNINGS / ACTION REQUIRED
  ─────────────────────────────────────────────────────
  [Any sandbox_blocked uploads, Plaud pull failures, or M365 throttle errors]
  [If any email storage uploads were sandbox_blocked: manually run push_email_report.py
   for those dates from your terminal:
   DATE=2026-06-21 python3 ~/personal-os/data/push_email_report.py]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Results will appear in your Personal OS dashboard
  as the backfill.yml AI jobs complete (~[N × 20] min).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Resilience rules

1. **Never abort the entire run for one date.** If one date fails (M365 timeout,
   upload blocked, etc.), log it in WARNINGS and continue to the next date.

2. **Sandbox upload blocks are expected.** The Cowork sandbox may not have outbound
   internet to Supabase. If curl upload fails: log as `sandbox_blocked`, save local
   copy to `{DATA_PATH}/last-email-report.json`, and list the manual upload command
   in WARNINGS. The local file is still valid input for backfill.yml if needed.

3. **No M365 connector = stop email pull cleanly.** If the Outlook connector is
   unavailable, skip Step 4 entirely. Log "M365 unavailable — email pull skipped."
   Proceed with Steps 3 and 5 using whatever data is already in storage.

4. **No GITHUB_PAT = skip GitHub triggers.** Print manual trigger commands for
   plaud-pull.yml and backfill.yml. The skill still completes the M365 email pull.

5. **Already-complete dates.** If BOTH email and Plaud storage files exist for a date,
   still include that date in the backfill.yml dispatch — the process-email-report
   and AI job are idempotent (upsert logic). This re-runs the AI intelligence extraction,
   which is valuable if something was missed or the extraction logic has been improved.

6. **Weekend dates.** Include in range. No Plaud meetings expected, but email still
   existed. Handle normally.

---

## Timing expectations

For a typical 8-day backfill (e.g., June 21–28):

| Step | Time |
|------|------|
| Step 2 — Storage audit | ~2 min |
| Step 3 — Plaud pull (GitHub Actions) | ~3–5 min |
| Step 4 — Email pull from M365 (8 dates) | ~40–60 min |
| Step 5 — backfill.yml dispatch | ~1 min |
| Total skill runtime | ~50–70 min |
| backfill.yml AI jobs (GitHub Actions) | ~160–200 min (runs in background) |

The Cowork skill finishes when backfill.yml is dispatched. The AI processing runs
in GitHub Actions in the background — results appear progressively in your dashboard.
