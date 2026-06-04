-- Session 8 Migration — consolidated
-- Run once in Supabase SQL editor
-- All statements use IF NOT EXISTS — safe to re-run

-- ─────────────────────────────────────────────────
-- tasks: columns referenced in nightly-ai-local.js
-- ─────────────────────────────────────────────────

-- source_id: UUID link back to the source email row
-- (enables direct cascade on task completion without fuzzy subject matching)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES emails(id) ON DELETE SET NULL;

-- ai_enriched: flag indicating row was created/updated by AI job
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ai_enriched BOOLEAN DEFAULT false;

-- source_confidence: AI confidence score (0–1) for the extraction
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC(4,3) DEFAULT 0.85;

-- cross_references: JSONB array of related email/thread IDs surfaced by AI
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS cross_references JSONB DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────
-- others_commitments: columns referenced in nightly-ai-local.js
-- ─────────────────────────────────────────────────────────────────

-- delivery_type: three-tier classification
--   'general'        — someone else's action item, FYI
--   'to_ryan'        — owed directly to Ryan
--   'blocking_ryan'  — actively blocking Ryan's work (manual escalation only)
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'general'
    CHECK (delivery_type IN ('general', 'to_ryan', 'blocking_ryan'));

-- source_id / source_label: link back to originating email or meeting
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source_id UUID;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- ─────────────────────────────────────────────────
-- Backfill defaults on existing rows
-- ─────────────────────────────────────────────────

UPDATE tasks
  SET ai_enriched = false
  WHERE ai_enriched IS NULL;

UPDATE tasks
  SET source_confidence = 0.85
  WHERE source_confidence IS NULL;

UPDATE tasks
  SET cross_references = '[]'::jsonb
  WHERE cross_references IS NULL;

UPDATE others_commitments
  SET delivery_type = 'general'
  WHERE delivery_type IS NULL;

-- ─────────────────────────────────────────────────
-- Indexes for dashboard / AI job queries
-- ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_source_id
  ON tasks (source_id);

CREATE INDEX IF NOT EXISTS idx_tasks_ai_enriched
  ON tasks (ai_enriched);

CREATE INDEX IF NOT EXISTS idx_others_commitments_delivery_type
  ON others_commitments (delivery_type);

CREATE INDEX IF NOT EXISTS idx_others_commitments_source_id
  ON others_commitments (source_id);
