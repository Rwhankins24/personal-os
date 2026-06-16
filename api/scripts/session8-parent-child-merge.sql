-- personal-os — Session 8: Parent-child merge
-- Run in Supabase SQL Editor

-- Add parent_id to others_commitments (self-referencing FK)
ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES others_commitments(id) ON DELETE SET NULL;

-- Add parent_id to tasks (self-referencing FK)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- Indexes for fast child lookups
CREATE INDEX IF NOT EXISTS idx_others_commitments_parent_id ON others_commitments(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);

-- Clear any stale archived-via-merge records so they show as children instead
-- (only run this if you want previously merged items to surface again)
-- UPDATE others_commitments SET parent_id = potential_duplicate_of, status = 'open'
-- WHERE status = 'archived' AND potential_duplicate_of IS NOT NULL;

-- Add parent_id to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_parent_id ON contacts(parent_id);
