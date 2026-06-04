---
name: backfill-contacts
description: >
  One-time (re-runnable) skill: scan the ENTIRE Microsoft 365 email history (all time,
  not just recent), create contacts for every unique external sender/recipient, and
  enrich them with signature data (title, company, phone, address). Uses the same
  Outlook MCP connector as the email-pull skill. Run manually from Cowork when prompted.
---

# Contact Backfill — Full M365 History (All Time)

You are scanning Ryan's COMPLETE Microsoft 365 email history (claycorp.com) — going
back as far as emails exist, not limited to any fixed window — to:
1. Find every unique external sender and recipient
2. Create contacts in Supabase for anyone not already there
3. Enrich contacts missing title, company, phone, or address from email signatures

**Supabase credentials:**
- `SUPABASE_URL` = `https://dvevqwhphrcboyjpvnlz.supabase.co`
- `SUPABASE_SERVICE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4`

**Internal domains to skip (never create contacts for):**
`claycorp.com`, `ljc.com`, `crg.com`, `concretestrategies.com`, `ventanaconstruction.com`,
`clayco.com`, `ljcdesign.com`

**Noise domains to skip:**
`noreply`, `no-reply`, `donotreply`, `mailer`, `bounce`, `notifications`,
`newsletter`, `amazonses.com`, `sendgrid.net`, `mailchimp.com`, `hubspot.com`,
`salesforce.com`, `marketo.com`, `constantcontact.com`

---

## Step 1 — Setup

```bash
date '+%Y-%m-%d'
```

Store `TODAY_ISO`.

Build a list of **90-day windows going back from today until queries return empty**.
Start with today and work backwards in 90-day chunks. Do not set a fixed end date —
keep going until a quarter returns 0 inbox results AND 0 sent results.

```
Window 1:  today → 90 days ago
Window 2:  90 → 180 days ago
Window 3:  180 → 270 days ago
Window 4:  270 → 365 days ago
Window 5:  365 → 455 days ago
... keep going ...
Window N:  [auto] → stop when both inbox + sent return 0 results for a window
```

Initialize: `senders = {}` (email → name map), `total_messages = 0`, `window_num = 1`

---

## Step 2 — Load existing contacts from Supabase

```bash
curl -s \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/rest/v1/contacts?select=id,email,name,title,company,phone_mobile,address,enriched&limit=2000" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4"
```

Build two maps:
- `existingEmails`: Set of all lowercase email addresses already in contacts
- `needsEnrichment`: contacts where `title IS NULL OR company IS NULL OR phone_mobile IS NULL OR address IS NULL`

---

## Step 3 — Scan email history window by window

For each 90-day window, run **2 parallel queries**. Keep going until both return empty.

**Query A — Inbox received in this quarter:**
```
folderName: "inbox"
afterDateTime: [quarter_start]
beforeDateTime: [quarter_end]
limit: 100
```
Extract `from_address`, `from_name` from each result.

**Query B — Sent items in this quarter:**
```
folderName: "sentitems"
afterDateTime: [quarter_start]
beforeDateTime: [quarter_end]
limit: 100
```
Extract `toRecipients` (to + cc addresses) from each result.

For each address found:
- Lowercase it
- Skip if domain matches internal or noise lists
- Skip if already in `existingEmails`
- Add to `senders` map: `email → best_name`

**Stop condition:** When both the inbox query AND the sent query for a window return
0 results, the full history has been scanned. Do not continue further.

Log after each window: `Window [N] ([date_range]) — [X] inbox + [Y] sent, [Z] new senders found so far`

**Note on limits:** The Outlook connector returns max 100 per query. For high-volume
windows (recent periods), run an additional keyword pass to catch more contacts:
```
query: "proposal OR contract OR project OR meeting OR schedule OR pricing"
afterDateTime: [window_start]
beforeDateTime: [window_end]
limit: 100
```

---

## Step 4 — Create missing contacts in Supabase

After all 8 quarters are scanned, build the `toCreate` list from `senders` minus
`existingEmails`. For each new contact:

```json
{
  "email": "jsmith@acme.com",
  "name": "John Smith",
  "source": "email",
  "enriched": false
}
```

Insert in batches of 50 via Supabase REST:

```bash
curl -s -X POST \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/rest/v1/contacts" \
  -H "apikey: [SERVICE_KEY]" \
  -H "Authorization: Bearer [SERVICE_KEY]" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '[BATCH_JSON]'
```

Log: `Created [N] new contacts`

---

## Step 5 — Enrich contacts from email signatures

For each contact in `needsEnrichment` (missing title, company, phone, or address),
plus any newly created contacts — cap at 200 per run:

**5A — Fetch their last 3 emails:**
```
query: "[contact_email]"
folderName: "inbox"
limit: 3
```

Extract `body_preview` and `full_thread_content` if available.

**5B — Extract signature data:**
Read the email bodies and extract the following if present in a signature block:
- Job title
- Company name  
- Mobile/cell phone number
- Office/direct phone number
- Physical address
- LinkedIn URL

Use high confidence only — if the data isn't clearly in a signature, leave it null.

**5C — Update Supabase:**
For each field extracted, PATCH the contact only if the field is currently null:

```bash
curl -s -X PATCH \
  "https://dvevqwhphrcboyjpvnlz.supabase.co/rest/v1/contacts?id=eq.[contact_id]" \
  -H "apikey: [SERVICE_KEY]" \
  -H "Authorization: Bearer [SERVICE_KEY]" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "VP of Construction",
    "company": "Acme Development",
    "phone_mobile": "602-555-1234",
    "enriched": true,
    "enriched_at": "[TODAY_ISO]",
    "source": "email"
  }'
```

Always set `enriched: true` and `enriched_at` after processing, even if no fields
were found — this prevents re-processing the same contact on the next run.

Log each enriched contact: `✓ [Name] ([email]) → title, company, phone`

---

## Step 6 — Summary report

Print:

```
════════════════════════════════════════
  CONTACT BACKFILL COMPLETE
  Run date: [TODAY_ISO]
════════════════════════════════════════

  Windows scanned:     [N] × 90 days = [total years] of history
  Messages reviewed:   [N]
  Unique ext. senders: [N]
  Contacts created:    [N]
  Contacts enriched:   [N]
  Skipped (no sig):    [N]

  Contacts still needing enrichment: [N]
  → Re-run to process next batch of 200
════════════════════════════════════════
```

If more than 200 contacts still need enrichment, advise Ryan to re-run the skill
to continue processing the next batch.
