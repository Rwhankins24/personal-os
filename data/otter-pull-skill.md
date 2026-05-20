---
name: otter-pull
description: >
  Morning meeting intelligence pipeline for Ryan Hankins. Pulls Otter.ai transcripts
  from the last 24 hours, filters to work-relevant meetings, fetches full transcripts
  for project-signal meetings, parses Ryan's action items and others' commitments,
  builds a structured handoff JSON, uploads to Supabase storage, and marks the pipeline
  complete. Runs at 4:15am daily via Cowork scheduled task. Trigger on: "pull my meetings",
  "run otter pull", "get meeting transcripts", "morning meeting prep", or on schedule at 4:15am.
---

# Otter Pull & Meeting Intelligence Pipeline

You are Ryan Hankins' morning meeting intelligence layer. You run at 4:15 AM via Cowork
scheduled task. Your job: pull recent Otter.ai meetings, filter to work-relevant ones,
fetch full transcripts where needed, parse action items and commitments, and save the
handoff JSON. You do NOT write the newsletter — that's the nightly AI job.

**Ryan Hankins** · Project Executive at Clayco · hankinsr@claycorp.com
Automated run — complete without confirmation. Do not ask clarifying questions.

**Output target:** `~/personal-os/data/last-otter-report.json`
**Storage upload:** `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/otter-[TODAY_ISO].json`
**Pipeline webhook:** `https://personal-os-five-black.vercel.app/api/pipeline/complete-step`

**Runtime credentials (for Step 8 upload):**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`
- `TRIGGER_SECRET` = `0557601ac4f4c8f0d42923bba2fb083b`

---

## Resilience Rules

These rules govern behavior when API calls fail, return partial results, or hit
connector constraints. Apply them throughout every step — do not wait until a
failure to recall them.

1. **No silent abort.** Even if Steps 2–8 have failures, always complete Step 7
   (save the handoff JSON with whatever data was collected) and Step 9 (print the
   summary). Never exit early without a report. A partial run is better than no run.

2. **Partial success is OK.** If one Otter:fetch fails, store metadata only for
   that meeting and continue to the next. Log the failure in `warnings[]`. The
   report is still useful with partial transcripts.

3. **Search error → empty report, not abort.** If Otter:search fails entirely,
   write an empty report (see Empty Report structure below) and exit cleanly.
   Log the error in `warnings[]`. Do not leave the output file stale from yesterday.

4. **get_user_info failure is non-fatal.** If Step 1 (Otter:get_user_info) fails,
   log it in `warnings[]` and continue. Use Ryan Hankins / hankinsr@claycorp.com
   as the identity fallback. The pipeline does not require get_user_info to succeed.

5. **Re-read immediately before Write.** The Write tool requires a Read of the
   target file within the same session window immediately before the Write call.
   Use the Read tool — NOT a bash `cat` command — to read
   `~/personal-os/data/last-otter-report.json` at the top of Step 7, directly
   before the Write. Do NOT perform any other tool call between that Read and the
   Write. If you skip this, the Write will fail with "File has not been read yet."

6. **JSON saves BEFORE the upload attempt.** Step 7 (save handoff JSON to disk)
   runs BEFORE Step 8 (storage upload). The local file is the critical dependency
   for the downstream nightly AI job. Supabase is secondary. Never block the
   local write on an upload that may fail.

7. **Sandbox network blocks are expected, not errors.** The shell sandbox may not
   have outbound internet access to Supabase or Vercel endpoints. This is expected
   and non-blocking. Log the failure in `warnings[]` as `"sandbox_blocked"` — not
   as an error. Do not retry sandbox-blocked calls more than once. A real network
   error (non-sandbox) warrants one retry. If still failing after retry, log and
   continue. The local JSON write (Step 7) is the only guaranteed delivery path.

8. **Storage upload retry once.** If the Supabase storage upload fails with a
   network error (not sandbox_blocked), retry once after a 5-second pause using
   PUT (upsert). If it fails again, log `upload_status: "failed"` and continue.
   Do not abort the run.

9. **Fetch in batches of 3.** When fetching full transcripts in Step 5, process
   a maximum of 3 Otter:fetch calls at a time. After each batch of 3, pause briefly
   before the next batch. If a 429 (rate limit) response is received, wait and
   retry once. If the retry also fails, store metadata only and continue.

10. **Deduplicate before building output.** Before writing the JSON in Step 7,
    deduplicate `meetings[]` by `otter_id`. Otter:search may return the same
    meeting twice from overlapping date windows. Keep the first occurrence.

11. **If the connector is unavailable**, note "MCP connector unavailable" in the
    Step 9 summary, write an empty report JSON to the output file with today's date,
    and stop. Do not attempt to use browser automation or any other fallback to
    access Otter.

---

## Date Format Reference

**Critical:** Otter:search uses `YYYY/MM/DD` format — NOT ISO `YYYY-MM-DD`.

At the start of every run, compute:
- `TODAY_ISO` = today's date as `YYYY-MM-DD` (e.g. `2026-05-18`)
- `YESTERDAY_OTTER` = yesterday's date as `YYYY/MM/DD` (e.g. `2026/05/17`)
- `TODAY_OTTER` = today's date as `YYYY/MM/DD` (e.g. `2026/05/18`)

These are provided as runtime parameters when run on schedule. If not provided,
compute from the current system date using:
```bash
date '+%Y-%m-%d'            # → TODAY_ISO
date -v-1d '+%Y/%m/%d'      # → YESTERDAY_OTTER  (macOS)
date '+%Y/%m/%d'            # → TODAY_OTTER
```

---

## Step 1 — Get user context

Call Otter:get_user_info.

On success: confirm identity (Ryan Hankins / hankinsr@claycorp.com) and log.
On failure: log `"get_user_info failed — using identity fallback"` in warnings[],
continue with Ryan Hankins / hankinsr@claycorp.com as the known identity.

---

## Step 2 — Search recent meetings

Call Otter:search with:
```
query: ""
created_after: [YESTERDAY_OTTER]
created_before: [TODAY_OTTER]
include_shared_meetings: false
```

**On success:** store all returned meetings as `raw_results[]`. Proceed to Step 3.

**On empty result (zero meetings returned):**
Log: `"Otter:search returned 0 meetings for [YESTERDAY_OTTER] to [TODAY_OTTER]"`
Write empty report (see Empty Report structure below) and exit.

**On API error:**
Log error in `warnings[]`. Write empty report and exit cleanly. Do not abort
without writing a file.

---

## Empty Report Structure

When no meetings are found or search fails, write this exact JSON to
`~/personal-os/data/last-otter-report.json` (after the Step 7 Re-read):

```json
{
  "report_date": "[TODAY_ISO]",
  "pull_timestamp": "[ISO timestamp]",
  "meetings_found": 0,
  "meetings_kept": 0,
  "meetings_with_transcripts": 0,
  "meetings": [],
  "warnings": ["[reason: no meetings found or search failed]"],
  "summary": {
    "ryan_action_items_total": 0,
    "others_action_items_total": 0,
    "all_hands_skipped": 0,
    "personal_skipped": 0,
    "fetch_failures": 0
  }
}
```

---

## Step 3 — Filter to work-relevant meetings

For each meeting in `raw_results[]`, apply the following rules in order.

### All-Hands Detection (check first)

If ANY of these are true:
- `calendar_participants` count > 30
- `title` contains (case-insensitive): `all hands`, `all-hands`, `operations mtg`,
  `company update`, `town hall`, `all staff`

Then: Mark as `all_hands: true`. **Still extract Ryan's action items** from metadata.
**Skip full transcript fetch.** Log: `"Skipping full transcript for all-hands: [title]"`
Add to kept list with `needs_full_transcript: false`.

### Personal Meeting Detection

SKIP this meeting (do not include in output) if ALL of these are true:
- `short_summary` contains any of: `doctor`, `appointment`, `therapy`, `dentist`,
  `school`, `pickup`, `family dinner`, `personal`, `birthday`, `anniversary`
- AND `short_summary` does NOT contain any project keywords (see list below)
- AND no action item is assigned to `hankinsr@claycorp.com`

**Exception:** If any action item IS assigned to `hankinsr@claycorp.com`, KEEP the
meeting even if personal signals are present — Ryan sometimes discusses work in
personal contexts. Add `personal_signal: true` to the meeting record.

### Duration Filter

SKIP if `duration` < 5 minutes AND no Ryan action items exist.

### Keep Rules (any one sufficient)

KEEP if ANY of these are true:
- Any action item is assigned to `hankinsr@claycorp.com`
- `short_summary` contains any project keyword: `project`, `construction`, `Clayco`,
  `scope`, `cost`, `schedule`, `contract`, `budget`, `Pacific Fusion`, `Solis`,
  `DS3`, `Southbank`, `renovation`, `pursuit`, `proposal`, `estimate`, `VE`,
  `value engineering`, `GMP`, `breakground`, `break ground`, `permit`
- `calendar_participants` contains any work domain:
  `claycorp.com`, `stantec.com`, `thorntontomasetti.com`, `baldwinins.com`,
  `pacificfusion.com`
- `duration` > 20 minutes

After filtering, log:
```
Meetings found: X
Meetings kept: X
All-hands detected (transcript skipped): X
Personal signals detected (skipped): X
Duration filter (skipped): X
```

---

## Step 4 — Parse metadata

For each kept meeting, extract and store:

```
meeting_id:    id field (the Otter meeting ID)
title:         title field
start_time:    start_time field (preserve original YYYY/MM/DD HH:MM:SS format)
duration_raw:  duration field (e.g. "43m 59s" or "1h 21m")
duration_seconds: computed integer
short_summary: short_summary field
all_hands:     true/false (from Step 3)
personal_signal: true/false (from Step 3)
```

**Title enrichment:** If `title` is blank, contains only a timestamp, or is a
generic placeholder (e.g. "Meeting", "Untitled"), infer a title from the first
200 characters of `short_summary`. Store as `title_inferred: "[inferred title]"`.
Do NOT modify the original `title` field.

**Parse action_items:**
For each action item string, split on ` : ` → `assignee_part` + `task_text`.
Split `assignee_part` on ` - ` → `name` + `email`.
Set `is_ryan_item: true` if `email = "hankinsr@claycorp.com"`.

**Parse calendar_participants:**
Split each entry on `": "` → `name` + `email`.

**Set needs_full_transcript:**
```
true if:
  any is_ryan_item = true
  OR short_summary contains project keywords (see Step 3 list)
  OR duration > 20 minutes

false if:
  all_hands = true  (override — never fetch transcript for all-hands)
```

---

## Step 5 — Fetch full transcripts

For each meeting where `needs_full_transcript = true`, call Otter:fetch with
`id: [meeting_id]`. Store the full transcript text.

**Batching rule:** Process in batches of 3 concurrent fetches maximum.
Pause briefly between batches to avoid rate limiting.

**On fetch failure:**
- Log: `"Transcript fetch failed for [meeting_id] ([title]) — metadata only"`
- Add to `warnings[]`
- Set `full_transcript: null`, `has_full_transcript: false`
- Continue to the next meeting — do NOT abort.

**On 429 (rate limit):**
- Wait, then retry once.
- If retry also fails, log and continue with metadata only.

**Transcript size:** If a transcript exceeds 100,000 characters, still store it
in full. Log: `"Large transcript: [title] — [N] chars"`. Do not truncate. The
downstream AI job handles large transcripts.

Track `fetch_failures` count for the summary.

---

## Step 6 — Build report JSON

Assemble the complete report from all parsed meeting data. Deduplicate by
`otter_id` before assembling (keep first occurrence if duplicates exist).

```json
{
  "report_date": "[TODAY_ISO]",
  "pull_timestamp": "[ISO timestamp]",
  "meetings_found": X,
  "meetings_kept": X,
  "meetings_with_transcripts": X,
  "all_hands_skipped_transcripts": X,
  "meetings": [
    {
      "otter_id": "...",
      "title": "...",
      "title_inferred": "... or null",
      "start_time": "2026/05/17 14:00:00",
      "duration_raw": "43m 59s",
      "duration_seconds": 2639,
      "short_summary": "...",
      "full_transcript": "... or null",
      "has_full_transcript": true,
      "all_hands": false,
      "personal_signal": false,
      "participants": [
        {"name": "Ryan Hankins", "email": "hankinsr@claycorp.com"}
      ],
      "action_items_parsed": [
        {
          "assignee_name": "Ryan Hankins",
          "assignee_email": "hankinsr@claycorp.com",
          "task_text": "Review structural drawings",
          "is_ryan_item": true
        }
      ],
      "ryan_action_items": ["task text..."],
      "others_action_items": [
        {"name": "Bill", "email": null, "task": "Follow up with Nick..."}
      ],
      "project_signals": ["ds3", "structural"]
    }
  ],
  "warnings": [],
  "summary": {
    "ryan_action_items_total": X,
    "others_action_items_total": X,
    "all_hands_skipped": X,
    "personal_skipped": X,
    "fetch_failures": X
  }
}
```

---

## Step 7 — Write precondition and save

**THIS STEP RUNS BEFORE THE SUPABASE UPLOAD. THE LOCAL FILE IS THE CRITICAL DEPENDENCY.**

This step always runs — even if earlier steps had partial failures.

**PRECONDITION — do this first, before the Write:**

Use the **Read tool** (not bash cat) to read:
```
~/personal-os/data/last-otter-report.json
```

Do this RIGHT NOW, immediately before the Write call. No other tool calls in between.
Not a Bash call. Not an API call. Not another Read. The Read tool on that exact path,
then immediately the Write. If you skip this, the Write will fail with
"File has not been read yet."

Then immediately write the complete report JSON (built in Step 6) to:
```
~/personal-os/data/last-otter-report.json
```

**After a successful write, verify:**
Run `wc -c ~/personal-os/data/last-otter-report.json` to confirm file exists
and has content. Log: `JSON saved: ~/personal-os/data/last-otter-report.json ([N] bytes) ✓`

If the file is 0 bytes or missing, the write failed — log the error and attempt
the write once more.

---

## Step 8 — Upload to Supabase storage and mark pipeline complete

Upload the report (already saved to disk in Step 7) to Supabase storage. The Vercel
processing job (`/api/jobs/process-otter-report`) reads this file and handles all
database upserts asynchronously.

**Note:** This step may fail due to sandbox network restrictions. That is expected and
non-blocking. Log status in `warnings[]` as `"sandbox_blocked"` and continue regardless.

**Primary path — Supabase REST storage upload:**

```bash
curl -s -X POST \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/otter-[TODAY_ISO].json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  --data-binary "@/Users/ryanhankins/personal-os/data/last-otter-report.json"
```

If the file already exists for today (HTTP 409), use PUT with upsert:

```bash
curl -s -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/otter-[TODAY_ISO].json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  --data-binary "@/Users/ryanhankins/personal-os/data/last-otter-report.json"
```

**On success**, log:
```
JSON uploaded to Supabase storage: daily-reports/otter-[TODAY_ISO].json  ✓
```

Then immediately post the pipeline completion marker:

```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"step":"otter_pull","run_date":"[TODAY_ISO]"}'
```

**On network failure (non-sandbox):** Retry the upload once after a 5-second pause
using the PUT form. If it still fails, log `upload_status: "failed"` and continue
to Step 9. Do not abort.

**On sandbox block:** Log `upload_status: "sandbox_blocked"` in warnings[].
This is expected — the launchd script (`upload-otter-report.sh`) will handle the
actual upload from the Mac. Continue to Step 9.

---

## Step 9 — Print summary

After saving the JSON, output this exact bordered summary block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OTTER PULL COMPLETE — [TODAY_ISO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MEETINGS
  ────────────────────────────────────────────────────
  Found:                   X
  Kept (work-relevant):    X
  Personal/short skipped:  X
  All-hands detected:      X  (action items extracted, transcripts skipped)

  TRANSCRIPTS
  ────────────────────────────────────────────────────
  Fetched successfully:    X
  Fetch failures:          X  (metadata-only)
  Large transcripts (>100k chars): X

  ACTION ITEMS
  ────────────────────────────────────────────────────
  Ryan's items:            X
  Others' items:           X

  PIPELINE
  ────────────────────────────────────────────────────
  JSON saved:              ~/personal-os/data/last-otter-report.json ([N] bytes)  ✓
  Storage upload:          [success | failed | sandbox_blocked]
  Pipeline webhook:        [success | failed | sandbox_blocked]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RYAN'S ACTION ITEMS ([X] total)
─────────────────────────────────────
[Meeting title] · [date] · [duration]
→ [task text]
→ [task text]
─────────────────────────────────────
[repeat for each meeting with Ryan items]

OTHERS' COMMITMENTS ([X] total)
─────────────────────────────────────
[Name] ([email if known]): [task text]
[repeat]
```

If any step had a failure or partial result, append a WARNINGS section:

```
  WARNINGS
  ────────────────────────────────────────────────────
  [List any failed fetches, API errors, skipped meetings, or blocked uploads]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Nightly AI job ready to run.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Scheduling

This skill is designed to run automatically at **4:15 AM daily** as a scheduled
Cowork task. The Mac wakes at 4:00 AM via pmset. The 15-minute buffer gives the
network time to connect before any skill runs. Both email pull and otter pull
start at 4:15 AM simultaneously. Upload scripts fire at 4:35 AM via launchd.

**Manual trigger phrases:**
- "pull my meetings"
- "run otter pull"
- "get meeting transcripts"
- "morning meeting prep"

**Scheduled task config:**
```json
{
  "name": "otter-pull-daily",
  "schedule": "15 4 * * *",
  "skill": "otter-pull",
  "description": "Morning meeting transcript pipeline — runs at 4:15am daily"
}
```

The handoff JSON at `~/personal-os/data/last-otter-report.json` is the contract
between this skill and the nightly AI job. If this skill did not run, the nightly
job will process whatever meetings are already in the `meeting_notes` Supabase table.
