-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 20B: CROSS-ENTITY CATEGORY TAGGING
-- Extends the meeting_categories pod-routing system to knowledge_base,
-- observations, and strategic_decisions.
--
-- Run this in Supabase SQL Editor AFTER session20-category-pod-routing.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add meeting_category_id to knowledge_base ─────────────────────────────
-- Separate from the existing 'category' field (domain_knowledge, contract_legal, etc.)
-- This links a knowledge entry to the broader topic/pod routing system.

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS meeting_category_id UUID REFERENCES meeting_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_base_meeting_category ON knowledge_base (meeting_category_id);

-- ── 2. Add meeting_category_id to observations ────────────────────────────────

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS meeting_category_id UUID REFERENCES meeting_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_observations_meeting_category ON observations (meeting_category_id);

-- ── 3. Add meeting_category_id to strategic_decisions ────────────────────────

ALTER TABLE strategic_decisions
  ADD COLUMN IF NOT EXISTS meeting_category_id UUID REFERENCES meeting_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_strategic_decisions_meeting_category ON strategic_decisions (meeting_category_id);

-- ── 4. Extend topic_pod_content to track non-meeting sources ─────────────────
-- Enables provenance tracking when knowledge/observation content routes to a pod.

ALTER TABLE topic_pod_content
  ADD COLUMN IF NOT EXISTS knowledge_base_id UUID REFERENCES knowledge_base(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observation_id     UUID REFERENCES observations(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS strategic_decision_id UUID REFERENCES strategic_decisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pod_content_knowledge   ON topic_pod_content (knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_pod_content_observation ON topic_pod_content (observation_id);

-- ── 5. DIAGNOSTIC ─────────────────────────────────────────────────────────────
SELECT 'knowledge_base'      AS entity, COUNT(*) AS rows FROM knowledge_base
UNION ALL
SELECT 'observations'        AS entity, COUNT(*) AS rows FROM observations
UNION ALL
SELECT 'strategic_decisions' AS entity, COUNT(*) AS rows FROM strategic_decisions
UNION ALL
SELECT 'topic_pod_content'   AS entity, COUNT(*) AS rows FROM topic_pod_content;
