-- Personal OS — Phase 1A Schema Migrations
-- Run these in Supabase SQL Editor (one block at a time, in order)
-- Date: 2026-06-26

-- ════════════════════════════════════════════════════════════════
-- MIGRATION 1: Add job_started_at to pipeline_runs (#68)
-- Purpose: Cascade guard — nightly AI job writes this at startup.
-- The GitHub Actions polling logic uses it to detect: job running
-- (< 110 min ago) vs. crashed (> 110 min ago, no ai_completed_at).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS job_started_at TIMESTAMPTZ;

-- Verify:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'pipeline_runs' AND column_name = 'job_started_at';


-- ════════════════════════════════════════════════════════════════
-- MIGRATION 2: Extend source_type vocabulary (#66)
-- Purpose: Track data provenance on all AI-written records.
-- NOTE: We are EXTENDING the existing source_type field, NOT
-- adding a new "source" field. source_type already exists on
-- some tables (e.g. tasks uses source_type = 'ai_email').
-- ════════════════════════════════════════════════════════════════

-- Add source_type to tables that don't have it yet
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

ALTER TABLE strategic_decisions
  ADD COLUMN IF NOT EXISTS source_type VARCHAR DEFAULT 'manual';

-- Add approved_at for tracking when Ryan interacted with an AI-extracted record
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════════
-- MIGRATION 3: Add match_attempted to meeting_notes (#86)
-- Purpose: Prevent Step 2.44 from repeatedly trying to re-match
-- very old unlinked Plaud meetings. Once marked, it won't retry.
-- (The 30-day time window is the primary guard; this is backup.)
-- ════════════════════════════════════════════════════════════════

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS match_attempted BOOLEAN DEFAULT FALSE;

-- Mark all existing unlinked meetings older than 30 days as already attempted
-- (so tonight's run doesn't immediately try to match all historical meetings)
UPDATE meeting_notes
SET match_attempted = TRUE
WHERE source = 'plaud'
  AND event_id IS NULL
  AND start_time < NOW() - INTERVAL '30 days';

-- Verify row count updated:
-- SELECT COUNT(*) FROM meeting_notes WHERE match_attempted = TRUE;


-- ════════════════════════════════════════════════════════════════
-- ALL DONE
-- After running these, the following will work:
--   - job_started_at written at start of each AI run
--   - GitHub Actions cascade guard reads job_started_at
--   - source_type available on all key tables
--   - Step 2.44 won't hammer historical meetings nightly
-- ════════════════════════════════════════════════════════════════
