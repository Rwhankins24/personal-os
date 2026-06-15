-- Session 18: Leads tracking table + lead file attachments
-- Provides a structured CRM-lite for tracking potential future projects
-- Run in Supabase SQL editor.

-- ── Main leads table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identification
  codename        TEXT NOT NULL,               -- internal project name / code
  client_name     TEXT,                        -- owner / developer / client
  project_type    TEXT,                        -- data center, advanced mfg, pharma, industrial, etc.

  -- Status & priority
  status          TEXT DEFAULT 'active'        -- active, hot, cold, dead, won, lost
    CHECK (status IN ('active','hot','cold','dead','won','lost')),
  priority        TEXT DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),

  -- Project details
  location        TEXT,                        -- city, state or region
  estimated_value NUMERIC,                     -- rough $ estimate if known
  source          TEXT,                        -- how we heard (referral, press, conference, etc.)
  procurement     TEXT,                        -- CM-at-Risk, design-build, GC, negotiated, bid
  timeline        TEXT,                        -- e.g. "Q1 2027 start", "12 months out"

  -- Notes & AI output
  notes           TEXT,                        -- free-form notes
  ai_summary      TEXT,                        -- rolled-up AI summary from all attached files

  -- Tracking
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Lead file attachments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Storage
  filename        TEXT NOT NULL,
  storage_path    TEXT NOT NULL,               -- path in Supabase Storage bucket 'lead-files'
  file_size       INTEGER,                     -- bytes
  mime_type       TEXT,

  -- AI extraction output (populated by nightly job)
  ai_processed    BOOLEAN DEFAULT FALSE,
  ai_summary      TEXT,                        -- per-file AI extraction
  extracted_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
CREATE INDEX IF NOT EXISTS idx_lead_files_lead_id ON lead_files(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_files_ai_processed ON lead_files(ai_processed) WHERE ai_processed = FALSE;

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at();

-- ── Storage bucket (run this if bucket doesn't exist yet) ─────────────────────
-- This creates the bucket for lead file attachments.
-- If it already exists from a prior run, this is a no-op.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-files', 'lead-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: service role has full access (API uses service key)
-- RLS is handled at the API layer via service role key — no additional row policies needed.
