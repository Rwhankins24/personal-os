-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 20: CATEGORY → POD ROUTING
-- Links a topic pod to a meeting category so the nightly AI job automatically
-- routes extracted category-specific intelligence into the pod as content.
--
-- Run this in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Link topic_pods to a meeting category ──────────────────────────────────
-- One pod can be the "home" for one category.
-- When a meeting has that category (primary OR secondary), extracted content
-- is automatically routed here by the nightly job.

ALTER TABLE topic_pods
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES meeting_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_topic_pods_category_id ON topic_pods (category_id);

-- ── 2. DIAGNOSTIC ─────────────────────────────────────────────────────────────
SELECT
  tp.id,
  tp.name,
  tp.status,
  tp.category_id,
  mc.name AS linked_category
FROM topic_pods tp
LEFT JOIN meeting_categories mc ON mc.id = tp.category_id
ORDER BY tp.created_at;
