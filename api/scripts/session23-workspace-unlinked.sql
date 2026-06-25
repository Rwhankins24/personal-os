-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 23: WORKSPACE ON UNLINKED INTELLIGENCE
-- Adds workspace_id to unlinked_intelligence, defaults existing rows to 'work'.
-- Run in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE unlinked_intelligence
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

UPDATE unlinked_intelligence
  SET workspace_id = (SELECT id FROM workspaces WHERE name = 'work' LIMIT 1)
  WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_unlinked_intelligence_workspace ON unlinked_intelligence (workspace_id);

-- Diagnostic
SELECT w.name, COUNT(u.id) AS unlinked_intel
FROM workspaces w
LEFT JOIN unlinked_intelligence u ON u.workspace_id = w.id
GROUP BY w.name
ORDER BY w.name;
