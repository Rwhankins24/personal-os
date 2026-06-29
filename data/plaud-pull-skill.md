---
name: plaud-pull
description: >
  Morning meeting intelligence pipeline for Ryan Hankins. Pulls Plaud.ai meeting emails
  from Gmail (last 48h), extracts summaries and action items from email body, downloads
  transcript attachments, builds a structured handoff JSON, uploads to Supabase storage,
  and marks the pipeline complete. Runs at 4:15am daily via Cowork scheduled task.
  Trigger on: "pull my plaud meetings", "run plaud pull", "get meeting notes", "morning
  meeting prep", or on schedule at 4:15am.
---

# Plaud Pull & Meeting Intelligence Pipeline

You are Ryan Hankins' morning meeting intelligence layer — Plaud.ai edition. You run at
4:15 AM via Cowork scheduled task. Your job: pull Plaud meeting emails from Gmail,
extract structured meeting data, download transcripts, and save the handoff JSON for the
nightly AI job. You do NOT write the newsletter — that's the nightly AI job.

**Ryan Hankins** · Project Executive at Clayco · ryanhankins.personalos@gmail.com (Plaud inbox)
Automated run — complete without confirmation. Do not ask clarifying questions.

**Gmail account:** `ryanhankins.personalos@gmail.com`
**Plaud email identifier:** subject prefix `[Plaud-AutoFlow]`
**Output target:** `~/personal-os/data/last-plaud-report.json`
**Storage upload:** `https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/plaud-[TODAY_ISO].json`
**Pipeline webhook:** `https://personal-os-five-black.vercel.app/api/pipeline/complete-step`

**Runtime credentials (for Step 7 upload):**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`
- `TRIGGER_SECRET` = `0557601ac4f4c8f0d42923bba2fb083b`
- `GMAIL_CREDENTIALS_FILE` = `~/personal-os/data/gmail-credentials.json`

---

## How Plaud Emails Work

Each Plaud meeting generates exactly one email sent to `ryanhankins.personalos@gmail.com`:

- **Subject format:** `[Plaud-AutoFlow] MM-DD Meeting Title Here`
- **Body:** Contains the AI-generated meeting summary. Structured with sections for
  Overview, Key Points, and Action Items. Sometimes speaker names are identified;
  sometimes action items are listed without attribution.
- **Attachment:** A `.txt` or `.vtt` file containing the full transcript. Filename
  typically contains "transcript" in the name.

Your job is to extract both — body (summary + action items) AND transcript attachment.

---

## Resilience Rules

These rules govern behavior when API calls fail, return partial results, or the Gmail
API is unreachable. Apply them throughout — do not wait until a failure to recall them.

1. **No silent abort.** Even if Steps 2–7 have failures, always complete Step 6 (save
   handoff JSON with whatever data was collected) and Step 8 (print summary). Never
   exit early without a report. A partial run is better than no run.

2. **Partial success is OK.** If one Gmail message fetch fails, store what you have for
   that meeting (subject/date at minimum) and continue. Log the failure in `warnings[]`.

3. **Gmail API unavailable → empty report, not abort.** If token refresh fails or the
   Gmail API returns 401/403, write an empty report structure and exit cleanly. Log the
   error in `warnings[]`. Do not leave the output file stale from yesterday.

4. **Transcript attachment is optional.** If a message has no attachment, or the
   attachment download fails, set `has_transcript: false` and `transcript_text: null`.
   This is non-fatal — summary + action items from the body are sufficient.

5. **Re-read immediately before Write.** The Write tool requires a Read of the target
   file within the same session window immediately before the Write call. Use the Read
   tool — NOT a bash `cat` command — to read `~/personal-os/data/last-plaud-report.json`
   at the top of Step 6, directly before the Write. Do NOT perform any other tool call
   between that Read and the Write. If you skip this, the Write will fail.

6. **External network calls may fail in sandbox.** Supabase and Vercel uploads may be
   blocked. This is expected and non-blocking. Log as "sandbox_blocked" in `warnings[]`.
   The local JSON write is the only guaranteed delivery path.

7. **Retry token refresh once.** If the access token request fails, retry once after
   5 seconds. If it fails again, write empty report and exit.

8. **Deduplicate by message ID.** If the same Gmail message ID appears in multiple
   search results, process it once. The 48h window may overlap with yesterday's run.

9. **48h window prevents gaps.** Always search last 48 hours, not just last 24. This
   ensures coverage if yesterday's run failed or missed a late-arriving email.

10. **JSON saves BEFORE the upload attempt.** Step 6 (save handoff JSON) runs BEFORE
    Step 7 (storage upload). Never block the local write on an upload that may fail.

---

## Date Format Reference

```bash
TODAY_ISO=$(date '+%Y-%m-%d')        # e.g. 2026-06-03
YESTERDAY_ISO=$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')
NOW_UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
WINDOW_START=$(date -v-2d '+%Y/%m/%d' 2>/dev/null || date -d '2 days ago' '+%Y/%m/%d')
```

---

## Empty Report Structure

If Gmail API is unavailable or no Plaud emails found, write this exact structure:

```json
{
  "report_date": "YYYY-MM-DD",
  "source": "plaud",
  "generated_at": "YYYY-MM-DDTHH:MM:SSZ",
  "meetings": [],
  "ryan_action_items_total": 0,
  "others_action_items_total": 0,
  "meetings_with_transcripts": 0,
  "warnings": ["reason for empty report"]
}
```

---

## Step 1 — Setup & Credentials

```bash
TODAY_ISO=$(date '+%Y-%m-%d')
YESTERDAY_ISO=$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')
NOW_UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "Run date: $TODAY_ISO"
```

Read the Gmail credentials file:

```bash
cat ~/personal-os/data/gmail-credentials.json
```

Store the values:
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

If the file does not exist or any field is missing, write an empty report with
`warnings: ["gmail-credentials.json missing or incomplete — run gmail-oauth-setup.sh"]`
and stop.

Also load the previous report for deduplication:

```bash
cat ~/personal-os/data/last-plaud-report.json 2>/dev/null || echo "{}"
```

Extract `meeting_ids_seen` (an array of Gmail message IDs from yesterday's report) to
use as a duplicate-check baseline.

---

## Step 2 — Refresh Gmail Access Token

Exchange the refresh token for a short-lived access token:

```bash
TOKEN_RESPONSE=$(curl -s -X POST \
  "https://oauth2.googleapis.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${GMAIL_CLIENT_ID}&client_secret=${GMAIL_CLIENT_SECRET}&refresh_token=${GMAIL_REFRESH_TOKEN}&grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('access_token', ''))
")

echo "Token refresh: $([ -n "$ACCESS_TOKEN" ] && echo 'SUCCESS' || echo 'FAILED')"
```

If `ACCESS_TOKEN` is empty:
- Retry once after 5 seconds
- If still empty, write empty report with `warnings: ["Gmail token refresh failed"]` and stop

---

## Step 3 — Search Gmail for Plaud Emails (last 48h)

Build the Gmail search query. Plaud emails always have `[Plaud-AutoFlow]` in the subject:

```bash
# Gmail query: subject prefix + date window
QUERY="subject:%5BPlaud-AutoFlow%5D newer_than:2d"

SEARCH_RESPONSE=$(curl -s \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${QUERY}&maxResults=50" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

MESSAGE_COUNT=$(echo "$SEARCH_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
msgs = d.get('messages', [])
print(len(msgs))
")

echo "Found ${MESSAGE_COUNT} Plaud messages in last 48h"
```

Extract the message ID list:

```bash
MESSAGE_IDS=$(echo "$SEARCH_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for msg in d.get('messages', []):
    print(msg['id'])
")
```

If `MESSAGE_COUNT` is 0, write an empty report with
`warnings: ["No Plaud emails found in last 48h"]` and stop — this is a valid outcome
(no meetings yesterday).

---

## Step 4 — Fetch Each Message and Extract Content

For each message ID (process sequentially, not in parallel — Gmail API rate limits):

### 4A — Get Full Message

```bash
MSG_RESPONSE=$(curl -s \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/${MSG_ID}?format=full" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
```

### 4B — Extract Subject, Date, and Email Received Datetime

Parse from the `payload.headers` array:

```python
import json, sys, base64, re
from datetime import datetime
from email.utils import parsedate_to_datetime

data = json.load(sys.stdin)
headers = {h['name']: h['value'] for h in data.get('payload', {}).get('headers', [])}
subject = headers.get('Subject', '')
date_str = headers.get('Date', '')
gmail_id = data.get('id', '')

# Parse date → ISO format
# date_str is RFC 2822: "Tue, 03 Jun 2026 08:15:00 -0700"
# Extract meeting title from subject: strip "[Plaud-AutoFlow] MM-DD " prefix
title = subject.replace('[Plaud-AutoFlow]', '').strip()
# Remove leading "MM-DD " date prefix if present
title = re.sub(r'^\d{2}-\d{2}\s+', '', title).strip()

# Capture the exact email received datetime (used for start time estimation)
# Store as UTC ISO string — e.g. "2026-06-03T15:15:00+00:00"
email_received_datetime = None
if date_str:
    try:
        email_received_datetime = parsedate_to_datetime(date_str).isoformat()
    except Exception:
        email_received_datetime = None
```

### 4C — Extract Email Body (Summary + Action Items)

The email body is base64url-encoded. Handle both single-part and multipart messages:

```python
def decode_body(payload):
    """Recursively find and decode the text/plain or text/html body part."""
    mime_type = payload.get('mimeType', '')
    
    if mime_type == 'text/plain':
        data = payload.get('body', {}).get('data', '')
        if data:
            return base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')
    
    if mime_type in ('multipart/mixed', 'multipart/alternative', 'multipart/related'):
        for part in payload.get('parts', []):
            result = decode_body(part)
            if result:
                return result
    
    return None
```

Priority: prefer `text/plain` over `text/html`. If only HTML available, extract text
content (strip tags). Store the raw body as `email_body_raw`.

### 4D — Parse Structured Content from Body

From the decoded body, extract:

**Summary:** The overview/summary paragraph(s) at the top, before any "Action Items"
or "Key Points" section. Store as `summary`.

**Action Items:** Find the action items section. Parse each item. Attempt to identify:
- Speaker/assignee (if named in the format "Name: task" or "- [Name] task")
- Task description
- Due date (if mentioned)

For items assigned to Ryan Hankins or "Ryan" → `ryan_action_items[]`
For items assigned to others (named) → `others_action_items[]` with `assignee` field
For items with no speaker attribution → add to `unattributed_action_items[]`

**Participants:** Extract any names mentioned in speaker labels or "Attendees:" section.

### 4E — Find and Download Transcript Attachment

Check `payload.parts[]` for any part with a filename containing "transcript" (case-insensitive)
or with mimeType `text/plain` and a non-empty filename:

```python
def find_transcript_part(payload):
    """Find the transcript attachment part ID."""
    for part in payload.get('parts', []):
        filename = part.get('filename', '')
        if filename and ('transcript' in filename.lower() or filename.endswith('.vtt') or filename.endswith('.txt')):
            attachment_id = part.get('body', {}).get('attachmentId', '')
            return attachment_id, filename
    return None, None
```

If found, download:

```bash
ATTACHMENT_RESPONSE=$(curl -s \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/${MSG_ID}/attachments/${ATTACHMENT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

TRANSCRIPT_TEXT=$(echo "$ATTACHMENT_RESPONSE" | python3 -c "
import json, sys, base64
d = json.load(sys.stdin)
data = d.get('data', '')
if data:
    print(base64.urlsafe_b64decode(data + '==').decode('utf-8', errors='replace'))
")
```

If attachment download fails or no attachment found:
- Set `has_transcript: false`, `transcript_text: null`
- Log in `warnings[]`: `"No transcript attachment for: {title}"`
- Continue — body summary is sufficient

### 4F — Parse Transcript Duration

From the downloaded transcript text, extract the last timestamp to determine recording duration:

```python
def parse_transcript_duration(transcript_text):
    """Parse HH:MM:SS timestamps from transcript, return duration in minutes."""
    if not transcript_text:
        return None
    # Plaud transcripts use relative HH:MM:SS timestamps: "Speaker Name 00:39:48"
    timestamps = re.findall(r'\b(\d{1,2}:\d{2}:\d{2})\b', transcript_text)
    if not timestamps:
        return None
    last_ts = timestamps[-1]
    parts = last_ts.split(':')
    total_minutes = int(parts[0]) * 60 + int(parts[1]) + int(parts[2]) / 60
    return round(total_minutes)

duration_from_transcript = parse_transcript_duration(transcript_text)
```

### 4G — Parse Plaud Structured Blocks from Email Body

Plaud's AI summary email contains structured call-word blocks delimited with `=LABEL=` markers.
Parse all three blocks from `email_body_raw`:

```python
def extract_block(text, label):
    """Extract JSON from =LABEL= ... =END_LABEL= block (flexible = count)."""
    if not text:
        return None
    pattern = r'={1,}' + label + r'={1,}\n(.*?)\n={1,}END_' + label + r'={1,}'
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except (json.JSONDecodeError, Exception) as e:
        print(f'  Warning: Could not parse {label} block: {e}')
        return None

# Parse all three structured blocks from the email body
meeting_metadata    = extract_block(email_body_raw, 'MEETING_METADATA')
people_and_actions  = extract_block(email_body_raw, 'PEOPLE_AND_ACTIONS')
decisions_and_risks = extract_block(email_body_raw, 'DECISIONS_AND_RISKS')

# Resolve recording start time and date from metadata
recording_start_time = meeting_metadata.get('recording_start_time') if meeting_metadata else None
recording_date       = meeting_metadata.get('recording_date')       if meeting_metadata else None
duration_minutes     = meeting_metadata.get('duration_minutes')     if meeting_metadata else duration_from_transcript
timezone             = meeting_metadata.get('timezone', 'America/Phoenix') if meeting_metadata else 'America/Phoenix'

# Determine time_source
if recording_start_time and recording_date:
    time_source = 'plaud_ai'
elif duration_from_transcript and email_received_datetime:
    # Estimate: email was sent ~8 min after recording ended
    time_source = 'estimated'
    # Estimate start: email_received - duration - 8 min buffer
    # The nightly job can use this to compute start_time
else:
    time_source = 'unknown'

# Participants from structured block (fallback to legacy parsing if empty)
block_participants = []
if people_and_actions and people_and_actions.get('participants'):
    block_participants = [p.get('name') for p in people_and_actions['participants'] if p.get('name')]

if meeting_metadata:
    print(f'  Plaud metadata: {recording_date} {recording_start_time} ({duration_minutes} min) [{timezone}]')
else:
    print(f'  Warning: MEETING_METADATA block not found in email body for: {title}')

if people_and_actions:
    action_count = len(people_and_actions.get('actions', []))
    print(f'  PEOPLE_AND_ACTIONS: {action_count} action(s), {len(block_participants)} participant(s)')
else:
    print(f'  Warning: PEOPLE_AND_ACTIONS block not found for: {title}')

if decisions_and_risks:
    decision_count = len(decisions_and_risks.get('decisions', []))
    risk_count = len(decisions_and_risks.get('risks', []))
    print(f'  DECISIONS_AND_RISKS: {decision_count} decision(s), {risk_count} risk(s)')
else:
    print(f'  Warning: DECISIONS_AND_RISKS block not found for: {title}')
```

---

## Step 5 — Build Meeting Objects

For each processed message, build:

```json
{
  "id": "gmail_message_id",
  "title": "Construction Schedule and Installation Sequencing Coordination",
  "date": "2026-06-03",
  "source": "plaud",
  "email_subject": "[Plaud-AutoFlow] 06-03 Construction Schedule and Installation Sequencing Coordination",
  "gmail_message_id": "1abc2def3ghi",
  "summary": "The team discussed...",
  "email_body_raw": "...",

  "meeting_metadata": {
    "recording_date": "2026-06-03",
    "recording_start_time": "12:00",
    "recording_end_time": "13:40",
    "duration_minutes": 100,
    "timezone": "America/Phoenix",
    "meeting_type": "project_coordination"
  },
  "people_and_actions": {
    "participants": [{ "name": "Ryan Hankins", "role": "Project Executive" }],
    "projects_referenced": ["Pacific Fusion Albuquerque"],
    "actions": [
      {
        "task": "Send updated schedule to owner by Friday",
        "owner": "Ryan Hankins",
        "ryan_owns": true,
        "due": "2026-06-06",
        "urgency": "high"
      }
    ],
    "commitments": [],
    "relationship_signals": []
  },
  "decisions_and_risks": {
    "decisions": [],
    "pending": [],
    "risks": [],
    "facts": [],
    "cost_flags": [],
    "schedule_flags": [],
    "lead_signals": []
  },

  "recording_date": "2026-06-03",
  "recording_start_time": "12:00",
  "duration_minutes": 100,
  "time_source": "plaud_ai",
  "email_received_datetime": "2026-06-03T19:15:00+00:00",

  "participants": ["Ryan Hankins", "John Smith"],
  "ryan_action_items": [
    {
      "task": "Send updated schedule to owner by Friday",
      "assignee": "Ryan Hankins",
      "due_date": "2026-06-06",
      "source": "plaud_email_body"
    }
  ],
  "others_action_items": [
    {
      "task": "Confirm steel delivery window",
      "assignee": "John Smith",
      "due_date": null,
      "source": "plaud_email_body"
    }
  ],
  "unattributed_action_items": [
    {
      "task": "Review installation sequence drawing",
      "assignee": null,
      "due_date": null,
      "source": "plaud_email_body"
    }
  ],
  "has_transcript": true,
  "transcript_text": "00:00 Ryan: Good morning everyone...",
  "transcript_word_count": 4821
}
```

Note on `participants`: Populate from `people_and_actions.participants[].name` when block parse succeeds. Fall back to legacy parsing from email body if block is null.

Count totals across all meetings:
- `ryan_action_items_total` — sum of all `ryan_action_items` arrays
- `others_action_items_total` — sum of all `others_action_items` arrays
- `meetings_with_transcripts` — count of meetings where `has_transcript: true`

---

## Step 6 — Save Handoff JSON

**First: Read the output file** (required by Write tool):

Use the Read tool on `~/personal-os/data/last-plaud-report.json`. If the file does not
exist, that is fine — proceed to Write.

**Then immediately Write** (no other tool calls between Read and Write):

```json
{
  "report_date": "TODAY_ISO",
  "source": "plaud",
  "generated_at": "NOW_UTC",
  "meetings": [ ... ],
  "meeting_ids_seen": ["id1", "id2"],
  "ryan_action_items_total": 0,
  "others_action_items_total": 0,
  "meetings_with_transcripts": 0,
  "warnings": []
}
```

After writing, verify the file size:

```bash
wc -c ~/personal-os/data/last-plaud-report.json
```

Log the size in your summary. If size is 0 or file missing, log as a critical warning.

---

## Step 7 — Upload to Supabase Storage

Attempt POST first, fall back to PUT:

```bash
TODAY_ISO=$(date '+%Y-%m-%d')

RESPONSE=$(curl -s -X POST \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/storage/v1/object/daily-reports/plaud-${TODAY_ISO}.json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Content-Type: application/json" \
  --data-binary @"$HOME/personal-os/data/last-plaud-report.json" \
  -w "\nHTTP_STATUS:%{http_code}")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
echo "Upload status: $HTTP_STATUS"
```

- HTTP 200 or 201 → success. Call pipeline webhook:

```bash
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d "{\"step\":\"plaud_processing\",\"run_date\":\"${TODAY_ISO}\"}"
```

- HTTP 4xx → retry with PUT method
- Curl error or no response → log as "sandbox_blocked" in `warnings[]`, continue

---

## Step 8 — Print Summary

Print a bordered summary block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PLAUD PULL COMPLETE — 2026-06-03
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MEETINGS:          3 pulled, 3 processed
  TRANSCRIPTS:       2 downloaded, 1 missing
  RYAN ACTION ITEMS: 5 total
  OTHERS ACI:        8 total
  UNATTRIBUTED:      3 total
  FILE SIZE:         47.2 KB
  UPLOAD:            SUCCESS (plaud-2026-06-03.json)
  PIPELINE:          complete-step → plaud_processing ✓
  WARNINGS:          1 (see below)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠ No transcript attachment for: Weekly Standup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Scheduling

This skill runs at **4:15 AM daily** via Cowork scheduled task (same time as email-pull —
both fire together, they are independent).

Cron: `"15 4 * * *"`

The launchd upload agent (`com.personalos.plaud-upload`) watches
`~/personal-os/data/last-plaud-report.json` via `WatchPaths` and fires instantly
when this skill writes the output file.

---

## Retiring Otter Infrastructure

Now that Plaud is the meeting source, the Otter pipeline is retired:
- Otter Cowork scheduled task: disabled (delete or pause)
- `com.personalos.otter-upload` launchd agent: unloaded
- `data/otter-pull-skill.md`: archived (do not delete — keep for reference)
- `meeting_notes` Supabase table: still active, now fed from Plaud data

The nightly AI job (`nightly-ai-local.js`) should be updated to read
`plaud-{TODAY_ISO}.json` from Supabase storage instead of `otter-{TODAY_ISO}.json`.
