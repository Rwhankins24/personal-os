-- Session 7: Otter integration migration
-- Run in Supabase SQL Editor

-- Meeting notes table
CREATE TABLE IF NOT EXISTS meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  otter_id TEXT UNIQUE NOT NULL,
  title TEXT,
  title_inferred TEXT,
  start_time TIMESTAMPTZ,
  duration_seconds INTEGER,
  duration_raw TEXT,
  short_summary TEXT,
  full_transcript TEXT,
  participants JSONB DEFAULT '[]'::jsonb,
  action_items_raw JSONB DEFAULT '[]'::jsonb,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  project_confidence TEXT DEFAULT 'low',
  intelligence_extracted BOOLEAN DEFAULT false,
  commitments_extracted BOOLEAN DEFAULT false,
  extraction_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meeting_notes: auth full access"
  ON meeting_notes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Speaker attribution learning
CREATE TABLE IF NOT EXISTS speaker_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meeting_notes(id) ON DELETE CASCADE,
  speaker_label TEXT,
  attributed_to_name TEXT,
  attributed_to_email TEXT,
  attributed_to_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  confidence TEXT DEFAULT 'medium',
  attribution_basis JSONB DEFAULT '[]'::jsonb,
  confirmed_by_ryan BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE speaker_attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "speaker_attributions: auth full access"
  ON speaker_attributions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add Otter pipeline columns
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS otter_pull_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otter_processing_completed_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meeting_notes_otter_id ON meeting_notes (otter_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_start_time ON meeting_notes (start_time);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_project ON meeting_notes (project_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_extracted ON meeting_notes (intelligence_extracted);
