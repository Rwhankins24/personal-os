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
    if (req.method === 'GET') {
      const { id, project_id, workspace_id, source } = req.query
      if (id) {
        const { data, error } = await supabase
          .from('meeting_notes').select('*').eq('id', id).single()
        if (error) throw error
        return res.json(data)
      }
      let query = supabase.from('meeting_notes').select('*').order('meeting_date', { ascending: false })
      if (project_id)   query = query.eq('project_id', project_id)
      if (workspace_id) query = query.eq('workspace_id', workspace_id)
      if (source)       query = query.eq('source', source)
      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'POST') {
      // Upsert by external_id if provided (idempotent for re-runs + backfill)
      if (req.body.external_id) {
        const { data, error } = await supabase
          .from('meeting_notes')
          .upsert(req.body, { onConflict: 'external_id', ignoreDuplicates: false })
          .select().single()
        if (error) throw error
        return res.status(200).json(data)
      }

      // No external_id — check for duplicate by title + meeting_date before inserting
      if (req.body.title && req.body.meeting_date) {
        const { data: existing } = await supabase
          .from('meeting_notes')
          .select('id')
          .eq('title', req.body.title)
          .eq('meeting_date', req.body.meeting_date)
          .eq('source', req.body.source || 'plaud')
          .maybeSingle()
        if (existing) {
          // Update with any richer content from this payload
          const { data, error } = await supabase
            .from('meeting_notes')
            .update(req.body)
            .eq('id', existing.id)
            .select().single()
          if (error) throw error
          return res.status(200).json(data)
        }
      }

      const { data, error } = await supabase
        .from('meeting_notes').insert(req.body).select().single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const { data, error } = await supabase
        .from('meeting_notes').update(req.body).eq('id', id).select().single()
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase
        .from('meeting_notes').delete().eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
