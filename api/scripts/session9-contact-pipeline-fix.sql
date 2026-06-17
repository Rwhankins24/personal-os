-- Session 9: Fix contact creation pipeline
-- Problem: Step 3.6 only scanned 25 bucket-1/2 emails for contact creation.
--          Senders in bucket 3-5 or outside that narrow window never got contacts.
--          Also: full_thread_content wasn't refreshed on existing threads, breaking Step 3.7 enrichment.
-- Fix:     Expanded Step 3.6 to scan all today's emails. Added backfill RPC below.

-- ── 1. RPC for orphaned sender backfill (Step 3.6b) ──────────────────────────
-- Returns distinct email senders from the emails table that have no contact record.
-- Called by the nightly AI job to backfill missing contacts.
CREATE OR REPLACE FUNCTION get_emails_without_contacts(row_limit INT DEFAULT 50)
RETURNS TABLE (
  from_address TEXT,
  from_name    TEXT,
  thread_subject TEXT,
  is_internal  BOOLEAN
) AS $$
  SELECT DISTINCT ON (e.from_address)
    e.from_address,
    e.from_name,
    e.thread_subject,
    e.is_internal
  FROM emails e
  LEFT JOIN contacts c ON c.email = lower(e.from_address)
  WHERE e.from_address IS NOT NULL
    AND e.from_address != 'hankinsr@claycorp.com'
    AND c.id IS NULL
  ORDER BY e.from_address, e.received_at DESC
  LIMIT row_limit;
$$ LANGUAGE sql STABLE;

-- ── 2. Diagnostic: how many email senders have no contact? ───────────────────
SELECT
  COUNT(DISTINCT e.from_address) AS senders_without_contacts,
  MIN(e.received_at)             AS oldest_orphan,
  MAX(e.received_at)             AS newest_orphan
FROM emails e
LEFT JOIN contacts c ON c.email = lower(e.from_address)
WHERE e.from_address IS NOT NULL
  AND e.from_address != 'hankinsr@claycorp.com'
  AND c.id IS NULL;

-- ── 3. Check recent pipeline runs ────────────────────────────────────────────
SELECT
  run_date,
  email_pull_completed_at,
  processing_completed_at,
  ai_completed_at,
  status,
  error_count
FROM pipeline_runs
ORDER BY run_date DESC
LIMIT 10;

-- ── 4. Check full_thread_content availability for enrichment ─────────────────
SELECT
  COUNT(*) FILTER (WHERE full_thread_content IS NOT NULL)::INT AS has_content,
  COUNT(*) FILTER (WHERE full_thread_content IS NULL)::INT     AS no_content,
  COUNT(*) FILTER (WHERE extraction_depth = 'full')::INT       AS full_depth,
  COUNT(*) FILTER (WHERE extraction_depth = 'extended')::INT   AS extended_depth,
  COUNT(*) FILTER (WHERE extraction_depth = 'standard')::INT   AS standard_depth
FROM emails
WHERE bucket IN (1, 2);
