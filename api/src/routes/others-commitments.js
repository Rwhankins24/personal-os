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
      const { status, workspace_id, workspace } = req.query
      const filterStatus = status || 'open'

      let query = supabase
        .from('others_commitments')
        .select('*')
        .order('due_date', { ascending: true, nullsLast: true })

      // 'all' = no status filter (used by meeting card inline view)
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus)
      }

      if (workspace_id) {
        query = query.eq('workspace_id', workspace_id)
      } else if (workspace && workspace !== 'all') {
        const { data: ws } = await supabase.from('workspaces').select('id').eq('name', workspace).maybeSingle()
        if (ws?.id) query = query.eq('workspace_id', ws.id)
      }

      const { data, error } = await query

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
        .insert(req.body)
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    if (req.method === 'PATCH') {
      const { id } = req.query
      const allowed = [
        'title', 'committed_by_name', 'committed_by_email', 'due_date',
        'urgency', 'status', 'context', 'meeting_note_id', 'source_label',
        'workspace_id', 'contact_id', 'delivery_type', 'parent_id',
        'source_type', 'source_date', 'person_name',
      ]
      const updates = {}
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key]
      }
      const { data, error } = await supabase
        .from('others_commitments')
        .update(updates)
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
