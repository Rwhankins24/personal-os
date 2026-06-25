const { createClient } = require('@supabase/supabase-js')

// ── Calendar matching helpers ──────────────────────────────────────────
// Recordings arrive 1-2 days after meetings. Match by title similarity + ±48h window.
const STOP_WORDS = new Set(['the','a','an','and','or','of','in','at','for','with','to','on','is','this','call','meeting','sync','standup','check-in','checkin','weekly','monthly'])
function tokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
}
function titleScore(a, b) {
  const ta = new Set(tokenize(a)), tb = new Set(tokenize(b))
  if (!ta.size || !tb.size) return 0
  let overlap = 0; for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.min(ta.size, tb.size)
}
function participantScore(rp, ea) {
  if (!rp?.length || !ea?.length) return 0
  const rpSet = new Set((rp).map(p => p.toLowerCase().trim()))
  const eaSet = new Set((ea).map(a => (typeof a === 'string' ? a : a?.name || a?.email || '').toLowerCase().trim()))
  let overlap = 0; for (const p of rpSet) for (const a of eaSet) if (a.includes(p) || p.includes(a)) { overlap++; break }
  return overlap / Math.min(rpSet.size, eaSet.size)
}
async function matchRecordingToEvent(supabase, recording) {
  const refDate = recording.start_time || recording.meeting_date
  if (!refDate) return null
  const ref = new Date(refDate)
  const windowStart = new Date(ref.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const windowEnd   = new Date(ref.getTime() + 48 * 60 * 60 * 1000).toISOString()
  const { data: candidates } = await supabase.from('events').select('id, title, start_time, attendees')
    .gte('start_time', windowStart).lte('start_time', windowEnd)
  if (!candidates?.length) return null
  let best = null, bestScore = 0
  for (const evt of candidates) {
    const score = titleScore(recording.title, evt.title) * 0.6 + participantScore(recording.participants, evt.attendees) * 0.4
    if (score > bestScore) { bestScore = score; best = evt }
  }
  return bestScore >= 0.25 ? best.id : null
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { type } = req.query

  try {
    if (type === 'calendar') {
      const extId = req.body.external_id
      if (extId) {
        // Check if this event already exists by external_id
        const { data: existing } = await supabase
          .from('events').select('id').eq('external_id', extId).maybeSingle()
        if (existing) {
          const { data, error } = await supabase
            .from('events').update(req.body).eq('external_id', extId).select().single()
          if (error) throw error
          return res.json({ success: true, action: 'updated', data })
        }
      }
      const { data, error } = await supabase
        .from('events').insert(req.body).select().single()
      if (error) throw error
      return res.json({ success: true, action: 'inserted', data })
    }

    if (type === 'email') {
      const { data, error } = await supabase
        .from('emails').insert(req.body).select().single()
      if (error) throw error
      return res.json({ success: true, action: 'inserted', data })
    }

    if (type === 'transcript') {
      const { data, error } = await supabase
        .from('meeting_notes').insert(req.body).select().single()
      if (error) throw error

      // Attempt immediate calendar matching — recordings arrive 1-2 days late
      // so we search ±48h around the recording's meeting_date/start_time
      const recording = data
      try {
        const matchedEventId = await matchRecordingToEvent(supabase, recording)
        if (matchedEventId) {
          await supabase
            .from('meeting_notes')
            .update({ event_id: matchedEventId })
            .eq('id', recording.id)
          recording.event_id = matchedEventId
        }
      } catch {
        // non-fatal — nightly job will retry unmatched recordings
      }

      return res.json({ success: true, action: 'inserted', data: recording })
    }

    if (type === 'pipeline_complete') {
      const { report_date } = req.body || {}
      const date = report_date || new Date().toISOString().split('T')[0]

      const { data: existing } = await supabase
        .from('pipeline_runs').select('id').eq('run_date', date).maybeSingle()

      const now = new Date().toISOString()
      if (existing) {
        const { error } = await supabase
          .from('pipeline_runs')
          .update({ processing_completed_at: now, status: 'in_progress' })
          .eq('run_date', date)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('pipeline_runs')
          .insert({ run_date: date, processing_completed_at: now, status: 'in_progress', error_count: 0 })
        if (error) throw error
      }
      return res.json({ success: true, action: 'pipeline_complete_marked', date })
    }

    return res.status(400).json({ error: 'Unknown webhook type' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
