-- =============================================================
-- personal-os :: Supabase Schema Migration
-- =============================================================
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- or via the Supabase CLI: supabase db push
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- 1. USERS
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'owner',   -- owner | spouse | coordinator
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: authenticated full access"
  ON users FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- =============================================================
-- 2. WORKSPACES
-- =============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,                            -- work | personal | other
  color      TEXT,                            -- hex color code
  user_id    UUID REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces: authenticated full access"
  ON workspaces FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces (user_id);


-- =============================================================
-- 3. PROJECTS
-- =============================================================
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  type             TEXT,                      -- pursuit | active | personal | book
  workspace_id     UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  delivery_method  TEXT,
  contract_type    TEXT,
  est_value        NUMERIC,
  fee_position     TEXT,
  decision_date    DATE,
  win_probability  TEXT,
  key_risk         TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects: authenticated full access"
  ON projects FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_id  ON projects (workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_status        ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_type          ON projects (type);
CREATE INDEX IF NOT EXISTS idx_projects_decision_date ON projects (decision_date);


-- =============================================================
-- 4. TASKS
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  context       TEXT,
  project_id    UUID REFERENCES projects (id) ON DELETE SET NULL,
  workspace_id  UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  type          TEXT,                         -- pursuit | contract | coord | personal | home | book
  status        TEXT NOT NULL DEFAULT 'open', -- open | in_progress | done
  due_date      DATE,
  urgency       TEXT,                         -- critical | high | medium | low
  source        TEXT,                         -- meeting | email | manual
  source_label  TEXT,
  source_date   DATE,
  made_progress BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks: authenticated full access"
  ON tasks FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id   ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_urgency      ON tasks (urgency);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks (due_date);


-- =============================================================
-- 5. EVENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  start_time   TIMESTAMPTZ,
  end_time     TIMESTAMPTZ,
  location     TEXT,
  join_link    TEXT,
  organizer    TEXT,
  attendees    JSONB,
  body         TEXT,
  workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'outlook',
  external_id  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: authenticated full access"
  ON events FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_events_workspace_id ON events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_start_time   ON events (start_time);
CREATE INDEX IF NOT EXISTS idx_events_external_id  ON events (external_id);


-- =============================================================
-- 6. EMAILS
-- =============================================================
CREATE TABLE IF NOT EXISTS emails (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address             TEXT,
  from_name                TEXT,
  subject                  TEXT,
  body_preview             TEXT,
  received_at              TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,
  status                   TEXT,             -- needs_reply | waiting_on | read | done
  project_id               UUID REFERENCES projects (id) ON DELETE SET NULL,
  thread_id                TEXT,
  importance               TEXT,
  ai_summary               TEXT,
  -- classification fields (populated by email-pull skill at 6:00am)
  bucket                   INTEGER,          -- 1=needs_reply 2=waiting_on 3=oversight 4=documents 5=invites 6=filtered
  tags                     TEXT[],           -- TIME_SENSITIVE | CONTRACT_LANGUAGE | EXTERNAL | HAS_ATTACHMENT | AGING | LARGE_THREAD
  days_waiting             INTEGER,
  urgency                  TEXT,             -- normal | elevated | high | critical
  followed_up              BOOLEAN DEFAULT false,
  cross_reference_status   TEXT,             -- new | aging | resolved
  is_internal              BOOLEAN DEFAULT false,
  has_attachment           BOOLEAN DEFAULT false,
  is_time_sensitive        BOOLEAN DEFAULT false,
  has_contract_language    BOOLEAN DEFAULT false,
  thread_participant_count INTEGER,
  last_report_date         DATE,
  -- thread-aware fields (migration_03)
  conversation_id          TEXT,
  thread_message_count     INTEGER,
  thread_participants      TEXT[],
  latest_sender            TEXT,
  latest_sender_name       TEXT,
  my_last_reply_time       TIMESTAMPTZ,
  waiting_since            TIMESTAMPTZ,
  thread_subject           TEXT,
  is_flagged               BOOLEAN DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emails: authenticated full access"
  ON emails FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_emails_project_id      ON emails (project_id);
CREATE INDEX IF NOT EXISTS idx_emails_status          ON emails (status);
CREATE INDEX IF NOT EXISTS idx_emails_received_at     ON emails (received_at);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id       ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_bucket          ON emails (bucket);
CREATE INDEX IF NOT EXISTS idx_emails_days_waiting    ON emails (days_waiting);
CREATE INDEX IF NOT EXISTS idx_emails_is_internal     ON emails (is_internal);
CREATE INDEX IF NOT EXISTS idx_emails_urgency         ON emails (urgency);
CREATE INDEX IF NOT EXISTS idx_emails_conversation_id ON emails (conversation_id);
CREATE INDEX IF NOT EXISTS idx_emails_is_flagged      ON emails (is_flagged);
CREATE INDEX IF NOT EXISTS idx_emails_waiting_since   ON emails (waiting_since);


-- =============================================================
-- 7. COMMITMENTS
-- =============================================================
CREATE TABLE IF NOT EXISTS commitments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  made_to           TEXT,
  made_on           DATE,
  due_date          DATE,
  urgency           TEXT,
  status            TEXT NOT NULL DEFAULT 'open',
  source_meeting_id UUID,
  source_transcript TEXT,
  project_id        UUID REFERENCES projects (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commitments: authenticated full access"
  ON commitments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_commitments_project_id ON commitments (project_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status     ON commitments (status);
CREATE INDEX IF NOT EXISTS idx_commitments_due_date   ON commitments (due_date);


-- =============================================================
-- 8. MEETING NOTES
-- =============================================================
CREATE TABLE IF NOT EXISTS meeting_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT,
  meeting_date     TIMESTAMPTZ,
  duration_minutes INTEGER,
  source           TEXT,                      -- otter | plaud | manual
  transcript       TEXT,
  ai_summary       TEXT,
  project_id       UUID REFERENCES projects (id) ON DELETE SET NULL,
  workspace_id     UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  action_items     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meeting_notes: authenticated full access"
  ON meeting_notes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_project_id   ON meeting_notes (project_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_workspace_id ON meeting_notes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_date ON meeting_notes (meeting_date);


-- =============================================================
-- 9. CONTACTS
-- =============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT,
  company             TEXT,
  role                TEXT,
  last_contact_date   DATE,
  last_topic          TEXT,
  relationship_warmth TEXT,                   -- hot | warm | cold
  notes               TEXT,
  project_id          UUID REFERENCES projects (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts: authenticated full access"
  ON contacts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_contacts_project_id          ON contacts (project_id);
CREATE INDEX IF NOT EXISTS idx_contacts_relationship_warmth ON contacts (relationship_warmth);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contact_date   ON contacts (last_contact_date);


-- =============================================================
-- 10. DECISIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS decisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   TEXT NOT NULL,
  what_was_decided        TEXT,
  alternatives_considered TEXT,
  assumptions             TEXT,
  who_was_present         TEXT,
  decided_on              DATE,
  project_id              UUID REFERENCES projects (id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decisions: authenticated full access"
  ON decisions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions (project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_decided_on ON decisions (decided_on);


-- =============================================================
-- 11. CLIPS
-- =============================================================
CREATE TABLE IF NOT EXISTS clips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT,
  url          TEXT,
  ai_summary   TEXT,
  tags         TEXT[],
  read         BOOLEAN NOT NULL DEFAULT false,
  archived     BOOLEAN NOT NULL DEFAULT false,
  workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clips: authenticated full access"
  ON clips FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_clips_workspace_id ON clips (workspace_id);
CREATE INDEX IF NOT EXISTS idx_clips_archived     ON clips (archived);
CREATE INDEX IF NOT EXISTS idx_clips_read         ON clips (read);
CREATE INDEX IF NOT EXISTS idx_clips_tags         ON clips USING GIN (tags);


-- =============================================================
-- 12. CAPTURES
-- =============================================================
CREATE TABLE IF NOT EXISTS captures (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content    TEXT,
  type       TEXT,                            -- text | voice | photo | url
  routed     BOOLEAN NOT NULL DEFAULT false,
  routed_to  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "captures: authenticated full access"
  ON captures FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_captures_routed ON captures (routed);
CREATE INDEX IF NOT EXISTS idx_captures_type   ON captures (type);


-- =============================================================
-- 13. TAGS
-- =============================================================
CREATE TABLE IF NOT EXISTS tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  bucket     TEXT,
  color      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags: authenticated full access"
  ON tags FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tags_bucket ON tags (bucket);


-- =============================================================
-- 14. FRICTION LOG
-- =============================================================
CREATE TABLE IF NOT EXISTS friction_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature     TEXT,
  description TEXT,
  ai_output   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE friction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friction_log: authenticated full access"
  ON friction_log FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_friction_log_feature    ON friction_log (feature);
CREATE INDEX IF NOT EXISTS idx_friction_log_created_at ON friction_log (created_at);


-- =============================================================
-- END OF MIGRATION
-- =============================================================
