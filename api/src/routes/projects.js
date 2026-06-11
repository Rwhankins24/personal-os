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

      // ── Merge endpoint: PATCH /api/projects?id=WINNER&merge_from=LOSER
      if (req.query.merge_from) {
        const winnerId = id
        const loserId  = req.query.merge_from
        if (!winnerId || !loserId || winnerId === loserId) {
          return res.status(400).json({ error: 'merge_from and id must be different non-null project ids' })
        }

        // 1. Load both projects
        const [{ data: winner, error: we }, { data: loser, error: le }] = await Promise.all([
          supabase.from('projects').select('*').eq('id', winnerId).single(),
          supabase.from('projects').select('*').eq('id', loserId).single(),
        ])
        if (we) return res.status(404).json({ error: `Winner project not found: ${we.message}` })
        if (le) return res.status(404).json({ error: `Loser project not found: ${le.message}` })

        // 2. Merge JSONB arrays (dedupe by JSON string)
        const mergeArrays = (a, b) => {
          const combined = [...(a || []), ...(b || [])]
          const seen = new Set()
          return combined.filter(item => {
            const key = JSON.stringify(item)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        }

        const mergedIntel    = mergeArrays(winner.intelligence_notes, loser.intelligence_notes)
        const mergedDecisions = mergeArrays(winner.decisions_made,     loser.decisions_made)
        const mergedRisks    = mergeArrays(winner.risk_signals,        loser.risk_signals)
        const mergedKeyFacts = mergeArrays(winner.key_facts,           loser.key_facts)

        // 3. Re-point all related records from loser → winner
        const tables = [
          'tasks', 'emails', 'meeting_notes', 'others_commitments',
          'commitments', 'contacts', 'events', 'pending_decisions',
          'decisions', 'captures', 'knowledge',
        ]
        const repoints = tables.map(table =>
          supabase.from(table).update({ project_id: winnerId }).eq('project_id', loserId)
        )
        await Promise.allSettled(repoints)

        // 4. Merge winner keywords
        const winnerKw = winner.keywords || []
        const loserKw  = loser.keywords  || []
        const mergedKw = [...new Set([...winnerKw, ...loserKw])]

        // 5. Update winner with merged data + fill gaps from loser if winner is missing
        // Only write columns confirmed to exist — avoid writing non-existent columns
        const enriched = {
          intelligence_notes: mergedIntel,
          decisions_made:     mergedDecisions,
          risk_signals:       mergedRisks,
          key_facts:          mergedKeyFacts,
          keywords:           mergedKw,
          updated_at:         new Date().toISOString(),
        }
        // Fill gaps only for columns we know exist (confirmed by ProjectCard + migrations)
        const fillGap = (col) => {
          if (!winner[col] && loser[col]) enriched[col] = loser[col]
        }
        ;['description', 'client', 'location', 'contract_value', 'current_phase',
          'delivery_method', 'contract_type', 'type', 'decision_date',
          'win_probability', 'key_risk', 'est_value'].forEach(fillGap)
        const { data: updated, error: ue } = await supabase
          .from('projects').update(enriched).eq('id', winnerId).select().single()
        if (ue) {
          console.error('Merge winner update failed:', ue)
          console.error('Enriched payload keys:', Object.keys(enriched))
          return res.status(500).json({ error: `Failed to update winner: ${ue.message}`, detail: ue.details, hint: ue.hint })
        }

        // 6. Archive loser
        await supabase.from('projects').update({
          status:     'archived',
          updated_at: new Date().toISOString(),
        }).eq('id', loserId)

        return res.json({
          merged: true,
          winner: updated,
          loser_id: loserId,
          repointed: tables,
        })
      }

      // Regular PATCH
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
