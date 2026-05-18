-- SESSION 7 — Contacts column additions
-- Run in Supabase SQL Editor

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_mobile_2       TEXT,
  ADD COLUMN IF NOT EXISTS phone_office_2       TEXT,
  ADD COLUMN IF NOT EXISTS company_pending      TEXT,
  ADD COLUMN IF NOT EXISTS job_change_detected  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enriched_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS secondary_email      TEXT;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contacts'
  AND column_name IN (
    'phone_mobile_2', 'phone_office_2',
    'company_pending', 'job_change_detected',
    'enriched_at', 'secondary_email'
  )
ORDER BY column_name;
