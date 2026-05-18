const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // ── Keyword preview endpoint ──────────────────────────────────
    const urlPath = (req.url || '').split('?')[0]
    const previewMatch = urlPath.match(/\/api\/projects\/([^/]+)\/keyword-preview$/)
    if (previewMatch && req.method === 'GET') {
      const keywords = (req.query.keywords || '').split(',').map(k => k.trim()).filter(k => k.length > 0)
      if (!keywords.length) return res.json({ email_count: 0, meeting_count: 0 })
      const emailFilter = keywords.map(k => `thread_subject.ilike.%${k}%`).join(',')
      const { count: emailCount } = await supabase
        .from('emails').select('id', { count: 'exact', head: true }).or(emailFilter)
      const meetingFilter = keywords.map(k => `title.ilike.%${k}%,short_summary.ilike.%${k}%`).join(',')
      const { count: meetingCount } = await supabase
        .from('meeting_notes').select('id', { count: 'exact', head: true }).or(meetingFilter)
      return res.json({ email_count: emailCount || 0, meeting_count: meetingCount || 0 })
    }

    if (req.method === 'GET') {
      const { id, status, type, workspace_id } = req.query
      if (id) {
        const { data, error } = await supabase
          .from('projects').select('*').eq('id', id).single()
        if (error) throw error
        return res.json(data)
      }
      let query = supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (status)       query = query.eq('status', status)
      if (type)         query = query.eq('type', type)
      if (workspace_id) query = query.eq('workspace_id', workspace_id)
      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'POST') {
      const body = {
        intelligence_notes: [],
        decisions_made: [],
        risk_signals: [],
        key_facts: [],
        ...req.body,
      }
      const { data, error } = await supabase
        .from('projects').insert(body).select().single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const body = { ...req.body, updated_at: new Date().toISOString() }
      const { data, error } = await supabase
        .from('projects').update(body).eq('id', id).select().single()
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase
        .from('projects').delete().eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
