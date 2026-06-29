-- session24-plaud-project-context.sql
-- Task #73: Plaud architecture overhaul — project context columns
--
-- Adds columns to projects table for storing the AI-extracted project context snapshot.
-- These are written nightly by extractMeetingIntelligence Call C.
-- All columns are nullable — only populated when a Plaud meeting is linked to a project.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_phase           text,
  ADD COLUMN IF NOT EXISTS key_constraints         jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS core_problem            text,
  ADD COLUMN IF NOT EXISTS next_milestone          text,
  ADD COLUMN IF NOT EXISTS open_dependencies       jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS workstream_owners       jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS project_context_updated_at timestamptz;

-- Also add columns to knowledge_base for Plaud-specific fields
ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS transferability  text,
  ADD COLUMN IF NOT EXISTS source_context  text;

-- observations table already has evidence/implication/applicable_to from session18-wisdom-layer.sql
-- Confirm they exist (no-op if already present):
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS evidence       text,
  ADD COLUMN IF NOT EXISTS implication    text,
  ADD COLUMN IF NOT EXISTS applicable_to  text;
