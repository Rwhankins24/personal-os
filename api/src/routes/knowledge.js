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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

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
          const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname)
          const snippet = text.slice(0, 3000)
          const Anthropic = require('@anthropic-ai/sdk')
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
          const msg = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 1024,
            messages: [{
              role: 'user',
              content: `You are extracting structured knowledge from a document for a construction executive's personal knowledge base.\n\nDocument text (first 3000 chars):\n${snippet}\n\nExtract a knowledge entry with this exact JSON structure:\n{\n  "topic": "concise title (max 10 words)",\n  "category": "contract_legal" | "construction_complexity" | "domain_knowledge" | "project_lesson",\n  "entry_type": "for contract_legal: specific_contract | general_knowledge; for construction_complexity: scope_trap | system_coordination | sequencing_risk | lesson_learned; else null",\n  "context": "what this is about / background (2-4 sentences)",\n  "resolution": "key takeaway, risk to watch, or action to remember (2-4 sentences)",\n  "risk_level": "high" | "medium" | "low" | null,\n  "parties": "contracting parties if applicable, else null",\n  "effective_date": "YYYY-MM-DD if found, else null",\n  "project_refs": ["project name or type if mentioned"],\n  "applies_to": ["relevant tags, systems, or trade areas"]\n}\n\nReturn only valid JSON. No explanation.`
            }]
          })
          const raw = msg.content[0].text.trim()
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw)
          res.json(extracted)
          resolve()
        } catch (e) {
          res.status(500).json({ error: e.message })
          resolve()
        }
      })
    })
  }

  try {
    if (req.method === 'GET') {
      const { status = 'active' } = req.query
      let query = supabase
        .from('knowledge_base')
        .select('*')
        .order('updated_at', { ascending: false })

      if (status !== 'all') {
        query = query.eq('status', status)
      }

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
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase
        .from('knowledge_base')
        .delete()
        .eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
