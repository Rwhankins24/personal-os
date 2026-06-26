# Personal OS — System Architecture & Build Spec

*Last updated: June 26, 2026 — Workshopped with Ryan Hankins*

---

## 1. System Goal

A wholistic operating system for Ryan's work and personal life. Tracks emails, meetings, context, and data in real time. Functions as an executive assistant that understands technical and operational issues at the same level Ryan does. Keeps track of actions, commitments (Ryan's and others'), decisions, intelligence, and knowledge — updated daily through automated pipelines and Ryan's manual input.

**Core principle:** The system accumulates institutional memory. Each day adds context. Over time, it gets smarter about Ryan's world — his projects, his people, his patterns.

**Primary goal:** Win the right work, structure it correctly, execute without surprises. The OS removes the cognitive overhead of tracking everything so Ryan can stay present.

---

## 2. Architecture — Three-Legged Stool

```
  Leg 1: EMAIL          Leg 2: PLAUD          Leg 3: MANUAL
  (Cowork skills)       (GitHub Actions)      (Front end)
  4:05 AM / 4:25 AM     As recordings arrive  Ryan, anytime
       ↓                      ↓                    ↓
  Supabase storage      Supabase storage      Supabase tables
  last-email-raw.json   plaud-{DATE}.json     source = 'manual'
       ↓                      ↓                    ↓
  ─────────────────────────────────────────────────────────
                    PHASE 2: NIGHTLY AI JOB
                    (GitHub Actions, 10 AM–6 PM UTC)
                    Reads all three legs, synthesizes,
                    writes intelligence to all pages
  ─────────────────────────────────────────────────────────
```

**Key constraint:** Plaud stays in GitHub Actions permanently. It is not part of Cowork skills. Phase 1 only covers Legs 1 (Email) in Cowork. Leg 2 is always separate.

### Source Field

Every AI-written record carries a `source` field tracking data provenance:

| Value | Meaning |
|---|---|
| `manual` | Ryan entered directly via front end — ground truth |
| `email_ai` | Extracted from email by Phase 2 |
| `plaud_ai` | Extracted from Plaud by Phase 2 |
| `approved` | AI-extracted, Ryan interacted with it |

### Approval Logic

- Interact with item (edit, complete, link) → auto-approved
- Delete item → rejection signal logged (quality feedback loop)
- 48 hours no action → auto-approved
- Morning dashboard shows "X items extracted last night" with review link

---

## 3. OS Pages & Data Destinations

All pages already exist in the front end. Phase 2 routes extracted intelligence to each:

| Page | What routes here |
|---|---|
| **Tasks** | Action items where `ryan_owns = true` |
| **Others** | Commitments others made; action items Ryan is waiting on |
| **Meetings** | Plaud meeting notes, calendar cross-reference, summaries, action items |
| **Contacts** | Signature enrichment, new participants, communication patterns, relationship signals |
| **Projects** | Project mentions, activity updates, cost/schedule flags, open issues |
| **Knowledge** | Synthesized knowledge entries from emails and meetings (e.g., settlement expertise growth) |
| **Topics** | Auto-routed content matching existing pods; cluster suggestions for new pods |
| **Leads** | Lead signals from emails and meetings |
| **Journal / Observations** | Pattern observations, daily synthesis notes |
| **Pending Decisions** | Open questions, decisions pending Ryan's confirmation |
| **Strategic Decisions** | Risks, significant decisions made |

---

## 4. Current State — What's Working, What's Broken

### Working (as of June 26)
- Email pull with full pagination (Resilience Rule 11 — 3 pages, 70 threads on June 26 run)
- Nightly AI job core structure (25+ steps, all pages receiving data)
- Front end pages built and receiving data
- Plaud → email → GitHub Actions pipeline connected
- pipeline_runs table tracking pull/plaud/AI completion

### Broken / Bleeding
- **Email pull crashes at write step** — Cowork session drops mid-write; atomic write not yet implemented
- **Nightly AI cascade** — job times out at 60 min, never writes `ai_completed_at`, poller re-fires every 10 min → $10+/day
- **Classify fires on fixed timer** — not event-driven; can read stale file if pull ran late
- **launchd push_email_report.py** — no date check before pushing; can push stale data and trigger AI on wrong pool
- **No Dismiss/Remove on front end** — only "Complete" exists; quality feedback loop is broken
- **Per-item API architecture** — 300-400 sequential calls/night causing 60+ min runtime
- **No backfill** — June 22-24 data gap unresolved

### Already Fixed (pushed)
- Pagination in email pull (Rule 11)
- webhooks.js 400 error (7-day AI failure root cause)
- anthropic undefined in Step 3.9
- supabase.rpc().catch() → .then() pattern
- withRetry network error handling

---

## 5. Phase 1A — Reliability (IMMEDIATE — do tonight)

**Goal:** Stop the bleeding. Zero cascade. Zero stale data triggering AI.

### Task #68 — Fix nightly AI cascade

**Problem:** 60-min timeout kills job → `ai_completed_at` never written → poller re-fires → $10/day

**Fix — 3 parts:**

**Part 1:** SQL migration
```sql
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS job_started_at timestamptz;
```

**Part 2:** `nightly-ai-local.js` — write `job_started_at` at the very start of real work (after idempotency check, before first API call):
```javascript
await supabase
  .from('pipeline_runs')
  .update({ job_started_at: new Date().toISOString() })
  .eq('run_date', runDate);
```

**Part 3:** `nightly-ai.yml` — update polling logic to guard against cascade:
```
Current fire condition:
  processing_done AND (plaud_done OR 90+ min) AND NOT ai_done → RUN

New fire condition:
  if ai_done → SKIP (already completed today)
  if job_started_at set < 110 min ago AND NOT ai_done → SKIP (running or recently crashed)
  if job_started_at set > 110 min ago AND NOT ai_done → RUN ONCE (crashed — retry allowed)
  if processing_done AND (plaud_done OR 90+ min) AND NOT job_started_at → RUN (normal)
```

Also change: `timeout-minutes: 60` → `timeout-minutes: 120`

**Ryan must push:** All changes require `git push origin main` from terminal.

---

### Task #74 — Fix launchd date check

**File:** `data/push_email_report.py`

**Problem:** Pushes email report to Supabase and fires pipeline_complete webhook without checking if `report_date` matches today. Can push stale June 25 data and trigger AI job on wrong email pool.

**Fix:** Before pushing, compare `report_date` in `last-email-report.json` against today's date (UTC). If stale → abort, log warning, do NOT fire webhook.

---

### Task #71 (Part A) — Atomic write for email pull

**Problem:** Cowork session crashes mid-write → `last-email-raw.json` corrupted or left with stale date → classify reads wrong file.

**Fix:** Email pull writes to `last-email-raw.tmp.json`, then renames to `last-email-raw.json` only on success. If Cowork crashes mid-write, old file is untouched. `PULL_SINCE` is never corrupted.

Add to Step 3 of `email-pull-raw-skill.md`:
```
1. Write to ~/personal-os/data/last-email-raw.tmp.json (full payload)
2. Verify write succeeded (file exists, is valid JSON, has report_date = TODAY)
3. Rename/overwrite: last-email-raw.tmp.json → last-email-raw.json
4. Log: "Atomic write complete"
```

---

### Task #75 — Event-driven classify trigger

**Problem:** Classify fires on fixed 20-min timer (4:25 AM). If pull ran late or crashed, classify reads a stale file.

**Fix:** Pull writes a completion flag when done. Classify polls for the flag.

- Pull writes: `~/personal-os/data/pull-complete-{TODAY_ISO}.flag` on successful write
- Classify polls for flag every 2 min, up to 30 min before proceeding
- If flag not found after 30 min → log warning, check file freshness, proceed with caution

---

## 6. Phase 1B — Extraction Layer

**Goal:** Email classify becomes the structured data extraction layer. Phase 2 never touches M365 again. Everything Phase 2 needs is in the email intelligence package.

**Blocked by:** Nothing. Can begin after Phase 1A is stable.
**Blocks:** Phase 2 refactor (Phase 2 depends on Phase 1B output schema being locked).

### Task #69 — Upgrade email classify to full extraction

For every email thread, extract and structure:

#### Thread structure
- Full conversation transcript — messages in order (sender, date, body) — NOT concatenated text, NOT AI-summarized
- Participants with email domains (domain → company, no AI needed)
- Project keyword matches (against known project list)
- Bucket classification 1-6 (existing)
- Urgency score, days waiting, attachment flags

#### Signal extraction (keyword/phrase detection — no AI calls)

| Signal Type | What to extract |
|---|---|
| **Action phrases** | Exact sentences with requests/asks directed at Ryan (look for: "can you", "please", "could you", "need you to", "would you") |
| **Commitment phrases** | Exact sentences with promises made or received ("I'll send by Friday", "We'll have pricing Monday", "Let me get back to you") |
| **Signature blocks** | Raw text of email signatures, per unique sender |
| **Commercial/financial** | Pricing, budget, allowance, contingency, fee, bid, estimate, cost, invoice, GMP |
| **Schedule/timeline** | Deadline, milestone, delivery, critical path, procurement, long-lead, phasing, schedule |
| **Risk/exposure** | Issue, concern, delay, dispute, claim, exposure, escalation, problem |
| **Decision language** | Approved, rejected, confirmed, agreed, pending, authorized, signed off |
| **Contract/legal** | Indemnity, lien, GMP, change order, scope, addendum, execute, sign-off, exhibit |
| **Technical/design** | Specs, drawings, submittal, RFI, RFQ, constructability, comments, review |
| **Pursuit/BD** | Proposal, RFP, interview, shortlist, award, selection, fee negotiation, pursue |
| **Relationship signals** | New contact introduced, org change noted, escalation tone, frustration language |

#### Calendar (from pull package — already in raw JSON)
- Today's events: title, start, end, location, join link, organizer, attendees
- Pending invites: organizer, title, proposed time, days pending, response status

#### Output format per thread
```json
{
  "conversationId": "AAQk...",
  "threadSubject": "...",
  "bucket": 2,
  "urgency": "high",
  "days_waiting": 3,
  "extraction_depth": "full",
  "participants": [
    { "email": "j.miller@firm.com", "name": "J. Miller", "domain": "firm.com", "company_inferred": "Firm LLC" }
  ],
  "transcript": [
    { "sender": "j.miller@firm.com", "date": "2026-06-25T14:00:00Z", "body": "Full message body..." }
  ],
  "signature_blocks": [
    { "sender": "j.miller@firm.com", "raw_signature": "J. Miller | VP | Firm LLC | 602-555-1234" }
  ],
  "action_phrases": ["Can you send the updated pricing by Thursday?"],
  "commitment_phrases": ["I'll have the submittal to you by Monday"],
  "signals": {
    "commercial": ["updated pricing", "fee proposal"],
    "schedule": ["by Thursday", "by Monday"],
    "risk": [],
    "decision": [],
    "contract": [],
    "technical": ["submittal"],
    "pursuit": [],
    "relationship": []
  },
  "project_matches": ["LWIC - Tampa"],
  "has_attachment": true,
  "has_contract_language": false,
  "is_time_sensitive": true
}
```

#### Output file
- Daily: `~/personal-os/data/last-email-report.json`
- Archive (Task #71 Part B): `daily-reports/email-{DATE}.json` in Supabase storage → permanent historical record

---

### Task #66 — Source field schema migration

Add `source VARCHAR DEFAULT 'manual'` to these Supabase tables:
- `tasks`
- `knowledge_base`
- `others_commitments`
- `pending_decisions`
- `observations`
- `contacts`
- `strategic_decisions`

SQL:
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE others_commitments ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE pending_decisions ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE observations ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
ALTER TABLE strategic_decisions ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual';
```

---

## 7. Phase 2 — Nightly AI Job Refactor

**Goal:** 6-10 batch API calls. Runtime < 20 min. Cost $0.50–$1.50/run (from current $10+). Full intelligence synthesis across all three legs.

**Blocked by:** Phase 1B schema must be locked first. Phase 2 reads Phase 1B output — if Phase 1B schema changes mid-refactor, Phase 2 breaks.

### Task #70 — Refactor to batch architecture

#### Step 0 — Load all three legs (zero API calls)

**0A — Email package** (Phase 1B output)
- Load from Supabase: `daily-reports/email-{TODAY}.json`
- Contains: full transcripts, extracted signals, action phrases, commitments, signature blocks, participants, calendar

**0B — Plaud meetings**
- Load from Supabase: `plaud-{TODAY}.json`
- Contains: structured JSON per meeting (see Plaud section below)

**0C — Manual context** (ground truth)
- Query Supabase for `source = 'manual'` records modified in last 30 days
- Includes: manual tasks, journal entries, project notes, contact notes
- Manual context = highest weight in synthesis; AI extractions that conflict are flagged, not overwritten

Missing leg: note it, continue with available data.

---

#### Step 1 — Batch email intelligence (1-2 Sonnet calls)

Single call with all threads + pre-extracted signals:

Input: all threads with their transcripts, action_phrases, commitment_phrases, signals, participants

Output (structured JSON):
- Per-thread: 1-sentence summary, ryan_tasks[], others_tasks[], open_questions[], risks[], knowledge_items[]
- Across all threads: new contacts detected (name, email, company, context), relationship signals, lead signals

---

#### Step 2 — Batch meeting intelligence (1 Sonnet call)

Input: all Plaud meetings with transcripts and structured JSON

Output:
- Per-meeting: action items (ryan_owns flag), decisions made, open questions, continuity notes (what's still unresolved from previous meeting on same project), relationship signals
- Knowledge items: substantive learnings to route to Knowledge page (e.g., Ryan learning about settlement — new entry + existing entry enrichment)

---

#### Step 3 — Cross-reference (zero API calls)

**Plaud × Calendar matching:**

```
PRIMARY (both required):
  Same day (hard gate — no cross-day matches ever)
  Start time within ±30 min

SECONDARY (tiebreaker for same-day, same-time ambiguity):
  Participant overlap (email addresses)
  Title/keyword similarity (fuzzy match on meeting name vs. Plaud content)

Result:
  Strong match (both primary + any secondary) → auto-link, confidence = high
  Weak match (primary only, no secondary confirmation) → link with flag = 'implied', surface in daily brief
  No match → unlinked, flagged for Ryan to manually confirm via front end
```

**Email × Plaud:** Same person + project appearing in both legs = unified story per person/project.

**Email × Manual:** Ryan's manual context takes precedence. AI extractions conflicting with manual entries are flagged as "conflicts with manual input" — not overwritten.

---

#### Step 4 — Synthesis (1 Sonnet call)

Input: cross-referenced full picture

Output:
- Daily brief text (for morning newsletter)
- Key observations (pattern-level, not item-level)
- 5-day lookahead across all three legs

---

#### Step 5 — File everything, deep-process what matters

**Write directly — no AI calls:**
- All signal extractions (commercial, schedule, risk, etc.) → tagged and stored
- Cost/schedule/risk flags → project records
- Topic frequency updates → accumulates toward cluster detection
- New contact records (shadow, awaiting enrichment) → contacts table
- Commitment phrases → flagged for tracking in Others page
- All records get source field

**One batch AI call — contact enrichment:**
- Collect all signature blocks from new/updated contacts
- Single Sonnet call: "Extract title, company, phone, department from each signature block"
- Write enriched data back to contacts table

**Rotating AI calls (2-3 per night max, not all pods every night):**
- Topic pod research — rotates across active pods over time (not all pods every run)
- Project intelligence — only for projects with email/meeting activity in the last 7 days

---

#### Step 6 — Write to Supabase (all records with source field)

Routes to: Tasks, Others, Contacts, Knowledge, Pending Decisions, Strategic Decisions, Observations, Leads, Projects, Meetings, Topic Pods

---

### Task #76 — Topic cluster detection

- Every run: increment topic frequency counters in Supabase
- Cluster detection trigger: topic appears 3+ times across emails + meetings without existing pod
- Action: flag in next day's brief — "Settlement appeared in 6 conversations this week — consider creating a pod"
- Ryan creates pod via front end → system starts routing

---

### Task #77 — Retroactive pod population

- When new pod created in front end → next Phase 2 run searches last 90 days of historical email + meeting content for matches
- Routes matching content to new pod automatically
- One-time batch operation per new pod (not every night)

---

### Task #80 — Auto-route to existing pods each run

- Each nightly run: check all extracted knowledge items against existing pod keywords
- Auto-route matching items to appropriate pods (source = email_ai | plaud_ai)
- No AI call needed — keyword matching against pod tag list

---

## 8. Plaud Pipeline (Stays in GitHub Actions — Always Separate)

**Architecture:** Recording → Plaud AI summary → email to personal OS inbox → GitHub Actions pulls → structured JSON extracted → Supabase storage as `plaud-{DATE}.json`

### Plaud prompt (Ryan's executive summary prompt — keep as-is)

Ryan's existing prompt produces excellent output. When Phase 1B schema is locked, add a structured JSON block at the end of the prompt (Task #73) so Plaud outputs machine-readable data alongside the human summary.

### JSON output structure (finalized in Task #73 after Phase 1B schema is locked)

Routes to same Supabase tables as email extraction:

```json
{
  "meeting_date": "2026-06-25",
  "meeting_start_time_approx": "09:00",
  "meeting_title_from_content": "LWIC Coordination",
  "participants": [
    { "name": "Name", "email": "email@domain.com", "company": "Company", "role": "PM" }
  ],
  "action_items": [
    { "assignee": "Ryan", "task": "Send updated pricing by Thursday", "due": "2026-06-27", "ryan_owns": true }
  ],
  "commitments_others_made": [
    { "person": "J. Miller", "commitment": "Will send submittal Monday", "due": "2026-06-28" }
  ],
  "decisions": ["Approved phased procurement approach"],
  "open_questions": ["Confirming GMP language with legal by EOW"],
  "risks": ["Foundation sequencing may delay MEP rough-in by 2 weeks"],
  "knowledge_items": ["Settlement in clay soils — differential settlement calculations require..."],
  "topics_discussed": ["settlement", "procurement", "MEP coordination", "GMP"],
  "lead_signals": [],
  "relationship_signals": ["Tension noted with subcontractor — follow up needed"],
  "cost_flags": ["$240k contingency draw request pending approval"],
  "schedule_flags": ["Milestone: steel delivery pushed to August 15"],
  "projects_referenced": ["LWIC - Tampa"]
}
```

### Plaud × Calendar matching (in Phase 2 Step 3)

Day match (required) + time within ±30 min → link meeting to calendar event → enrich with attendee list from calendar, add join link, confirm project tag.

---

## 9. Phase 3 — Backfill System

**Goal:** Fill historical gaps (June 22-24 and beyond). Never touch the daily pipeline.

**Blocked by:** Phase 1B extraction schema must be locked (backfill uses same extraction logic).

### Isolation rules — inviolable

- Backfill NEVER writes to `last-email-raw.json` or `last-email-report.json`
- Backfill NEVER fires `pipeline_complete` webhook
- Backfill NEVER updates `PULL_SINCE`
- Daily pipeline files are exclusively owned by the daily pipeline
- All backfill output goes to archive paths only

### Task #72A — email-pull-backfill.md (new skill file)

Input: `TARGET_DATE` (YYYY-MM-DD, required)

Logic:
- Pull all inbox/sent for `TARGET_DATE` — `afterDateTime: TARGET_DATE 00:00 UTC`, `beforeDateTime: TARGET_DATE+1 00:00 UTC`
- Paginate fully (same rules as daily pull)
- Apply full thread grouping and tiered extraction
- Write to: `archive/email-raw-{TARGET_DATE}.json` ONLY

Never reads or writes `last-email-raw.json`.

### Task #72B — email-classify-backfill.md (new skill file)

Input: `TARGET_DATE`

Logic:
- Read: `archive/email-raw-{TARGET_DATE}.json`
- Apply full Phase 1B extraction (same logic as daily classify)
- Write to: `archive/email-report-{TARGET_DATE}.json`
- Upload to Supabase storage: `daily-reports/{TARGET_DATE}.json`

Ends by printing (NOT auto-executing):
```
gh workflow run nightly-ai.yml \
  -f force_run=true \
  -f date_override={TARGET_DATE} \
  -f force_rerun=true
```
Ryan copies and runs this from his terminal.

### Task #71 (Part B) — Date archiving in daily classify

Daily classify already runs and writes `last-email-report.json`. Add one additional step: also upload to Supabase storage as `daily-reports/{TODAY_ISO}.json`. Builds permanent historical record from today forward.

### Backfill execution plan

After Phase 3 skills are built:
1. Run pull-backfill for June 22
2. Run classify-backfill for June 22 → copy gh command → run from terminal
3. Repeat for June 23, June 24
4. Going forward: daily classify auto-archives to `daily-reports/`

---

## 10. Front End Requirements

### Task #67 — Dismiss/Remove action

Add Dismiss button to: Tasks, Knowledge, Others, Pending Decisions

Behavior:
- Dismiss ≠ Complete (Complete keeps record as done; Dismiss removes it and logs rejection)
- Rejection logs: `{ item_id, source, reason: 'dismissed', dismissed_at }`
- Rejection signals feed back to improve Phase 2 quality over time (what kinds of extractions get dismissed most?)

Currently Ryan is clicking "Complete" even for items he wants to discard — this corrupts the quality signal.

### Task #78 — Dashboard "Extracted last night" panel

Morning review panel showing:
- Count by type: "3 tasks · 4 knowledge entries · 2 contact updates · 3 others' commitments"
- Filters to items with `source IN (email_ai, plaud_ai)` created in last 24h
- Not a blocking gate — Ryan reviews when he has time, items auto-approve at 48h

---

## 11. Schema Changes Summary

| Table | Change |
|---|---|
| `pipeline_runs` | Add `job_started_at TIMESTAMPTZ` |
| `tasks` | Add `source VARCHAR DEFAULT 'manual'` |
| `knowledge_base` | Add `source VARCHAR DEFAULT 'manual'` |
| `others_commitments` | Add `source VARCHAR DEFAULT 'manual'` |
| `pending_decisions` | Add `source VARCHAR DEFAULT 'manual'` |
| `observations` | Add `source VARCHAR DEFAULT 'manual'` |
| `contacts` | Add `source VARCHAR DEFAULT 'manual'` |
| `strategic_decisions` | Add `source VARCHAR DEFAULT 'manual'` |

---

## 12. Full Task List by Phase

### Phase 1A — Pipeline reliability ✅ COMPLETE (2026-06-26)
| # | Task | Status |
|---|---|---|
| #68 | Cascade fix: `job_started_at` guard + timeout 60→120 | ✅ Pushed 2026-06-26 |
| #79 | Push pagination fix | ✅ Pushed 2026-06-26 |
| #74 | Fix push_email_report.py stale date abort | ✅ Pushed 2026-06-26 |
| #71A | Atomic write + completion flag for email pull | ✅ Pushed 2026-06-26 |
| #75 | Event-driven classify trigger (flag file polling) | ✅ Pushed 2026-06-26 |
| #86 | Step 2.44 Plaud re-matching: 30-day window + limit 20 | ✅ Pushed 2026-06-26 |
| #66 | SQL migrations: job_started_at, source_type, match_attempted | ✅ Run in Supabase 2026-06-26 |

### Schema & front end
| # | Task | Status |
|---|---|---|
| #67 | Dismiss button on front end pages | Pending (Phase 1B ready) |
| #78 | Dashboard "Extracted last night" panel | Pending |

### Phase 1B — Extraction layer
| # | Task | Blocked by |
|---|---|---|
| #69 | Upgrade classify to full extraction | Phase 1A stable |
| #71B | Date archiving in daily classify | #69 |

### Phase 2 — Nightly AI refactor
| # | Task | Blocked by |
|---|---|---|
| #70 | Batch architecture refactor (6-10 calls) | #69 (Phase 1B locked) |
| #76 | Topic cluster detection | #70 |
| #77 | Retroactive pod population | #70 |
| #80 | Auto-route to existing pods each run | #70 |

### Plaud
| # | Task | Blocked by |
|---|---|---|
| #73 | Finalize Plaud JSON prompt | #69 (Phase 1B schema locked) |

### Phase 3 — Backfill
| # | Task | Blocked by |
|---|---|---|
| #72A | email-pull-backfill.md skill | #71A |
| #72B | email-classify-backfill.md skill | #69 |
| — | Run June 22-24 backfills | #72A + #72B |

### Open from original backlog
| # | Task | Notes |
|---|---|---|
| #18 | Knowledge base domain context layer | Addressed inside Phase 2 refactor |

---

## 13. Sequencing — Critical Path

```
TONIGHT
  #68 — cascade fix (Ryan terminal)       ← $10/day stops immediately
  #79 — push pagination fix (Ryan terminal)

NEXT SESSION
  #74 — launchd date check
  #66 — source field schema migration
  #71A — atomic write
  #67 — Dismiss button front end

THEN (Phase 1A complete)
  #75 — event-driven classify trigger
  #69 — Phase 1B classify upgrade ← CRITICAL GATE
  #71B — date archiving in classify

THEN (Phase 1B locked)
  #70 — Phase 2 batch refactor
  #73 — Plaud JSON prompt finalized
  #76 — topic cluster detection
  #77 — retroactive pod population
  #80 — auto-route to pods each run
  #78 — dashboard panel

THEN (Phase 2 stable + classify archiving in place)
  #72A — pull-backfill skill
  #72B — classify-backfill skill
  Run June 22-24 backfills
```

---

## 14. Success Metrics

### Reliability
- Email pull completes and writes correct file: `last-email-raw.json` date = today
- Classify reads correct data: classify detects today's `report_date` before proceeding
- AI job completes in single run: no cascade in GitHub Actions run history

### Cost
- Daily API cost < $2.00 (from current ~$10/day)
- Single nightly run < 20 minutes (from current 60+ min timeout)

### Coverage
- Email threads per day: 60-100 (from current 25, now 70+ with pagination)
- All pages receiving nightly updates from AI job
- Topic pods growing from email + meeting content automatically

### Quality (tracked via source field)
- Dismissal rate < 20% (less than 1 in 5 AI extractions dismissed)
- Approval rate trends upward over time as system learns Ryan's patterns

---

## 15. Key Architectural Decisions (Locked)

1. **Plaud stays in GitHub Actions permanently** — not part of Cowork skills, ever
2. **Daily vs. backfill = separate skill files** — not parameterized single skill, for isolation safety
3. **Phase 1 = extraction layer (no AI calls)** — keyword/phrase detection only; AI calls belong to Phase 2
4. **Phase 2 = synthesis layer (batch AI calls)** — reads all three legs, never calls M365 directly
5. **File everything, deep-process what matters** — storage is cheap; AI calls are not. Extract broadly, synthesize selectively.
6. **Manual = ground truth** — Ryan's front end entries take precedence over AI extractions in all conflicts
7. **Source field on all AI-written records** — provenance tracking enables quality loop
8. **Approval = interaction-based** — edit/complete/link = approved; delete = rejection signal; 48h = auto-approve
9. **Backfill isolation = inviolable** — backfill never touches daily pipeline files

---

*This spec is the authoritative record of all planned work. Update it as decisions change.*
