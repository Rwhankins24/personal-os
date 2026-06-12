-- Session 13: knowledge base project linkage
-- Adds project_id FK so knowledge entries can be tied to a specific source project
-- and cross-referenced with that project's meeting notes.

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Index for fast project-scoped queries
CREATE INDEX IF NOT EXISTS idx_knowledge_base_project_id ON knowledge_base(project_id);

-- Run via Supabase SQL editor.
