const supabase = require('../services/supabase')
const multer   = require('multer')
const pdf      = require('pdf-parse')
const mammoth  = require('mammoth')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase()
    if (ext.endsWith('.pdf') || ext.endsWith('.docx') || ext.endsWith('.txt')) cb(null, true)
    else cb(new Error('Unsupported file type — upload PDF, DOCX, or TXT'))
  }
}).single('file')

async function extractText(buffer, mimetype, filename) {
  const ext = (filename || '').toLowerCase()
  if (mimetype === 'application/pdf' || ext.endsWith('.pdf')) {
    const result = await pdf(buffer)
    return result.text
  }
  if (ext.endsWith('.docx') || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  return buffer.toString('utf-8')
}

// Pull recent meeting notes for a project to enrich negotiation context
async function getProjectMeetingContext(projectId) {
  if (!projectId) return null
  try {
    const { data: meetings } = await supabase
      .from('meeting_notes')
      .select('title, start_time, meeting_date, short_summary, extracted_intelligence')
      .eq('project_id', projectId)
      .order('start_time', { ascending: false, nullsFirst: false })
      .limit(15)

    if (!meetings || meetings.length === 0) return null

    const lines = meetings.map(m => {
      const date   = m.start_time || m.meeting_date || 'unknown date'
      const title  = m.title || 'Untitled meeting'
      const parts  = []

      if (m.short_summary) parts.push(m.short_summary.slice(0, 300))

      const intel = m.extracted_intelligence
      if (intel) {
        if (intel.ryan_action_items?.length)
          parts.push('Ryan actions: ' + intel.ryan_action_items.slice(0, 3).join('; '))
        if (intel.verbal_commitments_others?.length)
          parts.push('Others committed: ' + intel.verbal_commitments_others.slice(0, 3).join('; '))
        if (intel.key_decisions?.length)
          parts.push('Decisions: ' + intel.key_decisions.slice(0, 3).join('; '))
        if (intel.risk_signals?.length)
          parts.push('Risks: ' + intel.risk_signals.slice(0, 3).join('; '))
      }

      return `[${date}] ${title}: ${parts.join(' | ') || '(no summary)'}`
    })

    return lines.join('\n')
  } catch (e) {
    console.error('getProjectMeetingContext error:', e.message)
    return null
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── Extract knowledge from pasted text ──────────────────────
  if (req.method === 'POST' && req.query.action === 'extract-text') {
    try {
      const { text, project_id } = req.body || {}
      if (!text?.trim()) return res.status(400).json({ error: 'text required' })

      const snippet       = text.slice(0, 4000)
      const meetingContext = await getProjectMeetingContext(project_id)
      const meetingSection = meetingContext
        ? `\n\nRELEVANT MEETING HISTORY FOR THIS PROJECT:\n${meetingContext}\n\nUse the meeting history to populate "our_position" and "resolution".`
        : ''

      const Anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY })
      const msg = await Anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are extracting structured knowledge from text for a construction executive's knowledge base at Clayco.

Text:
${snippet}
${meetingSection}

Extract ONE entry per material issue or insight found. Return a JSON array:
[{
  "topic": "concise title (max 8 words)",
  "category": "contract_legal" | "construction_complexity" | "domain_knowledge" | "project_lesson" | "client_intel",
  "context": "background / where's the risk (2-3 sentences)",
  "our_position": "for contract_legal: Clayco's preferred position; null otherwise",
  "client_asks": "for contract_legal: what clients push for; null otherwise",
  "resolution": "how resolved or key takeaway (2-3 sentences)",
  "risk_level": "high" | "medium" | "low" | null,
  "entry_type": null,
  "project_refs": [],
  "applies_to": ["relevant tags"]
}]

Return ONLY a valid JSON array. No explanation.`
        }]
      })

      const raw       = msg.content[0].text.trim()
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      const entries   = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw)
      const enriched  = entries.map(e => ({ ...e, project_id: project_id || null }))
      return res.json({ entries: enriched, source_doc: 'Pasted text' })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── Extract knowledge from uploaded doc ─────────────────────
  if (req.method === 'POST' && req.query.action === 'extract') {
    return new Promise((resolve) => {
      upload(req, res, async (err) => {
        if (err) {
          res.status(400).json({ error: err.message })
          return resolve()
        }
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' })
          return resolve()
        }
        try {
          const projectId = req.body?.project_id || null

          const text    = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname)
          const snippet = text.slice(0, 4000)

          // Pull project meeting context to enrich negotiation history fields
          const meetingContext = await getProjectMeetingContext(projectId)

          const meetingSection = meetingContext
            ? `\n\nRELEVANT MEETING HISTORY FOR THIS PROJECT:\n${meetingContext}\n\nUse the meeting history above to populate "our_position" (what we pushed for / held firm on) and "resolution" (how it was actually resolved in negotiations). If a meeting references a specific clause or issue from the document, incorporate that context directly.`
            : ''

          const Anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY })
          const msg = await Anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            messages: [{
              role: 'user',
              content: `You are extracting structured negotiation knowledge from a contract document for a construction executive's knowledge base at Clayco (a major GC/developer).

Document filename: ${req.file.originalname}
Document text (first 4000 chars):
${snippet}
${meetingSection}

Extract ONE entry per material clause or issue found in this document. Focus on clauses that carry real risk or negotiation history — indemnification, liquidated damages, consequential damages waivers, limitation of liability, IP ownership, termination rights, differing site conditions, owner-controlled insurance, payment terms, schedule risk, force majeure, etc. Skip boilerplate definitions and procedural clauses.

Return a JSON array of entries. Each entry MUST follow this exact structure:
{
  "topic": "concise issue title (max 8 words, e.g. 'Liquidated Damages Cap' or 'Indemnification — Mutual vs One-Way')",
  "category": "contract_legal",
  "context": "2-3 sentences: what is this clause about and where is the risk if it goes wrong",
  "our_position": "Clayco's preferred or standard position on this clause — what we push for and why (populate from meeting history if available, otherwise infer from GC best practice)",
  "client_asks": "what clients / owners typically ask for on this clause — their position",
  "resolution": "how this has been or should be resolved in negotiation — compromise language, fallback positions, red lines",
  "risk_level": "high" | "medium" | "low",
  "entry_type": null,
  "project_refs": [],
  "applies_to": ["relevant contract types, project types, or trade areas"]
}

Return ONLY a valid JSON array. No explanation, no markdown, no wrapper object. Example format:
[{"topic": "...", ...}, {"topic": "...", ...}]`
            }]
          })

          const raw        = msg.content[0].text.trim()
          const jsonMatch  = raw.match(/\[[\s\S]*\]/)
          const entries    = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw)

          // Attach project_id to every entry so the frontend can store it
          const enriched = entries.map(e => ({ ...e, project_id: projectId || null }))

          res.json({ entries: enriched, source_doc: req.file.originalname })
          resolve()
        } catch (e) {
          console.error('knowledge extract error:', e)
          res.status(500).json({ error: e.message })
          resolve()
        }
      })
    })
  }

  try {
    if (req.method === 'GET') {
      const { status = 'active', project_id } = req.query
      let query = supabase
        .from('knowledge_base')
        .select('*')
        .order('updated_at', { ascending: false })

      if (status !== 'all') query = query.eq('status', status)
      if (project_id)       query = query.eq('project_id', project_id)

      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'POST') {
      const now = new Date().toISOString()
      const payload = { ...req.body, created_at: now, updated_at: now }
      const { data, error } = await supabase
        .from('knowledge_base')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const payload = { ...req.body, updated_at: new Date().toISOString() }
      const { data, error } = await supabase
        .from('knowledge_base')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // ── Pod routing: if meeting_category_id was set, route to linked pod ──
      if (payload.meeting_category_id) {
        try {
          const { data: pod } = await supabase
            .from('topic_pods')
            .select('id, name')
            .eq('category_id', payload.meeting_category_id)
            .eq('status', 'active')
            .maybeSingle()

          if (pod) {
            // Only insert if not already routed
            const { data: existing } = await supabase
              .from('topic_pod_content')
              .select('id')
              .eq('pod_id', pod.id)
              .eq('knowledge_base_id', id)
              .maybeSingle()

            if (!existing) {
              const entry = data
              await supabase.from('topic_pod_content').insert({
                pod_id:           pod.id,
                content_type:     'knowledge_link',
                title:            entry.title || 'Knowledge Entry',
                raw_text:         [entry.context, entry.resolution, entry.our_position]
                  .filter(Boolean).join('\n\n').slice(0, 2000),
                extracted_points: (entry.applies_to || []).map(p => ({
                  point: typeof p === 'string' ? p : p.point || JSON.stringify(p),
                  significance: 'medium',
                  tags: [entry.category || 'knowledge'],
                })),
                source_label:     `Knowledge: ${entry.title || 'Untitled'}`,
                knowledge_base_id: id,
              })
              await supabase.from('topic_pods')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', pod.id)
            }
          }
        } catch (podErr) {
          console.error('Knowledge pod routing error:', podErr.message)
        }
      }

      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase.from('knowledge_base').delete().eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
