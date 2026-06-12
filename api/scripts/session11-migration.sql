-- Session 11 Migration
-- Run once in Supabase SQL editor
-- Fixes: task status enum, others_commitments column naming, pipeline error tracking

-- ─────────────────────────────────────────────────────────────────
-- 1. tasks: fix status 'active' → 'open'
--    The nightly job and all queries expect 'open'. Historical backfill used 'active'.
-- ─────────────────────────────────────────────────────────────────

UPDATE tasks
  SET status = 'open'
  WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────
-- 2. others_commitments: ensure correct column names exist
--    Code references committed_by_name / committed_by_email.
--    Older backfill scripts incorrectly wrote to person_name / person_email.
-- ─────────────────────────────────────────────────────────────────

-- Add committed_by_name if it doesn't exist yet
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS committed_by_name TEXT;

-- Add committed_by_email if it doesn't exist yet
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS committed_by_email TEXT;

-- If person_name column exists, backfill committed_by_name from it
-- (safe no-op if person_name column doesn't exist — catches error via DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'others_commitments' AND column_name = 'person_name'
  ) THEN
    UPDATE others_commitments
      SET committed_by_name = person_name
      WHERE committed_by_name IS NULL AND person_name IS NOT NULL;

    UPDATE others_commitments
      SET committed_by_email = person_email
      WHERE committed_by_email IS NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'others_commitments' AND column_name = 'person_email'
        );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 3. others_commitments: fix status 'pending' → 'open'
--    Backfill script used 'pending'; production code expects 'open'.
-- ─────────────────────────────────────────────────────────────────

UPDATE others_commitments
  SET status = 'open'
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────
-- 4. pipeline_runs: add error_count column if missing
--    Used by partial-failure detection in nightly-ai.yml
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────
-- 5. Indexes for performance (safe to re-run)
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_others_commitments_committed_by_name
  ON others_commitments (committed_by_name);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks (status);

-- ─────────────────────────────────────────────────────────────────
-- Verification queries — run after migration to confirm
-- ─────────────────────────────────────────────────────────────────

-- Should return 0:
-- SELECT count(*) FROM tasks WHERE status = 'active';

-- Should return 0:
-- SELECT count(*) FROM others_commitments WHERE status = 'pending';

-- Should show populated data:
-- SELECT count(*), count(committed_by_name) FROM others_commitments WHERE status = 'open';

-- ─────────────────────────────────────────────────────────────────
-- 6. meeting_notes: cache full extracted intelligence
--    Stores the complete AI extraction result so signals can be
--    pushed to project JSONB even after project_id is assigned later
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS extracted_intelligence JSONB;

-- raw_transcript: fallback field used by backfill (some older records use this vs full_transcript)
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS raw_transcript TEXT;

-- ─────────────────────────────────────────────────────────────────
-- 7. tasks: source tracking for meeting-sourced tasks
--    source_type differentiates email vs meeting origin (e.g. 'ai_otter', 'ai_plaud', 'ai_manual')
--    meeting_note_id links task back to the specific meeting record
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_type TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS meeting_note_id UUID REFERENCES meeting_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_meeting_note_id
  ON tasks (meeting_note_id);

-- ─────────────────────────────────────────────────────────────────
-- 8. others_commitments: source tracking + meeting link
--    Mirrors the pattern used for tasks above
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source_type TEXT;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source_date DATE;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS meeting_note_id UUID REFERENCES meeting_notes(id) ON DELETE SET NULL;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_others_commitments_meeting_note_id
  ON others_commitments (meeting_note_id);

-- ─────────────────────────────────────────────────────────────────
-- 9. commitments (Ryan's): source tracking
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS source_type TEXT;
