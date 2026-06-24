-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 22: WORKSPACE SEPARATION
-- Adds workspace_id to tables that were missing it, defaults existing rows to
-- the 'work' workspace, and adds indexes for fast filtering.
-- Run this entire script in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add workspace_id to tables that are missing it ────────────────────────
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE pending_decisions
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

-- ── 2. Default all existing records to 'work' workspace ──────────────────────
UPDATE meeting_notes
  SET workspace_id = (SELECT id FROM workspaces WHERE name = 'work' LIMIT 1)
  WHERE workspace_id IS NULL;

UPDATE others_commitments
  SET workspace_id = (SELECT id FROM workspaces WHERE name = 'work' LIMIT 1)
  WHERE workspace_id IS NULL;

UPDATE pending_decisions
  SET workspace_id = (SELECT id FROM workspaces WHERE name = 'work' LIMIT 1)
  WHERE workspace_id IS NULL;

UPDATE commitments
  SET workspace_id = (SELECT id FROM workspaces WHERE name = 'work' LIMIT 1)
  WHERE workspace_id IS NULL;

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meeting_notes_workspace      ON meeting_notes      (workspace_id);
CREATE INDEX IF NOT EXISTS idx_others_commitments_workspace ON others_commitments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_pending_decisions_workspace  ON pending_decisions  (workspace_id);
CREATE INDEX IF NOT EXISTS idx_commitments_workspace        ON commitments        (workspace_id);

-- ── DIAGNOSTIC ────────────────────────────────────────────────────────────────
SELECT
  w.name AS workspace,
  COUNT(mn.id) FILTER (WHERE mn.workspace_id = w.id) AS meeting_notes,
  COUNT(oc.id) FILTER (WHERE oc.workspace_id = w.id) AS others_commitments,
  COUNT(pd.id) FILTER (WHERE pd.workspace_id = w.id) AS pending_decisions
FROM workspaces w
LEFT JOIN meeting_notes mn ON mn.workspace_id = w.id
LEFT JOIN others_commitments oc ON oc.workspace_id = w.id
LEFT JOIN pending_decisions pd ON pd.workspace_id = w.id
GROUP BY w.name
ORDER BY w.name;
