-- Session 10 Migration
-- Run once in Supabase SQL editor

-- Contact display names (user-editable alias, doesn't affect email routing)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Email context classification (work / personal / mixed)
-- Set by nightly AI job, user can override
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS context_type TEXT DEFAULT 'work'
    CHECK (context_type IN ('work', 'personal', 'mixed'));

CREATE INDEX IF NOT EXISTS idx_emails_context_type
  ON emails (context_type);
