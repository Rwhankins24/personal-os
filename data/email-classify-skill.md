---
name: email-classify
description: >
  Task 2 of 2 in the morning email pipeline. Reads raw thread data from
  ~/personal-os/data/last-email-raw.json (written by Task 1 at 4:05 AM).
  Classifies threads into 6 buckets, applies urgency scoring, cross-references
  against yesterday's report, builds tags, writes final classified report to
  ~/personal-os/data/last-email-report.json, and uploads to Supabase storage.
  NO M365 connector calls. NO data pulling. Classification and output only.
  Runs at 4:25 AM, 20 minutes after Task 1.
---

# Email Classify — Classification & Output (Task 2 of 2)

You are Task 2 of Ryan Hankins' morning email pipeline. Task 1 ran at 4:05 AM and wrote
`~/personal-os/data/last-email-raw.json`. Your job is to read that file, classify every
thread into 6 buckets, apply urgency and tags, and write the final classified report.

**You make ZERO M365 connector calls. All email data is already in the raw JSON.**
**You do NOT re-pull anything from Outlook.**

**Input:**  `~/personal-os/data/last-email-raw.json` (written by Task 1)
**Output:** `~/personal-os/data/last-email-report.json` (read by the newsletter)
**Upload:** `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json`

**Runtime credentials (for Step 6 upload):**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`

---

## Step 1 — Read raw input

```bash
cat ~/personal-os/data/last-email-raw.json
```

Parse the JSON. Verify `report_date` is today. If the file doesn't exist or `report_date`
is not today, log a warning and stop — Task 1 did not complete. Do not attempt to pull
email data yourself.

From the raw JSON, store:
- `threads[]` — all thread records from Task 1
- `calendar[]` — today's calendar events
- `pending_invites[]` — unanswered meeting invites
- `yesterday_conv_ids[]` — previous report's conversationIds (for cross-reference)
- `bucket6_count` — filtered sender count
- `TODAY_ISO` — from `report_date`

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

Automated senders: `@noreply`, `@notifications`, `@marketing`, newsletters, LinkedIn,
vendor promotions. These are already counted in `bucket6_count` from Task 1.
Do NOT include in output buckets. Use the `bucket6_count` directly.

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

## Step 6 — Write classified report

**PRECONDITION:** Read `~/personal-os/data/last-email-report.json` immediately before the Write.
No other tool call between the Read and the Write.

```
Read: ~/personal-os/data/last-email-report.json
```

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
      "thread_subject": "LWIC coordination"
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

**Note:** This may fail in sandbox. Expected and non-blocking. Log failure in `warnings[]` and continue.

Primary path — PUT (upsert):
```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

On success, post pipeline completion marker:
```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"step":"upload","run_date":"[TODAY_ISO]"}'
```

On failure, retry once after 5 seconds. If still failing, fall back to direct webhook push:
For each thread in Buckets 1–5, POST to `https://personal-os-five-black.vercel.app/api/webhooks?type=email`

Use the same payload structure as each thread record (see Step 6 schema). If fallback
webhook push fails for a thread, log the subject and continue.

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

If `last-email-raw.json` is missing or stale (not today's date), log:
`Task 1 output not found for today. Skipping. Check email-pull-raw task logs.`
Then stop — do not attempt to pull email data.
