const { createClient } = require('@supabase/supabase-js')

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
      return res.json({ success: true, action: 'inserted', data })
    }

    return res.status(400).json({ error: 'Unknown webhook type' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
