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
      const { data, error } = await supabase
        .from('events')
        .upsert(req.body, { onConflict: 'external_id' })
      if (error) throw error
      return res.json({ success: true, data })
    }

    if (type === 'email') {
      const { data, error } = await supabase
        .from('emails')
        .insert(req.body)
      if (error) throw error
      return res.json({ success: true, data })
    }

    if (type === 'transcript') {
      const { data, error } = await supabase
        .from('meeting_notes')
        .insert(req.body)
      if (error) throw error
      return res.json({ success: true, data })
    }

    return res.status(400).json({ error: 'Unknown webhook type' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
