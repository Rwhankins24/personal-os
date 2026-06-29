# Personal OS — System Architecture & Build Spec

*Last updated: June 29, 2026 — Workshopped with Ryan Hankins*

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

### Root cause of prior hang (June 29, 2026 — FIXED in Task #73)

`parsePlaudSummary` sent the full 13k–20k character Plaud summary to Haiku with `max_tokens: 8000` and asked for a comprehensive 12-category JSON. Haiku's OUTPUT was the bottleneck — not the input. Output truncated mid-JSON → parse failed → fallback triggered `extractIntelligenceFromTranscript` (Sonnet, 32k tokens, no timeout) → 90-minute hang.

**Key distinction:** A 20k char summary is ~5k tokens as INPUT — Haiku handles this fine (200k context). The problem was the OUTPUT was too large (comprehensive JSON across 12 categories requiring 10k+ token output). Fix: restructure what we ask for, not what we feed in.

### Architecture decision: Plaud as its own output layer (structured data block approach)

**Do not ask Haiku to re-summarize what Plaud already summarized.**

Plaud's AI already produces an excellent narrative summary. The strategy:

1. **Full narrative summary** — kept exactly as-is in the DB. No AI call to regenerate it.
2. **`=====BEGIN_STRUCTURED_DATA=====` / `=====END_STRUCTURED_DATA=====` delimiter pair** — added to Plaud's custom prompt. Plaud's AI outputs thorough structured JSON between these markers. We parse it directly in the Plaud pull step (Step 5), before DB write — because `email_body_raw` is not stored to DB. Zero Haiku tokens consumed for the main extraction pass.
3. **Transcript** — stored in DB as `full_transcript` / `raw_transcript`. Used as input for targeted Haiku knowledge/learning calls.
4. **Targeted Haiku calls** (separate, focused, bounded output) — made only for knowledge and learning extraction, where the output is small and specific.

**Critical implementation note:** Parse the structured data block in `plaud-pull-skill.md` Step 5, while `email_body_raw` is still in memory. Store extracted JSON as `intel_json` field in `last-plaud-report.json`. By the time the nightly job runs, only `short_summary` (truncated intro) and `full_transcript` survive in DB — `email_body_raw` is gone.

**Why call words work here:** `---INTEL---` is a text delimiter in Plaud's output, not a model feature. Plaud writes one continuous response; we split at the delimiter. The "6k limit" concern doesn't apply — there is no per-section token budget. The fix is scoping output size, not paginating input.

### Plaud intelligence taxonomy — 8 categories (defined June 29, 2026)

Each category answers not just WHAT but WHY + IMPLICATION. This is the "juicing the lemon" principle — context without implication is noise.

#### ACTIONS — routes to Tasks table
```
owner: who (specific name, not "team")
task: what exactly
due_date: when (or "unspecified")
project: project name
urgency: critical / high / normal
ryan_owns: true/false
```

#### COMMITMENTS — routes to Others table
```
made_by: person name
made_to: person/org name
deliverable: exactly what was promised
due_date: stated or implied
status: open / conditional / pending confirmation
```

#### DECISION MADE — routes to Strategic Decisions table
```
decision: what was decided
driver: why this decision (not just that it was made)
implication: what does this change downstream (cost / schedule / scope / risk)
parties_agreed: who was in the room and consented
reversibility: locked / soft / conditional
```

#### PENDING DECISION — routes to Pending Decisions table
```
question: the open question
options: known alternatives
blocker: what's preventing resolution
decision_maker: who has authority
impact_if_unresolved: cost / schedule / contractual consequence
trigger_date: when this becomes critical
```

#### RISK — routes to Intelligence Notes / Knowledge Base
```
risk: the risk in plain language
why_it_exists: root cause or structural driver
cascading_effects: what else breaks if this materializes (2nd/3rd order)
severity: critical / high / medium / watch
trigger_date: when it becomes active or irreversible
mitigation: what would neutralize it
```

#### KEY FACT — routes to Knowledge Base (type: fact)
```
fact: the specific, verifiable statement
source_person: who stated it
confidence: confirmed / stated / inferred
project: project context if applicable
```

#### KNOWLEDGE — routes to Knowledge Base (type: context)
```
what: the concept or information
why_it_matters: the implication for Ryan's work
decision_trigger: what decision does this inform or change
transferability: this project only / cross-project / industry-wide
```

#### LEARNING — routes to Observations table
```
pattern: the observable pattern (not just what happened — what it represents)
evidence: specific instance(s) from this meeting
implication: what should change or be watched as a result
applicable_to: which projects, roles, or situations this applies to
```

### Extraction architecture — two layers, each doing what it does best (finalized June 29, 2026)

**The governing principle:** Plaud handles *factual extraction* (what was explicitly said). Haiku handles *reasoning extraction* (what should we learn, retain, and understand about this project). These are different jobs and must not be mixed.

---

**Layer 1 — Plaud outputs two call-word blocks (factual, zero AI cost on our end)**

Failure isolation: if one block has a JSON parse error, the other still succeeds. Plaud produces both during its own processing.

**Block 1: `=====PEOPLE_AND_ACTIONS=====`**
Who was there · what was assigned · what was promised · observable relationship dynamics

**Block 2: `=====DECISIONS_AND_RISKS=====`**
What was decided (and why) · what's still open · risks explicitly identified · verifiable facts stated verbatim · cost signals · schedule signals · lead/BD signals

Cost and schedule flags are distinct from risks — they are specific quantifiable signals that route to project cost/schedule tracking. Lead signals route to the Leads page.

---

**Layer 2 — Haiku processes full transcript, three targeted calls (reasoning, nightly job)**

Input to all three calls: full `raw_transcript` (27k+ chars, ~7k tokens — no truncation). Falls back to `email_body_raw` if transcript unavailable, then `short_summary`. Never skip — log `input_type` on each record.

`max_tokens: 8192` on every Haiku call. Cost is irrelevant (~$0.35/day for 4 meetings × 3 calls). Design for quality.

**Call A — Knowledge**
What reusable knowledge from this meeting should be retained in the knowledge base? For each item: what is it, why does it matter, what decision does it inform, how transferable is it (this project / cross-project / industry-wide)?
Input: full transcript + existing knowledge base entries for this project (context injection — identify what's genuinely new vs. already known).

**Call B — Learnings**
What patterns does this meeting evidence? For each: what is the pattern, what in this meeting demonstrates it, what should change or be watched, what other projects or situations does it apply to?
Input: full transcript + prior observations for this project and category (to recognize recurring patterns, not just one-off incidents).

**Call C — Project Context Snapshot**
What is the current state of this project as evidenced by this meeting? Captures: project phase, key constraints driving decisions, workstream ownership, the core problem the team is trying to solve, next milestone, and open dependencies. This is background context — not a fact, risk, or learning — used for AI context injection in future meetings on the same project.
Input: full transcript. Output stored on the project record, updated each meeting.

**Why A, B, C stay in Haiku and not in Plaud:**
Plaud sees one recording in isolation. Haiku can be injected with prior knowledge, prior observations, and project history — enabling it to say "this is the third time WGI has deferred on soft soil sites" or "this adds to what we already know about differential settlement." That cross-context reasoning is what builds institutional memory rather than per-meeting notes.

---

### Plaud custom prompt — final version (paste into Plaud app settings)

```
The device owner and primary meeting participant is Ryan Hankins, Project Executive at Clayco (construction and real estate development).

Speaker attribution rules:
- When Voice ID identifies a speaker as Ryan Hankins, always refer to him by name — never as "Speaker" or a generic label.
- For all other participants: use their Voice ID name if recognized. If not, use any name mentioned in the conversation. If a name cannot be determined, describe their role or company (e.g., "the owner's legal counsel" or "the structural engineer").
- Never output "Speaker 1," "Speaker 2," or "Unknown Speaker" anywhere in the summary or structured data. These labels are meaningless after the meeting — always resolve to a name or role.

Generate a detailed executive summary organized by topic, followed by attributed action items, using your current format.

After the action items, output ALL THREE structured blocks below exactly as shown. Do not alter the delimiters. Be thorough — full sentences for every field. This is permanent institutional memory.

=====MEETING_METADATA=====
{
  "recording_date": "YYYY-MM-DD",
  "recording_start_time": "HH:MM",
  "recording_end_time": "HH:MM",
  "duration_minutes": 0,
  "timezone": "America/Phoenix",
  "meeting_type": "in-person/video-call/phone/voice-note"
}
=====END_MEETING_METADATA=====

=====PEOPLE_AND_ACTIONS=====
{
  "participants": [{"name": "", "role": "", "company": "", "context": "how they relate to this project or meeting"}],
  "projects_referenced": [],
  "actions": [{"owner": "specific person's name", "task": "full description of what was agreed", "due": "", "project": "", "urgency": "critical/high/normal", "ryan_owns": true}],
  "commitments": [{"made_by": "name", "made_to": "name or org", "deliverable": "full description of what was promised", "due": "", "conditional_on": "any stated conditions", "status": "open"}],
  "relationship_signals": [{"person": "name", "signal": "what was observed — tone, deference, tension, dynamic", "implication": "what this suggests about the relationship or project"}]
}
=====END_PEOPLE_AND_ACTIONS=====

=====DECISIONS_AND_RISKS=====
{
  "decisions": [{"decision": "full statement of what was decided", "driver": "why this decision was made", "implication": "what changes downstream as a result", "parties_agreed": ["names"], "reversibility": "locked/soft/conditional"}],
  "pending": [{"question": "full statement of the open question", "options": "known alternatives discussed", "blocker": "what is preventing resolution", "decision_maker": "who has authority to decide", "impact_if_unresolved": "cost/schedule/contractual consequence", "trigger_date": "when this becomes critical"}],
  "risks": [{"risk": "full description of the risk", "why_it_exists": "root cause or structural driver", "cascading_effects": "what else breaks if this materializes", "severity": "critical/high/medium/watch", "trigger_date": "", "mitigation": "what would neutralize it"}],
  "facts": [{"fact": "verbatim or near-verbatim specific fact stated", "source_person": "who stated it", "confidence": "confirmed/stated/inferred"}],
  "cost_flags": [{"flag": "specific cost signal stated", "amount": "dollar figure if mentioned", "project": "", "status": "pending/approved/at-risk"}],
  "schedule_flags": [{"flag": "specific schedule signal stated", "date": "milestone or deadline mentioned", "impact": "what this affects", "project": ""}],
  "lead_signals": [{"signal": "what was said that suggests a pursuit or BD opportunity", "opportunity": "description of the potential project or relationship", "contact": "who mentioned it or is connected to it", "follow_up": "what action would advance this"}]
}
=====END_DECISIONS_AND_RISKS=====
```

Knowledge, learnings, and project context handled by three targeted Haiku calls in the nightly job — these require cross-context reasoning against the knowledge base, prior observations, and project history, which Plaud cannot do.

### parsePlaudSummary fix (nightly-ai-local.js + ai.js — Task #73)

**Step 1 — Parsing happens in `plaud-pull-skill.md` Step 5 (before DB write):**
`email_body_raw` is not stored to DB. All three call-word blocks must be parsed from `email_body_raw` while it is still in memory, and stored as structured fields in `last-plaud-report.json`:
- `meeting_metadata` → parsed JSON from MEETING_METADATA block
- `people_and_actions` → parsed JSON from PEOPLE_AND_ACTIONS block
- `decisions_and_risks` → parsed JSON from DECISIONS_AND_RISKS block
- On parse failure per block: store `null` for that block, log warning, continue

**Confirmed from live test (June 29, 2026):** Plaud simplifies delimiter syntax. Prompt specifies `=====MEETING_METADATA=====` but Plaud outputs `=MEETING_METADATA=`. Parser must match on the label text, not exact `=` count. Use regex:
```python
import re

def extract_block(text, label):
    # Matches =LABEL= or ===LABEL=== or =====LABEL===== etc.
    pattern = rf'={"{1,}"}{label}={"{1,}"}\n(.*?)\n={"{1,}"}END_{label}={"{1,}"}'
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError as e:
        print(f'  Parse error in {label}: {e}')
        return None

meeting_metadata   = extract_block(email_body_raw, 'MEETING_METADATA')
people_and_actions = extract_block(email_body_raw, 'PEOPLE_AND_ACTIONS')
decisions_and_risks = extract_block(email_body_raw, 'DECISIONS_AND_RISKS')
```

**Also confirmed from live test:** Unresolved speakers output as `"Design Team Coordinator (Speaker 5)"` with full role and context — graceful degradation, fully usable for task routing. No prompt change needed.

**Date/time handling in pull skill (Step 4B — add alongside existing extraction):**

```python
# From Gmail message headers (already being read):
email_received_datetime = headers.get('Date', '')  # e.g. "Tue, 03 Jun 2026 21:15:00 +0000"

# From transcript — parse last timestamp to get recording duration:
import re
timestamps = re.findall(r'\b(\d{1,2}:\d{2}:\d{2})\b', transcript_text)
last_ts = timestamps[-1] if timestamps else None
# Convert HH:MM:SS to minutes: "00:39:48" → 39.8 minutes
duration_minutes_from_transcript = parse_hhmmss_to_minutes(last_ts) if last_ts else None
```

**Start time resolution (after MEETING_METADATA parsed):**
```python
recording_start_time = meeting_metadata.get('recording_start_time') if meeting_metadata else None
time_source = 'plaud_ai'

if not recording_start_time and email_received_datetime and duration_minutes_from_transcript:
    # Estimate: email arrived ~5-10 min after recording ended
    start_dt = parse_email_date(email_received_datetime) - timedelta(minutes=duration_minutes_from_transcript + 8)
    recording_start_time = start_dt.strftime('%H:%M')
    time_source = 'estimated'
elif not recording_start_time:
    time_source = 'unknown'
```

Store on each meeting record: `recording_start_time`, `recording_date`, `duration_minutes`, `time_source`, `email_received_datetime`. The nightly job uses `time_source` to set calendar match confidence.

**Step 2 — Nightly job reads pre-parsed blocks (zero AI call for factual extraction):**

In `nightly-ai-local.js`, replace `parsePlaudSummary` call with direct read:
```javascript
const peopleAndActions = meeting.people_and_actions || null
const decisionsAndRisks = meeting.decisions_and_risks || null
// If both null: old-format meeting — fall back to transcript calls below
```

**Step 3 — Three targeted Haiku calls (new function in ai.js):**
```javascript
async function extractMeetingIntelligence(meeting, projectContext, priorObservations) {
  const transcript = meeting.full_transcript || meeting.raw_transcript || meeting.email_body_raw || meeting.short_summary
  const inputType = meeting.full_transcript ? 'transcript' : meeting.email_body_raw ? 'email_body' : 'summary'

  // Call A — Knowledge (max_tokens: 8192)
  // Input: transcript + existing knowledge_base entries for this project
  // Output: { knowledge: [{ what, why_it_matters, decision_trigger, transferability }] }

  // Call B — Learnings (max_tokens: 8192)
  // Input: transcript + prior observations for this project + category
  // Output: { learnings: [{ pattern, evidence, implication, applicable_to }] }

  // Call C — Project Context Snapshot (max_tokens: 8192)
  // Input: transcript only
  // Output: { project_phase, key_constraints, workstream_owners, core_problem, next_milestone, open_dependencies }

  return { knowledge, learnings, project_context, input_type: inputType }
}
```

**Step 4 — Remove the transcript fallback entirely:**
```javascript
// DELETE THIS BLOCK — causes 90-minute hangs:
if (!intel && hasTranscript) {
  intel = await aiService.extractIntelligenceFromTranscript(...)
}
// If blocks are null and transcript calls fail: log clearly, skip, continue to next meeting.
```

### Plaud speaker recognition — resolved

Voice ID has been set up. The updated custom prompt explicitly instructs Plaud to use Voice ID attribution for Ryan Hankins and to never output generic Speaker labels. Monitor first few meetings after prompt update to confirm attribution is consistent.

### JSON output structure per meeting (stored in last-plaud-report.json after pull-step parsing)

```json
{
  "meeting_date": "2026-06-25",
  "meeting_start_time_approx": "09:00",
  "meeting_title_from_content": "LWIC Coordination",
  "narrative_summary": "Full Plaud narrative — everything before the first ===== delimiter",
  "has_transcript": true,
  "transcript_text": "Full raw transcript — 27k+ chars",
  "input_type": "transcript",

  "people_and_actions": {
    "participants": [{ "name": "J. Miller", "role": "PM", "company": "WGI", "context": "Geotechnical engineer of record" }],
    "projects_referenced": ["LWIC - Tampa"],
    "actions": [{ "owner": "Ryan", "task": "Send updated pricing by Thursday", "due": "2026-06-27", "project": "LWIC - Tampa", "urgency": "high", "ryan_owns": true }],
    "commitments": [{ "made_by": "J. Miller", "made_to": "Ryan", "deliverable": "Final GI report with settlement calcs", "due": "2026-06-28", "conditional_on": "", "status": "open" }],
    "relationship_signals": [{ "person": "J. Miller", "signal": "Deferred twice when pressed on schedule commitment", "implication": "WGI may be behind — may need escalation before July 1 trigger" }]
  },

  "decisions_and_risks": {
    "decisions": [{ "decision": "Approved phased procurement approach", "driver": "Long-lead MEP risk — 20-week lead time exceeds GMP window", "implication": "Commits $240k before GMP execution — owner must be aligned", "parties_agreed": ["Ryan", "Miller"], "reversibility": "soft" }],
    "pending": [{ "question": "GMP language — indemnity carve-out for owner-furnished equipment", "options": "Full carve-out vs. proportional liability", "blocker": "GT Law review not complete", "decision_maker": "Ryan + legal", "impact_if_unresolved": "Blocks A133 execution", "trigger_date": "2026-07-14" }],
    "risks": [{ "risk": "Foundation sequencing delays MEP rough-in by 2 weeks", "why_it_exists": "WGI design not finalized — rigid inclusion layout unresolved", "cascading_effects": "MEP delay → slab-on-grade push → steel erection slip → GMP exposure", "severity": "high", "trigger_date": "2026-07-01", "mitigation": "WGI CAD files confirmed by June 30" }],
    "facts": [{ "fact": "Tank fabrication and installation: 8-month minimum from start to commissioning", "source_person": "Jeremy Dixon", "confidence": "confirmed" }],
    "cost_flags": [{ "flag": "Contingency draw request for phased MEP procurement", "amount": "$240k", "project": "LWIC - Tampa", "status": "pending" }],
    "schedule_flags": [{ "flag": "Steel delivery pushed", "date": "August 15, 2026", "impact": "Slab-on-grade and MEP rough-in downstream", "project": "LWIC - Tampa" }],
    "lead_signals": [{ "signal": "Owner mentioned potential Phase 2 facility in Denver during schedule discussion", "opportunity": "Similar industrial facility, same owner, 2027 start", "contact": "Jeremy Dixon (owner's PM)", "follow_up": "Ask Jeremy directly in next meeting — gauge timeline and procurement approach" }]
  },

  "knowledge": [{ "what": "Rigid inclusions outperform stone columns in soft clay when differential settlement tolerance is under 0.5 inches", "why_it_matters": "Informs GI spec and value engineering decisions on similar industrial sites", "decision_trigger": "GI contractor selection or foundation system selection", "transferability": "cross-project" }],

  "learnings": [{ "pattern": "Feasibility-phase foundation assumptions don't survive first geotechnical review on soft soil sites", "evidence": "WGI findings overturned the conceptual rigid inclusion layout — requires full redesign", "implication": "Build GI confirmation milestone into all industrial ground-up schedules before steel procurement", "applicable_to": "All industrial ground-up — especially sites with clay or soft soil" }],

  "project_context": {
    "project_phase": "GMP preparation — 15 days to A133/A102 execution deadline",
    "key_constraints": ["Tank fabrication 8-month critical path drives July start requirement", "Lateral load sequence mandates admin → lab → CUB construction order", "WGI design not final — blocks foundation and MEP sequencing"],
    "workstream_owners": [{ "workstream": "Geotechnical / foundation", "owner": "J. Miller / WGI" }, { "workstream": "Contract / legal", "owner": "Ryan + GT Law" }],
    "core_problem": "Accelerate tank installation start from September to July while managing differential settlement risk from full-depth mat slab pour",
    "next_milestone": "WGI CAD files — June 30, 2026",
    "open_dependencies": ["WGI rigid inclusion layout finalized", "300-ton crane proposal received (June 9)", "GT Law review of GMP indemnity language", "Owner alignment on $240k pre-GMP commitment"]
  }
}
```

### Plaud × Calendar matching (in Phase 2 Step 3)

Day match (required) + time within ±30 min → link meeting to calendar event → enrich with attendee list from calendar, add join link, confirm project tag.

---

## 9. Intelligence Synthesis — Cross-Source, Cross-Time Design (June 29, 2026)

**The question:** How does the system merge intelligence from the same project, same time period, or across projects?

**The honest state:** Capture layer is being built (Plaud taxonomy above, Phase 1B email extraction). Connect layer is partially built (projects, contacts, categories, topic pods). Synthesize layer — active cross-source, cross-time pattern detection — is mostly missing.

### Three levels of synthesis required

**Level 1 — Within a project, across time**

A risk signal from a June 26 Plaud meeting and a related signal in a June 29 email thread are the same compounding risk. The system should know this.

Mechanism (Phase 2, Step 4): When processing a project's content in a single nightly run, pull all risks + pending decisions from that project in the last 30 days. Ask the synthesis prompt: "Are there 2+ signals pointing at the same underlying issue? If yes, surface this as a pattern and escalate." Result writes to observations table as a confirmed pattern — stronger than either individual signal.

**Level 2 — Across projects in the same domain**

"WGI uses rigid inclusions on soft clay sites" starts as a Solis fact. After it appears on 2+ projects, it becomes a generalizable knowledge entry, not a project-specific fact.

Mechanism (future — requires semantic similarity): The nightly job checks new knowledge entries against existing observations and knowledge base entries using keyword overlap (now) and eventually embedding similarity (future). When a pattern matches across projects, it routes to a cross-project observation. The `applicable_to` field on learnings drives this — `"cross-project"` entries are flagged for cross-referencing.

**Level 3 — Across time and people (unresolved commitments)**

A commitment made by a subcontractor 3 weeks ago, unresolved, appearing as a blocker in a new meeting — the system should connect these.

Mechanism: The commitments and others_commitments tables carry `status: open` until resolved. The nightly job pulls open commitments from the last 60 days and checks: does any current meeting reference the same person + project? If yes, surface as "prior commitment unresolved — now appears as blocker." Entity resolution (same person, different email/name formatting) handled via contacts table `canonical_id`.

### How the nightly job injects prior context (existing + enhancement)

The nightly job's `buildProjectContext` function already pulls prior knowledge entries, decisions, and risks for each active project. This is the context injection layer — it gives the AI the history it needs to recognize when a new meeting continues an existing thread rather than starting a new one.

Enhancement needed (Task #73 scope): When processing a Plaud meeting, inject:
- All open risks for that project (last 60 days)
- All open commitments for that project (last 60 days)
- All pending decisions for that project
- Most recent 3 observations tagged to this project's category

This lets the extraction prompt ask: "Does this meeting resolve or advance any prior open items? Does it introduce a new signal that compounds an existing risk?" Output includes `resolves_prior_item_id` and `escalates_risk_id` fields.

### What's missing — gap assessment

| Capability | Status | Path to close |
|---|---|---|
| Within-project pattern detection (30-day window) | Partially exists via buildProjectContext | Enhance context injection with open risks/commitments |
| Cross-project pattern detection | Keyword matching only — weak | Semantic similarity search (embedding layer — future) |
| Temporal commitment threading | Manual only | Phase 2 Step 4 synthesis pass + open commitment pull |
| Entity resolution (same person, different names) | Contacts table + canonical_id | Already designed, needs consistent FK usage |
| Semantic cross-source search | Missing entirely | Future capability — schema supports it (topic pods, categories) |

### Data linkage rules — every extracted record carries

```
project_id          → FK to projects table (required)
source_meeting_id   → FK to meeting_notes (traceability)
source_email_id     → FK to email thread (traceability)
category_id         → FK to meeting_categories (thematic routing)
topic_pod_id        → FK to topic_pods (cluster routing, optional)
applicable_to       → "this-project" | "cross-project" | "industry-wide"
```

The intelligence compounding loop: new meeting → context injection includes prior project history → extraction recognizes connections to prior items → observation escalates compound pattern → next meeting gets even richer context.

---

## 10. Phase 3 — Backfill System

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
| # | Task | Status | Blocked by |
|---|---|---|---|
| #73 | Plaud architecture overhaul: ---INTEL--- prompt + parsePlaudSummary fix + targeted Haiku calls + remove transcript fallback | Design complete (June 29) — needs code | None — can do now |

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
