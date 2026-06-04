#!/bin/bash
# Plaud Pull — Mac-side Gmail API script
# Runs at 4:15 AM via launchd (com.personalos.plaud-pull)
# Fetches [Plaud-AutoFlow] emails from Gmail, writes last-plaud-report.json
# WatchPaths on that file triggers upload-plaud-report.sh automatically

LOG_FILE="$HOME/personal-os/logs/plaud-pull.log"
OUTPUT_FILE="$HOME/personal-os/data/last-plaud-report.json"
CREDS_FILE="$HOME/personal-os/data/gmail-credentials.json"
TODAY=$(date +%Y-%m-%d)
NOW_UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

log() { echo "[$TODAY $(date +%H:%M:%S)] $1" >> "$LOG_FILE"; }

log "Plaud pull starting..."

# ── Load env (for SUPABASE creds, not used here but consistent) ───
export $(grep -v '^#' "$HOME/personal-os/api/.env" | xargs) 2>/dev/null || true

# ── Write empty report helper ─────────────────────────────────────
write_empty_report() {
  local reason="$1"
  log "Writing empty report: $reason"
  python3 - << PYEOF
import json
data = {
    "report_date": "$TODAY",
    "source": "plaud",
    "generated_at": "$NOW_UTC",
    "meetings": [],
    "meeting_ids_seen": [],
    "ryan_action_items_total": 0,
    "others_action_items_total": 0,
    "meetings_with_transcripts": 0,
    "warnings": ["$reason"]
}
with open("$OUTPUT_FILE", "w") as f:
    json.dump(data, f, indent=2)
print("Empty report written.")
PYEOF
}

# ── Check credentials file ────────────────────────────────────────
if [ ! -f "$CREDS_FILE" ]; then
  write_empty_report "gmail-credentials.json not found"
  log "FATAL: credentials file missing"
  exit 1
fi

CLIENT_ID=$(python3 -c "import json; d=json.load(open('$CREDS_FILE')); print(d.get('client_id',''))" 2>/dev/null)
CLIENT_SECRET=$(python3 -c "import json; d=json.load(open('$CREDS_FILE')); print(d.get('client_secret',''))" 2>/dev/null)
REFRESH_TOKEN=$(python3 -c "import json; d=json.load(open('$CREDS_FILE')); print(d.get('refresh_token',''))" 2>/dev/null)

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$REFRESH_TOKEN" ]; then
  write_empty_report "gmail-credentials.json missing required fields"
  log "FATAL: incomplete credentials"
  exit 1
fi

# ── Refresh access token ──────────────────────────────────────────
log "Refreshing Gmail access token..."

TOKEN_RESPONSE=$(curl -s -X POST \
  "https://oauth2.googleapis.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('access_token', ''))
" 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
  log "Token refresh failed, retrying in 10s..."
  sleep 10
  TOKEN_RESPONSE=$(curl -s -X POST \
    "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token")
  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('access_token', ''))
" 2>/dev/null)
fi

if [ -z "$ACCESS_TOKEN" ]; then
  write_empty_report "Gmail token refresh failed after 2 attempts"
  log "FATAL: token refresh failed"
  exit 1
fi

log "Token refresh: SUCCESS"

# ── Search Gmail for Plaud emails (last 48h) ──────────────────────
log "Searching Gmail for [Plaud-AutoFlow] emails..."

SEARCH_RESPONSE=$(curl -s \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject%3A%5BPlaud-AutoFlow%5D+newer_than%3A2d&maxResults=50" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

MESSAGE_IDS=$(echo "$SEARCH_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for msg in d.get('messages', []):
    print(msg['id'])
" 2>/dev/null)

MSG_COUNT=$(echo "$MESSAGE_IDS" | grep -c . 2>/dev/null || echo 0)
# Handle empty result
if [ -z "$MESSAGE_IDS" ]; then MSG_COUNT=0; fi

log "Found $MSG_COUNT Plaud messages"

if [ "$MSG_COUNT" -eq 0 ]; then
  write_empty_report "No Plaud emails found in last 48h"
  log "No meetings — empty report written"
  exit 0
fi

# ── Fetch and parse each message ─────────────────────────────────
log "Fetching message details..."

python3 - << PYEOF
import json, base64, re, os, sys
from datetime import datetime

ACCESS_TOKEN = """${ACCESS_TOKEN}"""
LOG_FILE = "$LOG_FILE"
OUTPUT_FILE = "$OUTPUT_FILE"
TODAY = "$TODAY"
NOW_UTC = "$NOW_UTC"
MESSAGE_IDS = """${MESSAGE_IDS}""".strip().split('\n')

import urllib.request, urllib.error

def gmail_get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        return {}

def gmail_get_attachment(msg_id, att_id):
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/attachments/{att_id}"
    return gmail_get(url)

def decode_b64(data):
    if not data:
        return ""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

def extract_body(payload):
    """Recursively extract plain text body."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        return decode_b64(payload.get("body", {}).get("data", ""))
    if mime.startswith("multipart/"):
        for part in payload.get("parts", []):
            result = extract_body(part)
            if result:
                return result
    return ""

def find_transcript(payload):
    """Find transcript attachment part."""
    for part in payload.get("parts", []):
        fname = part.get("filename", "")
        if fname and ("transcript" in fname.lower() or fname.endswith(".vtt") or fname.endswith(".txt")):
            att_id = part.get("body", {}).get("attachmentId", "")
            return att_id, fname
    return None, None

def parse_action_items(body_text):
    """Extract action items from email body. Returns ryan_items, others_items, unattributed."""
    ryan_items, others_items, unattributed = [], [], []

    # Find action items section
    lines = body_text.split('\n')
    in_action_section = False

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Detect action items section header
        if re.search(r'action items?|follow.?ups?|next steps?|tasks?', line, re.I) and len(line) < 60:
            in_action_section = True
            continue

        # Detect end of action items section (new major section)
        if in_action_section and re.match(r'^#{1,3}\s|^[A-Z][A-Z\s]{5,}:?\s*$', line):
            in_action_section = False
            continue

        if not in_action_section:
            continue

        # Skip section headers within action items
        if len(line) < 4 or line.endswith(':') and len(line) < 30:
            continue

        # Clean bullet markers
        task = re.sub(r'^[-•*\d\.]+\s*', '', line).strip()
        if not task or len(task) < 5:
            continue

        # Detect speaker attribution: "Name: task" or "[Name] task" or "Name - task"
        speaker_match = re.match(r'^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[:\-]\s*(.+)', task)
        bracket_match = re.match(r'^\[([^\]]+)\]\s*(.+)', task)

        assignee = None
        task_text = task

        if speaker_match:
            assignee = speaker_match.group(1).strip()
            task_text = speaker_match.group(2).strip()
        elif bracket_match:
            assignee = bracket_match.group(1).strip()
            task_text = bracket_match.group(2).strip()

        item = {"task": task_text, "assignee": assignee, "due_date": None, "source": "plaud_email_body"}

        if assignee:
            if re.search(r'\bryan\b', assignee, re.I):
                ryan_items.append(item)
            else:
                others_items.append(item)
        else:
            unattributed.append(item)

    return ryan_items, others_items, unattributed

def parse_summary(body_text):
    """Extract the summary section from the body."""
    lines = body_text.split('\n')
    summary_lines = []
    in_summary = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_summary and summary_lines:
                continue
            continue

        # Start capturing after any header or at the beginning
        if re.search(r'summary|overview|meeting notes?', stripped, re.I) and len(stripped) < 60:
            in_summary = True
            continue

        # Stop at action items section
        if re.search(r'action items?|follow.?ups?|next steps?', stripped, re.I) and len(stripped) < 60:
            break

        if in_summary or (not summary_lines and len(stripped) > 20):
            if not in_summary:
                in_summary = True
            summary_lines.append(stripped)
            if len(summary_lines) >= 8:  # cap summary length
                break

    return ' '.join(summary_lines) if summary_lines else body_text[:500]

meetings = []
warnings = []
ryan_total = 0
others_total = 0
transcripts_count = 0
seen_ids = []

for msg_id in MESSAGE_IDS:
    if not msg_id.strip():
        continue

    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}?format=full"
    msg = gmail_get(url)

    if not msg:
        warnings.append(f"Failed to fetch message {msg_id}")
        continue

    # Extract headers
    headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}
    subject = headers.get('Subject', '')
    date_header = headers.get('Date', '')

    # Parse meeting date from subject: [Plaud-AutoFlow] MM-DD Title
    title = re.sub(r'^\[Plaud-AutoFlow\]\s*', '', subject).strip()
    date_match = re.match(r'^(\d{2})-(\d{2})\s+(.*)', title)
    if date_match:
        month, day, title = date_match.group(1), date_match.group(2), date_match.group(3)
        year = TODAY[:4]
        meeting_date = f"{year}-{month}-{day}"
    else:
        meeting_date = TODAY

    # Extract body
    body_text = extract_body(msg.get('payload', {}))

    # Parse content
    summary = parse_summary(body_text)
    ryan_items, others_items, unattributed = parse_action_items(body_text)

    # Find transcript attachment
    att_id, att_filename = find_transcript(msg.get('payload', {}))
    transcript_text = None
    has_transcript = False

    if att_id:
        att_data = gmail_get_attachment(msg_id, att_id)
        raw = att_data.get('data', '')
        if raw:
            transcript_text = decode_b64(raw)
            has_transcript = True
            transcripts_count += 1
        else:
            warnings.append(f"Transcript attachment empty for: {title}")
    else:
        warnings.append(f"No transcript attachment for: {title}")

    ryan_total += len(ryan_items)
    others_total += len(others_items)
    seen_ids.append(msg_id)

    meetings.append({
        "id": msg_id,
        "gmail_message_id": msg_id,
        "title": title,
        "date": meeting_date,
        "source": "plaud",
        "email_subject": subject,
        "summary": summary,
        "participants": [],
        "ryan_action_items": ryan_items,
        "others_action_items": others_items,
        "unattributed_action_items": unattributed,
        "has_transcript": has_transcript,
        "transcript_text": transcript_text,
        "transcript_word_count": len(transcript_text.split()) if transcript_text else 0
    })

report = {
    "report_date": TODAY,
    "source": "plaud",
    "generated_at": NOW_UTC,
    "meetings": meetings,
    "meeting_ids_seen": seen_ids,
    "ryan_action_items_total": ryan_total,
    "others_action_items_total": others_total,
    "meetings_with_transcripts": transcripts_count,
    "warnings": warnings
}

with open(OUTPUT_FILE, "w") as f:
    json.dump(report, f, indent=2)

file_size = os.path.getsize(OUTPUT_FILE)
print(f"Wrote {len(meetings)} meetings ({file_size} bytes) to {OUTPUT_FILE}")
PYEOF

RESULT=$?
if [ $RESULT -ne 0 ]; then
  log "Python processing failed (exit $RESULT)"
  write_empty_report "Python processing error"
  exit 1
fi

FILE_SIZE=$(wc -c < "$OUTPUT_FILE" | tr -d ' ')
MEETING_COUNT=$(python3 -c "import json; d=json.load(open('$OUTPUT_FILE')); print(len(d.get('meetings',[])))" 2>/dev/null)

log "SUCCESS — $MEETING_COUNT meetings, ${FILE_SIZE} bytes written"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
echo "  PLAUD PULL COMPLETE — $TODAY" >> "$LOG_FILE"
echo "  MEETINGS: $MEETING_COUNT" >> "$LOG_FILE"
echo "  FILE SIZE: ${FILE_SIZE} bytes" >> "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"

exit 0
