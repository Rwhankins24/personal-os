-- Migration: add delivery_type to others_commitments
-- Run once in Supabase SQL editor

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'general'
    CHECK (delivery_type IN ('general', 'to_ryan', 'blocking_ryan'));

-- Backfill: existing rows stay 'general'
UPDATE others_commitments
  SET delivery_type = 'general'
  WHERE delivery_type IS NULL;

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_others_commitments_delivery_type
  ON others_commitments (delivery_type);
