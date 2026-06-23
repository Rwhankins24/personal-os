// personal-os — Strategic Decisions route
// Ryan's own significant decisions with assumptions + retrospective review
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

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
    // ── GET — list decisions ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { status, category, limit = 50 } = req.query

      let query = supabase
        .from('strategic_decisions')
        .select('*, projects(name)')
        .order('decided_on', { ascending: false })
        .limit(parseInt(limit))

      if (status && status !== 'all') query = query.eq('status', status)
      if (category && category !== 'all') query = query.eq('category', category)

      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    // ── POST — log a new decision ─────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        decision, why, assumptions = [], expected_outcome,
        category = 'other', decided_on, project_id
      } = req.body

      if (!decision) return res.status(400).json({ error: 'decision is required' })

      const { data, error } = await supabase
        .from('strategic_decisions')
        .insert({
          decision,
          why:              why || null,
          assumptions:      Array.isArray(assumptions) ? assumptions : [],
          expected_outcome: expected_outcome || null,
          category,
          decided_on:       decided_on || new Date().toISOString().split('T')[0],
          project_id:       project_id || null,
          status:           'open'
        })
        .select()
        .single()

      if (error) throw error
      return res.status(201).json(data)
    }

    // ── PATCH — update / review a decision ───────────────────────────────────
    if (req.method === 'PATCH') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id required' })

      const updates = { ...req.body, updated_at: new Date().toISOString() }

      // Auto-set reviewed_on and status when retrospective fields arrive
      if (updates.actual_outcome || updates.lesson || updates.outcome_correct !== undefined) {
        updates.reviewed_on = updates.reviewed_on || new Date().toISOString().split('T')[0]
        updates.status = 'reviewed'
      }

      const { data, error } = await supabase
        .from('strategic_decisions')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return res.json(data)
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id required' })

      const { error } = await supabase
        .from('strategic_decisions')
        .delete()
        .eq('id', id)

      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('strategic-decisions error:', err)
    return res.status(500).json({ error: err.message })
  }
}
