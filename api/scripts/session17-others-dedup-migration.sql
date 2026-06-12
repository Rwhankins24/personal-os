-- Session 17: Add potential_duplicate_of + duplicate_confidence to others_commitments
-- Run this in Supabase SQL editor before running the backfill script

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS potential_duplicate_of UUID REFERENCES others_commitments(id) ON DELETE SET NULL;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS duplicate_confidence INTEGER;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS duplicate_reviewed BOOLEAN DEFAULT false;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS known_not_duplicate_with UUID[];

CREATE INDEX IF NOT EXISTS idx_others_commitments_potential_dup
  ON others_commitments (potential_duplicate_of)
  WHERE potential_duplicate_of IS NOT NULL;
