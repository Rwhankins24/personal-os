#!/usr/bin/env python3
"""
Personal OS — Send email report via Gmail SMTP
Reads last-email-report.json, formats as HTML email,
sends from GMAIL_ADDRESS to GMAIL_ADDRESS.

Usage:
  python3 ~/personal-os/scripts/send-report.py
  python3 ~/personal-os/scripts/send-report.py --test   # send test message only
"""

import json
import os
import smtplib
import ssl
import sys
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────
HOME         = Path.home()
ENV_FILE     = HOME / "personal-os" / "api" / ".env"
REPORT_FILE  = HOME / "personal-os" / "data" / "last-email-report.json"
LOG_FILE     = HOME / "personal-os" / "logs" / "send-report.log"

# ── Logging ───────────────────────────────────────────────────────
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ── Load .env ─────────────────────────────────────────────────────
def load_env(path):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        log(f"ERROR: .env not found at {path}")
        sys.exit(1)
    return env

# ── HTML builder ──────────────────────────────────────────────────
URGENCY_COLOR = {
    "critical": "#ef4444",
    "elevated": "#f97316",
    "normal":   "#6b7280",
}

def urgency_badge(u):
    color = URGENCY_COLOR.get(u, "#6b7280")
    return f'<span style="background:{color};color:#fff;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase">{u}</span>'

def tag_pill(t):
    return f'<span style="background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;padding:1px 6px;border-radius:8px;font-size:11px;margin-right:3px">{t}</span>'

def thread_card(t, color="#1e40af"):
    subject   = t.get("thread_subject") or t.get("subject", "—")
    sender    = t.get("latest_sender_name") or t.get("from_name", "—")
    days      = t.get("days_waiting", 0)
    urgency   = t.get("urgency", "normal")
    tags      = t.get("tags") or []
    summary   = t.get("ai_summary") or t.get("action", "")
    tag_html  = "".join(tag_pill(tg) for tg in tags[:4])
    days_str  = f"{days}d ago" if days else "today"
    return f"""
    <div style="border-left:3px solid {color};padding:10px 14px;margin-bottom:10px;background:#fafafa;border-radius:0 6px 6px 0">
      <div style="font-weight:600;color:#111;font-size:13px;margin-bottom:3px">{subject}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:5px">
        {sender} · {days_str} &nbsp; {urgency_badge(urgency)}
      </div>
      {f'<div style="margin-bottom:5px">{tag_html}</div>' if tag_html else ''}
      {f'<div style="font-size:12px;color:#374151;font-style:italic">{summary}</div>' if summary else ''}
    </div>"""

def calendar_row(e):
    title = e.get("title", "—")
    start = e.get("start") or e.get("start_time", "")
    loc   = e.get("location", "")
    conf  = " ⚠️ CONFLICT" if e.get("conflict") else ""
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        time_str = dt.strftime("%-I:%M %p")
    except Exception:
        time_str = start[:16] if start else "—"
    return f"""
    <tr>
      <td style="padding:6px 10px;font-weight:600;color:#1e40af;font-size:12px;white-space:nowrap">{time_str}</td>
      <td style="padding:6px 10px;font-size:12px;color:#111">{title}{conf}</td>
      <td style="padding:6px 10px;font-size:11px;color:#6b7280">{loc}</td>
    </tr>"""

def build_html(report, is_test=False):
    date      = report.get("report_date", datetime.now().strftime("%Y-%m-%d"))
    b1        = report.get("bucket1", [])
    b2        = report.get("bucket2", [])
    b3        = report.get("bucket3", [])
    b4        = report.get("bucket4", [])
    b6        = report.get("bucket6_count", 0)
    calendar  = report.get("calendar", [])
    warnings  = report.get("warnings", [])
    summary   = report.get("summary", {})

    b1_html   = "".join(thread_card(t, "#ef4444") for t in b1) or "<p style='color:#6b7280;font-size:12px'>None</p>"
    b2_html   = "".join(thread_card(t, "#f97316") for t in b2) or "<p style='color:#6b7280;font-size:12px'>None</p>"
    cal_html  = "".join(calendar_row(e) for e in calendar) or "<tr><td colspan='3' style='color:#6b7280;font-size:12px;padding:8px'>No meetings today</td></tr>"
    warn_html = "".join(f"<li style='font-size:11px;color:#92400e;margin-bottom:3px'>{w}</li>" for w in warnings)

    critical = summary.get("critical_count", 0)
    elevated = summary.get("elevated_count", 0)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">

<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:#1e3a5f;padding:20px 24px">
    <div style="color:#93c5fd;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase">Personal OS</div>
    <div style="color:#fff;font-size:20px;font-weight:700;margin-top:2px">Email Intelligence Report</div>
    <div style="color:#93c5fd;font-size:13px;margin-top:4px">{date}{" — TEST MESSAGE" if is_test else ""}</div>
  </div>

  <!-- Summary bar -->
  <div style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:14px 24px;display:flex;gap:24px">
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:700;color:#ef4444">{len(b1)}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase">Needs Reply</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:700;color:#f97316">{len(b2)}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase">Waiting On</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:700;color:#6b7280">{len(b3)}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase">Oversight</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:700;color:#6b7280">{len(b4)}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase">Documents</div>
    </div>
    <div style="text-align:center">
      <div style="font-size:22px;font-weight:700;color:#9ca3af">{b6}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase">Filtered</div>
    </div>
    {"" if not critical and not elevated else f'''
    <div style="text-align:center;margin-left:auto">
      {f'<div style="font-size:22px;font-weight:700;color:#ef4444">{critical}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase">Critical</div>' if critical else ""}
    </div>'''}
  </div>

  <div style="padding:20px 24px">

    <!-- Calendar -->
    <div style="margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">📅 Today's Calendar</div>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:6px;overflow:hidden">
        {cal_html}
      </table>
    </div>

    <!-- Bucket 1 -->
    <div style="margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">✍️ Needs My Reply ({len(b1)})</div>
      {b1_html}
    </div>

    <!-- Bucket 2 -->
    <div style="margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">⏳ Waiting On Them ({len(b2)})</div>
      {b2_html}
    </div>

    {f'''<!-- Warnings -->
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 14px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:6px">⚠️ Warnings</div>
      <ul style="margin:0;padding-left:16px">{warn_html}</ul>
    </div>''' if warnings else ""}

  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 24px;text-align:center">
    <div style="font-size:11px;color:#9ca3af">Personal OS · {date} · hankinsr@claycorp.com → ryanhankins.personalos@gmail.com</div>
  </div>

</div>
</body>
</html>"""

# ── Send ──────────────────────────────────────────────────────────
def send_email(gmail_address, app_password, subject, html_body):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"Personal OS <{gmail_address}>"
    msg["To"]      = gmail_address
    msg.attach(MIMEText(html_body, "html"))

    context = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.ehlo()
        server.starttls(context=context)
        server.login(gmail_address, app_password)
        server.sendmail(gmail_address, gmail_address, msg.as_string())

# ── Main ──────────────────────────────────────────────────────────
def main():
    is_test = "--test" in sys.argv
    log("Starting send-report.py" + (" (TEST MODE)" if is_test else ""))

    # Load credentials
    env = load_env(ENV_FILE)
    gmail_address = env.get("GMAIL_ADDRESS")
    app_password  = env.get("GMAIL_APP_PASSWORD")

    if not gmail_address or not app_password:
        log("ERROR: GMAIL_ADDRESS or GMAIL_APP_PASSWORD missing from api/.env")
        sys.exit(1)

    log(f"Sending from/to: {gmail_address}")

    if is_test:
        # Send a minimal test message
        subject  = "Personal OS — pipeline test"
        html     = """<html><body style="font-family:sans-serif;padding:24px">
        <h2 style="color:#1e3a5f">Personal OS — pipeline test</h2>
        <p>This is a test from Cowork. Pipeline test.</p>
        <p style="color:#6b7280;font-size:12px">Sent via Gmail SMTP · send-report.py</p>
        </body></html>"""
    else:
        # Load report
        if not REPORT_FILE.exists():
            log(f"ERROR: Report file not found at {REPORT_FILE}")
            sys.exit(1)

        with open(REPORT_FILE) as f:
            report = json.load(f)

        report_date = report.get("report_date", "unknown")
        log(f"Report date: {report_date}")

        subject = f"Personal OS — Email Report {report_date}"
        html    = build_html(report)

    try:
        send_email(gmail_address, app_password, subject, html)
        log(f"SUCCESS: Email sent — '{subject}'")
    except smtplib.SMTPAuthenticationError:
        log("ERROR: Gmail authentication failed — check GMAIL_APP_PASSWORD in api/.env")
        log("  Make sure you're using an App Password (not your Gmail password)")
        log("  Generate one at: myaccount.google.com/apppasswords")
        sys.exit(1)
    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
