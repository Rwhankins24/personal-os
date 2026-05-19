# Setting Up the Otter Scheduled Task

One-time manual setup in Cowork.

## Steps

1. Open Cowork
2. Go to Cowork tab → Scheduled tasks
3. Create new scheduled task
4. Set time: 4:10 AM daily
5. Paste this exact prompt:

---
Read the Otter pull skill at
~/personal-os/data/otter-pull-skill.md
and run it completely.

TODAY_ISO = [insert today's date YYYY-MM-DD]
YESTERDAY_OTTER = [insert yesterday YYYY/MM/DD]
TODAY_OTTER = [insert today YYYY/MM/DD]

This is an automated run. Complete all
steps without asking for confirmation.
Follow all resilience rules.

Write output to:
~/personal-os/data/last-otter-report.json
---

6. Save the task
7. Run it once manually right now to pre-approve the Otter MCP tools and test the pipeline

## After running manually

Check the output file:
```bash
cat ~/personal-os/data/last-otter-report.json
```

Then run the nightly job to process the Otter data:
```bash
cd ~/personal-os/api && node src/jobs/nightly-ai-local.js
```

## Schedule

- Otter pull runs at 4:10 AM daily
- Upload script (launchd) monitors for the file and uploads to Supabase storage
- GitHub Actions AI job waits for Otter OR times out after 30 minutes

## Verification

Check your launchd jobs are all running:
```bash
launchctl list | grep personalos
```

Expected:
- com.personalos.wake
- com.personalos.upload
- com.personalos.process
- com.personalos.otter-upload

Load the new Otter upload job if not showing:
```bash
launchctl load ~/Library/LaunchAgents/com.personalos.otter-upload.plist
```
