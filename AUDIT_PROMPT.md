# Personal OS — Full System Audit Prompt

Paste this into a fresh Claude session. The auditor should read all referenced files
before forming any conclusions. Do not write or modify any files.

---

## CONTEXT: WHAT THIS SYSTEM IS

You are auditing a personal intelligence operating system built for Ryan Hankins,
Project Executive at Clayco (a major design-build GC). Ryan operates at the intersection
of pursuit, preconstruction, and execution — managing complex, high-stakes projects
across Industrial, Data Center, and other verticals.

The north star: Ryan wants to be fully present in meetings without taking notes.
The system handles capture, extraction, context, and follow-through. Over time it
should function as a peer-level executive assistant — not just a logger — that
understands his business, his language, his relationships, and his risk posture well
enough to surface things before he asks.

---

### THE PEOPLE AND ACCOUNTS INVOLVED

**Ryan Hankins**
- Work email: hankinsr@claycorp.com (Microsoft 365 / Outlook)
- Personal Gmail: ryanhankins.personalos@gmail.com (used only for Plaud transcript delivery and system alert emails — NOT his work inbox)
- Role: Project Executive at Clayco — leads preconstruction, design management, owner relationships, and pursuit strategy across large commercial projects
- Key projects include: Pacific Fusion (large industrial — active, complex), Gotion, Sofidel, DS3, Project Sun (pursuit)
- Works with: Clayco leadership, owner/client contacts, AE firms, key subcontractors, CRG (Commercial Real Estate Group, a sister company)

---

### THE TWO INTAKE CHANNELS

**Channel 1: Microsoft 365 Email (hankinsr@claycorp.com)**
This is Ryan's primary work email. The system connects to it via a Microsoft 365 / Outlook connector (MCP or similar integration). It ingests:
- Inbox emails (last 48h on each nightly run)
- Sent items (to track what Ryan committed to, what he's waiting on)
- Calendar events (Outlook calendar — synced to the `events` table)

Email processing runs via `process-email-report.js`, which is triggered separately from the nightly AI job. When it completes, it sets `processing_completed_at` in `pipeline_runs`, which signals the nightly AI job that it can fire.

The email pipeline feeds:
- `emails` table — every ingested email with AI summary, thread context
- `tasks` table — action items extracted from email threads assigned to Ryan
- `others_commitments` table — commitments others made to Ryan in email
- `contacts` table — enriched from email signatures and participants
- `projects` JSONB arrays — email intelligence linked to matching projects
- `events` table — calendar events for meeting-to-calendar matching

**Channel 2: Plaud Meeting Recorder → Gmail**
Ryan records meetings using a Plaud device. Plaud automatically emails transcripts to ryanhankins.personalos@gmail.com with subject `[Plaud-AutoFlow]`. Each email contains two attachments:
- `transcript.txt` — full verbatim transcript
- `summary.txt` — Plaud's own AI-generated summary with action items in `**@Name**` format

`plaud-pull.yml` (GitHub Action, 9 AM UTC) fetches these emails from Gmail via OAuth, downloads attachments, and inserts meeting records directly into `meeting_notes` via POST to `/api/meeting-notes`. It also uploads a daily JSON to Supabase storage as `daily-reports/plaud-{date}.json`.

The meeting pipeline feeds (via the nightly AI job):
- `meeting_notes` table — transcript, summary, participants, intelligence flags
- `tasks` table — Ryan's action items from meeting transcript (AI-extracted)
- `others_commitments` table — what others committed to in the meeting
- `projects` JSONB arrays — technical/financial/schedule/scope signals, decisions, risks
- `pending_decisions` table — open decisions (NOTE: this is a known gap — nothing currently writes here)

---

### THE NIGHTLY AI JOB — THE BRAIN

`nightly-ai-local.js` is the entire intelligence pipeline in one file (~4000+ lines). It runs once per day via GitHub Actions after both email processing and Plaud pull are complete. It processes everything sequentially:

**Email steps:**
- Step 2: Load emails from DB (already ingested by process-email-report.js)
- Step 3: Summarize email threads (Haiku model — fast, cheap)
- Step 3.2: Classify email context (urgency, type, project relevance)
- Step 3.5: Extract intelligence from emails (commitments, risks, decisions)
- Step 3.55: Email context enrichment (additional signal extraction)
- Step 3.6b: Learn project keywords from email context
- Step 3.6: Update contacts from email participants
- Step 3.65: Auto-create contacts from email participants
- Step 3.7: Enrich contacts from email signatures (title, company, phone)

**Meeting steps:**
- Step 2.4: Load Plaud meetings from Supabase storage into meeting_notes
- Step 2.4 (inner): Match Plaud meetings to calendar events (keyword overlap + Haiku content verification) to get real attendees and start_time
- Main AI loop: For each unprocessed meeting (intelligence_extracted=false):
  - Pass 1: Process action_items_raw (pre-AI items from summary.txt regex parse)
  - Pass 2: Run full `extractIntelligenceFromTranscript` on full_transcript
  - Write: ryan_action_items → tasks, others_action_items + verbal_commitments_others → others_commitments, signals → project JSONB arrays, summary → meeting_notes

**Cross-referencing steps:**
- Step 4: Extract tasks from emails (deduped against existing tasks)
- Step 4.5: Refresh stale open items
- Step 5: Extract commitments from emails (deduped against others_commitments)
- Step 5.45: Link waiting_on emails to others_commitments
- Step 5.5: Cross-reference sources (link email intelligence to meeting intelligence)

**Dedup strategy:**
Tasks and others_commitments are deduplicated using a two-level approach:
1. Exact title match
2. Semantic similarity check via `semanticMatchCheck()` — calls Haiku with two candidate items, asks if they're the same thing. Threshold: 75% confidence. This runs on every new item against existing open items in the same project.

---

### THE FIVE CORE UI SURFACES

**1. Dashboard**
Landing page. Shows summary widgets — open task counts, recent meetings, others' commitment counts, upcoming calendar events, possibly pipeline health. The quality of this view depends entirely on whether the underlying data is correctly populated.

**2. Tasks Page**
Ryan's own action items. Every task has a source (meeting, email, manual), source label, due date, urgency, project linkage. Supposed to be the definitive list of what Ryan needs to do. Currently has ZERO historical tasks from meetings because `ryan_action_items` wasn't in the AI prompt when the 65-meeting backfill ran.

**3. Others Page (OthersPage.jsx)**
What other people owe Ryan. Grouped by person (committed_by_name). Sources: both meeting transcripts and email threads. This is the accountability tracker — Ryan uses this to know who is blocking him before walking into a room. Key issues: Speaker N rows (unattributed, shown in amber with inline reassign), partial name variants (same person, different name formats showing as separate people).

**4. Meeting Cards (MeetingDetail.jsx)**
Single meeting view. Shows:
- Summary (new format: ## headings + bullets; old format: paragraph)
- Tasks extracted from this meeting
- Others' commitments from this meeting
- Decisions made (from project JSONB, filtered to this meeting's source)
- Risks surfaced (same)
- Technical / financial / schedule / scope signals (same)
- Pending decisions for this project
- Linked calendar event (pre-meeting notes)
Older records (backfill) have source_label fallback for commitments since meeting_note_id wasn't set.

**5. Project Cards (Projects.jsx / ProjectCard.jsx)**
Project-level intelligence. Each project accumulates signals from every meeting and email that mentions it, via keyword matching. The intelligence lives in JSONB arrays on the projects table:
- `intelligence_notes` — technical, financial, schedule, scope signals (capped at 50, oldest dropped)
- `decisions_made` — decisions made across all meetings (capped at 30)
- `risk_signals` — risks surfaced (capped at 30)
- `key_facts` — important facts (capped at 30)
Projects are matched to meetings/emails via `findProjectByKeywords()` — requires 2+ keyword overlaps between project name/keywords and meeting title/email subject.

---

### THE CONTACT SYSTEM

Contacts live in the `contacts` table. They are built from three sources:
1. **Email participants** — auto-created from every email sender/recipient (Step 3.65)
2. **Email signatures** — enriched with title, company, phone number (Step 3.7 via AI)
3. **Meeting transcripts** — names mentioned in transcripts are cross-referenced against contacts

Contact detail page (`ContactDetail.jsx`) is supposed to show the full relationship picture for a person: their emails with Ryan, meetings they were in, open commitments they have, last interaction date. This is the relationship intelligence layer.

Contacts are used operationally in the nightly job to:
- Resolve email addresses → real names for meeting participant rosters
- Attach contact_id to others_commitments and tasks where possible
- Feed the pre-meeting brief with recent interaction history

---

### THE KNOWLEDGE SYSTEM

`KnowledgePage.jsx` and `knowledge.js` route exist. What exactly populates the knowledge base, how it's structured, and how it's used is unclear — treat this as a zone to audit carefully. It may be underdeveloped, orphaned, or fully functional. Do not assume.

---

### THE CALENDAR SYSTEM

Outlook calendar events sync into the `events` table (from hankinsr@claycorp.com via M365 connector). Events have: title, start_time, attendees (mixed format — sometimes email addresses like `TinneyC@claycorp.com`, sometimes display names like `Bill Huie`).

Calendar events are used for:
1. **Plaud-to-calendar matching** — when a Plaud recording comes in, the nightly job tries to match it to a calendar event by keyword overlap on title, then verifies with Haiku content matching. Successful match gives the meeting: real start_time, real attendee roster (resolved to names via contacts table).
2. **Pre-meeting brief** (`EventDetail.jsx`, `pre-meeting-brief.js`) — when Ryan clicks a calendar event, it should show: open commitments from attendees, recent email threads with attendees, relevant project context.
3. **Meeting time** — if no calendar match, Plaud meetings default to noon on the recording date.

---

### THE PRE-MEETING BRIEF

`pre-meeting-brief.js` generates context before a meeting. It should pull:
- Open others_commitments from any attendee on this event
- Recent emails with any attendee (last 2 weeks)
- Open tasks linked to the relevant project
- Recent decisions and risks on the project
- What Ryan committed to last time he met with these people

This is one of the highest-value features if working correctly — it's the thing that lets Ryan walk in prepared without doing any manual research. Its actual functionality needs to be audited carefully.

---

### THE CHAT SYSTEM

`ChatPage.jsx` (full page) and `ChatWidget.jsx` (floating, available on all pages). Backed by `chat.js` and `chat-handler.js`. Should be grounded in Ryan's actual data — able to answer questions like "what are the top risks on Pacific Fusion right now?" or "what did Chris Tinney commit to last week?" If it's just a generic LLM with no data access, it's a dead feature. Audit what context it actually receives.

---

### THE CAPTURE SYSTEM

`CaptureButton.jsx` and `CaptureModal.jsx` — a quick capture feature. Could be voice memos, text notes, or both. Whether captures flow downstream into tasks, knowledge, or projects is unknown. Audit whether this is wired to anything or is a UI dead end.

---

### KNOWN ISSUES GOING INTO THIS AUDIT (do not re-discover, just verify and build on)
1. `pending_decisions` table — extracted from every meeting, never written to the DB. DecisionsPage likely renders empty.
2. Ryan's tasks from 65 historical meetings — zero. `ryan_action_items` wasn't in the prompt when backfill ran. No path to recover without re-running AI.
3. All backfill meeting records have `start_time = null` and `otter_id LIKE 'plaud_txt_%'`. Live pipeline meetings (from Gmail) would have `otter_id LIKE 'plaud_%'` — zero of these existed as of the last audit.
4. `committed_by_name` is the correct column in `others_commitments`. `person_name` does not exist in the schema — was being inserted silently dropped by Supabase.
5. Summary format split: old meetings = paragraph form in DB; new meetings going forward = ## heading + bullets from updated prompt. MeetingDetail.jsx handles both.
6. Project JSONB arrays are capped (50/30 items). Oldest items silently dropped with no UI indication.
7. `findProjectByKeywords()` fetches all active projects from DB on every call — not cached. Called hundreds of times per nightly run.
8. Two meeting-notes route files exist: `meeting-notes.js` and `meeting_notes.js` — one may be dead.

**Ryan's explicit goals** (stated throughout development):
1. Surface Ryan's own action items from every meeting AND every email thread automatically
2. Track what others committed to — in meetings AND in writing (emails) — as a unified accountability layer
3. Aggregate project-level intelligence: decisions made, risks, scope signals, financial signals — from BOTH meetings and emails
4. Pre-meeting context: what's open, what was last discussed (email or meeting), who owes what
5. No surprises — surface risk before it becomes a problem, whether it came up in a call or a thread
6. Relationship intelligence: know the full history with a contact — their emails, their meetings, their open commitments, their last interaction
7. Morning intelligence briefing (separate newsletter system, not this audit's focus — but it draws from this system's data)

**Ryan's insinuated goals** (read between the lines of his behavior and language):
- The north star for this system is a fully capable executive assistant that understands Ryan, his business, his language, and his relationships well enough to eventually function as a peer — not just a logger. Ryan has explicitly stated he wants to be fully present in meetings without taking notes. The system should handle everything: capture, extraction, context, follow-through.
- The "Others" accountability page is not a to-do list — it's a leverage tool. He wants to know who is blocking him before he walks into a room
- Meeting intelligence should make him look more prepared and better informed than anyone else in the room
- Project JSONB arrays (decisions_made, risk_signals, intelligence_notes) should accumulate real institutional memory, not just be logged and forgotten. Over time this is institutional knowledge that no one else has in one place.
- The system should scale without him having to manually touch it — everything that can be automated should be automated
- He thinks like a GC owner-side integrator: he separates facts from assumptions from judgment, and he hates hidden risk. The system should reflect that.
- The long-term vision is a system that knows enough about Ryan's business context — projects, people, language, risks — that it could draft a response to an email, prepare a meeting brief, or flag a risk before Ryan even asks. Not a search tool. A peer.
- Email and meeting intelligence should be indistinguishable at the surface layer — Ryan should never have to think "was that a meeting commitment or an email commitment." It's a commitment. Full stop.

**What he explicitly does NOT want:**
- Rework (processing things twice, fixing broken dedup, re-running AI)
- False precision (tasks with wrong attribution, commitments for "Unknown")
- A system that looks busy but isn't actually useful
- Things that worked once but break silently

---

## YOUR JOB

Read every file listed below. Do not write or modify anything. Your output is a
structured audit delivered as if you were a senior engineer and product strategist
handing off a full assessment to the developer who built this system. The developer
(Claude) needs to be able to pick this up and execute immediately.

Be brutal. Don't soften findings. If something is architecturally wrong, say so.
If a feature exists in the UI but has no data behind it, call it out. If the AI
prompt produces garbage for a specific case, say so. If a pipeline step is a single
point of failure with no alerting, flag it.

---

## FILE MAP — WHAT EACH FILE IS AND DOES

Read this section before touching any code. This tells you what you're looking at.

### THE DATA FLOW (high level)
```
Gmail (Plaud transcripts + Ryan's inbox)
    ↓
plaud-pull.yml (GitHub Action, 9 AM UTC)    ← fetches [Plaud-AutoFlow] emails
    ↓ POST /api/meeting-notes
process-email-report.js (triggered separately) ← processes Ryan's inbox/sent
    ↓
Supabase storage (plaud-{date}.json)
    ↓
nightly-ai-local.js (GitHub Action, fires after email processing done)
    ↓ runs AI extraction on meetings + emails
    ↓ writes to: tasks, others_commitments, meeting_notes, projects (JSONB)
    ↓
Supabase PostgreSQL (the DB)
    ↓
API routes (Vercel serverless)
    ↓
React frontend (what Ryan sees)
```

### GITHUB ACTIONS WORKFLOWS
| File | Schedule | Purpose |
|------|----------|---------|
| `plaud-pull.yml` | 9:00 UTC daily | Hits Gmail API, finds `[Plaud-AutoFlow]` emails, downloads transcript.txt + summary.txt attachments, inserts into `meeting_notes` via POST, uploads JSON to Supabase storage |
| `nightly-ai.yml` | Polls every 10 min, 9-18 UTC | Waits for email processing + plaud to complete, then runs `nightly-ai-local.js` — the full intelligence pipeline |
| `cleanup.yml` | Sunday 3 AM UTC | Weekly DB cleanup |
| `backfill.yml` | Manual only | Used to reprocess historical data |

### CORE INTELLIGENCE ENGINE
| File | What it does |
|------|-------------|
| `api/src/jobs/nightly-ai-local.js` | The entire nightly intelligence pipeline — ~4000+ lines. Runs sequentially: loads emails, loads Plaud meetings, summarizes email threads, classifies email context, extracts intelligence from emails, enriches contacts, runs AI extraction on meeting transcripts, extracts tasks for Ryan, extracts others' commitments, cross-references sources. This is the brain of the system. |
| `api/src/services/ai.js` | All AI prompt definitions and Anthropic API calls. Key functions: `extractIntelligenceFromTranscript` (meeting intelligence — produces ryan_action_items, others_action_items, decisions_made, risk_signals, technical_facts, financial_signals, schedule_signals, scope_signals, meeting_outcome.summary), `extractIntelligence` (email intelligence), `summarizeThread` (email thread summary), contact enrichment prompts. |
| `api/src/jobs/process-email-report.js` | Processes Ryan's inbox email report — ingests raw email data, runs AI classification, writes to `emails` table, sets `processing_completed_at` in `pipeline_runs` to signal the nightly job it can fire. |
| `api/src/jobs/process-otter-report.js` | Legacy — was used when system used Otter.ai. Largely superseded by Plaud pipeline but may still have relevant logic. |

### API ROUTES (Vercel serverless functions)
| File | Endpoint | Purpose |
|------|----------|---------|
| `meeting-notes.js` | `/api/meeting-notes` | GET all meetings, GET single meeting with full intelligence (tasks, others_commitments, decisions, risks, signals), POST new meeting from plaud-pull, PATCH update meeting |
| `meeting_notes.js` | Unknown — check router | Possible duplicate or legacy version of above. Needs investigation. |
| `others-commitments.js` | `/api/others-commitments` | GET open commitments others owe Ryan (grouped by person on frontend), POST new commitment, PATCH update status |
| `tasks.js` | `/api/tasks` | Ryan's own action items — GET, POST, PATCH |
| `projects.js` | `/api/projects` | Project records with JSONB intelligence arrays (decisions_made, risk_signals, intelligence_notes, key_facts) |
| `contacts.js` | `/api/contacts` | Contact records — names, emails, companies, enriched from email signatures and meeting transcripts |
| `events.js` | `/api/events` | Calendar events synced from Outlook — used for meeting-to-calendar matching and pre-meeting context |
| `emails.js` | `/api/emails` | Email records ingested from Ryan's inbox — metadata, AI summary, body preview, thread context |
| `pending-decisions.js` | `/api/pending-decisions` | Decisions that are open/unresolved — supposed to be populated from meeting AI extraction but pipeline gap exists |
| `commitments.js` | `/api/commitments` | Ryan's OWN commitments (what HE owes others) — distinct from others_commitments |
| `pre-meeting-brief.js` | `/api/pre-meeting-brief` | Generates a context card before a meeting — pulls open items, recent emails, commitments from attendees |
| `chat.js` / `chat-handler.js` | `/api/chat` | AI chat interface — should be grounded in Ryan's data (meetings, tasks, projects) but quality unknown |
| `pipeline.js` | `/api/pipeline/status`, `/api/pipeline/complete-step` | Tracks daily pipeline run state — which steps have completed, used by nightly-ai.yml to know when to fire |
| `unlinked-intelligence.js` | `/api/unlinked-intelligence` | Intelligence signals that couldn't be matched to a project — orphaned data |
| `ai-query.js` | `/api/ai-query` | Direct AI query against accumulated data — purpose and functionality unclear |
| `ai-questions.js` | `/api/ai-questions` | AI-generated questions/prompts — purpose unclear |
| `knowledge.js` | `/api/knowledge` | Knowledge base entries — purpose and population method unclear |
| `captures.js` | `/api/captures` | Quick capture / voice memo feature — unclear if wired to downstream intelligence |
| `suggested-projects.js` | `/api/suggested-projects` | Auto-suggest project matches for unlinked items |
| `webhooks.js` | `/api/webhooks` | Inbound webhooks — purpose unclear |
| `trigger-nightly.js` | `/api/trigger-nightly` | Manual trigger for nightly job |
| `router.js` | N/A | Express router — maps all URL paths to route handlers. Check this to find dead routes and duplicate registrations. |

### FRONTEND PAGES
| File | What it shows |
|------|--------------|
| `Dashboard.jsx` | Main landing page — summary widgets: task counts, recent meetings, open commitments, etc. |
| `TasksPage.jsx` | Ryan's action items — all tasks, filterable, linked to source meetings |
| `TaskDetail.jsx` | Single task detail — context, source meeting, project |
| `OthersPage.jsx` | What others owe Ryan — grouped by person, sourced from meetings AND emails. Amber highlight for unattributed "Speaker N" rows with inline reassign. |
| `MeetingDetail.jsx` | Single meeting — summary (## heading + bullet format for new meetings, paragraph for old), tasks extracted, others' commitments, decisions, risks, technical/financial/schedule/scope signals. Has source_label fallback for older records without meeting_note_id. |
| `MeetingsPage.jsx` | Meeting list — all meetings, filterable |
| `Projects.jsx` | Project list |
| `ProjectCard.jsx` | Single project — accumulated intelligence, decisions, risks |
| `DecisionsPage.jsx` | Open/pending decisions — supposed to show pending_decisions table. May be empty if pipeline gap not fixed. |
| `CommitmentsPage.jsx` | Ryan's commitments to others (what HE owes) — distinct from OthersPage |
| `EmailsPage.jsx` | Email intelligence view — what is shown here exactly is unknown, audit it |
| `Contacts.jsx` | Contact list |
| `ContactDetail.jsx` | Single contact — should show relationship history: emails, meetings, open commitments |
| `ContactCard.jsx` | Contact card component |
| `EventDetail.jsx` | Calendar event — pre-meeting brief, attendee context |
| `KnowledgePage.jsx` | Knowledge base — purpose and content unclear |
| `ChatPage.jsx` | Full-page AI chat |
| `ChatWidget.jsx` | Floating chat widget available on all pages |
| `CaptureButton.jsx` / `CaptureModal.jsx` | Quick capture UI — voice memo or text note |
| `App.jsx` | React router — all page routes registered here |
| `lib/api.js` | All frontend API call functions — the bridge between React and the backend |

### KEY DATABASE TABLES (what they hold)
| Table | Contents |
|-------|---------|
| `meeting_notes` | Every Plaud meeting — title, start_time, full_transcript, short_summary, action_items_raw (pre-AI), participants, source, intelligence_extracted flag, otter_id (dedup key: `plaud_{gmail_message_id}` for live pipeline, `plaud_txt_{...}` for backfill) |
| `tasks` | Ryan's action items — from meetings (meeting_note_id FK) and emails. Fields: title, urgency, due_date, status, source_type (ai_plaud/ai_otter/email), meeting_note_id, project_id, context |
| `others_commitments` | What others owe Ryan — from meetings AND emails. Fields: committed_by_name, committed_by_email, title, status (open/closed/dismissed), urgency, due_date, source_type, source_label, meeting_note_id, project_id, context |
| `projects` | Active projects — name, keywords (used for matching), JSONB arrays: intelligence_notes (technical/financial/schedule/scope signals), decisions_made, risk_signals, key_facts. Arrays capped at 30-50 items (oldest dropped silently). |
| `emails` | Ryan's inbox/sent emails — from_name, from_address, thread_subject, body_preview, ai_summary, received_at, waiting_on flag |
| `contacts` | People Ryan interacts with — name, email, company, role, enriched from signatures |
| `events` | Outlook calendar events — title, start_time, attendees (mixed: emails and names) |
| `pending_decisions` | Open decisions awaiting resolution — supposed to be populated from meeting AI extraction. Pipeline gap: nothing currently writes here. |
| `pipeline_runs` | Daily pipeline state — timestamps for each step completing (email pull, plaud pull, AI completion) |

### SCRIPTS (one-off and utility)
| File | Purpose |
|------|---------|
| `scripts/backfill-meeting-intelligence.js` | Re-runs AI extraction on historical meetings (intelligence_extracted=false). Used once to process 65 meetings. |
| `scripts/backfill-meeting-tasks.js` | Extracts tasks from already-extracted meeting intelligence without re-running AI |
| `scripts/backfill-plaud-meetings.js` | Imports Plaud meeting data from Supabase storage into meeting_notes |
| `scripts/import-plaud-txt.js` | One-time import of local .txt transcript files — created all `plaud_txt_` prefixed records |
| `scripts/process-archive-sweep.js` | Batch processes archived emails/meetings |
| `scripts/process-contact-sweep.js` | Batch contact enrichment sweep |

### KNOWN STATE GOING INTO THIS AUDIT
- All backfill meeting records have `start_time = null` and `otter_id LIKE 'plaud_txt_%'`
- Live pipeline meetings (from Gmail) would have `otter_id LIKE 'plaud_%'` (without `_txt_`) — zero of these exist yet
- `committed_by_name` is the correct column in `others_commitments` — `person_name` does not exist in the schema
- `pending_decisions` table exists but nothing writes to it
- Historical meetings have 0 Ryan tasks (ryan_action_items wasn't in prompt when backfill ran)
- Summary format: old meetings = paragraph form; new meetings going forward = ## heading + bullets
- The 90-min fallback in nightly-ai.yml and plaud POST endpoint are recent fixes, may not be deployed yet

---

## FILES TO READ (in this order)

### Pipeline & Infrastructure
```
.github/workflows/plaud-pull.yml
.github/workflows/nightly-ai.yml
.github/workflows/cleanup.yml
.github/workflows/backfill.yml
api/src/routes/pipeline.js
```

### Core Intelligence Engine
```
api/src/jobs/nightly-ai-local.js       ← read fully, all ~4000+ lines
api/src/services/ai.js                 ← read fully, all AI prompts
api/src/jobs/process-email-report.js
api/src/jobs/process-otter-report.js
```

### API Routes (all of them)
```
api/src/routes/meeting-notes.js
api/src/routes/meeting_notes.js        ← note: duplicate file, check if used
api/src/routes/others-commitments.js
api/src/routes/tasks.js
api/src/routes/projects.js
api/src/routes/contacts.js
api/src/routes/events.js
api/src/routes/emails.js
api/src/routes/pending-decisions.js
api/src/routes/commitments.js
api/src/routes/pre-meeting-brief.js
api/src/routes/chat.js
api/src/routes/chat-handler.js
api/src/routes/unlinked-intelligence.js
api/src/routes/ai-query.js
api/src/routes/ai-questions.js
api/src/routes/knowledge.js
api/src/router.js
```

### Frontend Pages
```
frontend/src/App.jsx
frontend/src/lib/api.js
frontend/src/pages/Dashboard.jsx
frontend/src/pages/TasksPage.jsx
frontend/src/pages/TaskDetail.jsx
frontend/src/pages/OthersPage.jsx
frontend/src/pages/MeetingDetail.jsx
frontend/src/pages/MeetingsPage.jsx
frontend/src/pages/Projects.jsx
frontend/src/pages/ProjectCard.jsx
frontend/src/pages/DecisionsPage.jsx
frontend/src/pages/CommitmentsPage.jsx
frontend/src/pages/EmailsPage.jsx
frontend/src/pages/Contacts.jsx
frontend/src/pages/ContactDetail.jsx
frontend/src/pages/ContactCard.jsx
frontend/src/pages/EventDetail.jsx
frontend/src/pages/KnowledgePage.jsx
frontend/src/pages/ChatPage.jsx
frontend/src/components/ChatWidget.jsx
frontend/src/components/CaptureButton.jsx
frontend/src/components/CaptureModal.jsx
```

### Scripts
```
scripts/backfill-meeting-intelligence.js
scripts/backfill-meeting-tasks.js
scripts/backfill-plaud-meetings.js
scripts/import-plaud-txt.js
scripts/process-archive-sweep.js
scripts/process-contact-sweep.js
```

### Email Intelligence (read these with extra attention — this is the second
### half of the system and was underweighted in prior reviews)
```
api/src/jobs/process-email-report.js   ← the email processing pipeline
api/src/routes/emails.js               ← email API route
api/src/routes/commitments.js          ← Ryan's own commitments (from sent items)
frontend/src/pages/EmailsPage.jsx      ← what Ryan sees
```

**While reading these, specifically look for:**
- How email intelligence (AI-extracted) maps to the same DB tables as meeting intelligence
- Where `source_type` is used to distinguish email-sourced vs meeting-sourced records
- The `waiting_on` field / concept — how it's extracted, stored, and surfaced
- Whether email-extracted `others_commitments` and meeting-extracted ones are handled identically downstream
- How email threads provide context to meeting intelligence (and vice versa) in the nightly job
- The contact enrichment pipeline from email signatures

---

## HOW TO CONDUCT THIS AUDIT

This is not a documentation exercise. You are not tracing pipelines to understand
how they work. You are testing specific hypotheses about what is broken, incomplete,
or architecturally wrong. Every section below gives you a hypothesis and tells you
exactly how to verify it. Some require reading code. Most require running SQL queries
against the actual Supabase database. Some require both.

**Before you start:** Get the actual DB state. Run these queries and keep the results
visible for the entire audit — they are your ground truth:

```sql
-- What meetings actually exist, and which pipeline created them?
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE otter_id LIKE 'plaud_txt_%') AS backfill_import,
  COUNT(*) FILTER (WHERE otter_id LIKE 'plaud_%' AND otter_id NOT LIKE 'plaud_txt_%') AS live_pipeline,
  COUNT(*) FILTER (WHERE intelligence_extracted = true) AS ai_processed,
  COUNT(*) FILTER (WHERE intelligence_extracted = false OR intelligence_extracted IS NULL) AS unprocessed,
  COUNT(*) FILTER (WHERE start_time IS NULL) AS no_start_time,
  COUNT(*) FILTER (WHERE full_transcript IS NULL OR full_transcript = '') AS no_transcript
FROM meeting_notes;

-- What's actually in tasks?
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE source_type = 'ai_plaud') AS from_meetings,
  COUNT(*) FILTER (WHERE source_type LIKE '%email%') AS from_email,
  COUNT(*) FILTER (WHERE meeting_note_id IS NOT NULL) AS linked_to_meeting,
  COUNT(*) FILTER (WHERE meeting_note_id IS NULL) AS orphaned,
  COUNT(*) FILTER (WHERE project_id IS NOT NULL) AS linked_to_project,
  COUNT(*) FILTER (WHERE status = 'active' OR status = 'open') AS open_count
FROM tasks;

-- What's in others_commitments?
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE source_type LIKE '%plaud%' OR source_type LIKE '%meeting%') AS from_meetings,
  COUNT(*) FILTER (WHERE source_type LIKE '%email%') AS from_email,
  COUNT(*) FILTER (WHERE committed_by_name ILIKE 'speaker%') AS speaker_n_rows,
  COUNT(*) FILTER (WHERE meeting_note_id IS NOT NULL) AS linked_to_meeting,
  COUNT(*) FILTER (WHERE status = 'open') AS open_count,
  COUNT(DISTINCT committed_by_name) AS distinct_people
FROM others_commitments;

-- Contact coverage
SELECT
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (WHERE email IS NOT NULL) AS have_email,
  COUNT(*) FILTER (WHERE company IS NOT NULL) AS have_company,
  COUNT(*) FILTER (WHERE title IS NOT NULL OR role IS NOT NULL) AS have_title
FROM contacts;

-- Pipeline run health
SELECT run_date, status, email_pull_completed_at, processing_completed_at,
       plaud_pull_completed_at, ai_completed_at
FROM pipeline_runs
ORDER BY run_date DESC
LIMIT 14;

-- Projects with intelligence
SELECT name, 
  jsonb_array_length(COALESCE(intelligence_notes, '[]'::jsonb)) AS intel_count,
  jsonb_array_length(COALESCE(decisions_made, '[]'::jsonb)) AS decisions,
  jsonb_array_length(COALESCE(risk_signals, '[]'::jsonb)) AS risks
FROM projects
ORDER BY intel_count DESC;

-- pending_decisions table - is anything there?
SELECT COUNT(*) FROM pending_decisions;
```

Save every result. These numbers will anchor every finding below.

---

## PRESSURE TESTS — HYPOTHESIS-DRIVEN

Each test has a hypothesis, verification steps, and stakes. Your job is to confirm
or refute the hypothesis with actual evidence from the code and DB. Not description
— evidence.

Mark severity: **P0** (broken now), **P1** (will break predictably), **P2** (fragile),
**Suggestion** (better approach exists)

---

### TEST BLOCK 1: THE LIVE PIPELINE HAS NEVER ACTUALLY WORKED

**Hypothesis:** Every meeting in the DB was manually imported. The live Plaud → Gmail
→ GitHub Actions → API pipeline has never successfully delivered a single meeting
to Supabase. The three reasons are: (1) the POST handler in `meeting-notes.js`
didn't exist until recently, (2) the plaud-pull.yml was querying a table
named `pipeline_status` that doesn't exist (it's `pipeline_runs`), and (3) the
cron timing was wrong. All three were fixed in commit 9aedccb. But even with the fix,
the pipeline hasn't run successfully yet.

**Verify with SQL:**
```sql
SELECT otter_id, title, created_at FROM meeting_notes
WHERE otter_id NOT LIKE 'plaud_txt_%'
ORDER BY created_at DESC LIMIT 10;
```
If this returns 0 rows: hypothesis confirmed. The live pipeline has never worked.

**Then verify the fix is sound:**
Read `.github/workflows/plaud-pull.yml`. Confirm:
- Cron is now `0 9 * * *` (9:00 UTC, not 11:15)
- The table name in the lookback query is `pipeline_runs` (not `pipeline_status`)
- The POST body matches what `meeting-notes.js` expects (`external_id`, not some other field)
- The `x-trigger-secret` header is included in the POST request

Read `api/src/routes/meeting-notes.js` POST handler. Confirm:
- It exists (not 405)
- `otter_id = 'plaud_' + external_id` — will this dedup correctly with the `plaud_txt_` backfill records?
- `start_time = meeting_date + 'T12:00:00Z'` — is this the right default?

**Stakes:** Until this pipeline runs successfully, Ryan has zero automated meeting intake.
Everything he records today is sitting in Gmail unseen. If this has never worked, 
the system has been blind to new meetings since launch.

---

### TEST BLOCK 2: RYAN HAS ZERO AI-EXTRACTED TASKS FROM 65 MEETINGS

**Hypothesis:** When the backfill ran on 65 historical meetings, the `ryan_action_items`
field was not in the `extractIntelligenceFromTranscript` prompt. Every meeting has
`intelligence_extracted = true` (so it won't re-process), but the `tasks` table has
near-zero records linked to meeting sources.

**Verify with SQL:**
```sql
SELECT COUNT(*) FROM tasks WHERE source_type = 'ai_plaud' OR meeting_note_id IS NOT NULL;
```
If this is near zero: hypothesis confirmed.

**Then identify the recovery path:**
Read `api/src/services/ai.js` — find `extractIntelligenceFromTranscript`. Is `ryan_action_items`
in the response schema NOW? (It should have been added.) If yes, the prompt is fixed but
historical meetings are frozen because `intelligence_extracted = true`.

Read `scripts/backfill-meeting-tasks.js`. What exactly does this script do?
- Does it re-run AI on meetings? Or does it read EXISTING AI output and extract tasks from it?
- If it reads existing output: the older meetings' AI output won't have `ryan_action_items` 
  in it because the prompt didn't ask for it. So this script would produce nothing.
- What's the actual path to get Ryan's historical tasks? Is there one that doesn't
  require re-running $X in API calls on 65 meetings?

**Stakes:** Ryan's task list is essentially empty for everything before the fix.
He has no system memory of what he agreed to do. The "task list" feature is
functionally useless for historical context.

---

### TEST BLOCK 3: THE SPEAKER N ATTRIBUTION PROBLEM IS STRUCTURAL, NOT COSMETIC

**Hypothesis:** The `committed_by_name = 'Speaker N -'` issue isn't just bad data in
old records — it's a structural gap that will reproduce on every future meeting
that doesn't match a calendar event. The pipeline has two paths: (1) meeting matched
to calendar event → attendees resolved to real names → speakers can be identified;
(2) no calendar match → `participants = []` → all speakers stay as "Speaker N". 
Since the Plaud-to-calendar match algorithm requires keyword overlap + AI verification,
many real meetings will never match, meaning the Speaker N problem will keep happening.

**Verify by reading:**
In `nightly-ai-local.js`, find the Plaud-to-calendar matching logic (Step 2.4 area).
What is the keyword overlap threshold? (Suspected: 2+ overlapping words between
meeting title and event title.) What happens with a meeting titled "Project Update Call"
and a calendar event titled "Pacific Fusion Weekly"? These are the same meeting in
reality. Does the keyword matcher catch it?

**Verify with SQL:**
```sql
SELECT COUNT(*) FROM meeting_notes WHERE event_id IS NOT NULL;  -- how many matched?
SELECT COUNT(*) FROM meeting_notes WHERE event_id IS NULL;      -- how many didn't match?
SELECT COUNT(*) FROM others_commitments WHERE committed_by_name ILIKE 'speaker%';
```

**Then test the fallback:**
If a meeting has `event_id IS NULL`, what participants does `extractIntelligenceFromTranscript`
receive? Read the exact code that assembles the context passed to the AI. If `participants`
is empty `[]`, the AI has NO NAME CONTEXT. The prompt must use "Speaker N" attribution
because it has nothing else. Every commitment becomes "Speaker N committed to..."

**Second-order effect:**
The `isSpeaker` regex in `OthersPage.jsx` is: `/^speaker\s*\d+\s*[-–]?\s*$/i`
This highlights these rows in amber and shows an inline reassign button. But Ryan
has to MANUALLY reassign every Speaker N commitment. For 65 unmatched meetings,
how many Speaker N commitments likely exist? 

```sql
SELECT committed_by_name, COUNT(*) as cnt 
FROM others_commitments 
GROUP BY committed_by_name 
ORDER BY cnt DESC LIMIT 20;
```

**Stakes:** Every unmatched meeting produces Speaker N commitments that Ryan must
manually triage. At 3-5 commitments per meeting and 65 unmatched meetings, that's
150-300 manually unresolvable accountability items. The "others" page is polluted
with noise.

---

### TEST BLOCK 4: THE DEDUP SYSTEM CREATES MORE PROBLEMS THAN IT SOLVES

**Hypothesis:** The two-level dedup (ILIKE title match + semantic Haiku check) has
three failure modes that are worse than no dedup: (1) false merges — two different
people making similar commitments get collapsed into one; (2) missed duplicates —
the same person makes the same commitment twice because they phrased it differently;
(3) API cost — `semanticMatchCheck` calls Haiku for every new item against every
existing open item in the same project. If Pacific Fusion has 30 open commitments
and a meeting produces 5 new ones, that's 150 Haiku calls just for that one meeting.

**Verify by reading `nightly-ai-local.js`:**
Find `semanticMatchCheck`. What is the outer loop? Is it:
  - For each new item: compare against ALL existing open items in the project?
  - Or compare against only items from the same person?
  - What's the actual Haiku API call count per nightly run?

**Verify by reading `ai.js`:**
Find the `semanticMatchCheck` prompt. Does it return a confidence score?
What does the system do at exactly 75%? Accept or reject the merge?

**Verify with SQL:**
```sql
-- Are there obvious duplicate commitments that dedup should have caught but didn't?
SELECT committed_by_name, title, COUNT(*) as dupes
FROM others_commitments
WHERE status = 'open'
GROUP BY committed_by_name, LEFT(title, 60)
HAVING COUNT(*) > 1
ORDER BY dupes DESC;

-- Are there commitments that look merged (same title, different people)?
SELECT title, COUNT(DISTINCT committed_by_name) as people_count
FROM others_commitments
WHERE status = 'open'
GROUP BY LEFT(title, 60)
HAVING COUNT(DISTINCT committed_by_name) > 1;
```

**The cost math:**
If there are N open commitments and M new commitments per night, dedup runs N×M
Haiku calls. Haiku input/output costs ~$0.00025 per call (estimate). What's the
actual nightly cost of dedup alone? At what scale does this become prohibitive?
Estimate based on current row counts.

**Stakes:** Dedup is the most expensive step per API call and the most likely to
create subtle data quality issues (false merges lose real accountability items).
If it's not working correctly, Ryan could be missing genuine commitments that were
silently merged away.

---

### TEST BLOCK 5: PROJECT MATCHING IS A BLACK BOX THAT FAILS SILENTLY

**Hypothesis:** `findProjectByKeywords` uses a simple keyword overlap check
(2+ overlapping words between project keywords and meeting/email title). When it
fails to match, the intelligence from that meeting is written to NOWHERE. There is
no `unlinked_intelligence` table that catches failures, no UI indicator that a meeting
contributed nothing to any project, and no way for Ryan to know this happened.
This means every meeting that doesn't have a keyword match quietly disappears from
project intelligence.

**Verify by reading `nightly-ai-local.js`:**
Find `findProjectByKeywords`. What is the exact matching algorithm?
What are the stop words (if any)? If a meeting is titled "Tuesday Check-In Call"
and the project keywords are `["Pacific Fusion", "fusion", "mfg"]` — would that match?
What about "PF Update" with keywords `["Pacific", "Pacific Fusion", "PF"]`?

**Verify with SQL:**
```sql
-- Which meetings have no project_id? (These are orphaned — their intelligence went nowhere)
SELECT COUNT(*) FROM meeting_notes WHERE project_id IS NULL;
SELECT COUNT(*) FROM tasks WHERE project_id IS NULL;
SELECT COUNT(*) FROM others_commitments WHERE project_id IS NULL;

-- What's in the unlinked_intelligence table (if it exists)?
SELECT COUNT(*) FROM unlinked_intelligence;
```

**Then check the JSONB cap:**
```sql
-- For the most active projects, are we hitting the array cap?
SELECT name,
  jsonb_array_length(COALESCE(intelligence_notes, '[]')) as intel,
  jsonb_array_length(COALESCE(decisions_made, '[]')) as decisions
FROM projects
WHERE jsonb_array_length(COALESCE(intelligence_notes, '[]')) > 40;
```

If any project has 50 intelligence notes (the cap), older intelligence is being silently
dropped with each new meeting. Read the `.slice(-50)` logic in `nightly-ai-local.js`.
Is there any log, any UI warning, any archival of the dropped items? Or does project
memory just silently shrink?

**Stakes:** Ryan may have projects where 40-60% of the meeting intelligence never
landed anywhere. The project cards might show 30 signals from a project with 80
meetings — and there's no indication the other 50 meetings contributed nothing.

---

### TEST BLOCK 6: THE PRE-MEETING BRIEF IS ASPIRATIONAL, NOT FUNCTIONAL

**Hypothesis:** `pre-meeting-brief.js` and `EventDetail.jsx` are the highest-value
features in the system if they work. They're the thing that lets Ryan walk into a room
prepared. But they depend on: (1) the calendar event being in the `events` table;
(2) the attendees on the event being resolved to contacts in the `contacts` table;
(3) those contacts having `others_commitments` linked to them; (4) emails with those
contacts being in the `emails` table. If any of these links is missing, the brief
renders empty. Given the known gaps (no live pipeline, no contact_id on commitments,
calendar attendees in mixed format), the brief likely shows nothing useful.

**Verify by reading `api/src/routes/pre-meeting-brief.js`:**
What queries does it run? Specifically:
- How does it resolve attendees? (email address match? name match? both?)
- If an attendee is `TinneyC@claycorp.com` in the calendar event, does it look up
  `contacts` by email? Or does it try to match by name?
- What happens when 0 contacts match? Does it return empty arrays, or an error?

**Verify with SQL:**
```sql
-- How many events do we have?
SELECT COUNT(*) FROM events;

-- How many have attendees that match contacts?
SELECT 
  e.id,
  e.title,
  e.attendees
FROM events
LIMIT 5;
-- Read the attendees format — are they email addresses, display names, or both?

-- For the most recent event, manually check if its attendees appear in contacts
SELECT email, name FROM contacts WHERE email ILIKE '%tinney%' OR name ILIKE '%tinney%';
```

**The critical question:**
Open `EventDetail.jsx`. When Ryan clicks a calendar event to see his pre-meeting brief:
- Does the page exist and render?
- Does it call `pre-meeting-brief.js`?
- What does `pre-meeting-brief.js` actually return for a real event?

**Simulate it manually:**
Pick the most recent event in the `events` table. Manually run the queries that
`pre-meeting-brief.js` would run for that event. Does it return any commitments?
Any emails? Any project context? Or empty arrays?

**Stakes:** This is the feature Ryan would use every single day before a meeting.
If it returns empty results, it's not a minor bug — it's the absence of the system's
most valuable output. He would have to manually research attendee history the way
he always did. The system provides zero leverage.

---

### TEST BLOCK 7: THE EMAIL PIPELINE'S CROSS-INTELLIGENCE WITH MEETINGS IS THEORETICAL

**Hypothesis:** The nightly job is supposed to cross-reference email threads with
meetings — passing relevant emails as context to meeting AI extraction, and vice versa.
In practice, this cross-reference requires: (a) email and meeting both mentioning
the same project; (b) project keywords matching in both; (c) the nightly job running
email steps BEFORE meeting steps. The claim is "email intelligence enriches meeting
extraction." Test whether this actually happens.

**Verify by reading `nightly-ai-local.js` step order:**
What is the EXACT sequence of steps? Does email processing (Steps 3-3.7) run before
meeting AI extraction? Or after?

If email runs first: the meeting AI extraction COULD receive email context.
If meetings run first: they have no email context. Meeting intelligence was extracted
cold with no knowledge of what was in Ryan's inbox about that same project.

**Find the context assembly for `extractIntelligenceFromTranscript`:**
Before the AI call for a meeting, what data is assembled? Find the code that builds
the `context` object. Does it include:
- Related email threads for this project? (If so, how are they selected — keyword overlap?)
- Recent email subjects mentioning the same people in this meeting?
- Prior meeting summaries from the same project?
Or is the extraction completely stateless — each meeting processed in isolation?

**The 48-hour email window problem:**
```sql
-- When does email processing run? Check the pipeline_runs table:
SELECT run_date, processing_completed_at, ai_completed_at FROM pipeline_runs
ORDER BY run_date DESC LIMIT 7;
```
`process-email-report.js` likely only ingests emails from the last 48 hours.
If Ryan had an important email thread 3 days ago that set context for today's meeting,
is that thread in the `emails` table? Or was it outside the 48-hour window and therefore
never ingested?

**Stakes:** If meeting extraction is stateless (no email context injected), then the
"unified intelligence" story is wrong. Email intelligence and meeting intelligence are
two parallel, non-communicating pipelines that happen to write to the same tables.
The cross-referencing that would make this genuinely useful — "in this meeting someone
committed to sending drawings, and the email thread from Monday shows they already
said that twice before" — doesn't exist.

---

### TEST BLOCK 8: THE CONTACT SYSTEM IS INSUFFICIENTLY RICH TO BE USEFUL

**Hypothesis:** The contacts table has records, but they're thin — created from email
addresses with AI-attempted enrichment. The real test is: for the 10 people who appear
most frequently in `others_commitments`, can Ryan open their contact page and get
a useful relationship picture? Or does he see a name, an email, maybe a company,
and empty arrays?

**Verify with SQL:**
```sql
-- Who are the top 10 people with open commitments?
SELECT committed_by_name, committed_by_email, COUNT(*) as open_count
FROM others_commitments
WHERE status = 'open'
GROUP BY committed_by_name, committed_by_email
ORDER BY open_count DESC LIMIT 10;

-- For each of those people, do they have a contact record?
-- Run for each email from the above query:
SELECT id, name, email, company, title, role 
FROM contacts 
WHERE email = '[email from above]' OR name ILIKE '%[name from above]%';

-- How many emails do we have from/to these contacts?
SELECT from_address, COUNT(*) as email_count
FROM emails
GROUP BY from_address
ORDER BY email_count DESC LIMIT 20;
```

**Verify by reading `ContactDetail.jsx`:**
What queries does it run? Does it:
- Pull `others_commitments` where `committed_by_email = contact.email`?
  Or where `committed_by_name ILIKE contact.name`? (These will give different results
  because name matching is fuzzy and email matching might miss Speaker N rows that
  were never enriched with an email)
- Pull `meeting_notes` where this contact was an attendee?
  (This requires the contact to be in `participants` array of meeting_notes, which
  only happens for meetings with a calendar match — the backfill meetings have `participants = []`)
- Pull `emails` where this contact appears as sender or recipient?

**The name dedup problem:**
If "Chris Tinney" appears as "Christopher Tinney" in one email, "Chris T." in a
meeting transcript, and "TinneyC@claycorp.com" in a calendar attendee list —
how many contact records exist for him? Does the system merge them? Or does Ryan
see 3 separate "people" with fragments of the same history?

```sql
SELECT id, name, email FROM contacts WHERE name ILIKE '%tinney%' OR email ILIKE '%tinney%';
```

**Stakes:** If a contact record is thin and the detail page shows empty arrays,
Ryan has no relationship intelligence. He can't see "last talked to Chris on May 15
about structural drawings; he has 3 open commitments from 4 meetings; the last email
thread with him was 2 weeks ago about VE options." That context is what changes how
he walks into a meeting. If the contact page is empty, this entire layer is dead.

---

### TEST BLOCK 9: THE SPLIT-STATE DATABASE IS A MAINTENANCE PROBLEM

**Hypothesis:** There are now two irreconcilable classes of data in the same tables:
(1) Backfill meetings — `otter_id LIKE 'plaud_txt_%'`, `start_time NULL`, no tasks,
no calendar match, paragraph-form summaries, `participants = []`. These have been
AI-processed with the OLD prompt. (2) Future live pipeline meetings — will have
`otter_id LIKE 'plaud_%'`, real `start_time`, AI-extracted tasks, possible calendar
match. These will use the NEW prompt.

These two classes cannot be treated the same by either the nightly job or the frontend.
The frontend must handle both summary formats. The nightly job must not try to
reprocess the backfill meetings. Task queries that filter by `meeting_note_id IS NOT NULL`
will miss all historical context. The "tasks from meetings" list will only show
meetings from today forward — making the historical task gap permanent.

**Verify:**
Read `MeetingDetail.jsx`. Find the summary renderer. Does it detect paragraph vs `##`
format and render differently? What's the detection logic?

Read `nightly-ai-local.js`. What is the query that selects meetings for AI processing?
Does it correctly use `intelligence_extracted = false` to skip backfill meetings?
Or could a bug cause it to re-process them?

```sql
-- Verify the split
SELECT 
  CASE WHEN otter_id LIKE 'plaud_txt_%' THEN 'backfill' ELSE 'live' END as source,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE intelligence_extracted = true) as processed,
  AVG(jsonb_array_length(COALESCE(action_items_raw::jsonb, '[]'))) as avg_action_items
FROM meeting_notes
GROUP BY 1;
```

**The permanent task gap:**
The only way Ryan gets historical tasks is to: (a) re-run AI on 65 meetings (expensive,
hours of compute), or (b) build `backfill-meeting-tasks.js` to extract tasks from
existing AI output — but if the old AI output didn't include `ryan_action_items`,
there's nothing to extract. This is a one-way door. Audit whether there's a third option.

**Read the existing AI output:**
```sql
-- Does the old AI output actually contain ryan_action_items data?
SELECT id, title,
  short_summary,
  (short_summary ILIKE '%ryan%' OR short_summary ILIKE '%action%') as mentions_actions
FROM meeting_notes
WHERE intelligence_extracted = true
LIMIT 5;
```

If `short_summary` (which stores meeting_outcome.summary) is where output lived,
and the old format stored `ryan_action_items` as part of the structured extraction
(not just the summary), check whether that data still exists somewhere in the DB
that could be parsed.

**Stakes:** Ryan has 65 meetings of institutional memory. Zero of it feeds his task list.
This gap gets worse over time because future meetings build on live data while the
history is frozen. Six months from now, searching for "what did I agree to on Pacific
Fusion in Q1" will return nothing.

---

### TEST BLOCK 10: THE SYSTEM CANNOT SYNTHESIZE — IT CAN ONLY LOG

**Hypothesis:** Every feature that requires cross-meeting or cross-email synthesis
— "what are the top risks across all projects," "has this person historically followed
through on commitments," "what was the last decision made about GMP on Pacific Fusion"
— is either unbuilt or routes through a chat interface that may not have the actual
data to answer it.

**Verify by reading `api/src/routes/chat.js` (or `chat-handler.js`):**
What context does the chat receive when Ryan asks a question?
- Does it query the DB for relevant context before calling the LLM?
- If yes: what queries? What tables? What fields?
- Is there a RAG (retrieval-augmented generation) step that searches for relevant
  meetings/emails/commitments before generating a response?
- Or does it just pass Ryan's question to Claude with no grounding?

**Test the actual capability:**
If you have DB access, manually assemble what an ideal answer to this question would
require: "What are the three biggest open risks on Pacific Fusion right now?"
You'd need: `risk_signals` from the `projects` table for Pacific Fusion, plus
any recent meeting commitments related to risks, plus any email threads flagged as risks.

Does the chat system actually do this? Or does it either: (a) hallucinate an answer
based on training data, or (b) say "I don't have access to that information"?

**Check whether proactive surfacing exists anywhere:**
```sql
-- Are there any "overdue" commitments the system could be flagging?
SELECT committed_by_name, title, due_date, status, (NOW() - due_date::timestamp)::text as overdue_by
FROM others_commitments
WHERE status = 'open' AND due_date IS NOT NULL AND due_date < NOW()::date::text
ORDER BY due_date ASC LIMIT 20;
```

Does any part of the system look at this and notify Ryan? Is there a `cleanup.yml` or
a daily briefing step that surfaces overdue items? Or does "overdue" have no meaning
in the system — items just sit open until Ryan manually closes them?

**Stakes:** The difference between a logging system and an executive assistant is synthesis
and proactivity. If the system only stores data but never synthesizes it, never surfaces
patterns, never proactively flags issues — Ryan still has to do all the cognitive work
himself. He just has a better-organized filing cabinet. That's not the north star.

---

### TEST BLOCK 11: THE "RYAN'S COMMITMENTS" LOOP IS BROKEN

**Hypothesis:** The system tracks what OTHERS owe Ryan (`others_commitments` table,
`OthersPage.jsx`). But Ryan also makes commitments in meetings and emails — "I'll get
you the estimates by Friday," "I'll loop in our structural engineer." These should
surface on a `CommitmentsPage.jsx` backed by a `commitments` table or similar.
The hypothesis: either (a) this table doesn't exist, or (b) it exists but the AI
prompt doesn't extract Ryan's own commitments from emails (only from meetings where
his voice is identified), or (c) the extraction happens but the page is dead.

**Verify:**
```sql
-- Does a commitments table exist for Ryan's own commitments?
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'commitments';
-- If this returns 0 rows: the table doesn't exist.
```

Read `api/src/routes/commitments.js`. What does it serve? What table does it read?

Read `frontend/src/pages/CommitmentsPage.jsx`. What endpoint does it call? What
does it render?

In `ai.js`, find `extractIntelligenceFromTranscript`. Is there a `ryan_commitments`
or `ryan_verbal_commitments` array in the output schema? Or does the prompt only
extract `ryan_action_items` (things Ryan has to do) without capturing the verbal
commitment framing (things Ryan PROMISED he'd do)?

The distinction matters: "Ryan — can you review the specs?" → Ryan says "yes" →
that's an action item. But "Ryan — we need that by Friday" → Ryan says "I'll have
it to you by Thursday actually" → that's a commitment with specific accountability.
Does the AI distinguish these? Is that distinction surfaced anywhere?

**Stakes:** If Ryan can't see his own commitment record, he has to maintain that
mentally. In high-stakes owner relationships, broken commitments (even small ones)
damage credibility. A system that tracks what others owe Ryan but not what Ryan owes
others is half a tool — and could actually make things worse by creating a false
sense of complete accountability visibility.

---

### TEST BLOCK 12: THE SYSTEM HEALTH INDICATOR FOR RYAN IS NONEXISTENT

**Hypothesis:** If the nightly pipeline fails — the AI job crashes at step 3.5,
`plaud-pull.yml` silently finds no emails, `process-email-report.js` runs but writes
nothing — Ryan has no visibility into this. The dashboard shows yesterday's data
as if it's today's. There's no "last processed at" indicator, no "pipeline status"
widget, no notification when the system goes dark.

**Verify:**
Read `Dashboard.jsx`. Is there any pipeline status indicator? Last sync time?
"No new data in X days" warning?

Check GitHub Actions: does `nightly-ai.yml` have a notification step on failure?
(The file was read earlier — it sends an email to `ryanhankins.personalos@gmail.com`
on failure via Resend. But does this email actually reach Ryan? His primary inbox is
hankinsr@claycorp.com. He may never see alerts at the personal Gmail address.)

```sql
-- When did the system last successfully complete a nightly run?
SELECT run_date, ai_completed_at FROM pipeline_runs
WHERE ai_completed_at IS NOT NULL
ORDER BY run_date DESC LIMIT 3;
```

If the last `ai_completed_at` is more than 2 days ago: the system has been dark
and Ryan doesn't know. Everything he's looking at in the UI is stale.

**Stakes:** A system Ryan can't trust is a system Ryan will stop using.
If he checks the Others page and commitments from yesterday's meeting aren't there,
he'll go back to his old system (or no system). Silent failures are the system's
biggest long-term threat to adoption.

---

## SCENARIOS — SIMULATE THESE EXACTLY

These are real-world tests using Ryan's actual use case. Don't trace code paths in
the abstract — walk through what actually happens step by step and state what Ryan
would see in the UI at the end.

**SCENARIO A: Ryan records a Pacific Fusion meeting today**
Ryan records a 45-min Plaud meeting titled "Pacific Fusion — Structural Coordination"
at 2pm today. It's on his Outlook calendar. Three attendees: himself, the structural
engineer, and the owner's PM. The structural engineer commits to sending revised
drawings by end of week. Ryan commits to getting them a revised GMP by the following
Monday. A risk is discussed: the long-lead steel delivery is now showing 14-week lead
time instead of 10.

Walk through:
1. When does plaud-pull.yml fire? (Check current cron)
2. When does the nightly AI run? (Check nightly-ai.yml cron and trigger conditions)
3. Does the Plaud meeting title match the calendar event? (Test `findProjectByKeywords`
   or the meeting-to-calendar matching logic with these exact titles)
4. If matched: Ryan gets real attendee names. If not: Speaker N.
5. Does "send revised drawings by end of week" → `others_commitments` row with
   committed_by_name = "John Smith" (structural engineer)? Or "Speaker 1 -"?
6. Does "get them a revised GMP by Monday" → Ryan's own commitments somewhere?
7. Does "14-week lead time vs 10" → `risk_signals` on Pacific Fusion project?
8. By 8am the next morning, what does Ryan see when he opens:
   - The Others page? (Does the structural engineer's commitment appear?)
   - The Pacific Fusion project card? (Is the steel lead time risk there?)
   - The Tasks page? (Does Ryan's GMP task appear?)
   - The Meeting detail for this meeting? (Does it show anything useful?)

Be specific about what actually happens vs what SHOULD happen.

**SCENARIO B: Ryan opens the app at 7:45 AM before a 9 AM meeting**
The 9 AM meeting is "Project Sun — Pursuit Strategy" with the BD director and a
potential owner client. Ryan has had 2 prior meetings about Project Sun and 3 email
threads. He opens `EventDetail.jsx` for the 9 AM event.

What does the pre-meeting brief actually show him?
- Does it know who the attendees are? (Calendar event attendee resolution)
- For the owner client: any open commitments from prior meetings?
- Most recent email thread with the BD director?
- Project Sun's open risks and recent decisions?
- What Ryan committed to last time he met with this owner?

Run the actual queries that `pre-meeting-brief.js` would run.
State each result. Is this brief useful? Or is it empty?

**SCENARIO C: Two weeks pass with no daily pipeline run**
The nightly AI job fails silently for 14 days (returns exit 0 but API call fails
at step 3.5). Ryan has had 12 meetings in that time.

- What does the Others page show? (Stale data with no indication it's 2 weeks old)
- Does the Dashboard show any staleness warning?
- Does Ryan get any notification?
- When the pipeline eventually runs again, does it pick up the 12 missed meetings?
  Or does it only process meetings since the last successful run?
- What is the max lookback window in plaud-pull.yml for Gmail API queries?
  (If it only looks back 7 days, anything older than that is gone forever)

---

## OUTPUT FORMAT

Deliver in exactly this structure. No exceptions. Every section must be present.

```
## EXECUTIVE SUMMARY (5 sentences max)
What is working. What is fundamentally broken. What is the gap between
Ryan's stated goal and the system's actual current capability. Be direct.

## DB STATE SNAPSHOT
The actual numbers from the ground-truth queries above. These anchor everything.
Don't skip this — it's the only way to separate "this code looks right" from
"this code runs correctly."

## CRITICAL FINDINGS (P0 — Broken Now, Data Wrong or Lost)
For each:
### P0-N: [Title]
**What is actually happening** (with file:line reference):
**Proof** (SQL result or specific code block that demonstrates the bug):
**Impact on Ryan** (what can he NOT do, or what wrong data is he seeing):
**Exact fix** (the specific change, not "refactor this" — the line to change):

## HIGH PRIORITY (P1 — Will Break Predictably)
Same format. Must include a trigger condition ("this breaks when X happens").

## MEDIUM PRIORITY (P2 — Works But Fragile or Misaligned)
Same format.

## SCENARIO RESULTS
For each of the 3 scenarios: what actually happens, step by step. End with a verdict.
  - SCENARIO A verdict: what % of the expected intelligence actually made it to the UI?
  - SCENARIO B verdict: is the pre-meeting brief useful or empty?
  - SCENARIO C verdict: what data is permanently lost after a 14-day outage?

## GOAL ALIGNMENT GAPS
These are not bugs — they are system design gaps between what was intended and
what was built. For each: the intended capability, the current reality, what it
would take to close the gap (be specific: code change, schema change, new feature).

## DEAD FEATURES (Built But Not Wired)
Pages that render empty. Routes that exist but nothing calls them. Features where
the UI exists but the data never arrives. For each: confirm it's dead, not just
underused. State the specific missing connection.

## COST ANALYSIS
Estimated nightly Anthropic API spend (meeting extraction + email + dedup + contact
enrichment). Based on actual row counts from the DB snapshot, not theoretical.
What is the monthly run rate? What is the per-month cost at 10x current scale?

## WHAT IS ACTUALLY WORKING (be honest)
Give credit where it's due. Things that are solid, reliable, and genuinely useful.

## THE NORTH STAR GAP
One paragraph. If the goal is "fully present in meetings, peer-level executive assistant" —
where is the system on a 1-10 scale today? What is the single highest-leverage thing
to build next that would move that score most? Not a bug fix — an architectural capability.

## EXECUTION ORDER (the first 5 things to fix, in priority order)
One line each. Specific enough to start work without asking any questions.
```

---

### TEST BLOCK 13: LONG-TERM COST AND STORAGE TRAJECTORY

**Hypothesis:** The system was built for current scale (65 meetings, ~2 months of email,
~5 active projects). Nobody has stress-tested what it costs and how much storage it
consumes at 12-month, 24-month, and 36-month scale. At those scales, the current
architecture may become either too expensive or too slow to be usable.

**Estimate the cost trajectory:**

Current baseline (derive from code + DB counts):
- Meeting AI extraction: how many meetings/week × which model × estimated tokens per call?
- Email extraction: how many emails/day × steps × model × token estimate?
- Semantic dedup: how many Haiku calls per night (N existing items × M new items)?
- Contact enrichment: does Step 3.7 run on all contacts every night, or only on new ones?

Ryan's expected future scale:
- 10-15 meetings per week
- 30-50 emails/day in processing scope
- 8-10 active projects

At that scale, what is the monthly Anthropic API bill?
At 12 months (500+ meetings, 10,000+ processed emails)?

**Estimate storage trajectory:**
```sql
SELECT
  COUNT(*) as meetings,
  ROUND(SUM(LENGTH(COALESCE(full_transcript, ''))) / 1024.0 / 1024.0, 2) as transcript_mb,
  ROUND(SUM(LENGTH(COALESCE(short_summary, ''))) / 1024.0 / 1024.0, 2) as summary_mb
FROM meeting_notes;

SELECT
  COUNT(*) as emails,
  ROUND(SUM(LENGTH(COALESCE(body_preview, '') || COALESCE(ai_summary, ''))) / 1024.0 / 1024.0, 2) as email_data_mb
FROM emails;
```

Project the `emails` table size at 30 emails/day × 365 days. What is the Supabase
free/paid tier storage limit? Does the system have a data retention policy for emails?
Is there any archival or pruning logic in `cleanup.yml`?

**The JSONB cap is a symptom, not a fix:**
The `.slice(-50)` cap on project intelligence arrays means the system permanently
loses data. At 10-15 meetings/week × 2 signals/meeting for one project, the 50-item
cap is hit in ~3 months. At 3 years, Ryan has 1500 meetings contributing to Pacific
Fusion, but the project card can only ever show the most recent 50. This is not
a minor UX issue — it means the system loses institutional memory on a rolling basis.
The current architecture has no path to fix this without a schema change.

---

### TEST BLOCK 14: ARCHITECTURE DECISION — KEEP, REVISE, REPLACE, OR SCRAP

This is the strategic audit. For each component below, deliver a verdict with evidence.
The verdicts must inform a decision: do we keep building on this foundation, or does
something need to be rearchitected now before the foundation calcifies?

Evaluate each on: (1) does it work today? (2) does it scale to 18-month usage?
(3) does it contribute to the north star? (4) what does it cost at scale?

**A. JSONB project intelligence arrays** (`decisions_made`, `risk_signals`, `intelligence_notes`)
- Evidence against keeping: silent data loss at cap, no history, no filtering by date,
  no way to query "what did we know about X in April?" — the oldest data is gone
- Alternative: `project_signals` table — normalized rows with `(project_id, type,
  content, source_meeting_id, source_email_id, created_at)` — full history, queryable,
  no cap. Projects endpoint aggregates them. Migration: extract existing JSONB into rows.
- **Verdict:** Keep current / Revise in place / Migrate to normalized table?
  Justify based on current query patterns and future scale.

**B. Nightly batch AI job (once-per-day, 4000-line sequential file)**
- Current latency: Ryan records a 2 PM meeting. Intelligence available at ~6 AM next day.
  That's 16 hours of latency.
- Evidence against: single point of failure, 60-min timeout risk, no partial retry,
  22-hour worst-case latency on commitments from today's meeting
- Alternative: event-driven — plaud-pull webhook triggers immediate extraction;
  email connector triggers extraction on arrival. Sub-30-minute latency on everything.
  GitHub Actions becomes just a fallback catcher, not the primary path.
- **Verdict:** Keep batch / Revise with shorter cron (every 4h?) / Rebuild event-driven?

**C. Meeting-to-calendar matching algorithm**
- Current: keyword overlap (2+ words) + Haiku content verification
- Evidence against: fails silently, causes Speaker N attribution, 100% of current
  meetings are unmatched (all `plaud_txt_` prefix, none have `event_id` set)
- Alternative: match on meeting_date + time window + participant email overlap
  (calendar event on the same day, within 30 minutes of recording start, with overlapping
  attendees). Much higher precision, no AI needed.
- **Verdict:** Fix current algorithm / Replace with date+participant matching?

**D. Contact system (auto-created from email addresses, AI signature enrichment)**
- Current problem: fragmented identity, no dedup, thin records
- Alternative: use M365 Contacts / People directory as authoritative source — Ryan
  already has a curated contact book in Outlook. Import that as the ground truth.
  Email participants are matched against it (email exact match + name fuzzy match).
  No auto-creation of thin records from email addresses.
- **Verdict:** Keep current auto-creation / Enrich existing / Replace with M365 import?

**E. Knowledge base (KnowledgePage.jsx, knowledge.js)**
- Unknown current state — auditor to determine: active, orphaned, or broken
- What it SHOULD be (if built correctly): a construction-domain knowledge layer
  injected into AI extraction prompts. If the AI knows "GMP = Guaranteed Maximum Price,
  a contract type where Clayco bears overrun risk; VE = value engineering, reducing
  scope/cost; Pacific Fusion = large industrial manufacturing facility, active project
  in [state], owner = [name], key risk: long-lead steel procurement" — then every
  extraction produces dramatically higher quality output. Without this context, the AI
  is extracting from generic construction industry language with no project-specific grounding.
- The knowledge base is the difference between a logging system and a system that
  actually understands Ryan's business.
- **Verdict:** Build out as domain context layer / Scrap and replace with per-project
  context injection in AI prompts / Keep as-is if already functional?

**F. Chat system (chat.js, ChatWidget.jsx)**
- The question: is it grounded in Ryan's data? Can it answer "what are the risks on
  Pacific Fusion?" with actual intelligence from the DB? Or is it a generic LLM?
- If grounded: it needs RAG — query the DB for relevant context, inject into prompt.
  The quality of the answer depends entirely on the quality of the DB retrieval.
- If not grounded: it is theater. A feature that looks valuable but produces
  generic or hallucinated answers. Users trust it because it sounds confident.
  This is the most dangerous state a chat feature can be in — worse than not having it.
- **Verdict:** Build out as proper RAG system / Scrap and replace with direct
  Claude interface with DB access / Keep current and invest in grounding?

**G. Semantic dedup**
- Evidence against: O(N×M) Haiku calls per night, risk of false merges losing
  real accountability items, uncertain accuracy at construction-specific language
- Alternative: deterministic dedup — exact match on `(committed_by_email, LEFT(title, 80))`;
  fuzzy dedup runs client-side in the UI (show "possible duplicate" flag for Ryan to
  confirm or reject). Zero nightly API cost, Ryan controls merge decisions.
- **Verdict:** Keep AI semantic dedup / Switch to deterministic + UI-driven fuzzy?

---

## OUTPUT FORMAT

Deliver in exactly this structure. Every section is required. Do not skip or abbreviate.

```
## EXECUTIVE SUMMARY (5 sentences max)
What is working. What is fundamentally broken. What is the gap between
Ryan's stated goal and the system's actual current capability. Be direct.

## DB STATE SNAPSHOT
The actual numbers from the ground-truth queries above. Every query result.
These anchor everything that follows. State them before any analysis.

## CRITICAL FINDINGS (P0 — Broken Now, Data Wrong or Lost)
For each:
### P0-N: [Title]
**What is actually happening** (with file:line reference):
**Proof** (SQL result or specific code block):
**Impact on Ryan** (what can he not do, or what wrong data is he seeing):
**Exact fix** (the specific line/function to change — not "refactor this"):

## HIGH PRIORITY (P1 — Will Break Predictably)
Same format. Every finding includes: trigger condition, failure mode, affected data.

## MEDIUM PRIORITY (P2 — Works But Fragile or Misaligned)
Same format.

## SCENARIO RESULTS
Walk each scenario step by step. State what actually happens, not what should happen.
  SCENARIO A verdict: what % of the expected intelligence actually made it to the UI?
  SCENARIO B verdict: is the pre-meeting brief useful or empty? (state actual query results)
  SCENARIO C verdict: what data is permanently lost after a 14-day silent outage?

## GOAL ALIGNMENT GAPS
Not bugs — design gaps between intent and implementation. For each:
- Intended capability
- Current reality
- What it would specifically take to close the gap

## DEAD FEATURES
Pages that render empty. Routes that exist but nothing calls them. Confirm each
is actually dead (not just slow or underused) by tracing the specific missing link.

## COST & SCALE ANALYSIS
Monthly API spend at current scale. Monthly spend at 12-month scale (500+ meetings,
10k+ emails). Supabase storage runway. Specific architectural choices that become
cost or performance problems at scale.

## ARCHITECTURE VERDICTS
For each of the 7 components in Test Block 14:
[Component name]: Keep / Revise / Replace / Scrap
Supporting evidence: [2-3 sentences]
Recommended path if not Keep: [specific approach]

## WHAT IS ACTUALLY WORKING (honest, give credit)
Things that are solid, reliable, and genuinely useful today.

## THE NORTH STAR GAP
Be honest: where is this system on a 1-10 scale toward "fully present in meetings,
peer-level executive assistant"? What ONE architectural capability — not a bug fix
but a design decision — would move the score most? Why that one?

## AUDITOR LIMITATIONS
Be explicit about what you could NOT verify:
- What required DB access you didn't have? (State the queries you would have run)
- What required running the actual pipeline to observe behavior?
- What required seeing Ryan's actual Outlook/Gmail data?
- Where did you have to make assumptions rather than verify?
- What is the confidence level of each P0 finding — did you see proof or infer it?
This section is not a hedge. It's a map of where the next auditor should focus first.

## RECOMMENDED EXECUTION ORDER
The first 7 things to address, in order. Specific enough to start work tomorrow
without asking any questions. Include: files to touch, specific changes, estimated
time. Mark each as: quick fix / single session / multi-session effort.
```

---

## IMPORTANT NOTES FOR THE AUDITOR

The code is actively developed. Some recent fixes (plaud POST handler, plaud-pull.yml
table name, nightly-ai.yml field name) may not be deployed yet. Treat code on disk
as ground truth.

Run the SQL queries. Code can look correct and still produce nothing. DB state is
the only real evidence.

Be explicit about the limits of this audit. You can read code and run queries.
You cannot observe a live pipeline run, see Ryan's actual email or calendar,
or validate AI extraction quality against real transcripts without samples.
State these limitations clearly so Ryan knows what was verified vs inferred.

Ryan thinks in systems. He separates facts from assumptions from judgment.
He will not use a system he can't trust. The most dangerous finding is a feature
that APPEARS to work but is silently producing wrong data.

The question to hold throughout: **If Ryan walked into Pacific Fusion's most
important meeting of the year tomorrow morning and used only this system to
prepare — what would he know, what would he be missing, and what would the system
have told him that he didn't realize he didn't know?**
