// personal-os — Observations route
// Atomic learnings: nightly AI extractions + manual entries
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
    // ── GET — list or fetch historical recall ────────────────────────────────
    if (req.method === 'GET') {
      const { project_id, contact_id, source_type, recall, limit = 100, offset = 0 } = req.query

      // Special mode: fetch 1 random observation from 30-90 days ago for historical recall
      if (recall === 'true') {
        const now = new Date()
        const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

        const { data, error } = await supabase
          .from('observations')
          .select('*')
          .gte('created_at', ninetyDaysAgo)
          .lte('created_at', thirtyDaysAgo)
          .order('surfaced_at', { ascending: true, nullsFirst: true }) // least recently surfaced first
          .limit(1)

        if (error) throw error

        // Update surfaced_at so we don't repeat the same one
        if (data?.[0]) {
          await supabase
            .from('observations')
            .update({ surfaced_at: new Date().toISOString() })
            .eq('id', data[0].id)
        }

        return res.json(data?.[0] || null)
      }

      let query = supabase
        .from('observations')
        .select('*, projects(name), contacts(full_name)')
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

      if (project_id) query = query.eq('project_id', project_id)
      if (contact_id) query = query.eq('contact_id', contact_id)
      if (source_type) query = query.eq('source_type', source_type)

      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    // ── POST — create an observation ─────────────────────────────────────────
    if (req.method === 'POST') {
      const { content, source_type = 'manual', source_id, project_id, contact_id, tags = [] } = req.body

      if (!content) return res.status(400).json({ error: 'content is required' })

      const { data, error } = await supabase
        .from('observations')
        .insert({
          content,
          source_type,
          source_id:  source_id  || null,
          project_id: project_id || null,
          contact_id: contact_id || null,
          tags:       Array.isArray(tags) ? tags : []
        })
        .select()
        .single()

      if (error) throw error
      return res.status(201).json(data)
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id required' })

      const { error } = await supabase
        .from('observations')
        .delete()
        .eq('id', id)

      if (error) throw error
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('observations error:', err)
    return res.status(500).json({ error: err.message })
  }
}
