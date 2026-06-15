-- Session 17c: Add dedup columns to commitments + pending_decisions
--              Add tasks dedup reset (same logic as session17b for others_commitments)
-- Run this in Supabase SQL editor before running the new backfill scripts
-- Safe to run multiple times (all statements are idempotent)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. commitments table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS potential_duplicate_of UUID REFERENCES commitments(id) ON DELETE SET NULL;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS duplicate_confidence INTEGER;

CREATE INDEX IF NOT EXISTS idx_commitments_potential_dup
  ON commitments (potential_duplicate_of)
  WHERE potential_duplicate_of IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pending_decisions table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS potential_duplicate_of UUID REFERENCES pending_decisions(id) ON DELETE SET NULL;

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS duplicate_confidence INTEGER;

CREATE INDEX IF NOT EXISTS idx_pending_decisions_potential_dup
  ON pending_decisions (potential_duplicate_of)
  WHERE potential_duplicate_of IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. tasks reset — same logic as session17b-dedup-reset.sql for others_commitments
--    Clears any previous dedup state on tasks so backfill-tasks-dedup.js starts clean.
--    Uses IF EXISTS guards since tasks already has the dedup columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. Un-archive tasks that were auto-merged below the current 93% threshold.
--     Restores them to open so the backfill can re-evaluate with project clustering.
--     Only touches rows that have duplicate_confidence set (backfill-managed rows).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'duplicate_confidence'
  ) THEN
    UPDATE tasks
    SET
      status                 = 'open',
      potential_duplicate_of = NULL,
      duplicate_confidence   = NULL
    WHERE
      status = 'archived'
      AND duplicate_confidence IS NOT NULL
      AND duplicate_confidence < 93;
  END IF;
END $$;

-- 3b. Clear review flags that are below the current 85% floor.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'duplicate_confidence'
  ) THEN
    UPDATE tasks
    SET
      potential_duplicate_of = NULL,
      duplicate_confidence   = NULL
    WHERE
      status = 'open'
      AND potential_duplicate_of IS NOT NULL
      AND duplicate_confidence IS NOT NULL
      AND duplicate_confidence < 85;
  END IF;
END $$;

-- 3c. Clear any orphaned flags with no confidence score.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'potential_duplicate_of'
  ) THEN
    UPDATE tasks
    SET potential_duplicate_of = NULL
    WHERE
      status = 'open'
      AND potential_duplicate_of IS NOT NULL
      AND duplicate_confidence IS NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify counts after running (optional)
-- ─────────────────────────────────────────────────────────────────────────────

-- tasks dedup state
SELECT
  'tasks' AS tbl,
  status,
  CASE
    WHEN duplicate_confidence IS NULL THEN 'no_confidence'
    WHEN duplicate_confidence < 85    THEN 'below_floor (<85)'
    WHEN duplicate_confidence < 93    THEN 'review_queue (85-92)'
    ELSE                                   'auto_merged (93+)'
  END AS tier,
  COUNT(*) AS cnt
FROM tasks
WHERE potential_duplicate_of IS NOT NULL OR (status = 'archived' AND duplicate_confidence IS NOT NULL)
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
