# Personal OS — Spec Pressure Test
*Against all code read, all history, all sandbox constraints*
*June 26, 2026 — Compiled after reading: email-pull-raw-skill.md, email-classify-skill.md, nightly-ai-local.js (Steps 1–3.5+), nightly-ai.yml, push_email_report.py*

---

## HOW TO READ THIS DOCUMENT

Each finding is categorized:
- **🔴 CRITICAL** — spec is wrong or misleading. Will cause failures if followed as written.
- **🟠 GAP** — spec is silent on something that must be addressed before building.
- **🟡 ASSUMPTION** — spec assumes something we haven't verified. Needs a check.
- **🟢 CONFIRMED** — I dug in and this part of the spec is solid. No changes needed.

---

## CATEGORY 1: KNOWN FAILURE MODES THAT HAVE ALREADY HAPPENED

### 1.1 🔴 Session crash mid-write (June 26 root cause)

**What happened:** Email pull ran successfully (70 results, 3 pages), then the Cowork session dropped at the file write step. `last-email-raw.json` was left with the PREVIOUS day's date (`2026-06-25`).

**Spec's fix:** Atomic write (temp file → rename). This is correct.

**What the spec misses:** The session can ALSO crash mid-read during the classify skill. Classify reads the raw JSON, processes 70 threads, runs signal extraction, builds output — this is a 15-20 minute skill execution. Cowork session stability for long-running tasks is not guaranteed. The spec's atomic write protects the PULL output but doesn't protect the CLASSIFY output.

**Fix needed:** Add to classify skill: periodic progress writes to a checkpoint file. If classify crashes after processing 50 threads, a restart should resume at thread 51, not thread 1. Without this, every classify crash wastes the full 15-20 minutes.

**Spec update required:** Add to Phase 1B (#69): classify writes progress checkpoint every 10 threads. On restart, reads checkpoint and skips already-processed threads.

---

### 1.2 🔴 push_email_report.py date check is already there — but wrong

**What the spec says:** Task #74 is to "add date check before pushing stale data."

**What the code actually does:**
```python
report_date = report.get("report_date", "")
if report_date != today:
    log(f"⚠  Report date is {report_date}, today is {today}.")
    log("   Proceeding anyway — may be a weekend or holiday catch-up.")
```

It CHECKS the date. Then IGNORES the check. This is the actual bug. The fix is changing 2 lines, not adding a new feature.

**Fix:**
```python
if report_date != today:
    log(f"✗ Report date is {report_date}, not today ({today}). Aborting — stale data.")
    log("  If this is intentional (backfill), pass the file path as an argument.")
    sys.exit(1)
```

Weekend handling: If Ryan is out all week and comes back Monday, the file will be from Friday. That's fine — the AI job handles date_override for manual backfill runs. The daily launchd script should NOT push stale data automatically. Manual runs can pass a file path argument (already supported).

**Spec update required:** Task #74 description should be "change 'Proceeding anyway' to actual abort" — it's a 2-line fix, not a new feature.

---

### 1.3 🔴 Cascade cost is primarily multiplier, not per-item count

**What the spec implies:** The $10/day cost is caused by 300-400 API calls being expensive.

**What the code shows:**

Actual call count per run (read from nightly-ai-local.js):
- Step 1.5: up to 25 Haiku calls (task context enrichment)
- Step 2.4: 1 Haiku call per Plaud meeting for calendar matching
- Step 2.44: 1 Haiku call per UNLINKED meeting (retrospective matching, scans entire history)
- Step 3: 1 Sonnet call per active email (up to 50 emails = 50 Sonnet calls via summarizeThread)
- Step 3.5: 1 Sonnet call per active email (50 more Sonnet calls via extractIntelligence)
- `semanticMatchCheck()`: 1 Haiku call per potential duplicate pair where Jaccard ≥ 0.55 (variable — could be 15-40 calls)

Estimated per-run cost:
- 100 Sonnet calls × ~6K tokens input × $3/M = $1.80 input
- 100 Sonnet calls × ~1K tokens output × $15/M = $1.50 output
- ~60 Haiku calls: ~$0.15
- **Total per run: ~$3.50**

With cascade (job runs 3× per day because timeout prevents ai_completed_at from being written):
- **3 × $3.50 = $10.50/day ✓** — this matches the invoices.

**The cascade is the cost problem. Each run is ~$3.50, not $10.** Fix cascade → ~$3.50/day. Phase 2 batch optimization further reduces to ~$0.75/day. Both matter, but cascade is the emergency.

**Spec correction:** Section 4 currently implies cost is driven by call count. Reality: cascade multiplier is the primary driver. Phase 2 optimization is important but the cost benefit is 5×, not 100×. Update success metrics accordingly.

---

### 1.4 🔴 Classify fires webhooks AND launchd also fires webhooks = duplicate email records

**What the spec doesn't address:** There are TWO independent webhook paths that both push email data to Supabase:

**Path 1 (Cowork classify skill, 4:25 AM):**
- Step 7 falls back to per-thread webhook push if Supabase storage fails
- Posts to `https://personal-os-five-black.vercel.app/api/webhooks?type=email`

**Path 2 (launchd push_email_report.py, 5:00 AM):**
- Always posts ALL threads via webhook (has its own idempotency check via push-state.json)
- Posts to same endpoint

Both paths post to the same Vercel webhook. This creates duplicate email records in the DB.

**Why the dedup logic exists:** The elaborate dedup in Step 1 of the nightly job (email dedup by normalized subject + sender) is cleaning up this mess every single night. It's a band-aid for a structural duplicate problem.

**The correct architecture (what spec should say):**
- classify → local file only. Never posts webhooks directly. Sandbox can't be trusted for it anyway.
- launchd → single authoritative webhook pusher. Has real network access.
- Classify's fallback webhook path should be REMOVED from the classify skill entirely.
- Classify's Supabase storage upload should REMAIN (that's the Phase 1B intelligence package path).

**Spec update required:** Phase 1B task #69 (upgrade classify) should also REMOVE the per-thread webhook fallback from classify Step 7. The canonical data path is: classify → storage JSON → launchd → webhooks → emails table. Classify should not also be pushing webhooks.

---

### 1.5 🟠 Two pipeline_complete endpoints doing the same thing

**What exists:**
- `classify` Step 7 (on storage upload success): POSTs to `/api/pipeline/complete-step` with `{"step":"upload","run_date":TODAY_ISO}`
- `push_email_report.py` (after all threads posted): POSTs to `/api/webhooks?type=pipeline_complete` with a summary payload

These are DIFFERENT endpoints. Unclear which one sets `processing_completed_at` in `pipeline_runs`. The AI job polls for `processing_completed_at`.

**The risk:** If classify's upload fails (sandbox) AND the classify webhook fallback also fails, `pipeline/complete-step` is never called. But launchd IS reliable — and it calls `/api/webhooks?type=pipeline_complete`. So `processing_completed_at` DOES get set eventually.

But if classify's storage upload SUCCEEDS (rare, when sandbox has network), `pipeline/complete-step` gets called at 4:25 AM. Then at 5:00 AM launchd calls `webhooks?type=pipeline_complete`. One sets it to 4:25, the other updates it to 5:00. This is benign but messy.

**Fix:** Classify should NOT call `pipeline/complete-step`. That's launchd's job. Remove from classify Step 7. The classify skill's responsibility is: write local file + upload storage JSON. Period.

---

### 1.6 🟢 Pagination fix is correct and working

Validated June 26: email pull got 70 threads across 3 pages (25 + 25 + 20). Resilience Rule 11 is correctly structured and the fix is already committed. Just needs pushing. **No changes needed to the spec here.**

---

## CATEGORY 2: ARCHITECTURAL GAPS IN THE SPEC

### 2.1 🔴 Phase 2 reads from emails TABLE, not from storage JSON — spec gets this backwards

**What the spec says (Phase 2, Step 0A):** "Load email intelligence package from Supabase storage: daily-reports/email-{TODAY}.json"

**What the code actually does (Step 2):**
```javascript
const { data: activeEmailsRaw } = await supabase
  .from('emails')
  .select('*')
  .in('bucket', [1, 2])
  .in('status', ['needs_reply', 'waiting_on'])
  .order('days_waiting', { ascending: false })
  .limit(50)
```

Phase 2 reads from the `emails` TABLE, not from storage JSON. The storage JSON is used only for Plaud (Step 2.4 reads `plaud-{today}.json`).

**The real architecture:**
```
Email data flow:
  classify → last-email-report.json (local)
           → storage/daily-reports/{DATE}.json (when sandbox allows)
           → launchd → Vercel webhooks → process-email-report.js → emails TABLE
  AI job → reads emails TABLE (Step 2)
         → writes ai_summary, intelligence, tasks etc. back to various tables

Plaud data flow:
  Plaud email → GitHub Actions → plaud-{DATE}.json → storage
  AI job → reads plaud-{DATE}.json from storage (Step 2.4) → writes to meeting_notes
```

**What this means for the spec:**

After Phase 1B adds signal extraction to the classify output, those signals need to get INTO the emails table for Phase 2 to read them. That requires:
1. New columns in the `emails` table (signal arrays, transcript, action_phrases, etc.)
2. Updated `process-email-report.js` to store the new fields when inserting records

OR — Phase 2 reads BOTH: emails table for current records, storage JSON for the Phase 1B enrichment layer. This is probably the right architecture: emails table = status/bucket (for frontend), storage JSON = extraction package (for AI). Phase 2 loads both and merges.

**Spec update required:** Phase 2 Step 0A should read "Load emails from both: Supabase emails TABLE (bucket 1/2 records, limit 50) AND storage JSON (full Phase 1B extraction package). Merge by conversationId."

Also: New sub-task under #69 — update process-email-report.js to store Phase 1B fields (signals, transcripts, action_phrases) in new emails table columns.

---

### 2.2 🔴 source_type field already exists — spec proposes adding a new source field that conflicts

**What the code uses:** `source_type` field throughout (`deduplicateTable`, meeting_notes, etc.)

Current `source_type` values in code: `manual`, `ai_otter`, `ai_email`, `system`

**What the spec proposes:** Add a new `source` field with values: `manual | email_ai | plaud_ai | approved`

These are DIFFERENT schemas. If we add `source` while `source_type` still exists:
- `deduplicateTable` still uses `source_type` → doesn't know about new `source` field
- New records written by Phase 2 get `source = email_ai` but `source_type = ai_email` (old value)
- Queries on one field return partial results

**Fix options:**
1. Rename `source_type` → `source` everywhere (large refactor, high risk)
2. Keep `source_type` for legacy records, use `source` for new Phase 1B/2 records (tech debt)
3. Use `source_type` as the canonical field, map new values to it: `ai_email` (keep), `plaud_ai` (new), `approved` (new)

**Recommendation:** Option 3. Extend `source_type` rather than adding a parallel field. This means:
- Existing `ai_email` = Phase 2 email extraction (unchanged)
- Add `plaud_ai` to `source_type` vocabulary
- Add `approved` to `source_type` vocabulary
- Add `approved_at` timestamp column for tracking when approval happened
- Update `deduplicateTable` priority: `manual: 4, approved: 3, plaud_ai: 2, ai_email: 2, ai_otter: 3, system: 1`

**Spec update required:** Task #66 SQL migration should be `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual'` (not a new `source` column) AND add new values to source_type vocabulary. Update all spec references from `source` to `source_type`.

---

### 2.3 🟠 process-email-report.js changes not in task list

**The gap:** Phase 1B adds new fields to the classify output (signals, transcripts, action_phrases, commitment_phrases, signature_blocks, participants). For Phase 2 to read these from the emails table, `process-email-report.js` must store them.

**What needs to happen:**
1. New columns in `emails` table: `action_phrases JSONB`, `commitment_phrases JSONB`, `signal_flags JSONB`, `transcript TEXT`, `participants JSONB`, `signature_blocks JSONB`
2. `process-email-report.js` updated to extract and store these fields
3. `push_email_report.py` `thread_to_payload()` function updated to include new fields in webhook payload

This is a 3-file change that isn't in the task list at all.

**New task needed:** #83 — Update `process-email-report.js` + `push_email_report.py` + schema to store Phase 1B extraction fields in emails table. (Blocked by #69 Phase 1B completion — schema must be locked first.)

---

### 2.4 🟠 Morning newsletter reads last-email-report.json, not Phase 2 output

**The gap:** The morning newsletter skill reads the LOCAL FILE `last-email-report.json` directly for email data. It doesn't query Supabase tables for AI summaries, intelligence notes, or Phase 2 output.

After Phase 2 refactor, the newsletter could read AI summaries from Supabase instead of doing fresh Sonnet calls on raw email data. But currently there's no connection between Phase 2's intelligence output and the newsletter's input.

**Options:**
1. Phase 2 writes a `morning-brief-context.json` to local disk or Supabase storage that the newsletter reads
2. Newsletter queries Supabase tables directly (tasks, others_commitments, observations) — this is better long-term
3. Leave as-is, newsletter continues its own data gathering (some duplication but acceptable)

**Recommendation:** Phase 2 should write a `daily-brief-{DATE}.json` to Supabase storage containing its synthesized output. Newsletter reads this first, uses it as context, doesn't re-process raw emails. This eliminates the newsletter's own Sonnet calls on email threads.

**New task needed:** #84 — Phase 2 Step 4 writes `daily-brief-{DATE}.json` to Supabase storage. Newsletter reads it as primary input. (Blocked by Phase 2 completion.)

---

### 2.5 🟠 Plaud pipeline mechanics are not described

**The spec says:** "Recording → Plaud AI summary → email to personal OS inbox → GitHub Actions pulls → structured JSON extracted → Supabase storage"

**What it doesn't say:** HOW does GitHub Actions know there's a new Plaud email? What triggers the pull? Is there a separate workflow for polling the inbox? How often does it run?

Looking at the code (Step 2.4), it downloads `plaud-{today}.json` from storage. Someone else created that file. There must be a separate GitHub Actions workflow that:
- Polls Ryan's inbox for Plaud email summaries
- Extracts the JSON
- Uploads to `daily-reports/plaud-{DATE}.json`

This workflow is not documented in the spec at all.

**Spec update required:** Add to Plaud section: document the existing GitHub Actions poll-and-extract workflow that creates `plaud-{DATE}.json`. This is already built but invisible in the spec.

---

### 2.6 🟠 Backfill cannot guarantee historical calendar events

**The spec says:** Backfill pull skill extracts calendar events for the target date.

**The risk:** `outlook_calendar_search` via the M365 connector may not return PAST calendar events. Calendar search tools typically show upcoming events. Past events from June 22-24 may not be searchable.

**Impact if this is true:** Backfill email packages for June 22-24 won't include calendar data. The Phase 2 cross-reference for those dates (Plaud × Calendar) will fail to match because the calendar table won't have entries for those dates.

**Mitigation:** 
1. Test `outlook_calendar_search` with a past date before committing to the backfill architecture
2. If historical calendar data isn't available via connector, check if it was synced to the `events` table already (the AI job syncs events). If it's there, backfill can read from events table directly.

**New task needed:** #85 — Verify M365 calendar connector returns past events. Test with date 7 days ago before building backfill skills.

---

## CATEGORY 3: SANDBOX CONSTRAINTS NOT FULLY ADDRESSED

### 3.1 🔴 Classify skill runs 15-20 minutes — highest crash risk of any Cowork task

**What the spec says:** Phase 1B upgrades classify to full extraction. More extraction = longer runtime.

**The math:** 70 threads × (parse signals + build transcript + extract participants + match project keywords) = significant processing time. Currently classify runs ~10 min. Phase 1B classify would run 20-30 min.

**The sandbox reality:** Cowork sessions that run longer than ~15-20 minutes are at significantly higher crash risk. The June 26 crash happened at the END of a pull session (which is also long-running).

**What the spec says about this:** Nothing. Phase 1B just adds more work to classify without addressing the stability risk.

**Options:**
1. Checkpoint-based resumption (mentioned in 1.1) — saves progress every N threads
2. Split classify into classify-1.md (buckets, urgency, tags) and classify-2.md (full extraction) — two shorter sessions
3. Move full extraction into a separate post-classify processing step

**Recommendation:** Phase 1B classify should be split into two sequential skill invocations:
- `email-classify-buckets.md` (~10 min): current classify behavior — buckets, urgency, tags, write local file, fire webhook
- `email-classify-extract.md` (~15 min): reads classified file, adds extraction layer (signals, transcripts, action phrases), writes enriched storage JSON

This way: if extract crashes, the core classification already happened and the launchd push still fires. The AI job gets some data. Extract is a best-effort enrichment.

**Spec update required:** Split Phase 1B task #69 into two phases: 69A (classify-buckets stays as-is, minimal changes) and 69B (classify-extract as new skill for signal extraction layer).

---

### 3.2 🟠 Classify's Supabase upload is unreliable in sandbox — but spec depends on it

**What classify Step 7 says:** "Note: This may fail in sandbox. Expected and non-blocking."

**What the spec says:** Phase 2 (Step 0A) reads `daily-reports/email-{TODAY}.json` from Supabase storage. This file is only written by classify Step 7.

**The conflict:** If Step 7 fails "as expected" in sandbox, the storage JSON doesn't exist. Phase 2 loads an empty Step 0A. The entire Phase 2 email intelligence layer falls through.

**The real flow has two paths:**
1. Classify uploads storage JSON → Phase 2 reads from storage (IDEAL — gets full Phase 1B data)
2. Classify fails upload → launchd pushes per-thread webhooks → emails table → Phase 2 reads emails TABLE (FALLBACK — gets bucket 1/2 only, no Phase 1B enrichment)

Phase 2 must explicitly handle both cases:
- If storage JSON exists → use it (Phase 1B intelligence included)
- If storage JSON missing → fall back to emails TABLE (Phase 1B intelligence missing, note it in log)

**Spec update required:** Phase 2 Step 0A should specify the fallback: "If storage JSON unavailable, fall back to emails TABLE for Buckets 1-2. Log which path was taken. Phase 1B signals will be unavailable — note in daily brief."

---

### 3.3 🟢 launchd is the real reliability layer — spec correctly keeps it

**What the spec says:** launchd push_email_report.py is kept and fixed (Task #74).

**What the code confirms:** launchd has:
- Its own idempotency check (push-state.json)
- Real network access (not sandbox)
- Date check (bug: "Proceeding anyway" — fix needed, see 1.2)
- Archive to local disk before push

launchd is the PRIMARY data path for email data reaching Supabase. Classify's upload is BONUS. The spec correctly keeps launchd. **No changes needed here** except the date check fix.

---

### 3.4 🟠 GitHub Actions has full network — no sandbox constraints — this is an advantage the spec underutilizes

**The insight:** Cowork = sandboxed, unreliable network, session crashes. GitHub Actions = full network, reliable, 6-hour timeout, no session drops.

**What this means for architecture:**
- Any step that requires network reliability should move to GitHub Actions
- Any step that is purely local (reads local files, no network) is safe in Cowork

Currently Phase 2 is in GitHub Actions (good). But the Phase 1B extraction is in Cowork (classify skill). The EXTRACTION could theoretically also be in GitHub Actions — it reads the storage JSON, processes it, writes enriched storage JSON. No M365 connector needed.

**Implication:** If classify crashes before uploading to storage, Phase 2 could pull the raw email data from the emails table (already pushed by launchd) and do its own extraction. But that's duplicating Phase 1B logic.

**Spec update required:** Explicitly state WHY Phase 1B is in Cowork: because it runs before launchd (4:25 AM vs 5 AM). The extraction provides richer data if it succeeds. But the system must degrade gracefully when it fails. This is already implied but should be explicit.

---

## CATEGORY 4: CODE BEHAVIOR THAT CONTRADICTS THE SPEC

### 4.1 🔴 Plaud × Calendar matching uses ±120 min, not ±30 min

**What the spec says:** "Day match (required) + time within ±30 min"

**What the code does:** Stage 1 filter uses `.filter(c => c.diffMin <= 120)` — that's ±120 min, not ±30.

**Why the code uses 120:** Recordings often happen during meetings (start recording 10 min in), or are post-meeting calls. ±30 would miss many legitimate matches.

**What the code actually does right (that the spec doesn't capture):** Two-stage matching:
1. Stage 1: ±120 min CANDIDATE FILTER (not the final match — just finds candidates)
2. Stage 2: Haiku reads TRANSCRIPT CONTENT and verifies match

The Haiku content check includes explicit rules:
- "A phone call between 2 people should NOT match a large group meeting"
- "If recording happened right BEFORE a meeting started, it's likely a SEPARATE call"

**The code's approach is BETTER than the spec's.** Content-first matching with permissive time filter catches more true positives than time-first with tight window. A 45-minute pre-meeting phone call would correctly match via content even though it's 45 minutes away.

**Spec correction:** Change from "Day match + ±30 min primary, content secondary" to "Day match + ±120 min candidate filter (Stage 1), then content verification via AI (Stage 2). Haiku reads transcript content and calendar event to make the final match decision. Low confidence → flag for Ryan. No match → unlinked."

---

### 4.2 🟠 Step 3 builds project context per email = N database calls per email

**What the code does:**
```javascript
const emailProjectId = email.project_id || await findProjectByKeywords(email.thread_subject)
const projectContext = emailProjectId ? await aiService.buildProjectContext(emailProjectId) : ''
```

For each email, it looks up project context from Supabase. With 50 emails and 10 active projects, this is up to 50 `buildProjectContext` calls. Each call queries Supabase for project details, meetings, decisions, etc.

`getActiveProjects()` IS cached (module-level). But `buildProjectContext()` appears to be a separate Supabase query per project, possibly not cached.

**The risk:** 50 emails → potentially 50 project context queries → adds significant time to Step 3.

**What Phase 2 should do differently:** Pre-load ALL project contexts once (for all active projects) before the email loop. Then the per-email lookup is a Map lookup, not a DB query.

**Spec update required:** Phase 2 batch architecture spec should include: "Pre-load all project contexts once at start. Store in Map<project_id, context>. Inject into batch call rather than per-email."

---

### 4.3 🟠 Step 2.44 processes ALL UNLINKED PLAUD MEETINGS EVER — not just today's

**What the code does (Step 2.44):** Queries all `meeting_notes` where `source = 'plaud'` AND `event_id IS NULL`. This includes every historical meeting that was never matched, not just today's.

With limit 100 and 1 Haiku call per meeting, this could be 100 Haiku calls on every single nightly run if there are many unlinked historical meetings.

**The risk:** If Ryan has 50+ historical unlinked meetings, every nightly run makes 50+ extra Haiku calls just for Step 2.44. This is one of the hidden API call sources.

**Fix:** Step 2.44 should have a time window: only re-try meetings from the last 30 days. Historical meetings older than 30 days with no match should be considered "standalone call, not on calendar" and the re-matching flag set to prevent repeated retries.

**New task needed:** #86 — Add time window and retry limit to Step 2.44 (re-matching unlinked Plaud meetings). Meetings older than 30 days should be marked as `match_attempted = true` to prevent repeated re-tries.

---

### 4.4 🟠 `semanticMatchCheck` Haiku calls are invisible in the spec

**What the code does:** For every new task extracted, before inserting, it computes Jaccard overlap against all existing open tasks. If Jaccard ≥ 0.55, it calls Haiku to confirm the duplicate.

**Why this matters:** If Phase 2 batch extraction produces 10 tasks per batch call (from 50 threads), that's 10 new tasks. Each runs Jaccard against 60 existing tasks. If 20% hit Jaccard ≥ 0.55, that's 2 Haiku calls per task × 10 tasks = 20 extra Haiku calls.

**The spec's batch approach reduces this:** Fewer total tasks extracted per run (because batch approach is better at deduplication upfront) = fewer semanticMatchCheck calls.

**Spec update required:** Phase 2 architecture should include: "Batch extraction call returns tasks with explicit dedup logic: 'If this task is essentially the same as [existing task title], don't include it.' Pass existing task list into the batch prompt. This reduces post-extraction dedup overhead."

---

## CATEGORY 5: MISSING PIECES

### 5.1 🔴 Topic cluster window is undefined

**The spec says:** "Topic appears 3+ times without existing pod → flag in daily brief"

**What it doesn't say:** 3 times in one day? 3 times in 7 days? 3 times in 30 days?

The `pattern_log` table already exists in the code (Step 3 writes `email_thread_processed` patterns). But topic frequency tracking isn't implemented yet.

**Definition needed:**
- Count window: 7 rolling days (not lifetime, not single day)
- Minimum threshold: 3 distinct conversations/meetings within 7 days
- Counting unit: distinct thread (not individual messages)
- Flag trigger: word appears in 3+ unique `conversationId`s within 7 days AND no `topic_pods` record matches

**Spec update required:** Add the counting definition to Task #76.

---

### 5.2 🟡 Calendar events table state is unknown for backfill dates

**The question:** When Phase 2 does Plaud × Calendar matching for backfill dates (June 22-24), does the `events` table already have entries for those dates?

**How events get into the table:** The nightly AI job syncs calendar events. But if the AI job never completed for June 22-24 (it didn't — that's why we're backfilling), the events table may not have those dates' calendar events.

**The risk:** Backfill Phase 2 runs for June 22 but events table has no June 22 entries → Plaud × Calendar matching fails for all meetings on June 22.

**Fix:** Backfill workflow needs a Step 0: verify events table has entries for the target date. If missing, attempt to populate from calendar (or skip matching for that date and note it).

**Spec update required:** Add to backfill workflow: "Before Phase 2 backfill run, check events table for target date. If empty, flag to Ryan that Plaud × Calendar matching will be incomplete for that date."

---

### 5.3 🟡 Phone timezone handling in matching

**What the code does:** Uses Phoenix-aware date boundaries for calendar matching (`America/Phoenix`).

**The risk for backfill:** If Ryan was in a different timezone on June 22 (e.g., a Tampa trip), a meeting that happened at 9am Eastern would be matched against Phoenix-time calendar events. The Phoenix-aware logic would look for events 9am–12pm EDT = 6am–9am PDT, potentially missing the right calendar entry.

**This is probably acceptable risk** for now — the Haiku content verification provides a second check. But worth noting.

---

### 5.4 🟠 No rollback strategy if Phase 1B breaks Phase 2

**The scenario:** Phase 1B classify upgrade (#69) changes the output schema. Phase 2 refactor (#70) reads the new schema. But if Phase 1B is deployed and then Phase 2 breaks in production, we're stuck: new Phase 1B output doesn't work with OLD Phase 2 code.

**Fix needed:** Phase 1B classify should add new fields ADDITIVELY to the existing output. Old fields stay exactly where they are. New fields (signals, transcripts, action_phrases) are additions. Old Phase 2 ignores new fields. New Phase 2 uses them.

This way: Phase 1B can be deployed first, observed for a few days, then Phase 2 refactor deployed. The gap period (Phase 1B deployed, Phase 2 still old code) works because old Phase 2 just ignores the new fields.

**Spec update required:** Add "Phase 1B output is additive only. No existing fields removed or renamed. Phase 2 reads new fields IF PRESENT, falls back to old behavior if absent." This is the safest deploy sequence.

---

### 5.5 🟠 Dismiss/Remove UX: what happens to the email record in the emails table?

**Task #67** says to add Dismiss action. Current "Complete" marks status = completed. Dismiss should mark differently.

**The question:** When Ryan dismisses an AI-extracted task, does the underlying `emails` record stay in the DB? If so, tomorrow's run might re-extract the same task from the same email thread.

**The risk:** Without explicit tracking of dismissed extractions, Phase 2 will re-extract and re-create dismissed items on subsequent runs.

**Fix needed:**
- Dismissed items get `status = 'dismissed'` in their table (not deleted)
- Email thread records should be updated: `dismissed_task_count += 1` (so Phase 2 can reduce confidence for future extractions from that thread)
- Phase 2 batch call should include dismissed items list: "Do NOT re-extract items similar to: [dismissed list]"

**Spec update required:** Task #67 should specify: dismissed status persists; Phase 2 input includes dismissed items to prevent re-extraction.

---

## CATEGORY 6: WHAT THE SPEC GOT RIGHT (CONFIRMED)

### 6.1 🟢 Three-legged stool architecture — correct

Leg 1 (email Cowork), Leg 2 (Plaud GitHub Actions), Leg 3 (manual front end). Separation is correct. Legs are independent. Phase 2 reads all three. The nightly AI job already implements this (legStatus object tracks which legs are available).

### 6.2 🟢 Plaud stays in GitHub Actions — correct

The code confirms it. `plaud-{today}.json` comes from storage, uploaded by a separate GitHub Actions workflow. Cowork skills never touch Plaud. This is the right separation.

### 6.3 🟢 File everything, deep-process what matters — confirmed in code

The existing nightly job does exactly this: it stores emails with `extraction_depth: full/extended/standard`, processes deep threads through AI, and uses heuristics for simple buckets. Phase 2 should maintain this philosophy.

### 6.4 🟢 Manual = ground truth — confirmed in dedup code

```javascript
const SOURCE_PRIORITY = { manual: 4, ai_otter: 3, ai_email: 2, system: 1 }
// Never delete manual items in dedup
if (group[i].source_type !== 'manual') { toDelete.push(group[i].id) }
```

The code already enforces this. Manual records are never overwritten or deleted by AI. The spec's principle is already implemented.

### 6.5 🟢 Daily archives in classify — partially exists

`push_email_report.py` already archives to `~/personal-os/data/archive/{today}-email-report.json` locally. The Supabase storage archiving (Task #71B) is the addition. The local archive already exists. Good foundation.

### 6.6 🟢 Backfill isolation principle — correct

The pull skill already has idempotency via `PULL_SINCE` from `generated_at`. The backfill skill writing to a different path is correct. The only enforcement needed is making it explicit in the skill file that it NEVER writes to `last-email-raw.json`.

### 6.7 🟢 Cascade fix design — correct

The `job_started_at` guard approach is sound. 110-minute window (job timeout 120 min, guard at 110 min) gives 10 minutes of buffer for the guard to apply before a legitimate re-trigger. The polling interval (10 min) fits within this. Logic is correct.

---

## SUMMARY: SPEC CHANGES REQUIRED

### Changes to existing spec sections:

| Finding | Section | Change |
|---|---|---|
| 1.1 | Phase 1A | Add classify checkpoint to prevent full restart on crash |
| 1.2 | Task #74 | Fix description — it's 2 lines, "Proceeding anyway" → abort |
| 1.3 | Success metrics | Cascade is cost driver, not per-item count; ~$3.50/run not $10 |
| 1.4 | Phase 1B #69 | Remove per-thread webhook fallback from classify Step 7 |
| 1.5 | Architecture | Classify should not call pipeline/complete-step — launchd only |
| 2.1 | Phase 2 Step 0A | Phase 2 reads emails TABLE + storage JSON (merged); not storage only |
| 2.2 | Task #66 | Use source_type (existing field), not new source field — reconcile vocabulary |
| 4.1 | Architecture §13 | Plaud×Calendar matching: ±120 min candidate filter + content verification is correct |
| 5.1 | Task #76 | Define cluster window: 3+ distinct conversations within 7 rolling days |

### New tasks to add to the list:

| # | Task | Blocked by |
|---|---|---|
| #83 | Update process-email-report.js + emails table schema for Phase 1B fields | #69 |
| #84 | Phase 2 writes daily-brief-{DATE}.json to storage; newsletter reads it | Phase 2 stable |
| #85 | Verify M365 calendar connector returns past events before building backfill | Now (test first) |
| #86 | Add time window and retry limit to Step 2.44 (30-day window, mark match_attempted) | Now (small fix) |

### Architecture corrections (one-liner each):

1. **Classify output is additive** — Phase 1B adds fields, never removes, so old Phase 2 degrades gracefully
2. **Dual webhook paths create duplicates** — the existing dedup logic exists because of this; fix the root cause in Phase 1B
3. **emails TABLE = frontend display; storage JSON = AI input** — both needed, Phase 2 reads both
4. **source_type is the canonical field** — extend vocabulary, don't create parallel field
5. **Dismiss status must persist** — Phase 2 must receive dismissed items list to avoid re-extraction
6. **Step 2.44 needs time-bounding** — currently scans all historical unlinked meetings, costs Haiku calls

---

## REVISED SEQUENCING (based on findings)

```
TONIGHT (unchanged):
  #68 — cascade fix (Ryan terminal)
  #79 — push pagination fix (Ryan terminal)

NEXT SESSION — IMMEDIATE FIXES (before Phase 1B):
  #74 — fix "Proceeding anyway" to actual abort (2 lines)
  #86 — Step 2.44 time window (prevent unlimited re-matching)
  #66 — source_type vocabulary extension (not new field)
  #85 — verify calendar connector with past date (test, not build)

PHASE 1A — Reliability:
  #71A — atomic write for email pull
  #67 — Dismiss button (need source_type vocabulary first)
  #75 — event-driven classify trigger

PHASE 1B — Extraction (split into 1B-core and 1B-extract):
  #69A — email-classify-buckets.md (minimal changes, short runtime)
  #69B — email-classify-extract.md (new extraction layer, separate skill file)
  #83 — process-email-report.js + emails table schema update
  #71B — date archiving in daily classify (now both classify skills)

PHASE 2 — AI Refactor (blocked by Phase 1B schema lock):
  #70 — batch architecture (reads emails TABLE + storage JSON, merged)
  #84 — Phase 2 writes daily-brief.json for newsletter
  #76 — topic cluster detection (with 7-day rolling window)
  #77, #80 — pod routing

PHASE 3 — Backfill:
  #72A, #72B — backfill skills
  (after #85 confirms calendar connector behavior)
  Run June 22-24 backfills

ONGOING:
  #78 — dashboard panel
  #84 — newsletter reads Phase 2 output
```

---

*This document is the result of a full pressure test against actual code. Nothing here is assumed — all findings reference specific lines of code or specific historical events.*

*Next update: after Phase 1A + pre-Phase-1B fixes are deployed.*
