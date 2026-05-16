// personal-os — Pipeline status tracker
// GET  /api/pipeline/status        — check today's pipeline run status
// POST /api/pipeline/complete-step — mark a pipeline step as complete

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-trigger-secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const secret = req.headers['x-trigger-secret']
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date().toISOString().split('T')[0]

  // ── GET — check pipeline status ───────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .eq('run_date', today)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })

    return res.json(data || {
      run_date: today,
      status: 'not_started',
      email_pull_completed_at: null,
      upload_completed_at: null,
      processing_completed_at: null,
      ai_completed_at: null
    })
  }

  // ── POST — mark a step complete ───────────────────────────────────────
  if (req.method === 'POST') {
    const { step, run_date } = req.body || {}
    const date = run_date || today

    const stepMap = {
      'email_pull':  'email_pull_completed_at',
      'upload':      'upload_completed_at',
      'processing':  'processing_completed_at',
      'ai':          'ai_completed_at'
    }

    const field = stepMap[step]
    if (!field) {
      return res.status(400).json({ error: `Unknown step: ${step}` })
    }

    const { data: existing } = await supabase
      .from('pipeline_runs')
      .select('id')
      .eq('run_date', date)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('pipeline_runs')
        .update({
          [field]: new Date().toISOString(),
          status: step === 'ai' ? 'complete' : 'in_progress'
        })
        .eq('run_date', date)
      if (error) return res.status(500).json({ error: error.message })
    } else {
      const { error } = await supabase
        .from('pipeline_runs')
        .insert({
          run_date: date,
          [field]: new Date().toISOString(),
          status: step === 'ai' ? 'complete' : 'in_progress'
        })
      if (error) return res.status(500).json({ error: error.message })
    }

    return res.json({
      success: true,
      step,
      completed_at: new Date().toISOString()
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
