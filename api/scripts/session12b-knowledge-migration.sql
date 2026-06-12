-- Knowledge base schema additions for contract/legal + construction complexity
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS risk_level TEXT;        -- 'high' | 'medium' | 'low'
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS effective_date DATE;    -- for specific contracts
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS parties TEXT;           -- "Clayco / Trammell Crow"
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS entry_type TEXT;        -- 'specific_contract' | 'general_knowledge' | 'lesson' | 'complexity'
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS project_refs TEXT[];    -- project names (freetext, not FKs)
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_doc_text TEXT;   -- raw extracted text from uploaded doc
