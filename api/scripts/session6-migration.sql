-- ─────────────────────────────────────────
-- PERSONAL OS — SESSION 6 MIGRATION
-- Run this entire script in Supabase SQL Editor
-- ─────────────────────────────────────────

-- ─────────────────────────────────────────
-- ADDITIONS TO EXISTING TABLES
-- ─────────────────────────────────────────

-- Projects: intelligence storage
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS intelligence_notes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decisions_made JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_signals JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS key_facts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

-- Commitments: type classification
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS commitment_type TEXT DEFAULT 'hard',
  ADD COLUMN IF NOT EXISTS condition_text TEXT,
  ADD COLUMN IF NOT EXISTS implicit BOOLEAN DEFAULT false;

-- Others commitments: fulfillment detection
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS fulfillment_evidence TEXT,
  ADD COLUMN IF NOT EXISTS ai_suggests_complete BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_suggestion_date DATE;

-- Decisions: extended fields
ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS decision_maker TEXT,
  ADD COLUMN IF NOT EXISTS all_parties JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS blocking_items JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'made',
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS project_card_synced BOOLEAN DEFAULT false;

-- Events: high stakes detection
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS high_stakes BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stakes_reason TEXT,
  ADD COLUMN IF NOT EXISTS preparation_required BOOLEAN DEFAULT false;

-- Emails: content and links
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS links_detected JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_body TEXT;

-- Captures: run type tracking
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS run_type TEXT DEFAULT 'scheduled';

-- Pipeline runs: questions tracking
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS pending_questions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;

-- Tasks: blocking field
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS blocking TEXT;

-- ─────────────────────────────────────────
-- NEW TABLES
-- ─────────────────────────────────────────

-- Pending decisions
CREATE TABLE IF NOT EXISTS pending_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  context TEXT,
  blocking TEXT,
  due_date DATE,
  urgency TEXT DEFAULT 'medium',
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  source_type TEXT DEFAULT 'email',
  source_id UUID,
  status TEXT DEFAULT 'open',
  decided_on DATE,
  decided_by TEXT,
  outcome TEXT,
  logged_to_decisions BOOLEAN DEFAULT false,
  checked_off BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unlinked intelligence
CREATE TABLE IF NOT EXISTS unlinked_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  intelligence_type TEXT,
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  suggested_project TEXT,
  suggested_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'unreviewed',
  checked_off BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Suggested projects
CREATE TABLE IF NOT EXISTS suggested_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email_count INTEGER DEFAULT 0,
  key_contacts JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  sample_emails JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pending',
  created_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI questions queue
CREATE TABLE IF NOT EXISTS ai_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  context TEXT,
  question_type TEXT DEFAULT 'binary',
  response_type TEXT DEFAULT 'binary',
  options JSONB DEFAULT '["Yes","No"]'::jsonb,
  conversation JSONB DEFAULT '[]'::jsonb,
  answer_tap TEXT,
  answer_chat TEXT,
  answered_at TIMESTAMPTZ,
  acted_on BOOLEAN DEFAULT false,
  checked_off BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────

ALTER TABLE pending_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE unlinked_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggested_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_decisions: auth full access"
  ON pending_decisions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "unlinked_intelligence: auth full access"
  ON unlinked_intelligence FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "suggested_projects: auth full access"
  ON suggested_projects FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "ai_questions: auth full access"
  ON ai_questions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Service role bypass policies (for API and AI job)
CREATE POLICY "pending_decisions: service role bypass"
  ON pending_decisions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "unlinked_intelligence: service role bypass"
  ON unlinked_intelligence FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "suggested_projects: service role bypass"
  ON suggested_projects FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "ai_questions: service role bypass"
  ON ai_questions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pending_decisions_status
  ON pending_decisions (status);
CREATE INDEX IF NOT EXISTS idx_pending_decisions_project
  ON pending_decisions (project_id);
CREATE INDEX IF NOT EXISTS idx_pending_decisions_due
  ON pending_decisions (due_date);
CREATE INDEX IF NOT EXISTS idx_unlinked_status
  ON unlinked_intelligence (status);
CREATE INDEX IF NOT EXISTS idx_suggested_projects_status
  ON suggested_projects (status);
CREATE INDEX IF NOT EXISTS idx_ai_questions_answered
  ON ai_questions (answered_at);
CREATE INDEX IF NOT EXISTS idx_ai_questions_acted
  ON ai_questions (acted_on);

-- ─────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Expected tables include:
-- ai_context, ai_questions, captures, commitments,
-- contacts, decisions, emails, events, meeting_notes,
-- others_commitments, pattern_log, pending_decisions,
-- pipeline_runs, projects, suggested_projects,
-- tasks, unlinked_intelligence
