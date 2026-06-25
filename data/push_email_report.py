#!/usr/bin/env python3
"""
personal-os — Email Report Push
Reads ~/personal-os/data/last-email-report.json and POSTs each classified thread
to the Vercel webhook. Runs automatically at 5 AM via launchd.

Manual run: python3 ~/personal-os/data/push_email_report.py
"""

import json
import urllib.request
import urllib.error
import os
import sys
from datetime import date

WEBHOOK = "https://personal-os-five-black.vercel.app/api/webhooks?type=email"
REPORT_FILE = os.path.expanduser("~/personal-os/data/last-email-report.json")
ARCHIVE_DIR = os.path.expanduser("~/personal-os/data/archive")
LOG_FILE = os.path.expanduser("~/personal-os/data/push-email.log")

def archive_report(today):
    """Copy last-email-report.json to archive/YYYY-MM-DD-email-report.json."""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    dest = os.path.join(ARCHIVE_DIR, f"{today}-email-report.json")
    if not os.path.exists(dest):
        import shutil
        shutil.copy2(REPORT_FILE, dest)
        return dest
    return dest  # already archived

def log(msg):
    print(msg)
    with open(LOG_FILE, "a") as f:
        f.write(msg + "\n")

def post(label, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        WEBHOOK,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            code = resp.getcode()
            if code in (200, 201):
                log(f"  ✓ {label}")
                return True
            else:
                log(f"  ✗ {label}  [HTTP {code}]")
                return False
    except urllib.error.HTTPError as e:
        log(f"  ✗ {label}  [HTTP {e.code}]")
        return False
    except Exception as e:
        log(f"  ✗ {label}  [{e}]")
        return False

def thread_to_payload(t, today):
    return {
        "from_address":           t.get("from_address", ""),
        "from_name":              t.get("from_name", ""),
        "subject":                t.get("subject", t.get("thread_subject", "")),
        "thread_subject":         t.get("thread_subject", t.get("subject", "")),
        "body_preview":           (t.get("body_preview") or t.get("full_thread_content") or "")[:500],
        "received_at":            t.get("received_at", ""),
        "status":                 t.get("status", "read"),
        "importance":             "normal",
        "bucket":                 t.get("bucket", 3),
        "tags":                   t.get("tags", []),
        "days_waiting":           t.get("days_waiting", 0),
        "urgency":                t.get("urgency", "normal"),
        "followed_up":            t.get("followed_up", False),
        "cross_reference_status": t.get("cross_reference_status", "new"),
        "is_internal":            t.get("is_internal", False),
        "has_attachment":         t.get("has_attachment", t.get("has_attachments", False)),
        "is_time_sensitive":      t.get("is_time_sensitive", False),
        "has_contract_language":  t.get("has_contract_language", t.get("contract_language_flag", False)),
        "is_flagged":             t.get("is_flagged", False),
        "thread_participant_count": t.get("thread_participant_count", 1),
        "last_report_date":       today,
    }

STATE_FILE = os.path.expanduser("~/personal-os/data/push-state.json")

def already_pushed_today(today):
    """Idempotency guard — skip if we already pushed today's report."""
    if not os.path.exists(STATE_FILE):
        return False
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
        return state.get("last_push_date") == today
    except Exception:
        return False

def mark_pushed(today):
    with open(STATE_FILE, "w") as f:
        json.dump({"last_push_date": today}, f)

def main():
    today = date.today().isoformat()

    # Accept optional path arg for manual backfill — skips idempotency check
    report_path = sys.argv[1] if len(sys.argv) > 1 else REPORT_FILE
    manual_backfill = len(sys.argv) > 1

    if not manual_backfill and already_pushed_today(today):
        log(f"[{today}] Already pushed today — skipping.")
        sys.exit(0)

    if manual_backfill:
        log(f"[BACKFILL MODE] Bypassing idempotency check for: {report_path}")

    log(f"\n{'━'*50}")
    log(f"  EMAIL PUSH — {today}")
    log(f"{'━'*50}")

    if not os.path.exists(report_path):
        log(f"✗ Report file not found: {report_path}")
        log("  Task 2 (classify) may not have run yet. Exiting.")
        sys.exit(1)

    # Archive today's report before pushing
    if report_path == REPORT_FILE:
        archived = archive_report(today)
        log(f"  Archived → {archived}")

    with open(report_path) as f:
        report = json.load(f)

    report_date = report.get("report_date", "")
    if report_date != today:
        log(f"⚠  Report date is {report_date}, today is {today}.")
        log("   Proceeding anyway — may be a weekend or holiday catch-up.")

    success = 0
    fail = 0

    for bucket_key in ["bucket1", "bucket2", "bucket3", "bucket4"]:
        items = report.get(bucket_key, [])
        if not items:
            continue
        label_map = {
            "bucket1": "NEEDS REPLY",
            "bucket2": "WAITING ON",
            "bucket3": "OVERSIGHT",
            "bucket4": "DOCUMENTS",
        }
        log(f"\n── {label_map[bucket_key]} ({len(items)}) ──")
        for t in items:
            label = t.get("thread_subject") or t.get("subject") or "thread"
            payload = thread_to_payload(t, today)
            if post(label[:60], payload):
                success += 1
            else:
                fail += 1

    # Post pipeline marker
    log(f"\n── PIPELINE MARKER ──")
    marker = {
        "type": "pipeline_complete",
        "report_date": today,
        "bucket1_count": len(report.get("bucket1", [])),
        "bucket2_count": len(report.get("bucket2", [])),
        "bucket3_count": len(report.get("bucket3", [])),
        "bucket4_count": len(report.get("bucket4", [])),
        "bucket6_count": report.get("bucket6_count", 0),
    }
    marker_req = urllib.request.Request(
        "https://personal-os-five-black.vercel.app/api/webhooks?type=pipeline_complete",
        data=json.dumps(marker).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(marker_req, timeout=15) as r:
            log(f"  ✓ Pipeline marker posted  [HTTP {r.getcode()}]")
    except Exception as e:
        log(f"  ✗ Pipeline marker failed  [{e}]")

    mark_pushed(today)

    log(f"\n{'━'*50}")
    log(f"  SUCCESS: {success}  |  FAILED: {fail}")
    log(f"  Archive: {ARCHIVE_DIR}/{today}-email-report.json")
    log(f"{'━'*50}\n")

if __name__ == "__main__":
    main()
