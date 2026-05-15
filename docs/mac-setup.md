# Mac Automation Setup — Personal OS Morning Pipeline

This configures your Mac to wake at 5:55 AM, run the email-pull skill at 6:00 AM
via Cowork, and stay available as a fallback server if needed.

---

## Step 1 — Prevent sleep

**Option A: System Settings (permanent)**

System Settings → Battery →
- Uncheck "Enable Power Nap"
- Set "Turn display off after" to Never (or a long duration)
- Under "Options": enable "Prevent automatic sleeping when display is off"

**Option B: Terminal (session-based)**

```bash
caffeinate -i &
```

Keeps the Mac awake indefinitely until you kill the process. Add to a login script
if you want it automatic.

---

## Step 2 — Wake schedule

System Settings → Battery → Schedule:
- Check "Start up or wake"
- Set time: **5:55 AM** (weekdays)
- Optionally set weekends too if you want weekend runs

This wakes the machine 5 minutes before the 6:00 AM Cowork trigger fires.

---

## Step 3 — Login Items

System Settings → General → Login Items & Extensions:

Add the following to "Open at Login":
- **Claude Desktop** (Cowork runs inside Claude Desktop)
- **Microsoft Outlook** (required for the email-pull skill's MCP connector)

This ensures both are running when the Mac wakes.

---

## Step 4 — Cowork scheduled task

In Claude Desktop → Cowork tab, type `/schedule` and create:

**Schedule:** Daily at 6:00 AM  
**Task prompt:**
```
Run the email-pull skill at ~/personal-os/data/email-pull-skill.md

Today's date is [current date].
My email is hankinsr@claycorp.com.
Follow all resilience rules.
This is an automated run.
```

The skill will:
1. Pull inbox + sent items from Outlook (48h window)
2. Group by thread, classify into 6 buckets
3. Upload JSON to Supabase storage (daily-reports/YYYY-MM-DD.json)
4. Save handoff JSON to ~/personal-os/data/last-email-report.json
5. Print the formatted report

---

## Step 5 — Phone trigger (manual backup)

If the Mac automation misses a morning, trigger the Vercel processing job manually
from your phone using the sync button in the Personal OS dashboard, or via curl:

```bash
curl -X POST \
  "https://personal-os-five-black.vercel.app/api/jobs/process-email-report" \
  -H "Content-Type: application/json" \
  -H "x-trigger-secret: 0557601ac4f4c8f0d42923bba2fb083b"
```

This re-processes whatever JSON is already in Supabase storage for today.

**Note:** The phone trigger processes the report that was already uploaded. It does
NOT re-pull email from Outlook. If you need a fresh pull, run the email-pull skill
again first via Cowork.

---

## Step 6 — Verify the full pipeline

After first setup, leave the Mac on overnight. Next morning check:

1. `~/personal-os/data/last-email-report.json` — should exist with today's date
2. Supabase storage → `daily-reports/` bucket → file named `YYYY-MM-DD.json`
3. Supabase database → `emails` table → new rows with `last_report_date` = today
4. Dashboard sync button — tap it, should show green checkmark with record count

---

## Pipeline architecture reference

```
6:00 AM — Cowork runs email-pull skill
            ↓
        Pulls Outlook (MCP connector)
            ↓
        Classifies threads into 6 buckets
            ↓
        Uploads JSON → Supabase storage (daily-reports/YYYY-MM-DD.json)
            ↓
        Saves ~/personal-os/data/last-email-report.json

[manual or phone trigger]
            ↓
        POST /api/jobs/process-email-report (x-trigger-secret)
            ↓
        Reads from Supabase storage
            ↓
        Upserts emails + calendar → Supabase database
            ↓
        Dashboard reflects updated data
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Mac didn't wake | Check Battery → Schedule is still set |
| Claude Desktop not open | Add to Login Items |
| Outlook MCP connector not responding | Restart Outlook, re-authenticate |
| Storage upload fails | Run skill again; check Supabase storage bucket exists |
| Phone trigger returns 401 | Verify TRIGGER_SECRET matches in api/.env and Vercel env vars |
| Phone trigger returns 404 | JSON not yet uploaded for today — run email-pull skill first |
