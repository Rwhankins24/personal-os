---
name: email-pull-raw
description: >
  Task 1 of 2 in the morning email pipeline. Pulls all inbox, sent, calendar, and invite
  data from M365 via batched time-sliced queries. Groups emails by thread. Extracts tiered
  context (full body for high-priority threads). Writes raw structured JSON to
  ~/personal-os/data/last-email-raw.json for Task 2 (email-classify) to process.
  NO classification. NO bucketing. Just data acquisition and thread grouping.
  Runs at 4:05 AM. Task 2 (classify) runs at 4:25 AM.
---

# Email Pull — Raw Data Acquisition (Task 1 of 2)

You are Task 1 of Ryan Hankins' morning email pipeline. Your ONLY job is to pull data
from M365, group emails by thread, extract context, and write a raw JSON handoff file.

**You do NOT classify threads into buckets. You do NOT assign urgency. You do NOT upload
to Supabase. All of that happens in Task 2 (email-classify) at 4:25 AM.**

**Output target:** `~/personal-os/data/last-email-raw.json`
**Next task reads:** `~/personal-os/data/last-email-raw.json` at 4:25 AM

---

## Resilience Rules

Apply throughout every step.

1. **Split queries — never combine.** M365 connector cannot combine `query` + `folderName`
   + `afterDateTime` in one call. Use keyword-only OR folder+date — never both at once.

2. **Min limit is 100.** Always set `limit: 100` on every query.

3. **Sent folder always separate.** Never pull sent items in the same call as inbox.

4. **Calendar always runs.** Step 2D executes independently. Never skip it.

5. **Partial success is OK.** If one query fails, continue with the rest. Write whatever
   was collected. A partial raw file is better than no file.

6. **No silent abort.** Always complete Step 3 (write the raw JSON) even if earlier steps
   had failures. Never exit early without writing a file.

7. **Deduplicate after all queries complete.** Merge inbox results and deduplicate by
   `conversationId` before thread grouping. One thread = one record.

8. **Write BEFORE anything else.** The local JSON write is the only guaranteed delivery.
   No upload, no Supabase call, no webhook. Just the file write.

9. **Re-read immediately before Write.** Read `~/personal-os/data/last-email-raw.json`
   directly before the Write call. No other tool call in between.

10. **Batched M365 queries — max 3 concurrent.** Never fire all time slices at once.
    Run in groups of 3 to prevent socket drops. See Step 2A for batching rules.

11. **MANDATORY PAGINATION — every query must paginate.**
    The M365 connector returns a maximum of 25 results per call regardless of `limit`.
    25 is a page size, not a total cap. After every query, check if the last item in
    the result array contains a `nextOffset` field. If it does, immediately call the
    same query again with `offset: [nextOffset value]`. Repeat until a response contains
    no `nextOffset`. Collect ALL pages before moving to the next slice or query.
    A query that stops at the first page silently drops all results beyond page 1.
    Log page counts: `Slice 0: page 1 (25) + page 2 (18) = 43 results`.

---

## Step 0 — Detect workspace path (REQUIRED before any file operation)

**The Read and Write tools require absolute paths. `~` does not resolve in the Cowork tool context.
You MUST detect the correct absolute path before any Read, Write, or Bash file operation.**

```bash
WORKSPACE_PATH=$(find /sessions -maxdepth 5 -name "personal-os" -type d 2>/dev/null | head -1)
if [ -z "$WORKSPACE_PATH" ]; then
  WORKSPACE_PATH="$HOME/personal-os"
fi
echo "Workspace path: $WORKSPACE_PATH"
DATA_PATH="${WORKSPACE_PATH}/data"
echo "Data path: $DATA_PATH"
```

Store `WORKSPACE_PATH` and `DATA_PATH`. Use them in ALL subsequent file Read/Write/Bash operations.
Every `~/personal-os/data/...` reference in this skill means `${DATA_PATH}/...` with the actual detected path.

---

## Step 1 — Setup

```bash
date '+%Y-%m-%d'
```

Store `TODAY_ISO`.

**Determine PULL_SINCE** — read from local file first, Supabase as fallback:

```bash
cat "${DATA_PATH}/last-email-raw.json" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ts = d.get('generated_at') or d.get('pull_since') or ''
    print(ts.strip())
except:
    print('')
"
```

- If `generated_at` is found in the local file → use that as `PULL_SINCE` (this is the timestamp of the last successful pull, works even without network)
- If local file is missing or empty → try Supabase pipeline_status as fallback
- If both fail → default to 48h ago

**This eliminates the Supabase dependency for PULL_SINCE.** The local file is always written at the end of every successful run, so it's the most reliable source. Travel gaps are handled automatically — if you're gone 5 days, the file still has the last real pull timestamp.

Log: `"Pull window: from [PULL_SINCE] to now (source: local-file | supabase | 48h-default)"`

**Load yesterday's conversationIds for Task 2's cross-reference:**

```bash
cat "${DATA_PATH}/last-email-report.json" 2>/dev/null || echo "{}"
```

Extract all `conversationId` values from all bucket arrays. Store as `YESTERDAY_CONV_IDS` list.
This goes into the output JSON so Task 2 doesn't need to read any other file.

---

## Step 2 — Pull all data (M365)

### 2A — Inbox queries

**Standard pull (windowHours ≤ 48):** One inbox query covering the full pull window,
then paginate completely before moving on.

```
Query 2A-1:
  folderName: "inbox"
  afterDateTime: PULL_SINCE
  limit: 100
  → paginate with offset until no nextOffset
```

**Recovery pull (windowHours > 48):** Split into daily chunks and run up to 3 concurrently,
paginating each chunk fully before moving to the next batch.

```
For each day D in [PULL_SINCE .. now]:
  folderName: "inbox"
  afterDateTime: D 00:00 UTC
  beforeDateTime: D+1 00:00 UTC  (last chunk: omit beforeDateTime)
  limit: 100
  → paginate until no nextOffset
Batch: run 3 chunks concurrently, wait, then next 3.
```

**PAGINATION IS MANDATORY.** See Resilience Rule 11. Never stop at page 1.
Log page counts: `Inbox: page 1 (25) + page 2 (25) + page 3 (17) = 67 results`

If any query returns a socket error, retry once before skipping.

**Keyword queries (run concurrently with inbox, or immediately after):**

Query 2A-2 — Urgent/action:
- `query: "urgent OR deadline OR ASAP OR \"action required\" OR \"please respond\" OR approval"`
- `limit: 100`, no `folderName:` or `afterDateTime:`
- **Paginate until no `nextOffset`**

Query 2A-3 — Contract language:
- `query: "contract OR agreement OR indemnity OR lien OR \"change order\" OR GMP OR \"sign off\" OR execute"`
- `limit: 100`, no `folderName:` or `afterDateTime:`
- **Paginate until no `nextOffset`**

Query 2A-4 — Signatures/documents:
- `query: "DocuSign OR signature OR exhibit OR submittal OR drawing OR spec"`
- `limit: 100`, no `folderName:` or `afterDateTime:`
- **Paginate until no `nextOffset`**

**After all queries return:** merge + deduplicate by `conversationId`.
Log: `Inbox: X | Keywords: X | Total unique threads: X (after dedup)`

**For each email, capture these fields:**

Standard:
- `from_address`, `from_name`, `subject`, `body_preview` (first 200 chars), `received_at`

Thread fields:
- `conversationId` — thread identifier from Outlook API
- `latestSender` — `from_address` of most recent message
- `latestSenderName` — `from_name` of most recent message
- `latestMessageTime` — `received_at` of most recent message
- `threadMessageCount` — total messages in thread
- `myLastReplyTime` — most recent time `hankinsr@claycorp.com` sent in this thread; `null` if never
- `waitingSince` — `received_at` of last message NOT from Ryan; `null` if Ryan sent last

Classification flags (compute now — Task 2 uses these):
- `is_internal`: domain is `@claycorp.com`, `@clayco.com`, `@ljcdesign.com`, `@crg.com`, `@concretestrategies.com`, or `@ventanaconstruction.com`
- `has_attachment`: body references attachment, PDF, drawing, spec, or contract
- `has_contract_language`: subject or body contains contract trigger phrase (see reference list at bottom)
- `is_time_sensitive`: subject or body contains: urgent, ASAP, deadline, today, EOD, end of day, by Friday, immediately, time sensitive
- `is_flagged`: email is flagged or starred in Outlook
- `thread_participant_count`: unique email addresses across all messages (To + CC combined)

### 2B — Sent items (2 queries, always separate from inbox)

Query 2B-1 — Sent since last pull:
- `folderName: "sentitems"`, `afterDateTime: PULL_SINCE`, `limit: 100`
- No `query:`
- **Paginate until no `nextOffset`** (see Resilience Rule 11)

Query 2B-2 — Sent overlap buffer:
- `folderName: "sentitems"`, `afterDateTime: 14d ago`, `beforeDateTime: PULL_SINCE`, `limit: 100`
- No `query:`
- **Paginate until no `nextOffset`**

Capture all thread fields same as inbox. These are merged with inbox results in Step 2.5
so `myLastReplyTime` and `waitingSince` can be computed accurately.

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

Include only invites where `my_response_status = "none"`.

### 2D — Today's calendar (always runs independently)

Use `outlook_calendar_search` for today. For each event capture:
- `title`, `start_time`, `end_time`, `location`, `join_link`, `organizer`
- `attendees` (array, first 5)

### 2E — Filtered sender count

Run one query to estimate filtered volume:
- `query: "noreply OR notifications OR newsletter OR unsubscribe OR LinkedIn"`
- `limit: 100`
- Count results only. Do NOT include these in thread data.

---

## Step 2.5 — Group emails by thread

Merge inbox + sent results. Group by `conversationId`.

For each thread group, produce one representative record (most recent message):
- `threadMessageCount`: count of all messages in this thread (inbox + sent combined)
- `threadSubject`: subject stripped of RE:, FWD:, EXT: prefixes
- `threadParticipants`: array of unique email addresses (To + From + CC across all messages)
- `latestSender`: `from_address` of most recent message
- `latestSenderName`: `from_name` of most recent message
- `latestMessageTime`: `received_at` of most recent message
- `myLastReplyTime`: most recent `sent_at` where `from_address = "hankinsr@claycorp.com"`, else `null`
- `waitingSince`: `received_at` of most recent message NOT from Ryan, else `null`
- `ryanSentLast`: boolean — is `latestSender` Ryan?

If `conversationId` is missing, fall back to grouping by normalized subject + thread participants.

---

## Step 2.5B — Tiered context extraction

After thread grouping, fetch additional content based on priority signals.
**This is the most expensive step — cast wide on Tier 1, it directly improves AI quality.**

### Tier 1 — Full thread extraction

For every thread where ANY is true:
- Has no `myLastReplyTime` (Ryan never replied — high chance of missed message)
- Has `myLastReplyTime` but `latestMessageTime > myLastReplyTime` (new reply arrived)
- `has_contract_language = true`
- `is_time_sensitive = true`
- `is_flagged = true`
- Days since `waitingSince` >= 2

Fetch the most recent 5 messages in the thread using `outlook_email_search` with the thread subject.

**CRITICAL — what to extract from each returned message:**
- Use the `body_preview` field (the text content of the email body — NOT `subject`)
- If `body_preview` is empty, null, or identical to `subject`, skip that message (do not use `subject` as a body fallback)
- Concatenate all non-empty `body_preview` values with `"---MESSAGE BREAK---"` as separator

Store as:
- `full_thread_content`: concatenated `body_preview` values (see above)
- `extraction_depth: "full"`

**Degeneracy check (run after building `full_thread_content`):**
If `full_thread_content` is null, empty, < 50 chars, or exactly equals `threadSubject`:
- Set `full_thread_content = null`
- Set `extraction_depth = "body_unavailable"`
- Log: `⚠ body_unavailable: [threadSubject] — body_preview was empty or degenerate`

Log total degenerate count at end of Tier 1:
`Tier 1 degenerate (body_unavailable): X of Y threads — classify will use subject+context for these`

Also fetch Ryan's most recent sent message for every Tier 1 thread:
```
folderName: "sentitems"
query: "[thread_subject]"
afterDateTime: 14d ago
limit: 5
```
Take most recent result matching this thread. Store body as `sent_body`. Non-fatal if not found.

### Tier 2 — Extended preview

For threads where: NOT Tier 1 AND `days_since_waitingSince >= 1`

Fetch first 1500 characters of most recent message body. Store as:
- `full_thread_content`: first 1500 chars
- `extraction_depth: "extended"`

### Tier 3 — Standard

All remaining threads. Keep existing `body_preview` only.
- `extraction_depth: "standard"`

Log:
```
Tier 1 (full):     X threads
Tier 2 (extended): X threads
Tier 3 (standard): X threads
```

---

## Step 3 — Write raw JSON handoff file (ATOMIC WRITE)

**THIS IS THE ONLY OUTPUT OF TASK 1. EVERYTHING ELSE IS SETUP.**

**ATOMIC WRITE — follow this exact four-step sequence.**
A session crash mid-write used to corrupt `last-email-raw.json` and break the entire pipeline.
This sequence prevents that: the old file stays intact until the new one is fully written.

**Step 3A — Read existing file (precondition)**

Use the Read tool with the ABSOLUTE path detected in Step 0:
```
Read: {DATA_PATH}/last-email-raw.json
```
(Substitute the actual DATA_PATH value, e.g. `/sessions/abc-xyz/mnt/personal-os/data/last-email-raw.json`)

No other tool call between this Read and the Write in Step 3B.

**Step 3B — Write full payload to TEMP file (not the final path)**

Use the Write tool with the ABSOLUTE path: `{DATA_PATH}/last-email-raw.tmp.json`
(Substitute the actual DATA_PATH value)

**Step 3C — Rename temp → final (atomic swap)**

```bash
mv "${DATA_PATH}/last-email-raw.tmp.json" "${DATA_PATH}/last-email-raw.json"
```

If the session crashes between 3B and 3C, `.tmp.json` exists but the FINAL file is untouched.
Tomorrow's pull reads the correct previous day file. No corruption, no stale date.

**Step 3D — Write completion flag so classify knows pull is done**

```bash
echo "done" > "${DATA_PATH}/pull-complete-[TODAY_ISO].flag"
```

Replace `[TODAY_ISO]` with the actual date string, e.g. `pull-complete-2026-06-26.flag`.
Task 2 (classify) polls for this flag instead of firing on a fixed 20-min timer.
Without this flag, classify may start while pull is still running and read a stale file.

**Full payload template (write to .tmp.json in Step 3B):**

```json
{
  "report_date": "[TODAY_ISO]",
  "pull_since": "[PULL_SINCE]",
  "pull_window_hours": "[calculated hours]",
  "generated_at": "[ISO timestamp]",
  "yesterday_conv_ids": ["AAQk...", "AAQk..."],
  "bucket6_count": 14,
  "calendar": [
    {
      "title": "Meeting title",
      "start_time": "ISO",
      "end_time": "ISO",
      "location": "...",
      "join_link": "...",
      "organizer": "Name",
      "attendees": ["Name1", "Name2"]
    }
  ],
  "pending_invites": [
    {
      "organizer_name": "Name",
      "organizer_email": "email",
      "meeting_title": "Title",
      "proposed_start_time": "ISO",
      "proposed_end_time": "ISO",
      "days_pending": 2,
      "my_response_status": "none"
    }
  ],
  "threads": [
    {
      "conversationId": "AAQkADFh...",
      "threadSubject": "LWIC coordination",
      "from_address": "j.miller@fireproofing.com",
      "from_name": "J. Miller",
      "subject": "RE: Insulation scope clarification",
      "body_preview": "Ryan — attaching the Siplast...",
      "received_at": "2026-05-15T14:30:00Z",
      "latestSender": "j.miller@fireproofing.com",
      "latestSenderName": "J. Miller",
      "latestMessageTime": "2026-05-15T14:30:00Z",
      "threadMessageCount": 4,
      "threadParticipants": ["j.miller@fireproofing.com", "hankinsr@claycorp.com"],
      "myLastReplyTime": "2026-05-10T14:00:00Z",
      "waitingSince": "2026-05-10T16:30:00Z",
      "ryanSentLast": false,
      "is_internal": false,
      "has_attachment": true,
      "has_contract_language": true,
      "is_time_sensitive": false,
      "is_flagged": false,
      "thread_participant_count": 3,
      "full_thread_content": "Full body text... ---MESSAGE BREAK--- Previous message...",
      "sent_body": "Ryan's last sent message body...",
      "extraction_depth": "full"
    }
  ],
  "warnings": [],
  "slice_summary": "Slice 0: 12 | Slice 1: 9 | Slice 2: 11 | Slice 3: 8 | Keywords: 5 | Total unique: 37"
}
```

After a successful write, log:
`Raw JSON saved: ~/personal-os/data/last-email-raw.json — [N] threads, [N] calendar events`

---

## Step 4 — Summary

Output this exact block after saving:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EMAIL PULL (TASK 1) COMPLETE — [TODAY_ISO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Pull window:   [PULL_SINCE] → now  ([N]h window)
  Threads found: [N] unique threads
  Calendar:      [N] events today
  Invites:       [N] pending
  Filtered:      [N] (not included)

  Extraction:
    Tier 1 (full):     [N]
    Tier 2 (extended): [N]
    Tier 3 (standard): [N]

  Slices:  [slice summary line]

  Output:  ~/personal-os/data/last-email-raw.json  ✓

  Task 2 (classify) runs at 4:25 AM.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If any step had failures, add a WARNINGS section listing them.

---

## Reference: Internal domains

`@claycorp.com`, `@clayco.com`, `@ljcdesign.com`, `@crg.com`,
`@concretestrategies.com`, `@ventanaconstruction.com`

## Reference: Contract language trigger phrases

`contract`, `agreement`, `clause`, `language`, `indemnity`, `liability`,
`lien`, `change order`, `GMP`, `scope of work`, `addendum`, `exhibit`,
`terms`, `conditions`, `sign off`, `execute`, `wet signature`

---

## Scheduling

Runs at **4:05 AM daily** via Cowork scheduled task.
Task 2 (email-classify) runs at **4:25 AM** and reads the output of this task.

**Manual trigger:** "run email pull raw" or "pull email data"
