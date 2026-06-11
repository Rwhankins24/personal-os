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
        console.log(`[merge] winner=${winnerId} loser=${loserId}`)

        if (!winnerId || !loserId || winnerId === loserId) {
          return res.status(400).json({ error: 'merge_from and id must be different non-null project ids' })
        }

        // 1. Load both projects
        const { data: winner, error: we } = await supabase
          .from('projects').select('*').eq('id', winnerId).single()
        if (we) {
          console.error('[merge] winner load failed:', we.message)
          return res.status(404).json({ error: `Winner not found: ${we.message}` })
        }

        const { data: loser, error: le } = await supabase
          .from('projects').select('*').eq('id', loserId).single()
        if (le) {
          console.error('[merge] loser load failed:', le.message)
          return res.status(404).json({ error: `Loser not found: ${le.message}` })
        }
        console.log(`[merge] loaded winner="${winner.name}" loser="${loser.name}"`)

        // 2. Merge JSONB arrays safely
        const safeArray = (v) => Array.isArray(v) ? v : []
        const mergeArrays = (a, b) => {
          const combined = [...safeArray(a), ...safeArray(b)]
          const seen = new Set()
          return combined.filter(item => {
            try {
              const key = JSON.stringify(item)
              if (seen.has(key)) return false
              seen.add(key)
              return true
            } catch (_) { return true }
          })
        }

        // 3. Re-point related records (only tables confirmed to have project_id)
        const tables = ['tasks', 'emails', 'meeting_notes', 'others_commitments',
                        'commitments', 'events', 'pending_decisions', 'decisions']
        const repointResults = {}
        for (const table of tables) {
          const { error: re, count } = await supabase
            .from(table)
            .update({ project_id: winnerId })
            .eq('project_id', loserId)
            .select('id', { count: 'exact', head: true })
          repointResults[table] = re ? `error: ${re.message}` : `ok (${count ?? '?'} rows)`
          if (re) console.warn(`[merge] repoint ${table}: ${re.message}`)
        }
        console.log('[merge] repoint results:', repointResults)

        // 4. Update winner — only JSONB arrays + keywords (safest possible set)
        const mergedKw = [...new Set([...(winner.keywords || []), ...(loser.keywords || [])])]
        const winnerUpdate = {
          intelligence_notes: mergeArrays(winner.intelligence_notes, loser.intelligence_notes),
          decisions_made:     mergeArrays(winner.decisions_made,     loser.decisions_made),
          risk_signals:       mergeArrays(winner.risk_signals,       loser.risk_signals),
          key_facts:          mergeArrays(winner.key_facts,          loser.key_facts),
          keywords:           mergedKw,
        }
        console.log('[merge] updating winner with keys:', Object.keys(winnerUpdate))

        const { data: updated, error: ue } = await supabase
          .from('projects').update(winnerUpdate).eq('id', winnerId).select().single()
        if (ue) {
          console.error('[merge] winner update failed:', JSON.stringify(ue))
          return res.status(500).json({
            step: 'winner_update',
            error: ue.message,
            detail: ue.details,
            hint: ue.hint,
            code: ue.code,
          })
        }

        // 5. Archive loser
        const { error: ae } = await supabase
          .from('projects').update({ status: 'archived' }).eq('id', loserId)
        if (ae) console.warn('[merge] archive loser failed:', ae.message)

        console.log('[merge] complete')
        return res.json({ merged: true, winner: updated, loser_id: loserId, repointed: repointResults })
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
