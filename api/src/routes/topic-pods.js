// topic-pods.js — Topic Intelligence Pods
// Living research containers with AI-generated synthesis, manual paste/upload,
// and nightly research directives.

const supabase  = require('../services/supabase')
const multer    = require('multer')
const pdf       = require('pdf-parse')
const mammoth   = require('mammoth')

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase()
    if (ext.endsWith('.pdf') || ext.endsWith('.docx') || ext.endsWith('.txt')) cb(null, true)
    else cb(new Error('Unsupported file type — PDF, DOCX, or TXT only'))
  }
}).single('file')

async function extractFileText(buffer, mimetype, filename) {
  const ext = (filename || '').toLowerCase()
  if (mimetype === 'application/pdf' || ext.endsWith('.pdf')) {
    return (await pdf(buffer)).text
  }
  if (ext.endsWith('.docx') || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return (await mammoth.extractRawText({ buffer })).value
  }
  return buffer.toString('utf-8')
}

// ── Extract key points from a text snippet for a given topic ──
async function extractPoints(text, podName, podDescription) {
  const Anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY })
  const snippet   = text.slice(0, 5000)

  const msg = await Anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are extracting key intelligence for a topic pod called "${podName}"${podDescription ? ` (${podDescription})` : ''}.

Text to analyze:
${snippet}

Extract the most important points relevant to this topic. Return JSON array:
[
  {
    "point": "concise statement of the key insight or fact",
    "significance": "high" | "medium" | "low",
    "tags": ["relevant tag"]
  }
]

Focus on facts, developments, implications, and named entities. 3-8 points maximum. Return only valid JSON.`
    }]
  })

  const raw   = msg.content[0].text.trim()
  const match = raw.match(/\[[\s\S]*\]/)
  return match ? JSON.parse(match[0]) : []
}

// ── Regenerate the synthesis for a pod from all its content ───
async function regenerateSynthesis(podId, podName, podDescription) {
  const { data: contents } = await supabase
    .from('topic_pod_content')
    .select('title, content_type, source_label, extracted_points, raw_text, created_at')
    .eq('pod_id', podId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!contents || contents.length === 0) return null

  // Build a condensed digest of all content
  const digest = contents.map(c => {
    const points = (c.extracted_points || []).map(p => `  • [${p.significance}] ${p.point}`).join('\n')
    return `[${c.created_at?.split('T')[0]} | ${c.source_label || c.content_type}] ${c.title || ''}
${points || c.raw_text?.slice(0, 400) || ''}`
  }).join('\n\n')

  const Anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY })

  const msg = await Anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are synthesizing all accumulated intelligence for a topic pod.

TOPIC: ${podName}
${podDescription ? `CONTEXT: ${podDescription}\n` : ''}
ALL ACCUMULATED CONTENT (${contents.length} items, newest first):
${digest}

Write a structured synthesis that captures everything known about this topic. Format as JSON:
{
  "summary": "2-3 paragraph narrative overview — current state, key players, trajectory, implications",
  "sections": [
    {
      "title": "section name (e.g. 'Key Players', 'Current State', 'Implications for Clayco', 'Open Questions')",
      "bullets": ["concise point", "concise point"]
    }
  ]
}

Make it actionable and specific — not generic. Include actual names, numbers, and dates where available. Return only valid JSON.`
    }]
  })

  const raw   = msg.content[0].text.trim()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  const parsed = JSON.parse(match[0])

  // Save synthesis back to the pod
  await supabase
    .from('topic_pods')
    .update({
      synthesis:           parsed.summary || null,
      synthesis_bullets:   parsed.sections || null,
      last_synthesized_at: new Date().toISOString(),
      updated_at:          new Date().toISOString(),
    })
    .eq('id', podId)

  return parsed
}

// ── Main handler ───────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const path = req.url.split('?')[0]

  // ── POST /api/topic-pods/:id/content — add content to a pod ──
  if (req.method === 'POST' && path.match(/^\/api\/topic-pods\/[^/]+\/content$/)) {
    const podId = path.split('/')[3]

    // Check if this is a file upload or a paste
    const contentType = req.headers['content-type'] || ''

    if (contentType.includes('multipart/form-data')) {
      // File upload path
      return new Promise((resolve) => {
        upload(req, res, async (err) => {
          if (err) { res.status(400).json({ error: err.message }); return resolve() }
          if (!req.file) { res.status(400).json({ error: 'No file' }); return resolve() }
          try {
            const { data: pod } = await supabase.from('topic_pods').select('name, description').eq('id', podId).single()
            const rawText  = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname)
            const points   = await extractPoints(rawText, pod.name, pod.description)
            const title    = req.body?.title || req.file.originalname

            const { data: item, error } = await supabase
              .from('topic_pod_content')
              .insert({
                pod_id:           podId,
                content_type:     'upload',
                title,
                raw_text:         rawText.slice(0, 50000),
                extracted_points: points,
                source_label:     `Uploaded: ${req.file.originalname}`,
              })
              .select()
              .single()
            if (error) throw error

            // Increment count and trigger synthesis in background
            try {
              const { data: cp } = await supabase.from('topic_pods').select('content_count').eq('id', podId).single()
              await supabase.from('topic_pods').update({ content_count: (cp?.content_count || 0) + 1 }).eq('id', podId)
            } catch {}
            regenerateSynthesis(podId, pod.name, pod.description).catch(console.error)

            res.status(201).json(item)
            resolve()
          } catch (e) {
            res.status(500).json({ error: e.message })
            resolve()
          }
        })
      })
    } else {
      // Paste / JSON path
      const { text, title, content_type = 'paste' } = req.body || {}
      if (!text?.trim()) return res.status(400).json({ error: 'text required' })

      try {
        const { data: pod } = await supabase.from('topic_pods').select('name, description').eq('id', podId).single()
        const points  = await extractPoints(text, pod.name, pod.description)
        const label   = content_type === 'research' ? `Research: ${new Date().toISOString().split('T')[0]}` : 'Pasted note'

        const { data: item, error } = await supabase
          .from('topic_pod_content')
          .insert({
            pod_id:           podId,
            content_type,
            title:            title || null,
            raw_text:         text.slice(0, 50000),
            extracted_points: points,
            source_label:     label,
          })
          .select()
          .single()
        if (error) throw error

        try {
          const { data: cp } = await supabase.from('topic_pods').select('content_count').eq('id', podId).single()
          await supabase.from('topic_pods').update({ content_count: (cp?.content_count || 0) + 1 }).eq('id', podId)
        } catch {}
        regenerateSynthesis(podId, pod.name, pod.description).catch(console.error)

        return res.status(201).json(item)
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
    }
  }

  // ── POST /api/topic-pods/:id/synthesize — force synthesis regen ──
  if (req.method === 'POST' && path.match(/^\/api\/topic-pods\/[^/]+\/synthesize$/)) {
    const podId = path.split('/')[3]
    try {
      const { data: pod } = await supabase.from('topic_pods').select('name, description').eq('id', podId).single()
      const synthesis = await regenerateSynthesis(podId, pod.name, pod.description)
      return res.json({ ok: true, synthesis })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── GET /api/topic-pods/:id/content — fetch content for a pod ──
  if (req.method === 'GET' && path.match(/^\/api\/topic-pods\/[^/]+\/content$/)) {
    const podId = path.split('/')[3]
    try {
      const { data, error } = await supabase
        .from('topic_pod_content')
        .select('id, content_type, title, source_label, extracted_points, created_at')
        .eq('pod_id', podId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return res.json(data)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── GET /api/topic-pods/:id — single pod with synthesis ──────
  if (req.method === 'GET' && path.match(/^\/api\/topic-pods\/[^/]+$/)) {
    const podId = path.split('/')[3]
    try {
      const { data, error } = await supabase
        .from('topic_pods')
        .select('*')
        .eq('id', podId)
        .single()
      if (error) throw error
      return res.json(data)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── DELETE /api/topic-pods/:id/content/:contentId ─────────────
  if (req.method === 'DELETE' && path.match(/^\/api\/topic-pods\/[^/]+\/content\/[^/]+$/)) {
    const parts = path.split('/')
    const contentId = parts[5]
    try {
      const { error } = await supabase.from('topic_pod_content').delete().eq('id', contentId)
      if (error) throw error
      return res.status(204).end()
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // ── Standard CRUD for /api/topic-pods ─────────────────────────
  try {
    if (req.method === 'GET') {
      const { status = 'active' } = req.query
      let query = supabase
        .from('topic_pods')
        .select('id, name, description, synthesis, synthesis_bullets, last_synthesized_at, last_researched_at, content_count, status, category_id, created_at, updated_at')
        .order('updated_at', { ascending: false })

      if (status !== 'all') query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'POST') {
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('topic_pods')
        .insert({ ...req.body, created_at: now, updated_at: now })
        .select()
        .single()
      if (error) throw error

      // ── #77: Retroactive historical population ─────────────────
      // Fire-and-forget: search knowledge_base + observations for
      // content matching this new pod's keywords and route matches.
      // Does NOT block the API response.
      setImmediate(async () => {
        try {
          const podId   = data.id
          const podName = data.name || ''
          const podDesc = data.description || ''
          const podDir  = data.research_directive || ''

          // Build keyword set from pod metadata (words > 4 chars to skip stop words)
          const keywords = `${podName} ${podDesc} ${podDir}`
            .toLowerCase()
            .split(/\W+/)
            .filter(w => w.length > 4)
          if (!keywords.length) return

          // Deduplicate keywords and take top 5 for queries
          const uniqueKw = [...new Set(keywords)].slice(0, 5)
          let routed = 0
          const CAP = 30

          // Search knowledge_base for each keyword
          for (const kw of uniqueKw) {
            if (routed >= CAP) break
            const { data: kbMatches } = await supabase
              .from('knowledge_base')
              .select('id, topic, context, source_label')
              .or(`topic.ilike.%${kw}%,context.ilike.%${kw}%`)
              .limit(20)

            for (const entry of (kbMatches || [])) {
              if (routed >= CAP) break
              // Require 2+ keyword overlap to reduce false positives
              const entryText = `${entry.topic || ''} ${entry.context || ''}`.toLowerCase()
              const overlap   = keywords.filter(w => entryText.includes(w)).length
              if (overlap < 2) continue

              const { data: dup } = await supabase
                .from('topic_pod_content')
                .select('id')
                .eq('pod_id', podId)
                .eq('source_id', entry.id)
                .eq('content_type', 'knowledge')
                .maybeSingle()
              if (dup) continue

              await supabase.from('topic_pod_content').insert({
                pod_id:           podId,
                content_type:     'knowledge',
                source_id:        entry.id,
                title:            entry.topic || 'Knowledge entry',
                source_label:     entry.source_label || 'Historical match',
                raw_text:         (entry.context || '').slice(0, 50000),
                extracted_points: [],
                created_at:       new Date().toISOString(),
              })
              routed++
            }
          }

          // Search observations for each keyword
          for (const kw of uniqueKw) {
            if (routed >= CAP) break
            const { data: obsMatches } = await supabase
              .from('observations')
              .select('id, title, summary, source_label')
              .or(`title.ilike.%${kw}%,summary.ilike.%${kw}%`)
              .limit(20)

            for (const obs of (obsMatches || [])) {
              if (routed >= CAP) break
              const obsText = `${obs.title || ''} ${obs.summary || ''}`.toLowerCase()
              const overlap = keywords.filter(w => obsText.includes(w)).length
              if (overlap < 2) continue

              const { data: dup } = await supabase
                .from('topic_pod_content')
                .select('id')
                .eq('pod_id', podId)
                .eq('source_id', obs.id)
                .eq('content_type', 'observation')
                .maybeSingle()
              if (dup) continue

              await supabase.from('topic_pod_content').insert({
                pod_id:           podId,
                content_type:     'observation',
                source_id:        obs.id,
                title:            obs.title || 'Observation',
                source_label:     obs.source_label || 'Historical match',
                raw_text:         (obs.summary || '').slice(0, 50000),
                extracted_points: [],
                created_at:       new Date().toISOString(),
              })
              routed++
            }
          }

          // Update content_count if anything was routed
          if (routed > 0) {
            const { data: cp } = await supabase.from('topic_pods').select('content_count').eq('id', podId).single()
            await supabase.from('topic_pods').update({ content_count: (cp?.content_count || 0) + routed }).eq('id', podId)
            console.log(`[topic-pods] Retroactive population: ${routed} items routed to pod ${podId}`)
          }
        } catch (err) {
          console.error('[topic-pods] Retroactive population error:', err.message)
        }
      })

      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const { data, error } = await supabase
        .from('topic_pods')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase.from('topic_pods').delete().eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
