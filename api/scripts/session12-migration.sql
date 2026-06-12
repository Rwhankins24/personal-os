-- Session 12 migration
-- 1. Make otter_id nullable so manually uploaded meeting files can be inserted
--    (previously UNIQUE NOT NULL from session7, which blocked all upload-meeting inserts)
ALTER TABLE meeting_notes ALTER COLUMN otter_id DROP NOT NULL;

-- 2. Add source_type enum value for manually uploaded meetings (informational — no enum change needed
--    since source_type is TEXT, not an enum type)

-- 3. Verify extracted_intelligence column exists (session11 added it)
-- ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS extracted_intelligence JSONB;

-- Run this once against the live Supabase DB:
--   psql $DATABASE_URL -f session12-migration.sql
-- Or via Supabase SQL editor.
