# Running the Contact Sweep

ONE-TIME SETUP: Populate your contacts database from 12 months of inbox history.

---

## Step 1 — Run SQL migration first

If you haven't already run the session7 migration, do that first in Supabase SQL Editor:

```
cat ~/personal-os/api/scripts/session7-contacts-migration.sql
```

Copy and paste the output into Supabase SQL Editor → Run.

---

## Step 2 — Run skill in Cowork

Open Cowork and type:

```
Read the contact sweep skill at
~/personal-os/data/contact-sweep-skill.md
and run it completely.

TODAY_ISO = [today's date YYYY-MM-DD]

This is a one-time historical sweep.
Process all 5 date batches sequentially.
Complete all steps without asking for
confirmation.

Write output to:
~/personal-os/data/contact-sweep.json
```

**Takes 20-30 minutes. Do not interrupt.**

---

## Step 3 — Process results

After Cowork finishes, run in Terminal:

```bash
node ~/personal-os/scripts/process-contact-sweep.js
```

Expected output:
```
═══ PROCESS CONTACT SWEEP ═══
Sweep date:        2026-05-18
Contacts in file:  147
  High confidence: 89
  Med confidence:  41
  Low confidence:  17

Loading existing contacts from Supabase...
Existing contacts: 23

═══ RESULTS ═══
✓ New contacts created:  84
✓ Existing enriched:     19
⚠ Job changes flagged:   3
  Low conf skipped:      17

Done. Check /contacts in your dashboard.
Review flagged items: cat ~/personal-os/data/contact-sweep-review.json
```

---

## Step 4 — Review flagged contacts

If any contacts have possible job changes:

```bash
cat ~/personal-os/data/contact-sweep-review.json
```

Or open their contact card in the dashboard — the ⚠️ banner will appear
with Accept / Keep buttons.

---

## Step 5 — Verify in dashboard

Go to `/contacts` — should show significantly more contacts with
title, company, phone populated.

Sort by "Going cold" to identify long-neglected contacts.
Sort by "Most open items" to see who has pending commitments.

---

## When to re-run

Re-run every 6 months.

**Safe to run multiple times — zero duplicate risk.**
The processing script matches by email, name+domain, and fuzzy name before
creating any new record.
