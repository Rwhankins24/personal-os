'use strict'
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const { data, error } = await supabase
      .from('meeting_notes')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(10)

    if (error) throw error
    return res.json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
