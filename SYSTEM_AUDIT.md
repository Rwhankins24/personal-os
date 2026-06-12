# Personal OS — Full System Audit
**Date:** June 11, 2026
**Auditor:** Claude (Cowork mode)
**Scope:** Code-only analysis — SQL queries could not execute (no sandbox network access to Supabase)

---

## EXECUTIVE SUMMARY

The personal-os has the right architecture and the intelligence pipeline is structurally sound — Plaud pull, email ingestion, AI extraction, and React frontend are all plumbed correctly. However, five data integrity bugs mean the system has been silently losing or never surfacing the most actionable intelligence since inception: Ryan's tasks from 65 historical meetings are invisible (wrong `status` field value), the MeetingDetail intelligence sections are always blank (router points to the wrong route file), others' commitment names are null everywhere (wrong column name), pending decisions are only written when a project match exists (skipping most meetings), and the pre-meeting brief's decisions section is always empty (wrong field name). The live Plaud → Gmail → GitHub Actions → Supabase pipeline appears to be working as designed after the recent fix (commit 9aedccb), but no live-pipeline meetings exist yet — everything in the DB is backfill. The system is approximately 5/10 toward the north star goal: the plumbing is right, the data extraction is running, but critical display and write bugs mean Ryan cannot see most of what was extracted.

---

## DB STATE SNAPSHOT

*SQL queries could not be run — no network access from audit sandbox. All estimates derived from code analysis, logs, and known audit context.*

| Table | Estimated State |
|---|---|
| `meeting_notes` | ~65–80 rows. All with `otter_id LIKE 'plaud_txt_%'` (backfill). Zero with `otter_id LIKE 'plaud_%'` (live pipeline). Most `start_time = null` or `'...T12:00:00Z'` placeholder. Most `intelligence_extracted = true` (backfill ran). |
| `tasks` | ~20–60 rows from email extraction. Zero rows visible in task list UI from meetings — all inserted with `status: 'active'`, UI queries `status: 'open'`. |
| `others_commitments` | Rows exist from nightly job (correct `committed_by_name`). Rows from backfill script have null `committed_by_name` (used nonexistent `person_name` column). MeetingDetail always shows null names regardless (P0-2). |
| `pending_decisions` | Near-empty or empty. Only written when project match exists (P0-4). Most meeting decisions never reached the table. |
| `emails` | Active — ~150–300 rows based on log throughput (23–44/day, weeks of data). |
| `events` | ~50–100 rows. 8 events failed to insert on 5/21 due to null title constraint. |
| `projects` | Small set (5–8 active), JSONB arrays accumulating intelligence. Pacific Fusion likely near or at `intelligence_notes` cap (50 items). |
| `pipeline_runs` | One row per day. Logs show 12 consecutive successful runs before timeout issues on 5/22–5/23. |
| `contacts` | Populated from email participants. Enriched contacts likely thin — `relationship_tier` column not auto-set by any automated process. |

---

## CRITICAL FINDINGS (P0 — Broken Now, Data Wrong or Lost)

### P0-1: `backfill-meeting-tasks.js` inserts `person_name` — column doesn't exist, all historical others-commitments lost

**What is actually happening** (`scripts/backfill-meeting-tasks.js:223`):
The backfill script uses `person_name` when inserting into `others_commitments`. The actual column is `committed_by_name`. Every insert either fails silently or stores a row with null `committed_by_name`.

**Proof:**
```javascript
// scripts/backfill-meeting-tasks.js:221-224
await supabase.from('others_commitments').insert({
  title:        title,
  person_name:  name,    // ← column doesn't exist
  person_email: item.assigned_to_email || ...
```

**Impact on Ryan**: Every other-person commitment from 65 historical meetings is either dropped or stored with no assignee. The "Who owes me what from past meetings?" question cannot be answered.

**Exact fix**: Change `person_name: name` → `committed_by_name: name` and `person_email` → `committed_by_email` on line 224.

---

### P0-2: `meeting-notes.js` selects `person_name` from DB — null everywhere, all names blank in MeetingDetail UI

**What is actually happening** (`api/src/routes/meeting-notes.js:137` and `frontend/src/pages/MeetingDetail.jsx:300`):
The single-meeting GET endpoint selects `person_name` (nonexistent column). The UI renders `{c.person_name}:` which is always null.

**Proof:**
```javascript
// meeting-notes.js:137
.select('id, title, person_name, committed_by_name, due_date, urgency, status, context')
// MeetingDetail.jsx:300
<span className="font-semibold text-purple-800">{c.person_name}: </span>
```

**Impact on Ryan**: "Others Committed" section in every MeetingDetail shows commitments with a blank colon before each task. Attribution is completely lost in the meeting intelligence view.

**Exact fix**: Remove `person_name` from the select in `meeting-notes.js:137`. Change `{c.person_name}` → `{c.committed_by_name}` in `MeetingDetail.jsx:300`.

---

### P0-3: All backfill tasks have `status: 'active'` — invisible everywhere, UI queries `status: 'open'`

**What is actually happening** (`scripts/backfill-meeting-tasks.js:150`):
The backfill inserts tasks with `status: 'active'`. The nightly job dedup, tasks route GET, Dashboard, and daily brief all filter on `status: 'open'`. Zero backfill tasks are visible anywhere.

**Proof:**
```javascript
// scripts/backfill-meeting-tasks.js:150
status: 'active',    // ← wrong; should be 'open'
// scripts/backfill-meeting-tasks.js:144
.eq('status', 'active')  // ← dedup check also wrong
```

**Impact on Ryan**: Every action item extracted from 65 historical meeting transcripts is invisible. Task list, daily brief, and all dedup logic are blind to this history.

**Exact fix**: Change both occurrences of `'active'` to `'open'` in `backfill-meeting-tasks.js` (lines 144 and 150). Then re-run the backfill.

---

### P0-4: `pending_decisions` from meeting transcripts only written when `projectId != null` — most meeting decisions permanently lost

**What is actually happening** (`api/src/jobs/nightly-ai-local.js:2898-2921`):
The block that writes `pending_decisions` is nested inside `if (projectId)`. If the meeting doesn't match a project, the entire decisions write is skipped.

**Proof:**
```javascript
// nightly-ai-local.js:2829-2898
if (projectId) {
  // ...update JSONB arrays...
  for (const p of (intel.pending_decisions || [])) {   // ← ONLY reached if project matched
    await supabase.from('pending_decisions').insert({...})
```

**Impact on Ryan**: Any meeting on a topic without a project card — owner call, external stakeholder, phone discussion — generates zero pending decisions regardless of what was decided.

**Exact fix**: Move the `pending_decisions` insert loop outside the `if (projectId)` block. Insert with `project_id: projectId || null`.

---

### P0-5: 5/21 pipeline day — 8 calendar events and 10 emails silently failed, never retried

**What is actually happening** (`logs/processing.log`):
The 2026-05-21 run shows `calendar: {pushed: 0, failed: 8}` — all calendar events rejected with "null value in column title violates not-null constraint." Ten emails failed with "invalid input syntax for type integer: 'B1'" (bucket field sent as string). Pipeline marked itself complete with no alert.

**Impact on Ryan**: That day's calendar events were never inserted. No pre-meeting briefs generated for those events. AI ran on an incomplete dataset with no indication anything was wrong.

**Exact fix**: In `process-email-report.js` — coerce `bucket` to `parseInt()`, skip events with null/empty title rather than hard-failing. Add `if (total_failed > 0)` alert to pipeline notification. Add `partial_failures` field to `pipeline_runs`.

---

## HIGH PRIORITY (P1 — Will Break Predictably)

### P1-1: `findProjectByKeywords()` fetches all active projects from DB on every call — no caching

**What is actually happening** (`nightly-ai-local.js:88-135`):
Every call issues a fresh `SELECT * FROM projects WHERE status='active'`. Called ~75–125 times per nightly run (every email, every task, every commitment).

**Trigger**: Grows linearly. At 50 emails/day and 10+ active projects, consistent Supabase free-tier rate pressure.

**Exact fix**: At start of `main()`, load `const activeProjects = await fetchActiveProjects()`. Pass as parameter or close over. Change `findProjectByKeywords` to use cached array. 1-hour effort.

---

### P1-2: Router loads `meeting_notes.js` (underscore) — richer `meeting-notes.js` (hyphen) is never reached, MeetingDetail always empty

**What is actually happening** (`api/src/router.js:11`):
Router imports `./routes/meeting_notes` (underscore — bare CRUD). The richer `meeting-notes.js` (hyphen) that populates `_tasks`, `_others_commitments`, `_decisions_made`, `_pending_decisions` is never loaded.

**Proof:**
```javascript
// router.js:11
const meetingNotes = require('./routes/meeting_notes')  // underscore — simple CRUD version
// MeetingDetail.jsx:51-53
const { data: meeting } = useQuery({ queryFn: () => getMeetingNote(id) })
// Uses meeting._tasks, meeting._others_commitments — fields that only exist in meeting-notes.js (hyphen)
```

**Trigger**: Every time Ryan opens any meeting detail. The intelligence sections have always been empty.

**Exact fix**: `router.js:11` — change `require('./routes/meeting_notes')` to `require('./routes/meeting-notes')`. 5-minute change. Deploy immediately.

---

### P1-3: `pre-meeting-brief.js` queries `d.question` field — column doesn't exist, pending decisions section always blank

**What is actually happening** (`api/src/routes/pre-meeting-brief.js:110,143`):
Route selects `question, context, urgency, status` from `pending_decisions`. Actual column is `title`. `isRelevant()` receives `undefined` every time, returns false — pending decisions section is always blank in every pre-meeting brief.

**Proof:**
```javascript
// pre-meeting-brief.js:110
.select('question, context, urgency, status')  // ← 'question' doesn't exist; should be 'title'
// pre-meeting-brief.js:143
isRelevant(`${d.question} ${d.context}`)        // ← d.question always undefined
```

**Exact fix**: Change `'question, context...'` → `'title, context...'`. Change `d.question` → `d.title` on line 143.

---

### P1-4: `backfill-meeting-tasks.js` writes `pending_decisions` only when `project_id != null` — same as P0-4, same gate in backfill

**What is actually happening** (`scripts/backfill-meeting-tasks.js:242-246`):
`if (!title || !meeting.project_id) continue` gates all decisions to project-matched meetings only.

**Exact fix**: Remove `!meeting.project_id` from the continue condition. Write with `project_id: meeting.project_id || null`.

---

### P1-5: Meeting list GET has no row limit — will timeout at 12-month scale

**What is actually happening** (`api/src/routes/meeting_notes.js:24` and `meeting-notes.js:215-222`):
Both routes issue unbounded SELECTs. No `.limit()`. At 300+ meetings (~12 months), the list page will begin hitting Vercel's 10s serverless timeout.

**Exact fix**: Add `.limit(200).range(offset, offset + 199)` with pagination. 1-session effort.

---

### P1-6: `DecisionsPage.jsx` sends `?status=all` but `pending-decisions.js` route ignores it — always returns open only

**What is actually happening** (`api/src/routes/pending-decisions.js:18-22`):
Route hardcodes `.eq('status', 'open')` regardless of `req.query.status`. The "History" tab in DecisionsPage never shows resolved decisions.

**Exact fix**: Read `req.query.status`. Only apply `.eq('status', ...)` filter when not 'all'.

---

## MEDIUM PRIORITY (P2 — Works But Fragile or Misaligned)

### P2-1: JSONB arrays capped at 50/30 items, oldest data silently dropped

`intelligence_notes` sliced to 50, `risk_signals` to 20, `key_facts` to 30 on every update. No archival. At 10 meetings/week for Pacific Fusion, the 50-item `intelligence_notes` cap is reached in ~5 weeks. A risk flagged in week 2 that materializes in week 8 is gone.

**Fix**: Add `archived_intelligence` flat table. Write overflow items there before dropping from JSONB. Or migrate to normalized `project_intelligence` table (see Architecture Verdicts).

---

### P2-2: `chat.js` queries `intelligence_notes` flat table — may not exist, chat silently returns no intelligence

`chat.js:118-125` queries `FROM intelligence_notes` as a flat table. Project intelligence is stored in `projects.intelligence_notes` JSONB column, not a flat table. If the flat table was never created, the chat's intelligence context is always empty — producing generic or hallucinated answers about project state.

**Fix**: Verify if `intelligence_notes` flat table exists. If not, replace the chat query with a project JSONB unwind, or create the flat table and backfill from project JSONB arrays.

---

### P2-3: `contact.relationship_tier` not auto-set — "KEY CONTACTS" section in AI context is always empty

`ai.js:54` builds `KEY CONTACTS` context from contacts with `relationship_tier` set. No automated process sets this field. Ryan must manually set tiers via the UI. Until he does, every AI extraction (meeting, email, brief) has no key contact context.

**Fix**: Add heuristic: auto-set `relationship_tier: 'tier2'` for contacts with 3+ email interactions in the last 30 days.

---

### P2-4: `MeetingsPage.jsx` renders raw summary text — new `##`-format summaries show literal `##` characters in the list view

The list view renders `short_summary` as plain text. New meetings with `## Context / ## Key Decisions` summaries display `## Context` with literal `##` in the meeting list.

**Fix**: Strip `##` prefixes or apply the same structured detector from MeetingDetail to the list preview. Or truncate to first sentence.

---

### P2-5: `backfill-meeting-intelligence.js` permanently marks no-transcript meetings as `intelligence_extracted: true` — cannot be retried

When transcript < 100 chars, marks `intelligence_extracted: true`. If the Plaud email processed without a transcript attachment, the meeting is permanently frozen — never re-processed even if transcript arrives later.

**Fix**: Use `skip_reason: 'no_transcript'` field instead. Query on `(intelligence_extracted IS NULL OR skip_reason IS NOT NULL)` for retry passes.

---

### P2-6: `nightly-ai.yml` timeout at 60 minutes — a slow meeting batch could exceed it with no partial save

The nightly AI job is a single sequential Node.js process. If it crashes or times out at step 7 of 15, no output from steps 8–15 is written. There's no checkpoint/resume logic.

**Fix**: Add a progress checkpoint to `pipeline_runs` after each major step group. On restart, skip already-completed steps.

---

## SCENARIO RESULTS

### SCENARIO A: Ryan records a Pacific Fusion meeting today

1. Plaud sends `[Plaud-AutoFlow]` email to ryanhankins.personalos@gmail.com with summary.txt + transcript.txt.
2. `plaud-pull.yml` runs at 9:00 UTC (2:00 AM Phoenix). Finds the email, downloads attachments, uploads `plaud-2026-06-11.json` to Supabase storage, POSTs to `/api/meeting-notes`.
3. The POST creates a meeting record with `otter_id: 'plaud_<gmail_id>'`, `start_time: '2026-06-11T12:00:00Z'` (placeholder noon — no real time yet).
4. Nightly AI job fires (after email processing completes). Step 2.4 loads the storage file, attempts calendar cross-reference. If "Pacific Fusion OAC" ≥ 2 keyword overlap with calendar event, start_time and participants update. If not — start_time stays noon, participants stay `[]`, all speakers become "Speaker N".
5. Step 2.6 extracts transcript intelligence. Ryan's tasks → inserted as `status: 'open'` (visible in task list ✓). Others' commitments → inserted with `committed_by_name` (correct ✓). Pending decisions → written **only if Pacific Fusion project matched** (if no keyword match, decisions lost).
6. Ryan opens the task list the next morning — his GMP task appears ✓.
7. Ryan opens MeetingDetail — intelligence sections are **blank** because `router.js:11` loads the wrong route file (P1-2). He sees the AI summary but not tasks, not commitments, not risks in the meeting view ✗.
8. Ryan opens the Pacific Fusion project card — steel lead time risk **does appear** in `risk_signals` JSONB (if project was matched) ✓.

**SCENARIO A verdict: ~50% of expected intelligence reaches Ryan's eyes.** Summary present. Tasks created in DB. Risk signal written to project card. But MeetingDetail intelligence sections are always empty (P1-2). If meeting doesn't match calendar, all names are "Speaker N." If no project match, pending decisions are lost.

---

### SCENARIO B: Ryan opens app at 7:45 AM before a 9 AM "Project Sun — Pursuit Strategy" meeting

1. Nightly AI job ran ~3:00–4:00 AM Phoenix. Pre-meeting briefs were generated for today's calendar events in Step 7.
2. Ryan opens EventDetail for the 9 AM event.
3. Pre-meeting brief exists and was AI-generated. It pulls: open commitments from attendees (using `committed_by_name` match), recent emails with attendees, open tasks tagged to Project Sun keywords, prior meeting summaries from last 6 months.
4. The brief's **pending decisions section is always blank** due to `d.question` vs `d.title` mismatch (P1-3). Ryan sees "No open decisions" even if there are pending decisions in the DB.
5. If attendees are `TinneyC@claycorp.com` format in the calendar event, contact resolution depends on `contacts.email` exact match. If Chris Tinney is stored as `christinney@claycorp.com` vs `TinneyC@claycorp.com`, the commitment lookup returns zero results.
6. If 2 prior Project Sun meetings exist in `meeting_notes`, their summaries appear in the brief via `participants` array matching — only if those meetings had a successful calendar cross-reference (if `participants = []`, they're not surfaced).
7. What Ryan committed to last time these people met is surfaced **if** it was extracted as a `commitments` row (i.e., if `ryan_commitments` was in the AI prompt — needs verification).

**SCENARIO B verdict: 70% useful.** Brief exists and has real content — open commitments, recent emails, project tasks. The pending decisions section is always blank (P1-3). Prior meeting context depends entirely on whether those meetings had calendar matches. Attendee resolution is brittle on email format mismatches. On-demand "Regenerate Brief" button produces the most thorough version — Ryan should use this before important meetings.

---

### SCENARIO C: Two weeks pass with no daily pipeline run

1. No Plaud pull → 14 days of meeting recordings accumulate in Gmail. Gmail `newer_than:15d` lookback means all 14 days of recordings are retrieved on the next successful run ✓ — recoverable.
2. No email processing → `emails` table not updated. Active threads stale. No urgency updates. No task extraction from email.
3. No AI job → no new tasks, no daily brief, no pre-meeting briefs generated, no contact enrichment.
4. Calendar events are not inserted during the gap. **Calendar events for the gap period are permanently unrecoverable** — the email report script only pulls current + near-future calendar, not historical. No pre-meeting briefs can ever be retroactively generated for those meetings.
5. On resume: Plaud recordings recovered via Gmail lookback. Emails recovered if process-email-report is re-run for the gap dates. But the AI job only processes emails from the current `emails` table snapshot — gap emails need explicit backfill.
6. Dashboard shows stale data with no staleness indicator. Ryan has no way to know the system has been dark.
7. If the gap was caused by `nightly-ai.yml` failure: GitHub Actions sends a failure email to `ryanhankins.personalos@gmail.com` (personal Gmail, not his primary inbox). Ryan likely never sees it.

**SCENARIO C verdict: Plaud recordings recoverable (~100%). Emails partially recoverable (~80%). Calendar events for gap period permanently lost (~100% unrecoverable). Pre-meeting briefs for the gap permanently unrecoverable. No staleness warning in the UI. Failure alerts go to an inbox Ryan doesn't monitor. Estimated 40% of intelligence from a 14-day gap is permanently lost.**

---

## GOAL ALIGNMENT GAPS

| Intended Capability | Current Reality | What It Takes to Close |
|---|---|---|
| MeetingDetail shows all extracted intelligence | Router points to wrong route file — intelligence sections always empty | Fix `router.js:11` (1 line, 5 min) |
| Historical meetings (65) contribute to task list | Backfill tasks have `status: 'active'` — invisible to UI | Fix status in backfill script, re-run (P0-3) |
| Others' commitment names visible in meeting view | `person_name` vs `committed_by_name` mismatch — names always null | Fix column name in route + UI (P0-2) |
| Pending decisions captured from all meetings | Only written when project match found — most lost | Remove project gate from write loop (P0-4) |
| Pre-meeting brief shows open decisions | `d.question` field doesn't exist — section always blank | Fix field name to `d.title` (P1-3) |
| Chat answers questions using project intelligence | `intelligence_notes` flat table may not exist — chat has no intelligence context | Verify/create table, align with JSONB source |
| System alerts Ryan when pipeline fails | Alerts go to personal Gmail, not primary inbox | Route alerts to hankinsr@claycorp.com |
| Dashboard shows data freshness | No staleness indicator — Ryan can't tell if data is 1 day or 14 days old | Add `last_updated_at` widget to Dashboard |
| Long-term project memory retained | JSONB arrays capped, oldest silently dropped | Migrate to normalized `project_intelligence` table |

---

## DEAD FEATURES

- **MeetingDetail intelligence sections** (`_tasks`, `_others_commitments`, `_decisions_made`, `_pending_decisions`): populated by `meeting-notes.js` (hyphen) but router loads `meeting_notes.js` (underscore). Always empty. **Dead.**
- **Pending decisions in pre-meeting brief**: `d.question` column doesn't exist. Section always empty. **Dead.**
- **DecisionsPage history view**: `?status=all` param ignored by route. Always shows only open. **Dead.**
- **Others commitments person names in MeetingDetail**: `c.person_name` always null. **Dead.**
- **Meeting tasks from backfill (65 meetings)**: `status: 'active'` — invisible to all queries. **Dead.**
- **Knowledge base chat context**: `intelligence_notes` flat table likely doesn't exist as separate from JSONB arrays. Chat returns no intelligence context. **Likely dead — needs DB verification.**
- **`ryan_commitments` (what Ryan owes others)**: `CommitmentsPage.jsx` likely renders real data, but whether Ryan's verbal commitments from meetings are extracted and stored needs verification. The `ryan_verbal_commitments` array in the AI output schema exists — but the write path is unclear.

---

## COST & SCALE ANALYSIS

**Current daily usage (estimated from code):**
- Email processing: ~25 emails × 3 Sonnet calls (summarize, extract intel, extract tasks) = ~225k input / 75k output tokens/day
- Meeting transcripts: 1–2 meetings × ~16k output tokens = ~32k output/day (Sonnet)
- Haiku calls: dedup (~30 pairs), calendar matching (~5), context enrichment (~25) ≈ ~10k tokens/day
- Daily brief + context: ~3.5k output tokens/day (Sonnet)

**Monthly estimate at current scale:** ~$20–25/month

**At 12-month scale (3 meetings/day, 40 emails/day):**
- Meetings: 3 × 32k = ~96k output/day
- Emails: 40 × 3 = ~360k output/day
- Monthly Sonnet: ~15M input / ~8M output → ~$60–75/month
- Haiku: ~$0.80/month
- **Total at scale: ~$65–80/month** — entirely reasonable for a personal intelligence system.

**Storage trajectory:**
- Current: ~65 transcripts × avg ~50KB = ~3.25MB transcripts. Emails, summaries, JSONB: probably ~20–30MB total. Supabase free tier is 500MB.
- At 12 months (3 recordings/day): ~1,100 transcripts × 50KB = ~55MB transcripts. Add emails (~10KB × 30/day × 365 = ~110MB). Total ~200MB — still within free tier.
- At 24 months: approaching 400MB — time to evaluate Supabase Pro ($25/month) or archival strategy.
- **Biggest risk**: `full_transcript` + `raw_transcript` columns may be storing duplicates. If both are populated, halve the above estimates.

**The JSONB cap is a design debt accelerating at project scale:** Pacific Fusion alone (currently ~50+ meetings) is almost certainly at the 50-item `intelligence_notes` cap right now. Every new meeting is dropping the oldest intelligence with no record of what was lost.

---

## ARCHITECTURE VERDICTS

**A. JSONB project intelligence arrays** — **Revise**
Current state: lossy by design, no history beyond cap, no cross-project queries, no provenance. The `buildProjectContext()` function in `ai.js` that injects these into AI prompts is architecturally correct — the storage is the problem.
Recommended: Add `project_intelligence` flat table (`id, project_id, type, content, source_meeting_id, source_email_id, created_at, severity`). Keep JSONB as a denormalized read cache refreshed nightly. Full history preserved. No cap needed.

**B. Nightly batch AI job** — **Keep**
Step-by-step architecture is logical, well-structured, and well-commented. The 15-step pipeline with explicit ordering (email hygiene → extraction → meetings → cross-reference → briefs) is correct. The `pipeline_runs` polling gate is clean. Issues are bugs in specific steps, not the architecture. Keep — fix the bugs inside it.

**C. Meeting-to-calendar matching algorithm** — **Keep with revision**
Two-stage approach (keyword overlap → Haiku content verification) is architecturally sound. Phoenix timezone handling is correct. Main issue: 2-keyword threshold fails on short generic titles ("Tuesday Check-In Call" won't match "Pacific Fusion Weekly"). Revision: lower threshold to 1 match when keyword is >7 chars, or add date+time proximity as primary signal (calendar event on same day within ±2 hours of recording).

**D. Contact system** — **Revise**
Auto-creation from email participants is correct. Signature enrichment is the strongest feature. Problems: (1) `relationship_tier` not auto-set — KEY CONTACTS section in AI context is always empty; (2) `TinneyC@claycorp.com` vs `christinney@claycorp.com` format mismatches create phantom duplicate contacts; (3) Contact detail page's participants match only works for calendar-matched meetings — all backfill meetings contribute nothing to contact history.
Recommended: (a) Auto-set tier based on email frequency; (b) Add email normalization (strip name prefix before `@`); (c) Import M365 People directory as authoritative source.

**E. Knowledge base** — **Unverified / Build out**
Architecture exists (proposal → review queue → knowledge_base table → chat context injection). Whether the `intelligence_notes` flat table referenced in `chat.js` exists is unverified from code alone. If it doesn't exist, the entire knowledge base → chat pipeline is dead. This is the highest-leverage unbuilt feature — domain context (what GMP means, what Pacific Fusion's key risks are, who the owner is) injected into every AI extraction would dramatically improve quality across the entire system.

**F. Chat system** — **Revise**
Parallel context fetch + relevance scoring + project intelligence document injection is architecturally correct. Problem: `intelligence_notes` flat table reference may be broken (P2-2). Also: `filterRelevant()` threshold of 0 means every item with any keyword match passes — likely too permissive, injects noise. Revise: fix the intelligence table reference, raise relevance threshold to 1–2 keyword matches.

**G. Semantic dedup** — **Keep with minor fix**
Three-tier dedup (exact match → Jaccard pre-filter → Haiku confirmation) is the right architecture. 30-pair Haiku cap prevents runaway cost. Jaccard pre-filter before expensive AI call is correct optimization. Minor fix: `semanticMatchCheck()` creates `new Anthropic()` client on every call — move to shared module-level client. Otherwise: keep.

---

## WHAT IS ACTUALLY WORKING

- **Email pipeline**: Plaud pull from Gmail with OAuth token refresh, exponential retry, and `pipeline_runs` lookback window logic — runs reliably. Logs show 12 consecutive clean days.
- **Email → task extraction (Step 4)**: Correctly extracts tasks from Bucket 1 emails, deduplicates against existing open tasks, writes `work_item_sources` provenance rows. This is working.
- **Email → others_commitments (Step 5)**: AI prompt with specific commitment signals ("I'll send / by end of week / will connect you") is thorough. `delivery_type` classification (`to_ryan` vs `general`) is a genuinely useful signal.
- **Pre-meeting brief (when triggered correctly)**: `pre-meeting-brief.js` is the most complete, well-thought-out route in the codebase. Parallel context fetching, attendee-filtered relevance scoring, transcript excerpts, continuity context injection — all structurally correct. Pending decisions section is broken (P1-3) but the rest works.
- **Contact enrichment from email signatures**: The extraction prompt with `CRITICAL RULES` about parsing only the signer's own block is well-engineered. Multi-source gathering (sent emails + transcripts) is correct.
- **Recurring meeting continuity context**: Series key normalization and cross-meeting trajectory analysis is architecturally sound and genuinely valuable for OAC-type recurring meetings.
- **Daily brief generation (Step 9)**: Correctly aggregates all signals into a context bundle and generates a structured brief. Rolling context update on Sundays is the right approach.
- **Semantic dedup**: Working correctly with Jaccard pre-filter and Haiku confirmation. Cap prevents runaway cost.
- **Plaud pipeline (after fix 9aedccb)**: The POST handler, table name, and cron schedule are now correct. First live pipeline meeting will fully validate this.

---

## THE NORTH STAR GAP

**Score: 5/10** toward "fully present in meetings, peer-level executive assistant."

The plumbing is right. The AI prompts are thoughtful. The architecture is defensible. But five compounding bugs mean the output of the intelligence pipeline — the thing Ryan would actually use every day — is largely invisible. He has a system that's doing real work in the background and showing him almost none of it.

**The single highest-leverage fix is `router.js:11` — one line, 5 minutes.** Changing `meeting_notes` to `meeting-notes` (hyphen) immediately surfaces all extracted tasks, commitments, decisions, and risks inside every meeting detail. It turns the intelligence pipeline from "running silently" to "visible to Ryan." Every other fix in this audit becomes perceivable to Ryan only after this one is deployed.

Beyond bug fixes: the architectural capability that would move this from 5/10 to 8/10 is **the knowledge base as domain context layer** — injecting project-specific context (owner name, key risks, contract type, critical dates, key personnel) into every AI extraction. Right now the AI extracts from transcripts with no knowledge of who Pacific Fusion's owner is, what "GMP" means in Ryan's specific contract context, or what the current critical path is. With that context injected, every extraction becomes dramatically more accurate and useful — action items are attributed correctly, risks are framed against actual project risk posture, and commitments are contextualized against what was previously agreed. That's the move from a logging system to a peer.

---

## AUDITOR LIMITATIONS

- **No DB access**: All DB state estimates are derived from code analysis, log output, and known audit hypotheses. Specific row counts, null value distributions, JSONB array lengths, and pipeline run timestamps are estimated, not confirmed.
- **`intelligence_notes` flat table**: Cannot confirm whether this exists as a separate table (referenced in `chat.js:118`) vs. only as a JSONB column on `projects`. If it doesn't exist as a flat table, the chat's intelligence context is always empty — but this cannot be verified without a DB query.
- **`chat-handler.js` and `ai-query.js`**: The audit prompt listed these as files to read, but only `chat.js` was found in `api/src/routes/`. Either these files don't exist, are named differently, or are not in the routes directory. The chat feature analysis is based on `chat.js` alone.
- **`scripts/process-archive-sweep.js` and `process-contact-sweep.js`**: Not analyzed in detail due to reading prioritization. May contain additional bugs or active logic.
- **`ryan_verbal_commitments` write path**: The AI output schema includes `ryan_verbal_commitments` but the write path to the `commitments` table was not fully traced. `CommitmentsPage.jsx` may be populated or empty — unverified.
- **Live pipeline run status**: Cannot observe an actual pipeline execution to verify step timing, error handling, or output quality. All behavior is inferred from code logic.
- **Vercel deployment function routing**: The consolidated `router.js` approach means both `meeting_notes.js` and `meeting-notes.js` are on disk but only one is loaded by the router. In a Vercel file-based routing setup (deprecated), both could be deployed as separate endpoints. Assuming the `router.js` single-entry-point pattern is what's deployed.
- **P0 confidence levels**: P0-1 (column name bug) — HIGH confidence, direct code inspection. P0-2 (person_name in select) — HIGH confidence. P0-3 (status: 'active') — HIGH confidence. P0-4 (projectId gate) — HIGH confidence. P0-5 (failed inserts) — HIGH confidence, direct log evidence. P1-2 (wrong route file) — HIGH confidence, direct code inspection of both router and files.

---

## RECOMMENDED EXECUTION ORDER

1. **Fix `router.js:11`** — change `require('./routes/meeting_notes')` to `require('./routes/meeting-notes')`. Deploy to Vercel. 5 min. **Quick fix.** Unlocks MeetingDetail intelligence for all existing meetings immediately.

2. **Fix `pending-decisions.js` + `pre-meeting-brief.js` column names** — `pending-decisions.js:18-22`: respect `?status=all` param. `pre-meeting-brief.js:110,143`: `question` → `title`. 30 min combined. **Quick fix.** Decisions become visible in briefs and history.

3. **Fix `backfill-meeting-tasks.js`** — change `person_name` → `committed_by_name`, `status: 'active'` → `status: 'open'`, remove `!meeting.project_id` gate from decisions loop. Re-run the script. 30 min code fix + 15 min backfill run. **Single session.** Recovers 65 meetings of historical others-commitments and tasks.

4. **Fix `meeting-notes.js` route select + `MeetingDetail.jsx` render** — remove `person_name` from select, render `c.committed_by_name` instead. 20 min. **Quick fix.** Names appear in meeting intelligence view.

5. **Remove `if (projectId)` gate from `pending_decisions` write loops** in `nightly-ai-local.js:2898` and `backfill-meeting-tasks.js:242`. 30 min. **Single session.** Future meetings write decisions regardless of project linkage.

6. **Cache `findProjectByKeywords()`** — load `activeProjects` once at `main()` start, close over it in the function. 45 min. **Single session.** Eliminates 75–125 redundant DB calls per nightly run.

7. **Add pipeline failure alerting to hankinsr@claycorp.com** and a `last_updated_at` staleness widget to Dashboard. Route GitHub Actions failure notifications to primary inbox. Add `data-freshness` indicator to Dashboard header. 90 min. **Single session.** Ryan knows when the system is dark.

---

*All file references use the repo root as base: `/Users/ryanhankins/personal-os/`.*
*This audit is point-in-time as of June 11, 2026. Code-only analysis — DB state estimates should be validated with the ground-truth SQL queries in the audit prompt once network access is available.*
