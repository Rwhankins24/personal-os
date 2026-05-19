'use strict'
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  const secret = req.headers['x-trigger-secret']
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date().toISOString().split('T')[0]

  try {
    const { data: fileData, error: fetchError } = await supabase.storage
      .from('daily-reports')
      .download(`otter-${today}.json`)

    if (fetchError) {
      return res.status(404).json({
        error: 'No Otter report found for today',
        date: today
      })
    }

    const text = await fileData.text()
    const report = JSON.parse(text)

    if (!report.meetings?.length) {
      return res.json({
        success: true,
        meetings_processed: 0,
        message: 'No meetings in report'
      })
    }

    const results = {
      meetings_processed: 0,
      errors: []
    }

    for (const meeting of report.meetings) {
      try {
        const startTimeISO = meeting.start_time
          ? meeting.start_time.replace(/\//g, '-').replace(' ', 'T') + 'Z'
          : null

        let durationSeconds = 0
        if (meeting.duration_raw) {
          const hours = meeting.duration_raw.match(/(\d+)h/)
          const mins  = meeting.duration_raw.match(/(\d+)m/)
          const secs  = meeting.duration_raw.match(/(\d+)s/)
          durationSeconds =
            (hours ? parseInt(hours[1]) * 3600 : 0) +
            (mins  ? parseInt(mins[1])  * 60   : 0) +
            (secs  ? parseInt(secs[1])         : 0)
        }

        const { error } = await supabase
          .from('meeting_notes')
          .upsert({
            otter_id:             meeting.otter_id,
            title:                meeting.title,
            start_time:           startTimeISO,
            duration_seconds:     durationSeconds,
            duration_raw:         meeting.duration_raw,
            short_summary:        meeting.short_summary,
            full_transcript:      meeting.full_transcript || null,
            participants:         meeting.participants || [],
            action_items_raw:     meeting.action_items_parsed || [],
            intelligence_extracted: false,
            commitments_extracted:  false
          }, { onConflict: 'otter_id' })

        if (error) {
          results.errors.push(`${meeting.title}: ${error.message}`)
        } else {
          results.meetings_processed++
        }
      } catch (err) {
        results.errors.push(`${meeting.otter_id}: ${err.message}`)
      }
    }

    await supabase
      .from('pipeline_runs')
      .upsert({
        run_date: today,
        otter_processing_completed_at: new Date().toISOString()
      }, { onConflict: 'run_date' })

    return res.json({ success: true, date: today, results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
