-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 18: WISDOM LAYER
-- Observations, Strategic Decisions, and Decision retrospectives
--
-- Run this entire script in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. OBSERVATIONS ──────────────────────────────────────────────────────────
-- Atomic learnings extracted nightly from emails/meetings, or added manually.
-- The foundation for pattern detection and historical recall.

CREATE TABLE IF NOT EXISTS observations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content      TEXT        NOT NULL,                          -- the actual observation
  source_type  TEXT        DEFAULT 'ai_nightly',              -- ai_nightly | meeting | email | manual
  source_id    UUID,                                          -- FK to emails.id or meeting_notes.id
  project_id   UUID        REFERENCES projects(id) ON DELETE SET NULL,
  contact_id   UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  tags         TEXT[]      DEFAULT '{}',
  surfaced_at  TIMESTAMPTZ,                                   -- last time shown in historical recall
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "observations: authenticated full access"
  ON observations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_observations_created_at  ON observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_project_id  ON observations (project_id);
CREATE INDEX IF NOT EXISTS idx_observations_contact_id  ON observations (contact_id);
CREATE INDEX IF NOT EXISTS idx_observations_source_type ON observations (source_type);

-- ── 2. STRATEGIC DECISIONS ───────────────────────────────────────────────────
-- Ryan's own significant decisions: career, investment, project strategy,
-- contract structure, major purchases. Fully manual capture.
-- Retrospective fields filled in 3-6 months later.

CREATE TABLE IF NOT EXISTS strategic_decisions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision          TEXT        NOT NULL,                     -- what was decided (concise)
  why               TEXT,                                     -- rationale at time of decision
  assumptions       JSONB       DEFAULT '[]'::jsonb,          -- array of assumption strings
  expected_outcome  TEXT,                                     -- what you expected to happen
  category          TEXT        DEFAULT 'other',              -- career | investment | project_strategy | contract | personal | other
  decided_on        DATE        NOT NULL DEFAULT CURRENT_DATE,
  project_id        UUID        REFERENCES projects(id) ON DELETE SET NULL,

  -- Retrospective (filled in later)
  actual_outcome    TEXT,                                     -- what actually happened
  lesson            TEXT,                                     -- what to carry forward
  outcome_correct   BOOLEAN,                                  -- was the core bet right?
  reviewed_on       DATE,
  status            TEXT        DEFAULT 'open',               -- open | reviewed

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE strategic_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategic_decisions: authenticated full access"
  ON strategic_decisions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_strategic_decisions_decided_on ON strategic_decisions (decided_on DESC);
CREATE INDEX IF NOT EXISTS idx_strategic_decisions_category   ON strategic_decisions (category);
CREATE INDEX IF NOT EXISTS idx_strategic_decisions_status     ON strategic_decisions (status);

-- ── 3. UPDATE EXISTING decisions TABLE ───────────────────────────────────────
-- Add retrospective fields so project decisions can be reviewed and annotated.

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS outcome_assessment TEXT,
  ADD COLUMN IF NOT EXISTS lesson             TEXT,
  ADD COLUMN IF NOT EXISTS outcome_correct    BOOLEAN,
  ADD COLUMN IF NOT EXISTS reviewed_on        DATE;

-- ── 4. DIAGNOSTIC QUERIES ─────────────────────────────────────────────────────

-- How many observations exist?
SELECT COUNT(*), source_type FROM observations GROUP BY source_type;

-- How many strategic decisions exist?
SELECT COUNT(*), category, status FROM strategic_decisions GROUP BY category, status;

-- Check decisions table has new columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'decisions'
  AND column_name IN ('outcome_assessment', 'lesson', 'outcome_correct', 'reviewed_on');
