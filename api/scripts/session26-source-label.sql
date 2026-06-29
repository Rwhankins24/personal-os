-- session26-source-label.sql
-- Task #66: Add source_label to tables missing it + source tracking to contacts

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS source_label text;

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS source_label text;

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS source_label text;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_type  text,
  ADD COLUMN IF NOT EXISTS source_label text;
