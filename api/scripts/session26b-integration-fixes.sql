-- session26b-integration-fixes.sql
-- Integration audit fixes (three breaks found):
--
-- Fix 1: Plaud block columns missing from meeting_notes
--   Without these, hasPlaudBlocks is always false and structured block routing never triggers.
--
-- Fix 2: conversation_id missing from emails table
--   Without this, Phase 1B index keys never match and fast path never fires.

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS people_and_actions  jsonb,
  ADD COLUMN IF NOT EXISTS decisions_and_risks jsonb,
  ADD COLUMN IF NOT EXISTS meeting_metadata    jsonb;

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS conversation_id text;

CREATE INDEX IF NOT EXISTS idx_emails_conversation_id
  ON emails(conversation_id);
