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
