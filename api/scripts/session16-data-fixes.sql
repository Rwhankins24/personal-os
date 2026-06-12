-- Session 16: Data fixes for wrong status values and null name rows
-- Run in Supabase SQL editor.

-- 1. tasks: status='active' was never a valid value — flip to 'open'
UPDATE tasks
   SET status = 'open'
 WHERE status = 'active';

-- 2. others_commitments: backfill script was inserting status='pending'
--    OthersPage queries for status='open' so these rows were invisible
UPDATE others_commitments
   SET status = 'open'
 WHERE status = 'pending';

-- 3. others_commitments: rows with null committed_by_name — set to 'Unknown'
--    so UI grouping works correctly
UPDATE others_commitments
   SET committed_by_name = 'Unknown'
 WHERE committed_by_name IS NULL
   AND status = 'open';

-- 4. others_commitments: auto-link to contacts by email where contact_id is null
--    (back-fills the new contact_id column for existing rows that have a matching email)
UPDATE others_commitments oc
   SET contact_id = c.id
  FROM contacts c
 WHERE oc.contact_id IS NULL
   AND oc.committed_by_email IS NOT NULL
   AND lower(oc.committed_by_email) = lower(c.email);

-- 5. Sanity check — count rows that will remain without contact linkage
-- SELECT count(*) FROM others_commitments WHERE contact_id IS NULL AND status = 'open';
