// personal-os — Email Report Processor
// Vercel serverless function + manually-triggerable endpoint.
//
// GET  /api/jobs/process-email-report  — health check (no auth)
// POST /api/jobs/process-email-report  — process today's report (requires x-trigger-secret)
//
// Reads today's JSON from Supabase storage (daily-reports/<YYYY-MM-DD>.json)
// and upserts emails + calendar events into the Supabase database.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-trigger-secret')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // ── Health check ──────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.json({
      status: 'ok',
      job: 'process-email-report',
      timestamp: new Date().toISOString()
    })
  }

  // ── Auth for POST ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const secret = req.headers['x-trigger-secret']
    if (!secret || secret !== process.env.TRIGGER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Main processing ───────────────────────────────────────────
  try {
    // Step 1 — Determine target date (default: today, override via body)
    const body = req.body || {}
    const today = body.date || new Date().toISOString().split('T')[0]
    const filename = `${today}.json`

    console.log(`Processing email report for: ${today}`)

    // Step 2 — Read report from Supabase storage
    const { data: fileData, error: fileError } = await supabase
      .storage
      .from('daily-reports')
      .download(filename)

    if (fileError) {
      return res.status(404).json({
        error: `No report found for ${today}`,
        detail: fileError.message,
        hint: `Upload the report via the email-pull skill before triggering this job.`
      })
    }

    // Step 3 — Parse and validate
    const reportText = await fileData.text()
    let report
    try {
      report = JSON.parse(reportText)
    } catch (parseErr) {
      return res.status(400).json({
        error: 'Invalid JSON in report file',
        detail: parseErr.message
      })
    }

    if (report.report_date !== today) {
      return res.status(400).json({
        error: `Report date mismatch. File: ${report.report_date}, Expected: ${today}`
      })
    }

    // Step 4 — Process calendar events
    const calendarResults = { pushed: 0, failed: 0, errors: [] }

    if (report.calendar && report.calendar.length > 0) {
      for (const event of report.calendar) {
        try {
          const externalId = event.external_id || `${event.title}::${event.start || event.start_time}`
          const { error } = await supabase
            .from('events')
            .upsert({
              title:       event.title,
              start_time:  event.start || event.start_time,
              end_time:    event.end   || event.end_time,
              location:    event.location   || null,
              join_link:   event.join_link  || null,
              organizer:   event.organizer  || null,
              attendees:   event.attendees  || null,
              body:        event.notes      || null,
              source:      'outlook',
              external_id: externalId
            }, {
              onConflict: 'external_id',
              ignoreDuplicates: false
            })
          if (error) throw error
          calendarResults.pushed++
        } catch (err) {
          calendarResults.failed++
          calendarResults.errors.push({ item: event.title, error: err.message })
        }
      }
    }

    // Step 5 — Collect all email threads (buckets 1–5, skip 6)
    const allEmails = [
      ...(report.bucket1 || []),
      ...(report.bucket2 || []),
      ...(report.bucket3 || []),
      ...(report.bucket4 || []),
      ...(report.bucket5 || [])
    ]

    const emailResults = { pushed: 0, updated: 0, failed: 0, errors: [] }

    for (const email of allEmails) {
      try {
        const threadKey = email.thread_subject || email.subject || email.threadSubject
        const fromAddr  = email.from_address

        // Check if this thread already exists and isn't resolved
        const { data: existing } = await supabase
          .from('emails')
          .select('id, status')
          .eq('thread_subject', threadKey)
          .eq('from_address', fromAddr)
          .neq('status', 'done')
          .maybeSingle()

        if (existing) {
          // Update existing thread's rolling fields
          const { error } = await supabase
            .from('emails')
            .update({
              days_waiting:          email.days_waiting        ?? null,
              urgency:               email.urgency             ?? null,
              cross_reference_status: email.cross_reference_status ?? 'aging',
              last_report_date:      email.last_report_date    ?? today,
              thread_message_count:  email.thread_message_count ?? email.threadMessageCount ?? null,
              latest_sender:         email.latest_sender       ?? email.latestSender        ?? null,
              latest_sender_name:    email.latest_sender_name  ?? email.latestSenderName    ?? null,
              waiting_since:         email.waiting_since       ?? email.waitingSince         ?? null,
              tags:                  email.tags                ?? null,
              is_time_sensitive:     email.is_time_sensitive   ?? false,
              has_contract_language: email.has_contract_language ?? false,
              is_flagged:            email.is_flagged           ?? email.isFlagged           ?? false,
              status:                email.status              ?? null,
              bucket:                email.bucket              ?? null
            })
            .eq('id', existing.id)
          if (error) throw error
          emailResults.updated++
          emailResults.pushed++
        } else {
          // Insert new thread record
          const { error } = await supabase
            .from('emails')
            .insert({
              from_address:           fromAddr,
              from_name:              email.from_name            ?? null,
              subject:                threadKey,
              thread_subject:         threadKey,
              body_preview:           email.body_preview         ?? email.ai_summary ?? null,
              received_at:            email.received_at          ?? null,
              status:                 email.status               ?? null,
              importance:             email.importance           ?? 'normal',
              bucket:                 email.bucket               ?? null,
              tags:                   email.tags                 ?? [],
              days_waiting:           email.days_waiting         ?? 0,
              urgency:                email.urgency              ?? 'normal',
              followed_up:            email.followed_up          ?? false,
              cross_reference_status: email.cross_reference_status ?? 'new',
              is_internal:            email.is_internal          ?? false,
              has_attachment:         email.has_attachment       ?? false,
              is_time_sensitive:      email.is_time_sensitive    ?? false,
              has_contract_language:  email.has_contract_language ?? false,
              thread_participant_count: email.thread_participant_count ?? 1,
              last_report_date:       email.last_report_date     ?? today,
              conversation_id:        email.conversation_id      ?? email.conversationId ?? null,
              thread_message_count:   email.thread_message_count ?? email.threadMessageCount ?? 1,
              thread_participants:    email.thread_participants   ?? email.threadParticipants ?? [],
              latest_sender:          email.latest_sender        ?? email.latestSender   ?? null,
              latest_sender_name:     email.latest_sender_name   ?? email.latestSenderName ?? null,
              my_last_reply_time:     email.my_last_reply_time   ?? email.myLastReplyTime ?? null,
              waiting_since:          email.waiting_since        ?? email.waitingSince    ?? null,
              thread_subject:         threadKey,
              is_flagged:             email.is_flagged            ?? email.isFlagged      ?? false,
              ai_summary:             email.ai_summary           ?? null
            })
          if (error) throw error
          emailResults.pushed++
        }
      } catch (err) {
        emailResults.failed++
        emailResults.errors.push({
          item:  email.thread_subject || email.subject || 'unknown',
          error: err.message
        })
      }
    }

    // Step 6 — Mark processing complete in pipeline
    try {
      await supabase
        .from('pipeline_runs')
        .upsert({
          run_date: today,
          processing_completed_at: new Date().toISOString(),
          status: 'processing_complete'
        }, { onConflict: 'run_date' })
    } catch (pipelineErr) {
      console.log('Pipeline status update failed:', pipelineErr.message)
      // Non-fatal — continue
    }

    // Step 7 — Build and return results
    const result = {
      success:        true,
      report_date:    today,
      calendar:       calendarResults,
      emails:         emailResults,
      summary: {
        total_pushed:  calendarResults.pushed + emailResults.pushed,
        total_failed:  calendarResults.failed + emailResults.failed,
        calendar:      calendarResults.pushed,
        bucket1:       (report.bucket1 || []).length,
        bucket2:       (report.bucket2 || []).length,
        bucket3:       (report.bucket3 || []).length,
        bucket4:       (report.bucket4 || []).length,
        bucket5:       (report.bucket5 || []).length
      },
      processed_at: new Date().toISOString()
    }

    console.log('Email report processed:', JSON.stringify(result.summary))
    return res.json(result)

  } catch (err) {
    console.error('Processing error:', err)
    return res.status(500).json({ error: err.message })
  }
}
