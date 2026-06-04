-- Session 9 Migration
-- Run once in Supabase SQL editor

-- Pre/post meeting notes on calendar events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS pre_meeting_notes  TEXT,
  ADD COLUMN IF NOT EXISTS post_meeting_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_events_pre_notes
  ON events (id) WHERE pre_meeting_notes IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_post_notes
  ON events (id) WHERE post_meeting_notes IS NOT NULL;

-- Source tracking on contacts (email | manual | otter | plaud)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Index for fast unenriched contact queries
CREATE INDEX IF NOT EXISTS idx_contacts_enriched
  ON contacts (enriched) WHERE enriched IS NULL OR enriched = false;
