-- Session 9 Migration — meeting notes fields
-- Run once in Supabase SQL editor

-- Pre/post meeting notes on calendar events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS pre_meeting_notes  TEXT,
  ADD COLUMN IF NOT EXISTS post_meeting_notes TEXT;

-- Index for events that have notes (useful for AI job context queries)
CREATE INDEX IF NOT EXISTS idx_events_pre_notes
  ON events (id) WHERE pre_meeting_notes IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_post_notes
  ON events (id) WHERE post_meeting_notes IS NOT NULL;
