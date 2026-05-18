-- personal-os — Session 6B: Contact enrichment columns
-- Run in Supabase SQL Editor

-- ── Add enrichment columns to contacts ─────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS title          TEXT,
  ADD COLUMN IF NOT EXISTS phone_mobile   TEXT,
  ADD COLUMN IF NOT EXISTS phone_mobile_2 TEXT,
  ADD COLUMN IF NOT EXISTS phone_office   TEXT,
  ADD COLUMN IF NOT EXISTS phone_office_2 TEXT,
  ADD COLUMN IF NOT EXISTS linkedin       TEXT,
  ADD COLUMN IF NOT EXISTS address        TEXT,
  ADD COLUMN IF NOT EXISTS secondary_email TEXT,
  ADD COLUMN IF NOT EXISTS previous_title TEXT,
  ADD COLUMN IF NOT EXISTS company_pending TEXT,
  ADD COLUMN IF NOT EXISTS enriched       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enriched_at    TIMESTAMPTZ;

-- ── Index for deduplication lookups ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (email);

CREATE INDEX IF NOT EXISTS idx_contacts_enriched
  ON contacts (enriched)
  WHERE enriched = false;

-- ── Duplicate audit: run after migration ───────────────────────
-- Shows any contacts with the same name (review manually)
-- SELECT name, COUNT(*) as count,
--   array_agg(id ORDER BY created_at) as ids,
--   array_agg(email ORDER BY created_at) as emails
-- FROM contacts
-- GROUP BY name
-- HAVING COUNT(*) > 1
-- ORDER BY count DESC;
