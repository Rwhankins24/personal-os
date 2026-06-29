-- session27-phase1b-emails-extracted.sql
-- Store Phase 1B classification output in the emails table.
--
-- The email-classify skill writes structured extraction (action_items, commitments,
-- pending_decisions, risk_signals, decisions_made, key_facts, ai_summary,
-- context_type) into email.extracted in the classify output JSON.
--
-- process-email-report.js now writes this object to the emails table so the
-- nightly AI job can read Phase 1B intelligence directly from the DB as a
-- reliable fallback when the Supabase storage path is unavailable (sandbox block).
--
-- The nightly job supplements its phase1bIndex from emails.extracted for any
-- conversation_id not found in the storage JSON.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS extracted JSONB;

-- Index for nightly job lookups by conversation_id (already exists from session26b)
-- but create here too in case it doesn't:
CREATE INDEX IF NOT EXISTS idx_emails_conversation_id ON emails(conversation_id);

-- Partial index on extracted for fast filtering of threads that have Phase 1B data
CREATE INDEX IF NOT EXISTS idx_emails_extracted_notnull
  ON emails(conversation_id)
  WHERE extracted IS NOT NULL;
