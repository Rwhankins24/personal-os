-- Migration: email classify signal fields (Step 2.5 additions)
-- Generated: 2026-07-01
-- Applies to: public.emails table in Supabase
-- Purpose: Store new classify output fields so nightly AI job can filter/read
--          without re-running LLM extraction. All columns nullable for backward compat.
--
-- Run in Supabase SQL editor or via psql. Idempotent — uses IF NOT EXISTS pattern.

BEGIN;

-- ── Sender classification ──────────────────────────────────────────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS sender_type TEXT
    CHECK (sender_type IN (
      'owner','subcontractor','design_team','internal_clayco',
      'broker','vendor','legal','financial','personal','unknown'
    ));

-- ── Decision tracking ─────────────────────────────────────────────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS decision_status TEXT
    CHECK (decision_status IN (
      'pending_ryan','pending_other','decided','no_decision'
    ));

-- ── Thread characterization ───────────────────────────────────────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS thread_type TEXT
    CHECK (thread_type IN (
      'thread','single_message','mass_email','automated'
    ));

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS thread_momentum TEXT
    CHECK (thread_momentum IN (
      'active','stalled','escalating','closing'
    ));

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS tone_signal TEXT
    CHECK (tone_signal IN (
      'neutral','urgent','frustrated','collaborative','formal','adversarial'
    ));

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS communication_register TEXT
    CHECK (communication_register IN (
      'executive','operational','contractual','administrative','social'
    ));

-- ── Relationship signals ──────────────────────────────────────────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS first_contact BOOLEAN DEFAULT FALSE;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS participant_tier TEXT
    CHECK (participant_tier IN (
      'c_suite','executive','manager','field','admin','external_unknown'
    ));

-- ── Contract / deadline signals ───────────────────────────────────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS action_deadline DATE;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS contract_event TEXT DEFAULT 'none'
    CHECK (contract_event IN (
      'none','execution','amendment','change_order','dispute','notice','closeout'
    ));

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS competitor_mentioned BOOLEAN DEFAULT FALSE;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS expected_reply_by DATE;

-- ── Attachment type array (stored as JSONB array of strings) ──────────────
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS attachment_types JSONB DEFAULT '[]'::JSONB;

-- ── Indexes for nightly job filtering ─────────────────────────────────────
-- These support the nightly AI job's B3 filtered reads and analytics queries.

CREATE INDEX IF NOT EXISTS idx_emails_sender_type
  ON public.emails (sender_type)
  WHERE sender_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_decision_status
  ON public.emails (decision_status)
  WHERE decision_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_contract_event
  ON public.emails (contract_event)
  WHERE contract_event IS NOT NULL AND contract_event != 'none';

CREATE INDEX IF NOT EXISTS idx_emails_action_deadline
  ON public.emails (action_deadline)
  WHERE action_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_competitor_mentioned
  ON public.emails (competitor_mentioned)
  WHERE competitor_mentioned = TRUE;

CREATE INDEX IF NOT EXISTS idx_emails_first_contact
  ON public.emails (first_contact)
  WHERE first_contact = TRUE;

CREATE INDEX IF NOT EXISTS idx_emails_thread_momentum
  ON public.emails (thread_momentum)
  WHERE thread_momentum IS NOT NULL;

COMMIT;

-- ── Verification query ─────────────────────────────────────────────────────
-- Run after applying migration to confirm columns exist:
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'emails'
--   AND column_name IN (
--     'sender_type','decision_status','thread_type','thread_momentum',
--     'tone_signal','communication_register','first_contact','attachment_types',
--     'participant_tier','action_deadline','contract_event',
--     'competitor_mentioned','expected_reply_by'
--   )
-- ORDER BY column_name;
