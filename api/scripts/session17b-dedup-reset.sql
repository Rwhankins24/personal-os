-- Session 17b: Reset others_commitments dedup state for threshold change
-- Old thresholds: auto-archive ≥75%, flag 65–74%
-- New thresholds: auto-archive ≥93%, flag 85–92%, discard <85%
--
-- Run this BEFORE re-running backfill-others-dedup.js
-- Safe to run multiple times (idempotent)

-- 1. Un-archive items that were auto-merged below the new 93% threshold.
--    Restore them to open so the new backfill can re-evaluate with project clustering.
--    Only touches rows that have duplicate_confidence set (backfill-managed rows).
UPDATE others_commitments
SET
  status               = 'open',
  potential_duplicate_of = NULL,
  duplicate_confidence   = NULL
WHERE
  status = 'archived'
  AND duplicate_confidence IS NOT NULL
  AND duplicate_confidence < 93;

-- 2. Clear review flags that are now below the new 85% floor (were flagged at 65–84%).
UPDATE others_commitments
SET
  potential_duplicate_of = NULL,
  duplicate_confidence   = NULL
WHERE
  status = 'open'
  AND potential_duplicate_of IS NOT NULL
  AND duplicate_confidence IS NOT NULL
  AND duplicate_confidence < 85;

-- 3. Clear any orphaned flags with no confidence score.
UPDATE others_commitments
SET
  potential_duplicate_of = NULL
WHERE
  status = 'open'
  AND potential_duplicate_of IS NOT NULL
  AND duplicate_confidence IS NULL;

-- Verify counts after running:
SELECT
  status,
  CASE
    WHEN duplicate_confidence IS NULL THEN 'no_confidence'
    WHEN duplicate_confidence < 85    THEN 'below_floor (<85)'
    WHEN duplicate_confidence < 93    THEN 'review_queue (85-92)'
    ELSE                                   'auto_merged (93+)'
  END AS tier,
  COUNT(*) AS cnt
FROM others_commitments
WHERE potential_duplicate_of IS NOT NULL OR (status = 'archived' AND duplicate_confidence IS NOT NULL)
GROUP BY 1, 2
ORDER BY 1, 2;
