-- Knowledge base schema additions for contract/legal + construction complexity
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS risk_level TEXT;        -- 'high' | 'medium' | 'low'
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS entry_type TEXT;        -- construction_complexity type: 'scope_trap' | 'system_coordination' | 'sequencing_risk' | 'lesson_learned'
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS our_position TEXT;      -- contract/legal: Clayco's standard position
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS client_asks TEXT;       -- contract/legal: what clients typically push for
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS project_refs TEXT[];    -- project names (freetext, not FKs)
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_doc_text TEXT;   -- raw extracted text from uploaded doc

-- Run this once against the live Supabase DB via the SQL editor.
