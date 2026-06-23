-- ─────────────────────────────────────────────────────────────────────────────
-- PERSONAL OS — SESSION 19: MEETING CATEGORIES
-- Classify meetings by type: one primary + optional secondaries
--
-- Run this entire script in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. MEETING CATEGORIES ─────────────────────────────────────────────────────
-- Global categories (project_id IS NULL) are available to all projects.
-- Project-scoped categories (project_id IS NOT NULL) are available only to that project.

CREATE TABLE IF NOT EXISTS meeting_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  color       TEXT        NOT NULL DEFAULT '#64748b',
  project_id  UUID        REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = global
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_categories: authenticated full access"
  ON meeting_categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_meeting_categories_project_id ON meeting_categories (project_id);

-- ── 2. PRIMARY CATEGORY + FLAGS — direct columns on meeting_notes ─────────────
-- primary_category_id: one primary per meeting (enforced at app layer)
-- information_only:    meeting generates NO action items — context/understanding only
-- suggested_category_ids: AI pre-suggestions before Ryan confirms

ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS primary_category_id    UUID      REFERENCES meeting_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS information_only        BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_category_ids UUID[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_ai_reprocess      BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_ai_processed_at   TIMESTAMPTZ;

-- Index for fast nightly job lookup of meetings needing reprocessing
CREATE INDEX IF NOT EXISTS idx_meeting_notes_needs_reprocess ON meeting_notes (needs_ai_reprocess)
  WHERE needs_ai_reprocess = true;

CREATE INDEX IF NOT EXISTS idx_meeting_notes_information_only ON meeting_notes (information_only)
  WHERE information_only = true;

CREATE INDEX IF NOT EXISTS idx_meeting_notes_primary_category ON meeting_notes (primary_category_id);

-- ── 3. SECONDARY CATEGORIES — junction table ───────────────────────────────────
-- Zero or more additional context tags per meeting

CREATE TABLE IF NOT EXISTS meeting_note_categories (
  meeting_note_id  UUID  NOT NULL REFERENCES meeting_notes(id) ON DELETE CASCADE,
  category_id      UUID  NOT NULL REFERENCES meeting_categories(id) ON DELETE CASCADE,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by      TEXT NOT NULL DEFAULT 'manual',   -- manual | ai_suggested | ai_auto
  PRIMARY KEY (meeting_note_id, category_id)
);

ALTER TABLE meeting_note_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_note_categories: authenticated full access"
  ON meeting_note_categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_meeting_note_categories_meeting ON meeting_note_categories (meeting_note_id);
CREATE INDEX IF NOT EXISTS idx_meeting_note_categories_cat     ON meeting_note_categories (category_id);

-- ── 4. SEED GLOBAL CATEGORIES ─────────────────────────────────────────────────

INSERT INTO meeting_categories (name, description, color, sort_order)
VALUES
  ('OAC',                    'Owner-Architect-Contractor coordination meeting',        '#1B2A4A', 10),
  ('Settlement Discussion',  'Dispute resolution or settlement negotiation',           '#b91c1c', 20),
  ('Design Review',          'Design coordination, design development review',         '#7c3aed', 30),
  ('Change Order / PCO',     'Potential change order or change order review',          '#d97706', 40),
  ('RFI Review',             'Request for information review',                         '#0369a1', 50),
  ('Subcontractor Coord.',   'Subcontractor coordination or pre-installation meeting', '#065f46', 60),
  ('Safety',                 'Safety coordination, incident review, or toolbox talk',  '#dc2626', 70),
  ('Internal Review',        'Internal team huddle or coordination',                   '#475569', 80),
  ('Pursuit / BD',           'Business development, pursuit, or client interview',     '#C9A84C', 90),
  ('Client Check-in',        'General client relationship or status meeting',          '#0891b2', 100),
  ('Close-out',              'Project closeout, punch list, or commissioning',         '#4f46e5', 110),
  ('Preconstruction',        'Preconstruction planning, scoping, or estimating',       '#15803d', 120)
ON CONFLICT DO NOTHING;

-- ── 5. DIAGNOSTIC ─────────────────────────────────────────────────────────────
SELECT id, name, color, sort_order
FROM meeting_categories
ORDER BY sort_order;
