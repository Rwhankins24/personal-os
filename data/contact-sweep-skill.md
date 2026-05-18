---
# CONTACT SWEEP SKILL — PERSONAL OS
# Run once manually in Cowork
# Sweeps Outlook inbox history for contacts

## Context
Ryan Hankins, Project Executive at Clayco
hankinsr@claycorp.com
TODAY_ISO = [insert today YYYY-MM-DD]

## Step 1 — Confirm session
Call Microsoft 365 connector to confirm authenticated.
Run a simple inbox search to verify connection is active.
If connector is not available, stop and report the issue.

## Step 2 — Search inbox in batches
Search Outlook inbox in 30-day batches going back 12 months.

For each batch use outlook_email_search:
  folder: inbox
  received_after: [batch start]
  received_before: [batch end]
  max_results: 50

Collect all unique senders tracking:
  from_address (email)
  from_name (display name)
  email_count (how many emails from them)
  most_recent_date

For each unique sender keep only their most recent email reference.

Process these date ranges sequentially:
  Batch 1: last 30 days
  Batch 2: 31-60 days ago
  Batch 3: 61-90 days ago
  Batch 4: 91-180 days ago
  Batch 5: 181-365 days ago

After all batches deduplicate sender list keeping highest email count
per unique email address.

## Step 3 — Filter senders
SKIP these senders:
  noreply@, no-reply@, donotreply@
  mailer@, newsletter@, updates@
  info@, hello@, support@, admin@
  Any sender with only 1 email total
  Display names that look like companies not people
    (no space in name, all caps, ends in Inc/LLC/Corp)

KEEP senders who:
  Have sent 2+ emails to Ryan
  Have a real person name (first + last)
  Are from professional domains

## Step 4 — Fetch most recent email body
For each kept sender fetch the full body of their most recent email.

Use outlook_email_search:
  from: [sender email]
  folder: inbox
  max_results: 1

Extract the full email body text.
This is where the signature lives — typically at the bottom after a
separator line (-- or ___ or similar).

Process in batches of 10 to avoid rate limits.
Brief pause between batches.

## Step 5 — Extract signature data
For each email body analyze the content to find the signature block.

Look for these patterns:
  Text after "-- " or "___" separator
  Formatted block with name, title, company, phone on separate lines
  Phone number patterns:
    (XXX) XXX-XXXX
    XXX-XXX-XXXX
    +1-XXX-XXX-XXXX
  LinkedIn URLs: linkedin.com/in/
  Email addresses in signature (may differ from from_address)

Extract:
  full_name: complete name
  title: job title or role
  company: company/organization name
  phone_mobile: mobile/cell number
  phone_office: office/direct number
  email: email in signature if different
  linkedin: LinkedIn URL
  address: office address
  confidence: high/medium/low

confidence = high: clear signature block found with 3+ data points
confidence = medium: partial data, 1-2 data points found
confidence = low: no clear signature, name/email only

## Step 6 — Build output JSON

{
  "sweep_date": "[TODAY_ISO]",
  "senders_found": [total unique],
  "contacts_extracted": [count],
  "high_confidence": [count],
  "medium_confidence": [count],
  "low_confidence": [count],
  "contacts": [
    {
      "name": "Full Name",
      "email": "email@domain.com",
      "title": "Job Title or null",
      "company": "Company or null",
      "phone_mobile": "number or null",
      "phone_office": "number or null",
      "linkedin": "URL or null",
      "address": "address or null",
      "confidence": "high|medium|low",
      "last_email_date": "YYYY-MM-DD",
      "email_count": 5
    }
  ]
}

## Step 7 — Write precondition and save
Re-read output file if exists:
  cat ~/personal-os/data/contact-sweep.json

Make NO other tool calls between re-read and write.

Write complete JSON to:
  ~/personal-os/data/contact-sweep.json

## Step 8 — Print summary
"CONTACT SWEEP COMPLETE [TODAY_ISO]"
"Unique senders processed: X"
"High confidence: X"
"Medium confidence: X"
"Low confidence: X"
"File: ~/personal-os/data/contact-sweep.json"
"Next step: node ~/personal-os/scripts/process-contact-sweep.js"

## Resilience Rules
Rule 1: Process batches one at a time. If a batch fails continue to next.
Rule 2: Never abort — partial results are better than no results.
Rule 3: Rate limit — pause 2 seconds between batches of email fetches.
Rule 4: Re-read before write. Always.
Rule 5: Sandbox network blocks expected. Log and continue.
---
