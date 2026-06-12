-- Session 14: Topic Intelligence Pods
-- Living research containers that accumulate content over time and maintain
-- an AI-generated synthesis that updates as new material is added.

CREATE TABLE IF NOT EXISTS topic_pods (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  description          TEXT,                          -- what this topic is and why it matters
  research_directive   TEXT,                          -- what the nightly job should search for
  synthesis            TEXT,                          -- AI-generated running summary (auto-updated)
  synthesis_bullets    JSONB,                         -- structured synthesis: [{section, points[]}]
  last_synthesized_at  TIMESTAMPTZ,
  last_researched_at   TIMESTAMPTZ,                   -- last nightly research run
  content_count        INT DEFAULT 0,                 -- denormalized count for quick display
  status               TEXT DEFAULT 'active',         -- active | archived
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topic_pod_content (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id         UUID NOT NULL REFERENCES topic_pods(id) ON DELETE CASCADE,
  content_type   TEXT NOT NULL,   -- 'paste' | 'upload' | 'research' | 'meeting_link'
  title          TEXT,            -- auto-generated or user-provided
  raw_text       TEXT,            -- full text
  extracted_points JSONB,         -- [{point: "...", significance: "high|medium|low", tags: []}]
  source_label   TEXT,            -- "Pasted note", "Uploaded: filename.pdf", "Research: 2026-06-12"
  source_url     TEXT,            -- for research items
  meeting_note_id UUID REFERENCES meeting_notes(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_pod_content_pod_id ON topic_pod_content(pod_id);
CREATE INDEX IF NOT EXISTS idx_topic_pod_content_type   ON topic_pod_content(content_type);
CREATE INDEX IF NOT EXISTS idx_topic_pods_status        ON topic_pods(status);

-- Run via Supabase SQL editor.
