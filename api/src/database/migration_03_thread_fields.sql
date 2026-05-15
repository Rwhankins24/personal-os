-- =============================================================
-- personal-os :: Migration 03 — Thread-Aware Email Fields
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS conversation_id        TEXT,
  ADD COLUMN IF NOT EXISTS thread_message_count   INTEGER,
  ADD COLUMN IF NOT EXISTS thread_participants    TEXT[],
  ADD COLUMN IF NOT EXISTS latest_sender          TEXT,
  ADD COLUMN IF NOT EXISTS latest_sender_name     TEXT,
  ADD COLUMN IF NOT EXISTS my_last_reply_time     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiting_since          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thread_subject         TEXT,
  ADD COLUMN IF NOT EXISTS is_flagged             BOOLEAN DEFAULT false;

-- Indexes for dashboard queries and thread deduplication
CREATE INDEX IF NOT EXISTS idx_emails_conversation_id ON emails (conversation_id);
CREATE INDEX IF NOT EXISTS idx_emails_is_flagged      ON emails (is_flagged);
CREATE INDEX IF NOT EXISTS idx_emails_waiting_since   ON emails (waiting_since);
