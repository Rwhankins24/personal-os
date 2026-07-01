---
name: email-classify
description: >
  Task 2 of 2 in the morning email pipeline. Reads raw thread data from
  ~/personal-os/data/last-email-report.json (written by Task 1 at 4:05 AM).
  Classifies threads into 6 buckets, applies urgency scoring, cross-references
  against yesterday's report, builds tags, extracts structured intelligence
  (action items, commitments, risks, decisions, summaries) per thread,
  writes final classified report to ~/personal-os/data/last-email-report.json,
  and uploads to Supabase storage.
  NO M365 connector calls. NO data pulling. Classification + extraction only.
  Runs at 4:25 AM, 20 minutes after Task 1.
  Phase 1B: extracted fields in output eliminate per-email AI calls in nightly job.
---

# Email Classify — Classification, Extraction & Output (Task 2 of 2)

You are Task 2 of Ryan Hankins' morning email pipeline. Task 1 ran at 4:05 AM and wrote
`~/personal-os/data/last-email-report.json`. Your job is to read that file, classify every
thread into 6 buckets, apply urgency and tags, and write the final classified report.

**You make ZERO M365 connector calls. All email data is already in the raw JSON.**
**You do NOT re-pull anything from Outlook.**

**Input:**  `~/personal-os/data/last-email-raw.json` (written by Task 1 — the pull)
**Output:** `~/personal-os/data/last-email-report.json` (read by the newsletter)
**Upload:** `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json`

**Runtime credentials (for Step 6 upload):**
Read from `${WORKSPACE_PATH}/api/.env` — do NOT hardcode credentials in this file.
```bash
SUPABASE_URL=$(grep '^SUPABASE_URL=' "${WORKSPACE_PATH}/api/.env" | cut -d= -f2-)
SUPABASE_SERVICE_KEY=$(grep '^SUPABASE_SERVICE_KEY=' "${WORKSPACE_PATH}/api/.env" | cut -d= -f2-)
echo "Supabase URL loaded: ${SUPABASE_URL:0:40}…"
echo "Service key loaded: ${SUPABASE_SERVICE_KEY:0:20}… (truncated)"
```

---

## Step 0 — Detect workspace path + wait for pull completion flag

**FIRST: Detect workspace path (required before any file operation)**

The Read and Write tools require absolute paths. `~` does not resolve in the Cowork tool context.

```bash
WORKSPACE_PATH=$(find /sessions -maxdepth 5 -name "personal-os" -type d 2>/dev/null | head -1)
if [ -z "$WORKSPACE_PATH" ]; then
  WORKSPACE_PATH="$HOME/personal-os"
fi
DATA_PATH="${WORKSPACE_PATH}/data"
echo "Data path: $DATA_PATH"
```

Store `WORKSPACE_PATH` and `DATA_PATH`. Use them in ALL subsequent file Read/Write/Bash operations.
Every `~/personal-os/data/...` reference in this skill means `${DATA_PATH}/...` with the actual path.

Also clean up any stale checkpoints from previous days (they must never be loaded for the wrong date):

```bash
find "${DATA_PATH}" -name "classify-checkpoint-*.json" ! -name "classify-checkpoint-${TODAY_ISO}.json" -delete 2>/dev/null
echo "Stale checkpoint cleanup done."
```

**THEN: Confirm Task 1 finished for today.**
This replaces the fragile fixed 20-minute timer — classify now waits for pull to signal it's done.

```bash
TODAY=$(date '+%Y-%m-%d')
FLAG_FILE="${DATA_PATH}/pull-complete-${TODAY}.flag"
MAX_WAIT=30  # minutes
INTERVAL=2   # minutes between checks
ELAPSED=0

echo "Waiting for pull completion flag: $FLAG_FILE"

while [ ! -f "$FLAG_FILE" ]; do
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo "⚠ Flag not found after ${MAX_WAIT} min. Checking raw file freshness..."
    break
  fi
  echo "  Flag not found yet. Waiting ${INTERVAL} min... (${ELAPSED}/${MAX_WAIT}m)"
  sleep $((INTERVAL * 60))
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ -f "$FLAG_FILE" ]; then
  echo "✓ Pull complete flag found — proceeding."
else
  # Flag missing: check if the raw pull file (last-email-raw.json) is fresh enough to use anyway
  # NOTE: do NOT check last-email-report.json — that is yesterday's classified output, not today's pull
  RAW_DATE=$(python3 -c "
import json, os, sys
data_path = os.environ.get('DATA_PATH', os.path.expanduser('~/personal-os/data'))
try:
    with open(os.path.join(data_path, 'last-email-raw.json')) as f:
        print(json.load(f).get('report_date',''))
except: print('')
" 2>/dev/null)
  TODAY_CHECK=$(date '+%Y-%m-%d')
  if [ "$RAW_DATE" != "$TODAY_CHECK" ]; then
    echo "✗ Raw pull file (last-email-raw.json) is from $RAW_DATE, not today ($TODAY_CHECK). Task 1 did not complete."
    echo "  Stopping — do not classify stale data."
    exit 0
  fi
  echo "⚠ Flag missing but raw file is today's — proceeding with caution. Pull may still be running."
fi
```

---

## Step 1 — Read raw input

Use the Read tool with the ABSOLUTE path detected in Step 0:
```
Read: {DATA_PATH}/last-email-raw.json
```
(Substitute the actual DATA_PATH value, e.g. `/sessions/abc-xyz/mnt/personal-os/data/last-email-raw.json`)

Also confirm with bash:
```bash
cat "${DATA_PATH}/last-email-raw.json"
```

Parse the JSON. Verify `report_date` is today. If the file doesn't exist or `report_date`
is not today, log a warning and stop — Task 1 did not complete. Do not attempt to pull
email data yourself.

NOTE: `last-email-report.json` is yesterday's classified OUTPUT — do not read that as input.
The input for classify is always `last-email-raw.json` (the pull output from Task 1).

From the raw JSON, store:
- `threads[]` — all thread records from Task 1
- `calendar[]` — today's calendar events
- `pending_invites[]` — unanswered meeting invites
- `yesterday_conv_ids[]` — previous report's conversationIds (for cross-reference)
- `bucket6_count` — filtered sender count
- `TODAY_ISO` — from `report_date`

---

## Step 1.5 — Load checkpoint (crash recovery)

**Purpose:** If this session crashed mid-run today, resume from where it left off instead
of restarting from thread 1. Without this, a crash at thread 50 of 70 wastes 25 minutes
of work every time.

```bash
CHECKPOINT_FILE="${DATA_PATH}/classify-checkpoint-${TODAY_ISO}.json"
echo "Checkpoint file: $CHECKPOINT_FILE"

if [ -f "$CHECKPOINT_FILE" ]; then
  echo "⚡ Checkpoint found — resuming from previous run."
  cat "$CHECKPOINT_FILE"
else
  echo "No checkpoint — starting fresh."
fi
```

If the checkpoint file exists:
1. Read it using the Read tool: `Read: {DATA_PATH}/classify-checkpoint-{TODAY_ISO}.json`
2. Load `checkpoint.processed_conv_ids[]` — set of conversationIds already done
3. Load `checkpoint.partial_classified[]` — threads already classified (with all fields)
4. Load `checkpoint.processed_count` — number of threads done so far
5. Set `RESUMING = true`

Log: `⚡ Resuming classify from thread ${processed_count}/${threads.length} (${processed_conv_ids.length} already done)`

If no checkpoint: set `RESUMING = false`, `processed_conv_ids = []`, `partial_classified = []`.

**When resuming:** In Step 2 and Step 5.5, skip any thread whose `conversationId` is in
`processed_conv_ids`. The `partial_classified[]` records are already done — merge them
with newly processed threads at Step 6.

---

## Step 2 — Classify threads into 6 buckets

Process each thread through this decision tree in order. Assign the FIRST bucket that matches.

### Bucket 1 — Needs Reply

**All three must be true:**
- Ryan appears in the TO field of any message in the thread
- `ryanSentLast = false` (latest message is NOT from Ryan)
- Thread contains an explicit ask, question, or action request directed at Ryan

**Not spam or automated.**

**Sort order within Bucket 1 (apply in priority sequence):**
1. `is_flagged: true` — always surfaces first
2. `is_time_sensitive: true` AND `has_contract_language: true`
3. `is_time_sensitive: true` only
4. `has_contract_language: true` only
5. `is_internal: false` (external before internal)
6. Days since `waitingSince` descending (oldest unanswered first)

### Bucket 2 — Waiting On Them

**Both must be true:**
- `ryanSentLast = true` (Ryan sent the most recent message)
- No reply arrived more than 48h after `myLastReplyTime`

Set:
- `days_waiting` = days since `myLastReplyTime`
- `followed_up: true` if Ryan sent more than one message in this thread with no reply
- Flag as `AGING` if `days_waiting >= 5`

**Sort order:** AGING first, then `days_waiting` descending.

### Bucket 3 — Oversight / FYI

**Any of these:**
- Ryan is CC'd only (never in TO across all messages in thread)
- Thread is informational with no direct ask to Ryan
- Thread has 6+ participants AND no direct ask to Ryan

**Sort order:** most recent `latestMessageTime` first.

### Bucket 4 — Documents / Contracts / Drawings

**Both must be true:**
- `has_attachment: true` OR `has_contract_language: true`
- Thread contains explicit review or approval request

`status: "needs_reply"` if review/approval requested, else `"read"`.

**Sort order:** `CONTRACT_LANGUAGE` threads first, then `days_waiting` descending.

### Bucket 5 — Pending Invites

All `pending_invites[]` from Task 1 (already filtered to `my_response_status = "none"`).
`status: "needs_reply"`.
**Sort:** `proposed_start_time` ascending (soonest first).

### Bucket 6 — Filtered

Apply this check BEFORE the Bucket 1–5 decision tree. Any thread matching the criteria
below goes directly to Bucket 6 — do NOT evaluate it further.

**Automated sender address patterns (match against `from_address`):**
- Address domain: `noreply`, `no-reply`, `notifications`, `marketing`, `alerts`, `digest`,
  `donotreply`, `do-not-reply`, `mailer`, `bounce`, `automailer`, `replies`
- Known newsletter/marketing domains: `bizjournals.com`, `ccsend.com`, `constantcontact.com`,
  `mailchimp.com`, `klaviyo.com`, `sendgrid.net`, `mandrillapp.com`, `mailgun.org`,
  `exacttarget.com`, `salesforce.com` (marketing subdomains), `hubspot.com` (email)
- Industry newsletters: `naiop.org` (daily/weekly digest emails), `uli.org` (email blasts)
- Events/entertainment: `seatgeek.com`, `ticketmaster.com`, `eventbrite.com`
- Travel/airlines: `southwest.com`, `united.com`, `delta.com`, `aa.com` (promotional; NOT transactional booking confirmations — those are Bucket 3)
- SharePoint / Microsoft system notifications: `from_address` contains `svc_` prefix,
  OR `from_name` contains "SharePoint" AND `from_address` does NOT contain a person's name,
  OR domain is `sharepointonline.com`, `sharepoint.com` (automated notifications only)

**Automated sender name patterns (match against `from_name`):**
- Contains: "Newsletter", "Digest", "Alerts", "Notifications", "No Reply", "Noreply",
  "Do Not Reply", "Marketing", "Updates", "Promotions"

**Subject-line automation signals (match against `threadSubject`):**
- Contains "unsubscribe", "[digest]", "[newsletter]", "Weekly Roundup", "Daily Briefing"
  (unless from a known human contact at a real organization)

**Sender count boundary:** If a thread has 8+ recipients in `threadParticipants` AND
the sender matches any automated pattern above → Bucket 6.

These are already counted in `bucket6_count` from Task 1.
Do NOT include Bucket 6 threads in output bucket arrays. Use the `bucket6_count` directly.
Increment `bucket6_count` for any additional threads caught here that weren't in Task 1's count.

### Checkpoint writes during classification

**Every 10 threads classified**, write the current checkpoint to disk:

```bash
# Write checkpoint (substitute actual DATA_PATH)
python3 -c "
import json, os, sys

data_path = '${DATA_PATH}'
today = '${TODAY_ISO}'
checkpoint_path = os.path.join(data_path, f'classify-checkpoint-{today}.json')

# Build from current state passed as arg
checkpoint = json.loads(sys.argv[1])
with open(checkpoint_path, 'w') as f:
    json.dump(checkpoint, f)
print(f'Checkpoint saved: {checkpoint_path}')
" '[CHECKPOINT_JSON]'
```

Checkpoint JSON structure:
```json
{
  "checkpoint_date": "[TODAY_ISO]",
  "processed_count": 30,
  "processed_conv_ids": ["AAQkAA...", "AAMkAB...", "..."],
  "partial_classified": [
    { /* full thread record with bucket, urgency, tags, extracted, all fields */ },
    { /* ... */ }
  ]
}
```

**Rules:**
- Write after every 10th thread, AND after the final thread
- `processed_conv_ids` is the complete set of conversationIds processed so far
- `partial_classified` contains the full classified thread records (everything that would go in the final output for those threads)
- If resuming, append newly processed threads to `partial_classified` from the loaded checkpoint
- Do NOT write checkpoint for Bucket 5 (invites) or Bucket 6 (filtered) — these are quick and handled separately

---

## Step 3 — Cross-reference against yesterday's report

For each thread in Buckets 1–4, check if its `conversationId` appears in `yesterday_conv_ids`:

- **Not in yesterday's list** → `cross_reference_status: "new"`
- **In yesterday's Bucket 1 or 2, still unresolved** → `cross_reference_status: "aging"`, increment `days_waiting` by 1
- **Was in yesterday's list, now resolved** → add to `resolved_since_yesterday[]`

---

## Step 4 — Urgency escalation

Apply to every thread in Buckets 1–4 based on `days_waiting`:

| days_waiting | urgency      | Dashboard color |
|---|---|---|
| 0–1          | `"normal"`   | None            |
| 2–3          | `"elevated"` | Yellow          |
| 4–6          | `"high"`     | Orange          |
| 7+           | `"critical"` | Red             |

For Bucket 1 threads: also escalate to `"elevated"` minimum if `is_time_sensitive: true`,
regardless of `days_waiting`.

---

## Step 5 — Build tags array

For each thread in Buckets 1–5, populate `tags: []`:

| Tag                | Condition                                          |
|--------------------|----------------------------------------------------|
| `TIME_SENSITIVE`   | `is_time_sensitive: true`                          |
| `CONTRACT_LANGUAGE`| `has_contract_language: true`                      |
| `EXTERNAL`         | `is_internal: false`                               |
| `HAS_ATTACHMENT`   | `has_attachment: true`                             |
| `AGING`            | `cross_reference_status: "aging"`                  |
| `INTERNAL`         | `is_internal: true`                                |
| `LARGE_THREAD`     | `thread_participant_count >= 6`                    |
| `FLAGGED`          | `is_flagged: true`                                 |
| `FOLLOWED_UP`      | `followed_up: true` (Bucket 2 only)                |

---

## Step 5.5 — Intelligence extraction (Phase 1B)

**Purpose:** Eliminate per-email AI calls in the nightly job. Every thread gets structured
extraction here, inline, so the nightly job reads this data instead of calling Haiku 200+ times.

For each thread in Buckets 1–4, read `full_thread_content` (or `body_preview` if full content
is unavailable) and extract the following. Use your best judgment — do NOT hallucinate.
Confidence below 0.6 → omit the item. This is extraction, not invention.

Add an `extracted` object to each thread record:

```json
{
  "extracted": {
    "ai_summary": "1-2 sentence plain English summary of what this thread is about and where it stands.",
    "context_type": "work",
    "action_items": [
      {
        "text": "Ryan needs to review and respond to the GMP proposal",
        "owner": "ryan",
        "due_date": "2026-06-28",
        "confidence": 0.92
      },
      {
        "text": "Send updated schedule to owner by Friday",
        "owner": "other",
        "owner_email": "contractor@company.com",
        "owner_name": "John Smith",
        "due_date": "2026-06-27",
        "confidence": 0.85
      }
    ],
    "commitments": [
      {
        "text": "Will send revised drawings by Monday",
        "made_by_email": "arch@studio.com",
        "made_by_name": "Sarah Lee",
        "due_date": "2026-06-30",
        "confidence": 0.88
      }
    ],
    "pending_decisions": [
      {
        "question": "Should Clayco accept the $150k credit as settlement of the LWIC scope gap?",
        "context": "Owner offering credit; contractor says full cost is $280k. Ryan has not responded.",
        "confidence": 0.9
      }
    ],
    "risk_signals": [
      {
        "signal": "Schedule milestone for steel delivery appears to be slipping — 3-week lag mentioned",
        "severity": "medium",
        "project_hint": "Gotion",
        "confidence": 0.78
      }
    ],
    "decisions_made": [
      {
        "decision": "Owner approved the alternate roofing system",
        "decided_by": "owner",
        "all_parties": ["hankinsr@claycorp.com", "owner@client.com"],
        "confidence": 0.91
      }
    ],
    "key_facts": [
      {
        "fact": "Insulation scope is now confirmed at $2.4M per approved change order",
        "confidence": 0.95
      }
    ]
  }
}
```

**Extraction rules:**

`ai_summary` — Always required. Keep to 1-2 sentences. State the topic and current status.
Do not editorialize. "Owner sent revised GMP; Ryan has not replied in 3 days."

`context_type` — Classify as:
- `"work"` — involves a project, client, subcontractor, contract, or Clayco business
- `"personal"` — flights, family, health, banking, personal appointments
- `"mixed"` — clearly both

`action_items` — Explicit asks, next steps, or tasks. For Ryan: `owner: "ryan"`. For others:
`owner: "other"` + `owner_email` and `owner_name` if identifiable. Only include items with
clear language ("please send", "can you confirm", "by Friday"). Omit vague requests.

`commitments` — Statements where someone promised a future deliverable.
"I'll send that by EOD", "We will have drawings to you by Monday." Must be specific.
Only include if due_date or recipient is identifiable.

`pending_decisions` — Open questions where Ryan's input or decision is needed and hasn't
been given. Include context (what the options are, what's at stake). Omit if the question is
trivial or already answered within the thread.

`risk_signals` — Schedule, cost, scope, or contractual risk. Must be specific and real —
not generic. severity: `"low"` | `"medium"` | `"high"`. Include `project_hint` if the email
is clearly tied to a project (use the subject or company name).

`decisions_made` — Decisions that were actually made in the thread and are now final.
Not pending — made. "Owner approved X", "Parties agreed to Y."

`key_facts` — Specific, verifiable facts that may be useful later. Numbers, dates, parties,
specifications. "GMP is $48.2M." "Substantial completion date is Sept 15." Omit opinions.

**Omit any key entirely if no qualifying items exist.** An empty `action_items: []` is fine.
Do not manufacture items to fill the structure.

**Bucket 3 and 4 threads:** Extract `ai_summary` and `context_type` always. Extract other
fields only if clearly present — B3/B4 threads often have no action items for Ryan.

---

## Step 6 — Write classified report

**If RESUMING:** Merge `partial_classified[]` from the checkpoint with all newly classified
threads before building the final output. The combined set is the complete thread list.
Then delete the checkpoint file — a successful write means recovery succeeded:

```bash
rm -f "${DATA_PATH}/classify-checkpoint-${TODAY_ISO}.json"
echo "Checkpoint cleared — run complete."
```

**PRECONDITION:** Read the report file using the ABSOLUTE path detected in Step 0, immediately before the Write.
No other tool call between the Read and the Write.

```
Read: {DATA_PATH}/last-email-report.json
```
(Substitute the actual DATA_PATH value detected in Step 0, e.g. `/sessions/abc-xyz/mnt/personal-os/data/last-email-report.json`)

**CRITICAL — pass-through rule:** For every thread record in the output, include ALL fields
from the raw JSON thread object. Do NOT drop any field. The downstream Vercel processing job
(`process-email-report.js`) and the nightly AI job (Step 3.7 signature extraction, Step 3.55
email enrichment) depend on these fields being present:

- `full_thread_content` — required for contact signature extraction (Step 3.7) and email
  context enrichment (Step 3.55). If dropped, all contact profile enrichment breaks.
- `sent_body` — Ryan's last sent message in the thread; used for context enrichment.
- `extraction_depth` — signals to downstream jobs how much content is available.
- `thread_participants` — full list of unique email addresses across the thread.
- `my_last_reply_time`, `waiting_since` — used for urgency calculations in the dashboard.
- `thread_message_count`, `latest_sender`, `latest_sender_name` — displayed in dashboard.

You add classification fields (`bucket`, `urgency`, `tags`, `days_waiting`, `followed_up`,
`cross_reference_status`, `status`) to each thread. You do NOT remove anything.

Then immediately write the full classified payload:

```json
{
  "report_date": "[TODAY_ISO]",
  "calendar": [ /* from Task 1 raw JSON — pass through unchanged */ ],
  "bucket1": [
    {
      "from_address": "j.miller@fireproofing.com",
      "from_name": "J. Miller",
      "subject": "RE: Insulation scope clarification",
      "body_preview": "Ryan — attaching the Siplast...",
      "received_at": "2026-05-15T14:30:00Z",
      "status": "needs_reply",
      "bucket": 1,
      "urgency": "high",
      "tags": ["TIME_SENSITIVE", "CONTRACT_LANGUAGE", "EXTERNAL"],
      "days_waiting": 5,
      "followed_up": false,
      "cross_reference_status": "aging",
      "is_internal": false,
      "has_attachment": true,
      "is_time_sensitive": true,
      "has_contract_language": true,
      "is_flagged": false,
      "thread_participant_count": 3,
      "last_report_date": "[TODAY_ISO]",
      "conversation_id": "AAQkADFhYWFhYWFh",
      "full_thread_content": "Full message body... ---MESSAGE BREAK--- Previous message...",
      "sent_body": "Ryan's last sent message in this thread...",
      "extraction_depth": "full",
      "thread_message_count": 4,
      "thread_participants": ["j.miller@fireproofing.com", "hankinsr@claycorp.com"],
      "latest_sender": "j.miller@fireproofing.com",
      "latest_sender_name": "J. Miller",
      "my_last_reply_time": "2026-05-10T14:00:00Z",
      "waiting_since": "2026-05-10T16:30:00Z",
      "thread_subject": "LWIC coordination",
      "extracted": {
        "ai_summary": "J. Miller is waiting on Ryan's response re: Siplast insulation scope; thread has been open 5 days.",
        "context_type": "work",
        "action_items": [
          {
            "text": "Review Siplast insulation spec attachment and respond to Miller on scope clarification",
            "owner": "ryan",
            "due_date": null,
            "confidence": 0.94
          }
        ],
        "commitments": [],
        "pending_decisions": [
          {
            "question": "Is Siplast or alternate insulation system approved for the LWIC scope?",
            "context": "Miller attached spec and is waiting for Ryan's direction. No response yet after 5 days.",
            "confidence": 0.88
          }
        ],
        "risk_signals": [
          {
            "signal": "LWIC scope clarification unresolved for 5 days — may impact subcontractor procurement",
            "severity": "medium",
            "project_hint": "LWIC coordination",
            "confidence": 0.82
          }
        ],
        "decisions_made": [],
        "key_facts": []
      }
    }
  ],
  "bucket2": [],
  "bucket3": [],
  "bucket4": [],
  "bucket5": [],
  "bucket6_count": 14,
  "resolved_since_yesterday": [
    {
      "from_address": "schen@southbankdev.com",
      "conversation_id": "AAQkADFhYWFhXXXX",
      "thread_subject": "Southbank fee questions",
      "resolved_on": "[TODAY_ISO]"
    }
  ],
  "summary": {
    "total_needs_reply": 3,
    "total_waiting_on": 2,
    "total_oversight": 5,
    "total_documents": 1,
    "total_pending_invites": 0,
    "total_filtered": 14,
    "time_sensitive_count": 2,
    "contract_language_count": 1,
    "internal_count": 4,
    "external_count": 7,
    "urgency_critical_count": 1,
    "urgency_high_count": 2,
    "urgency_elevated_count": 3,
    "urgency_normal_count": 4,
    "large_thread_count": 2,
    "flagged_count": 1,
    "followed_up_count": 0
  }
}
```

After a successful write, log: `Classified JSON saved: ~/personal-os/data/last-email-report.json`

---

## Step 7 — Upload to Supabase storage

**Purpose:** Deliver the Phase 1B intelligence package (extracted fields, ai_summary, action_items,
commitments, risk_signals, etc.) to Supabase storage so the nightly AI job can load it at 6 AM.
This is a BONUS step — if it fails, the system degrades gracefully via the launchd fallback path.

**Classify DOES NOT push individual threads to the webhook.** That is launchd's job
(`push_email_report.py` at 5:00 AM). Two things push to the same webhook = duplicate email records.
Classify only writes: (1) local file, (2) storage JSON. Nothing else.

**Note:** This may fail in sandbox. Expected and non-blocking. Log failure in `warnings[]` and continue.
The local file (Step 6) is the critical dependency — it's already saved regardless of Step 7 outcome.

Primary path — PUT (upsert):
```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

On success, log: `Storage upload: daily-reports/[TODAY_ISO].json ✓`

On failure, retry once after 5 seconds. If still failing:
- Log: `Storage upload failed — sandbox_blocked. launchd will push threads via webhook at 5:00 AM.`
- Add to `warnings[]` and **stop**. Do NOT attempt per-thread webhook fallback.
- The local file is already saved. launchd will push threads. The Phase 1B enrichment will be
  unavailable in tonight's nightly job (it will use the emails TABLE fallback path instead).

**Do NOT call** `pipeline/complete-step`. That endpoint is owned by launchd (`push_email_report.py`)
and is called once after all threads are pushed. If classify also calls it, the timestamp gets set
before launchd runs, and the nightly job may start before all email records are in the database.

---

## Step 8 — Report back

Output this exact bordered summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EMAIL CLASSIFY (TASK 2) COMPLETE — [TODAY_ISO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  BUCKETS
  ────────────────────────────────────────────────────
  Bucket 1 — Needs Reply:     X threads  [X aging, X critical]
  Bucket 2 — Waiting On:      X threads  [X aging]
  Bucket 3 — Oversight/FYI:   X threads
  Bucket 4 — Documents:       X threads
  Bucket 5 — Pending Invites: X
  Bucket 6 — Filtered:        X  (not pushed)

  URGENCY
  ────────────────────────────────────────────────────
  🔴 Critical (7+ days):  X
  🟠 High (4–6 days):     X
  🟡 Elevated (2–3 days): X
  ⚪ Normal (0–1 days):   X

  FLAGS
  ────────────────────────────────────────────────────
  Flagged:               X
  Time-sensitive:        X
  Contract language:     X
  Has attachment:        X
  Large thread (≥6):     X
  Internal:              X
  External:              X

  DELTA
  ────────────────────────────────────────────────────
  New since yesterday:   X
  Aging (carried over):  X
  Resolved:              X

  JSON saved:            ~/personal-os/data/last-email-report.json  ✓
  Storage upload:        daily-reports/[TODAY_ISO].json  [success | failed | sandbox_blocked]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUCKET 1 — NEEDS MY REPLY (X threads)
─────────────────────────────────────
[🚩 FLAGGED] [🔴 CRITICAL] [TIME_SENSITIVE] [CONTRACT_LANGUAGE]
Thread: [threadSubject]
Latest from: [latestSenderName] · [days_waiting]d ago
Participants: [thread_participant_count] people  ·  [threadMessageCount] messages
Action: [one-sentence summary of the explicit ask]
─────────────────────────────────────
[repeat for each Bucket 1 thread]

BUCKET 2 — WAITING ON THEM (X threads)
─────────────────────────────────────
[🟠 HIGH] [AGING] [FOLLOWED_UP if applicable]
Thread: [threadSubject]
Waiting on: [latest sender or recipient of Ryan's last sent message]
Ryan's last message: [days_waiting]d ago
Follow-up sent: [yes / no]
─────────────────────────────────────
[repeat for each Bucket 2 thread]
```

If any step had a failure, append:
```
  WARNINGS
  ────────────────────────────────────────────────────
  [List any failed uploads, skipped threads, or errors]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Newsletter AI layer ready to run.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Scheduling

Runs at **4:25 AM daily** via Cowork scheduled task.
Task 1 (email-pull-raw) runs at **4:05 AM** and writes the input this task reads.

**Manual trigger:** "run email classify" or "classify email threads"

If `last-email-report.json` is missing or stale (not today's date), log:
`Task 1 output not found for today. Skipping. Check email-pull-raw task logs.`
Then stop — do not attempt to pull email data.
