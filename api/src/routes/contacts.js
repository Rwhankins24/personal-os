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
      const { id, relationship_warmth, project_id } = req.query

      if (id) {
        // Single contact: fetch contact + latest AI profile
        const [contactResult, profileResult] = await Promise.all([
          supabase.from('contacts').select('*').eq('id', id).single(),
          supabase
            .from('ai_context')
            .select('content, created_at')
            .eq('context_type', 'contact_profile')
            .eq('subject_id', id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ])
        if (contactResult.error) throw contactResult.error
        return res.json({
          ...contactResult.data,
          ai_profile: profileResult.data?.content || null,
          ai_profile_date: profileResult.data?.created_at || null
        })
      }

      // List: select all columns (safe regardless of schema version),
      // sort by name as reliable DB fallback, re-sort by last_contact_date in JS
      // (handles cases where last_contact_date column doesn't exist yet)
      let query = supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true })
      if (relationship_warmth) query = query.eq('relationship_warmth', relationship_warmth)
      if (project_id)          query = query.eq('project_id', project_id)
      const { data, error } = await query
      if (error) throw error

      // Re-sort by last_contact_date DESC in JS (nulls last)
      const sorted = (data || []).sort((a, b) => {
        const da = a.last_contact_date ? new Date(a.last_contact_date) : null
        const db = b.last_contact_date ? new Date(b.last_contact_date) : null
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return db - da
      })
      return res.json(sorted)
    }

    if (req.method === 'POST') {
      const { data, error } = await supabase
        .from('contacts').insert(req.body).select().single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const { data, error } = await supabase
        .from('contacts').update(req.body).eq('id', id).select().single()
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      const { error } = await supabase
        .from('contacts').delete().eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
