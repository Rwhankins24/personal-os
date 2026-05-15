-- =============================================================
-- personal-os :: Migration 02 — Email Classification Fields
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- Add classification columns to emails table
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS bucket                   INTEGER,
  ADD COLUMN IF NOT EXISTS tags                     TEXT[],
  ADD COLUMN IF NOT EXISTS days_waiting             INTEGER,
  ADD COLUMN IF NOT EXISTS followed_up              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cross_reference_status   TEXT,        -- new | aging | resolved
  ADD COLUMN IF NOT EXISTS is_internal              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachment           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_time_sensitive        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_contract_language    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS thread_participant_count INTEGER,
  ADD COLUMN IF NOT EXISTS last_report_date         DATE;

-- Urgency field (added in v2 of this migration)
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS urgency TEXT;            -- normal | elevated | high | critical

-- Indexes for AI job queries at 6:05am
CREATE INDEX IF NOT EXISTS idx_emails_bucket       ON emails (bucket);
CREATE INDEX IF NOT EXISTS idx_emails_days_waiting ON emails (days_waiting);
CREATE INDEX IF NOT EXISTS idx_emails_is_internal  ON emails (is_internal);
CREATE INDEX IF NOT EXISTS idx_emails_urgency      ON emails (urgency);
