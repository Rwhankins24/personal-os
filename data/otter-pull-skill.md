---
# OTTER PULL SKILL — PERSONAL OS
# Runs at 4:10am daily via Cowork scheduled task
# Pulls all work-relevant meeting transcripts

## Context
Ryan Hankins, Project Executive at Clayco
hankinsr@claycorp.com
Automated run — complete without confirmation.
TODAY_ISO = [insert today YYYY-MM-DD]
YESTERDAY_OTTER = [insert yesterday YYYY/MM/DD]
TODAY_OTTER = [insert today YYYY/MM/DD]

## Step 1 — Get user context
Call Otter:get_user_info

## Step 2 — Search recent meetings
Call Otter:search with:
  query: ""
  created_after: [YESTERDAY_OTTER]
  created_before: [TODAY_OTTER]
  include_shared_meetings: false

If no meetings returned: write empty report and exit cleanly.

## Step 3 — Filter to work-relevant meetings
SKIP if ANY true:
  duration < 5 minutes
  title contains: personal, doctor, appointment, therapy, family, school
  short_summary has personal signals AND no project keywords

KEEP if ANY true:
  action_items contains hankinsr@claycorp.com
  short_summary contains: project, construction, Clayco, scope, cost,
    schedule, contract, budget, Pacific Fusion, Solis, DS3, Southbank,
    renovation, pursuit, proposal, estimate
  calendar_participants has work domains:
    claycorp.com, stantec.com, thorntontomasetti.com, baldwinins.com
  duration > 20 minutes

## Step 4 — Parse metadata
For each kept meeting:
  meeting_id: id field
  title: title field
  start_time: start_time field
  duration_raw: duration field
  short_summary: short_summary field
  Parse action_items:
    Split each on " : " → assignee + task
    Split assignee on " - " → name + email
    is_ryan_item: email = hankinsr@claycorp.com
  Parse calendar_participants:
    Split on ": " → name + email
  needs_full_transcript: true if:
    Any ryan_item exists
    OR short_summary has project keywords
    OR duration > 20 minutes

## Step 5 — Fetch full transcripts
For each needs_full_transcript = true:
  Call Otter:fetch with id: [meeting_id]
  Store full transcript text.
  If fetch fails: store metadata only, continue.

## Step 6 — Build report JSON
{
  "report_date": "[TODAY_ISO]",
  "pull_timestamp": "[ISO timestamp]",
  "meetings_found": X,
  "meetings_kept": X,
  "meetings_with_transcripts": X,
  "meetings": [
    {
      "otter_id": "...",
      "title": "...",
      "start_time": "2026/05/17 14:00:00",
      "duration_raw": "43m 59s",
      "duration_seconds": 2639,
      "short_summary": "...",
      "full_transcript": "... or null",
      "has_full_transcript": true,
      "participants": [
        {"name": "Ryan Hankins", "email": "hankinsr@claycorp.com"}
      ],
      "action_items_parsed": [
        {
          "assignee_name": "Ryan Hankins",
          "assignee_email": "hankinsr@claycorp.com",
          "task_text": "Review structural drawings",
          "is_ryan_item": true
        }
      ],
      "ryan_action_items": ["task text..."],
      "others_action_items": [
        {"name": "Bill", "email": null, "task": "Follow up with Nick..."}
      ],
      "project_signals": ["solis","structural"]
    }
  ]
}

## Step 7 — Write precondition and save
Re-read output file if exists:
cat ~/personal-os/data/last-otter-report.json

Make NO other tool calls between re-read and write.

Write to:
~/personal-os/data/last-otter-report.json

## Step 8 — Mark pipeline completion
curl -s -X POST \
  "https://personal-os-five-black.vercel.app/api/pipeline/complete-step" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b" \
  -d '{"step":"otter_pull","run_date":"[TODAY_ISO]"}'

Note: sandbox will block this. Expected. Local file write is the deliverable.

## Step 9 — Print summary
"OTTER PULL COMPLETE [TODAY_ISO]"
"Meetings found: X"
"Meetings kept: X"
"Transcripts fetched: X"
"Ryan action items: X"
"Others action items: X"
"File: ~/personal-os/data/last-otter-report.json"

## Resilience Rules
Rule 1: Search error → log, write empty, exit
Rule 2: Fetch fails → store metadata only, continue
Rule 3: Sandbox network blocks → log as sandbox_blocked not error
Rule 4: Never abort silently
Rule 5: Re-read before write. Always.
---
