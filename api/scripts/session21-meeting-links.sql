-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 21: MEETING LINKS
-- Adds direct FK links from meeting_notes to topic_pods, observations, and
-- knowledge_base so any meeting can be manually associated with existing cards.
-- Run this entire script in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS linked_pod_id         UUID REFERENCES topic_pods(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_observation_id UUID REFERENCES observations(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_knowledge_id   UUID REFERENCES knowledge_base(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_notes_linked_pod         ON meeting_notes (linked_pod_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_linked_observation ON meeting_notes (linked_observation_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_linked_knowledge   ON meeting_notes (linked_knowledge_id);

-- ── DIAGNOSTIC ───────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'meeting_notes'
  AND column_name IN ('linked_pod_id','linked_observation_id','linked_knowledge_id');
