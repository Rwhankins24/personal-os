// personal-os — Suggested Projects route
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('suggested_projects')
        .select('*')
        .eq('status', 'pending')
        .order('email_count', { ascending: false })
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const updates = req.body

      // If accepting — create the project
      if (updates.action === 'accept') {
        const { data: suggestion } = await supabase
          .from('suggested_projects')
          .select('*')
          .eq('id', id)
          .single()

        const { data: newProject, error: pErr } = await supabase
          .from('projects')
          .insert({
            name: suggestion.name,
            type: 'active',
            status: 'active'
          })
          .select()
          .single()

        if (pErr) throw pErr

        await supabase
          .from('suggested_projects')
          .update({
            status: 'accepted',
            created_project_id: newProject.id
          })
          .eq('id', id)

        return res.json({ success: true, project: newProject })
      }

      // If dismissing
      const { data, error } = await supabase
        .from('suggested_projects')
        .update({ status: 'dismissed' })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.json(data)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
