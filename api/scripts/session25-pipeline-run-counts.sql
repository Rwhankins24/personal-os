-- session25-pipeline-run-counts.sql
-- Task #78: Store extraction result counts in pipeline_runs for Dashboard panel

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS tasks_created          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decisions_logged       integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_decisions      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commitments_extracted  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS others_commitments     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knowledge_created      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observations_created   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_signals           integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threads_processed      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meetings_processed     integer DEFAULT 0;
