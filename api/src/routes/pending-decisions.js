// personal-os — Pending Decisions route
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('pending_decisions')
        .select('*, projects(name)')
        .eq('status', 'open')
        .order('due_date', { ascending: true })
      if (error) throw error
      return res.json(data)
    }

    if (req.method === 'POST') {
      const { data, error } = await supabase
        .from('pending_decisions')
        .insert(req.body)
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const { data, error } = await supabase
        .from('pending_decisions')
        .update(req.body)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // If marked as decided — log to decisions table
      if (req.body.status === 'decided' && req.body.outcome) {
        await supabase.from('decisions').insert({
          title: data.title,
          what_was_decided: req.body.outcome,
          decided_on: new Date().toISOString().split('T')[0],
          decided_by: 'Ryan Hankins',
          project_id: data.project_id,
          source_type: 'pending_decision',
          source_id: data.id,
          status: 'made'
        })
      }
      return res.json(data)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
