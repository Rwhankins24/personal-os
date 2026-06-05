// personal-os — Others Commitments route
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
      const { status } = req.query
      const filterStatus = status || 'open'

      const { data, error } = await supabase
        .from('others_commitments')
        .select('*')
        .eq('status', filterStatus)
        .order('due_date', { ascending: true, nullsLast: true })

      if (error) throw error

      // Add days_overdue calculation
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const withOverdue = (data || []).map(c => ({
        ...c,
        days_overdue: c.due_date
          ? Math.max(0, Math.floor(
              (today - new Date(c.due_date)) / (1000 * 60 * 60 * 24)
            ))
          : 0
      }))

      return res.json(withOverdue)
    }

    if (req.method === 'POST') {
      const { data, error } = await supabase
        .from('others_commitments')
        .insert({ ...req.body, created_at: new Date().toISOString() })
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const { data, error } = await supabase
        .from('others_commitments')
        .update({
          ...req.body,
          updated_at: new Date().toISOString()
        })
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
