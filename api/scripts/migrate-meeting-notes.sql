-- Migration: extend meeting_notes for Plaud + Otter pipeline
-- Run in Supabase SQL Editor

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS otter_id              TEXT UNIQUE,        -- plaud_<gmailId> or otter_<otterId>
  ADD COLUMN IF NOT EXISTS start_time            TIMESTAMPTZ,        -- alias for meeting_date
  ADD COLUMN IF NOT EXISTS short_summary         TEXT,               -- AI summary (Plaud summary.txt)
  ADD COLUMN IF NOT EXISTS full_transcript       TEXT,               -- full transcript text
  ADD COLUMN IF NOT EXISTS action_items_raw      JSONB DEFAULT '[]', -- [{task_text, assignee_name, assignee_email}]
  ADD COLUMN IF NOT EXISTS participants          JSONB DEFAULT '[]', -- array of name strings
  ADD COLUMN IF NOT EXISTS intelligence_extracted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS commitments_extracted  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_date       DATE;

-- Index for efficient unprocessed query
CREATE INDEX IF NOT EXISTS idx_meeting_notes_intelligence
  ON meeting_notes (intelligence_extracted, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_otter_id
  ON meeting_notes (otter_id);
