-- Session 15: Others commitments contact linkage
-- Adds contact_id FK to others_commitments so each item can be linked
-- to a contact record. SET NULL on contact delete (don't lose the commitment).

ALTER TABLE others_commitments
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_others_commitments_contact_id
  ON others_commitments(contact_id);

-- Optional: auto-link existing commitments where email matches a contact
-- Run manually / selectively if you want to back-fill existing rows:
--
-- UPDATE others_commitments oc
-- SET contact_id = c.id
-- FROM contacts c
-- WHERE oc.contact_id IS NULL
--   AND oc.committed_by_email IS NOT NULL
--   AND lower(oc.committed_by_email) = lower(c.email);
