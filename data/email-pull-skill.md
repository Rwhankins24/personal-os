---
name: email-pull
description: >
  Morning email classification pipeline for Ryan Hankins. Pulls inbox and sent items
  from Outlook (last 48h), classifies into 6 buckets by thread, cross-references against
  yesterday's report, tags each thread with metadata, pushes to personal-os webhook,
  and saves a structured handoff JSON for the 6:05am AI newsletter layer.
  Run this before the morning-newsletter skill. Trigger on: "pull my emails",
  "classify inbox", "run email pull", "morning email prep", or on schedule at 6:00am.
---

# Email Pull & Classification Pipeline

You are Ryan Hankins' morning email intelligence layer. You run at 6:00 AM, before
the newsletter AI job. Your job: pull, group by thread, classify, cross-reference,
push to the database, and save the handoff JSON. You do NOT write the newsletter —
that's the next job.

**The unit of classification is a THREAD, not an individual email.**

**Output target:** `~/personal-os/data/last-email-report.json`
**Storage upload:** `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json`
**Storage fallback (webhook):** `https://personal-os-five-black.vercel.app/api/webhooks?type=email`
**Delivery:** hankinsr@claycorp.com

**Runtime credentials (for Step 6):**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`

---

> **PULL WINDOW vs DISPLAY WINDOW — these are different things:**
>
> - **Pull window:** last 48 hours for new inbox items
> - **Sent scan:** last 14 days for waiting-on items
> - **Display window:** dashboard shows a rolling 4-week window of all unresolved threads
>
> The pull adds new items daily. The database retains them for 28 days.
> The dashboard surfaces all unresolved threads within that 28-day window.
> Items are cleared only when manually resolved or auto-archived after 28 days.

---

## Resilience Rules

These rules govern behavior when API calls fail, return partial results, or hit
connector constraints. Apply them throughout every step — do not wait until a
failure to recall them.

1. **Split queries — never combine.** The Microsoft 365 connector cannot combine
   `query` + `folderName` + `afterDateTime` in a single call. Always use either
   keyword-only queries (`query:` alone) or folder+date queries (`folderName:` +
   `afterDateTime:`), never both at once.

2. **Min limit is 100.** Always set `limit` to at least 100. Use 100 as the
   default for all queries unless a smaller sample is intentional (e.g., the
   Bucket 6 count query). If you expect more than 100 results, run a second
   query with different filters — do not assume one pass captures everything.

3. **Sent folder is always a separate call.** Never attempt to pull sent items
   in the same call as inbox items. Sent items require `folderName: "sentitems"`
   as a standalone request.

4. **Calendar always runs.** Step 2D (calendar pull) executes independently of
   all other steps. If inbox queries fail entirely, still pull the calendar.
   Never skip it.

5. **Partial success is OK.** If one query returns an error or empty result,
   continue with the remaining queries. Classify what you have. A partial run
   is better than no run.

6. **No silent abort.** Even if Steps 2–6 have failures, always complete Step 8
   (save the handoff JSON with whatever data was collected) and Step 9 (print the
   summary). Never exit early without a report.

7. **Deduplicate before classifying.** After all inbox queries complete, merge
   results and deduplicate by `conversationId`. Keep the most recent message per
   thread as the representative record. A thread seen in two queries is one thread.

8. **Storage upload retry once.** If the Supabase storage upload fails, retry
   once after a 5-second pause. If it fails again, fall back to direct webhook
   push (individual thread posts). If the fallback webhook push also fails for
   a thread, log the subject and continue — do not abort the run.

9. **JSON always saves last.** Step 7 (save handoff JSON) runs after Step 6
   (storage upload or webhook push) completes or fails. The handoff JSON
   reflects the actual state of the run. Never save the JSON before the upload
   attempt.

10. **If the connector is unavailable**, note "MCP connector unavailable" in the
    Step 9 summary, write a skeleton JSON to the output file with today's date
    and empty buckets, and stop. Do not attempt to use browser automation or
    any other fallback to access Outlook.

---

## Step 1 — Setup

```bash
date '+%Y-%m-%d'
```

Store `TODAY_ISO`. Then load yesterday's report if it exists:

```bash
cat ~/personal-os/data/last-email-report.json 2>/dev/null || echo "{}"
```

Store as `YESTERDAY_REPORT`. Extract the list of `conversationId` values from all
bucket arrays to use as the cross-reference baseline.

---

## Step 2 — Pull inbox, sent items, invites, and calendar in parallel

Run all sub-steps concurrently where possible. Each is a separate API call.

### 2A — Inbox (split into 4 queries — DO NOT combine)

**Query 2A-1 — Recent inbox by date (folder + date filter, no keyword):**
- `folderName: "inbox"`, `afterDateTime: 48h ago`, `limit: 100`
- Captures everything recent. No `query:` parameter.

**Query 2A-2 — Urgent/action keywords (keyword only, no folder/date):**
- `query: "urgent OR deadline OR ASAP OR \"action required\" OR \"please respond\" OR approval"`
- `limit: 100`
- No `folderName:` or `afterDateTime:` parameter.

**Query 2A-3 — Contract language keywords (keyword only):**
- `query: "contract OR agreement OR indemnity OR lien OR \"change order\" OR GMP OR \"sign off\" OR execute"`
- `limit: 100`
- No `folderName:` or `afterDateTime:` parameter.

**Query 2A-4 — Signature/document keywords (keyword only):**
- `query: "DocuSign OR signature OR exhibit OR submittal OR drawing OR spec"`
- `limit: 100`
- No `folderName:` or `afterDateTime:` parameter.

After all 4 queries return: merge results. For each email capture these fields:

**Standard fields:**
- `from_address`, `from_name`, `subject`, `body_preview` (first 200 chars), `received_at`

**Thread fields (capture for every email):**
- `conversationId` — the thread identifier from the Outlook API response
- `latestSender` — `from_address` of the most recent message in the thread
- `latestSenderName` — `from_name` of the most recent message
- `latestMessageTime` — `received_at` of the most recent message in the thread
- `threadMessageCount` — total number of messages in the thread
- `myLastReplyTime` — most recent time Ryan (`hankinsr@claycorp.com`) sent a message
  in this thread; `null` if Ryan has never replied
- `waitingSince` — `received_at` of the last message NOT from Ryan; this is when
  the reply clock started

**Classification flags:**
- **Internal check:** is the domain `@claycorp.com`, `@clayco.com`, `@ljcdesign.com`,
  `@crg.com`, `@concretestrategies.com`, or `@ventanaconstruction.com`?
  If yes → `is_internal: true`
- **Attachment check:** does the body reference an attachment, PDF, drawing, spec, or
  contract? → `has_attachment: true`
- **Contract language check:** does the subject or body contain any contract language
  trigger phrase (see reference list at bottom)? → `has_contract_language: true`
- **Time sensitive check:** does the subject or body contain: "urgent", "ASAP",
  "deadline", "today", "EOD", "end of day", "by Friday", "immediately",
  "time sensitive"? → `is_time_sensitive: true`
- **Flagged check:** is the email flagged or starred in Outlook? → `is_flagged: true`
- **Thread participant count:** count unique email addresses across all messages in
  the thread (To + CC combined). Store as `thread_participant_count`. If >= 6,
  add tag `"LARGE_THREAD"`.

### 2B — Sent items (split into 2 queries — ALWAYS separate from inbox)

**Query 2B-1 — Sent last 7 days:**
- `folderName: "sentitems"`, `afterDateTime: 7d ago`, `limit: 100`
- No `query:` parameter.

**Query 2B-2 — Sent days 8–14:**
- `folderName: "sentitems"`, `afterDateTime: 14d ago`, `beforeDateTime: 7d ago`, `limit: 100`
- No `query:` parameter.

Capture all the same thread fields as Step 2A for each sent item. These records
are merged with inbox results before thread grouping in Step 2.5 so that
`myLastReplyTime` and `waitingSince` can be computed accurately across the full
thread history.

### 2C — Pending calendar invites

Use `outlook_email_search` with:
```
query: "has invited you OR meeting request OR invitation"
```

For each invite extract:
- `organizer_name`, `organizer_email`
- `meeting_title`
- `proposed_start_time`, `proposed_end_time`
- `days_pending` = TODAY minus `received_at` in days
- `my_response_status` (none / tentative / accepted / declined)

Only include invites where `my_response_status = "none"`.
These go into Bucket 5 automatically — no further thread grouping needed.

### 2D — Today's calendar (always runs independently)

Use `outlook_calendar_search` for today only. For each event capture:
- `title`, `start_time`, `end_time`, `location`, `join_link`, `organizer`
- `attendees` (array, first 5)

This goes into the `calendar` array of the handoff JSON so the newsletter AI layer
already has today's schedule without making a second calendar API call.

Even if all inbox queries fail, still complete this step. Calendar data is independent.

### 2E — Filtered sender count (keyword only)

Run one additional query to estimate Bucket 6 volume:
- `query: "noreply OR notifications OR newsletter OR unsubscribe OR LinkedIn"`
- `limit: 100`
- Count results. This becomes `bucket6_count` in the summary. Do NOT classify or push these.

---

## Step 2.5 — Group emails by thread

Before classification, group all inbox + sent results by `conversationId`.

For each thread group:

**Identify the representative record:**
- Keep only the most recent message as the representative (highest `received_at`)
- Attach `threadMessageCount` (count of all messages across inbox + sent for this thread)
- Set `threadSubject` = original subject with RE:, FWD:, and EXT: prefixes stripped
- Set `threadParticipants` = array of unique email addresses across all messages (To + From + CC)
- Set `latestSender` = `from_address` of the most recent message
- Set `latestSenderName` = `from_name` of the most recent message
- Set `myLastReplyTime` = most recent sent_at where `from_address = "hankinsr@claycorp.com"`, else `null`
- Set `waitingSince` = `received_at` of the most recent message NOT from Ryan, else `null`

**Thread classification rules (apply in order, assign first match):**

```
IF latestSender is NOT Ryan
   AND myLastReplyTime is null
   → Ryan has never replied → candidate for Bucket 1

IF latestSender is NOT Ryan
   AND myLastReplyTime exists
   AND latestMessageTime > myLastReplyTime
   → New message arrived since Ryan last replied → candidate for Bucket 1

IF latestSender IS Ryan
   AND no reply has arrived since myLastReplyTime
   → Ryan sent last, waiting on them → Bucket 2

IF latestSender IS Ryan
   AND a reply arrived after myLastReplyTime
   → Active thread, Ryan may still need to respond
   → Evaluate body for explicit ask; if none, assign Bucket 3
```

**After grouping:** each `conversationId` appears exactly once going into Step 3.
If a `conversationId` is missing (API did not return it), fall back to grouping by
normalized subject (strip RE:/FWD: prefixes) + thread participants.

---

## Step 2.5B — Tiered context extraction

After thread grouping, fetch additional context based on urgency and bucket classification. This step runs while still in the Outlook session — before closing the connector.

### TIER 1 — Full thread extraction

For every thread where:
- `bucket = 1` AND `urgency IN ('critical', 'high')`
- OR `has_contract_language = true`
- OR `is_time_sensitive = true` AND `days_waiting >= 3`

Fetch the complete message body for the most recent 3 messages in the thread using `outlook_email_search` with the thread subject. Store as:
- `full_thread_content`: concatenated message bodies separated by `"---MESSAGE BREAK---"`
- `extraction_depth: "full"`

### TIER 2 — Extended preview extraction

For every thread where:
- `bucket = 1` AND `urgency = 'normal'`
- OR `bucket = 2`

Fetch extended body preview — first 1000 characters of most recent message. Store as:
- `extended_preview`: first 1000 chars
- `extraction_depth: "extended"`

### TIER 3 — Standard (no additional fetch)

All other buckets. Keep existing `body_preview`.
- `extraction_depth: "standard"`

After extraction update each email payload with these additional fields:
- `full_thread_content`: string or null
- `extraction_depth`: `"full"` | `"extended"` | `"standard"`

Log extraction summary:
```
Tier 1 (full): X threads
Tier 2 (extended): X threads
Tier 3 (standard): X threads
```

---

## Step 3 — Classify threads into 6 buckets

Process each thread (represented by its most recent message) through this decision
tree in order. Assign the FIRST bucket that matches.

### Bucket 1 — Needs Reply

- Ryan appears in the TO field of any message in the thread
- Latest message is NOT from Ryan (`latestSender ≠ hankinsr@claycorp.com`)
- Thread contains an explicit ask, question, or action request directed at Ryan
- Not spam or automated

**Sort order within Bucket 1 (apply in priority sequence):**
1. `is_flagged: true` — flagged items always surface first
2. `is_time_sensitive: true` AND `has_contract_language: true`
3. `is_time_sensitive: true` only
4. `has_contract_language: true` only
5. `is_internal: false` (external contacts before internal)
6. `days_waiting` descending (oldest unanswered first)
7. `importance: "high"` from Outlook

### Bucket 2 — Waiting On Them

- Ryan sent the most recent message (`latestSender = hankinsr@claycorp.com`)
- No reply has arrived more than 48 hours after Ryan's last message
- `days_waiting` = days since `myLastReplyTime`
- Set `followed_up: true` if Ryan sent more than one message in this thread with no reply
- Flag as AGING if `days_waiting >= 5`

**Sort order:** AGING first, then `days_waiting` descending.

### Bucket 3 — Oversight / FYI

- Ryan is CC'd only (not TO) across all messages in the thread
- OR thread is informational with no direct ask to Ryan
- OR LARGE_THREAD (6+ participants) with no direct ask to Ryan

**Sort order:** most recent `latestMessageTime` first.

### Bucket 4 — Documents / Contracts / Drawings

- Thread contains an attachment or contract language
- AND explicit review or approval request is present

`status: "needs_reply"` if review/approval requested, otherwise `"read"`.

**Sort order:** `CONTRACT_LANGUAGE` threads first, then `days_waiting` descending.

### Bucket 5 — Pending Invites

All invites from Step 2C with `my_response_status = "none"`.
`status: "needs_reply"`. Sort by `proposed_start_time` ascending (soonest first).

### Bucket 6 — Filtered

Automated senders: `@noreply`, `@notifications`, `@marketing`, newsletters,
LinkedIn digest, vendor promotions. Do NOT push to webhook. Count only.

---

## Step 4 — Cross-reference against yesterday's report

For each thread in Buckets 1–5, check if its `conversationId` appeared in
yesterday's report:

- **Not in yesterday's report** → `cross_reference_status: "new"`
- **In yesterday's bucket 1 or 2, still unresolved** → `cross_reference_status: "aging"`, increment `days_waiting`
- **Was in yesterday's report, now resolved** → `cross_reference_status: "resolved"`, add to `resolved_since_yesterday` list

---

## Urgency Escalation Rules

Apply after cross-referencing. Set `urgency` on every thread in Buckets 1–5
based on `days_waiting`:

| days_waiting | urgency | Dashboard color |
|---|---|---|
| 0–1 | `"normal"` | No highlight |
| 2–3 | `"elevated"` | Yellow |
| 4–6 | `"high"` | Orange |
| 7+  | `"critical"` | Red |

For Bucket 1 threads, also escalate to `"elevated"` minimum if
`is_time_sensitive: true`, regardless of days_waiting.

---

## Step 5 — Build tags array

For each thread, populate `tags: []` with applicable values:

| Tag | Condition |
|---|---|
| `TIME_SENSITIVE` | `is_time_sensitive: true` |
| `CONTRACT_LANGUAGE` | `has_contract_language: true` |
| `EXTERNAL` | `is_internal: false` |
| `HAS_ATTACHMENT` | `has_attachment: true` |
| `AGING` | `cross_reference_status: "aging"` |
| `INTERNAL` | `is_internal: true` |
| `LARGE_THREAD` | `thread_participant_count >= 6` |
| `FLAGGED` | `is_flagged: true` |
| `FOLLOWED_UP` | `followed_up: true` (Bucket 2 only) |

---

## Step 6 — Write JSON to Supabase storage

Instead of pushing individual threads directly to the webhook, upload the complete
classified report as a single JSON file to Supabase storage. The Vercel processing
job (`/api/jobs/process-email-report`) reads this file and handles all database
upserts asynchronously.

**Primary path — Supabase REST storage upload:**

```bash
curl -X POST \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -d "[FULL_JSON_PAYLOAD]"
```

Where:
- `[TODAY_ISO]` = today's date in YYYY-MM-DD format (e.g. `2026-05-15`)
- `[FULL_JSON_PAYLOAD]` = the complete `last-email-report.json` contents built in Step 7

If the file already exists for today (HTTP 409), use `PUT` (upsert/overwrite):

```bash
curl -X PUT \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/[TODAY_ISO].json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  -H "x-upsert: true" \
  -d "[FULL_JSON_PAYLOAD]"
```

**On success**, log:
```
JSON uploaded to Supabase storage: daily-reports/[TODAY_ISO].json
```

Then immediately post a pipeline completion marker:

```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"step":"upload","run_date":"[TODAY_ISO]"}'
```

**On failure**, retry once after 5 seconds using the same curl command. If it still
fails, fall back to the direct webhook push:

```
FALLBACK: Supabase storage upload failed — pushing threads individually to webhook.
```

Then push each thread from Buckets 1–5 individually to:
`https://personal-os-five-black.vercel.app/api/webhooks?type=email`

For each thread POST this payload:
```json
{
  "from_address": "j.miller@fireproofing.com",
  "from_name": "J. Miller",
  "subject": "RE: Insulation scope clarification — LWIC coordination",
  "thread_subject": "LWIC coordination",
  "body_preview": "Ryan — attaching the Siplast product data...",
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
  "last_report_date": "2026-05-15",
  "conversation_id": "AAQkADFhYWFhYWFh",
  "thread_message_count": 4,
  "thread_participants": ["j.miller@fireproofing.com", "hankinsr@claycorp.com"],
  "latest_sender": "j.miller@fireproofing.com",
  "latest_sender_name": "J. Miller",
  "my_last_reply_time": "2026-05-10T14:00:00Z",
  "waiting_since": "2026-05-10T16:30:00Z"
}
```

If a fallback webhook push fails, retry once after 2 seconds. If still failing, log
the subject and continue — do not abort the run.

---

## Step 7 — Save handoff JSON

Write the complete report to `~/personal-os/data/last-email-report.json`.
This step always runs — even if earlier steps had partial failures.

**Full output structure:**

```json
{
  "report_date": "2026-05-15",
  "calendar": [
    {
      "title": "Southbank pursuit — scope alignment",
      "start_time": "2026-05-15T16:00:00Z",
      "end_time": "2026-05-15T17:00:00Z",
      "location": "Southbank Tower, 22nd Floor",
      "join_link": "https://teams.microsoft.com/meet/southbank-scope",
      "organizer": "Sarah Chen",
      "attendees": ["Sarah Chen", "Marcus Powell", "Tom Walsh", "Ryan Hankins"]
    }
  ],
  "bucket1": [
    {
      "from_address": "j.miller@fireproofing.com",
      "from_name": "J. Miller",
      "subject": "RE: Insulation scope clarification",
      "body_preview": "Ryan — attaching the Siplast...",
      "received_at": "2026-05-15T14:30:00Z",
      "status": "needs_reply",
      "importance": "high",
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
      "last_report_date": "2026-05-15",
      "conversation_id": "AAQkADFhYWFhYWFh",
      "thread_message_count": 4,
      "thread_participants": [
        "j.miller@fireproofing.com",
        "d.kowalski@kowalskiroofing.com",
        "hankinsr@claycorp.com"
      ],
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
      "thread_subject": "Southbank fee structure questions",
      "resolved_on": "2026-05-15"
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

---

## Step 8 — Report back

After saving the JSON, output this exact bordered summary block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EMAIL PULL COMPLETE — [TODAY_ISO]
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

  Storage upload:        daily-reports/[TODAY_ISO].json (or fallback: X threads to webhook)
  JSON saved:            ~/personal-os/data/last-email-report.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUCKET 1 — NEEDS MY REPLY (X threads)
─────────────────────────────────────
[🚩 FLAGGED] [🔴 CRITICAL] [TIME_SENSITIVE] [CONTRACT_LANGUAGE]
Thread: [threadSubject]
Latest from: [latestSenderName] · [days_waiting]d ago
Participants: [thread_participant_count] people  ·  [threadMessageCount] messages
Action: [one-sentence summary of the explicit ask from the latest message]
─────────────────────────────────────
[repeat for each Bucket 1 thread]

BUCKET 2 — WAITING ON THEM (X threads)
─────────────────────────────────────
[🟠 HIGH] [AGING] [FOLLOWED_UP if applicable]
Thread: [threadSubject]
Waiting on: [latest_sender_name or recipient of Ryan's last sent message]
Ryan's last message: [days_waiting]d ago
Follow-up sent: [yes / no]
─────────────────────────────────────
[repeat for each Bucket 2 thread]
```

If any step had a failure or partial result, append a WARNINGS section:

```
  WARNINGS
  ────────────────────────────────────────────────────
  [List any failed webhook pushes, API errors, or skipped threads here]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Newsletter AI layer ready to run.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Bucket definitions reference

| Bucket | Name | Status pushed | Unit |
|--------|------|---------------|------|
| 1 | Needs Reply | `needs_reply` | Thread |
| 2 | Waiting On | `waiting_on` | Thread |
| 3 | Oversight/FYI | `read` | Thread |
| 4 | Documents | `needs_reply` or `read` | Thread |
| 5 | Pending Invites | `needs_reply` | Invite |
| 6 | Filtered | — | Count only |

## Internal domain list

`@claycorp.com`, `@clayco.com`, `@ljcdesign.com`, `@crg.com`,
`@concretestrategies.com`, `@ventanaconstruction.com`

## Contract language trigger phrases

`contract`, `agreement`, `clause`, `language`, `indemnity`, `liability`,
`lien`, `change order`, `GMP`, `scope of work`, `addendum`, `exhibit`,
`terms`, `conditions`, `sign off`, `execute`, `wet signature`

---

## Scheduling

This skill is designed to run automatically at **6:00 AM daily** as a scheduled
Cowork task, before the `morning-newsletter` skill fires at 6:05 AM.

**Manual trigger phrases:**
- "pull my emails"
- "classify inbox"
- "run email pull"
- "morning email prep"

**Scheduled task config:**
```json
{
  "name": "email-pull-daily",
  "schedule": "0 6 * * *",
  "skill": "email-pull",
  "description": "Morning email classification pipeline — runs before newsletter at 6:05am"
}
```

The handoff JSON at `~/personal-os/data/last-email-report.json` is the contract
between this skill and the `morning-newsletter` skill. If this skill did not run,
the newsletter will use the previous day's data and note the stale date.
