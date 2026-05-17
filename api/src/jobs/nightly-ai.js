// personal-os — Nightly AI job (Layer 1)
// POST /api/jobs/nightly-ai — requires x-trigger-secret
// Runs after email processing completes. Summarizes threads,
// extracts tasks and commitments, generates daily brief,
// updates rolling context and contact profiles.

const { createClient } = require('@supabase/supabase-js')
const {
  summarizeThread,
  extractTasks,
  extractOthersCommitments,
  extractMyCommitments,
  generatePreMeetingBrief,
  generateDailyBrief,
  generateDailyDigest,
  updateRollingContext,
  enrichTask,
  createContactProfile
} = require('../services/ai')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  // ── Auth ──────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-trigger-secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    return res.json({ status: 'ok', job: 'nightly-ai', timestamp: new Date().toISOString() })
  }

  const secret = req.headers['x-trigger-secret']
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date().toISOString().split('T')[0]
  const results = {
    date: today,
    threads_summarized: 0,
    tasks_created: 0,
    my_commitments_extracted: 0,
    others_commitments_extracted: 0,
    pre_meeting_briefs: 0,
    contacts_updated: 0,
    tasks_enriched: 0,
    daily_brief: null,
    errors: []
  }

  try {
    // ── STEP 1: Update overdue_days on tasks ──────────────────────────
    const { data: overdueTasks } = await supabase
      .from('tasks')
      .select('id, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .not('due_date', 'is', null)

    for (const task of (overdueTasks || [])) {
      const overdueDays = Math.floor(
        (new Date(today) - new Date(task.due_date)) / (1000 * 60 * 60 * 24)
      )
      await supabase
        .from('tasks')
        .update({ overdue_days: overdueDays })
        .eq('id', task.id)
    }

    // ── STEP 2: Get active emails needing processing ──────────────────
    const { data: activeEmails } = await supabase
      .from('emails')
      .select('*')
      .in('bucket', [1, 2])
      .in('status', ['needs_reply', 'waiting_on'])
      .order('days_waiting', { ascending: false })
      .limit(25)

    // ── STEP 3: Summarize threads ─────────────────────────────────────
    for (const email of (activeEmails || [])) {
      try {
        const summary = await summarizeThread(email)
        await supabase
          .from('emails')
          .update({ ai_summary: summary })
          .eq('id', email.id)
        results.threads_summarized++
      } catch (err) {
        results.errors.push(`Summarize failed ${email.thread_subject}: ${err.message}`)
      }
    }

    // ── STEP 4: Extract tasks from Bucket 1 ──────────────────────────
    const bucket1 = (activeEmails || []).filter(e => e.bucket === 1)

    for (const email of bucket1) {
      try {
        const tasks = await extractTasks(email)
        for (const task of tasks) {
          const { data: existing } = await supabase
            .from('tasks')
            .select('id')
            .eq('title', task.title)
            .eq('status', 'open')
            .maybeSingle()

          if (!existing) {
            await supabase.from('tasks').insert({
              ...task,
              status: 'open',
              source: 'email',
              source_type: 'ai_email',
              source_label: email.thread_subject,
              source_date: today,
              ai_enriched: true,
              source_confidence: 0.85
            })
            results.tasks_created++
          }
        }
      } catch (err) {
        results.errors.push(`Task extraction failed: ${err.message}`)
      }
    }

    // ── STEP 5: Extract commitments ───────────────────────────────────
    for (const email of (activeEmails || [])) {
      try {
        const othersCommitments = await extractOthersCommitments(email)
        for (const c of othersCommitments) {
          const { data: existing } = await supabase
            .from('others_commitments')
            .select('id')
            .eq('title', c.title)
            .eq('committed_by_email', c.committed_by_email)
            .eq('status', 'open')
            .maybeSingle()

          if (!existing) {
            await supabase.from('others_commitments').insert({
              ...c,
              source_type: 'ai_email',
              source_id: email.id,
              source_label: email.thread_subject,
              ai_context: `Extracted from email thread: ${email.thread_subject}`
            })
            results.others_commitments_extracted++
          }
        }

        // My commitments from Bucket 2
        if (email.bucket === 2) {
          const myCommitments = await extractMyCommitments(email)
          for (const c of myCommitments) {
            const { data: existing } = await supabase
              .from('commitments')
              .select('id')
              .eq('title', c.title)
              .eq('status', 'open')
              .maybeSingle()

            if (!existing) {
              await supabase.from('commitments').insert({
                ...c,
                status: 'open',
                source_type: 'ai_email',
                made_on: today
              })
              results.my_commitments_extracted++
            }
          }
        }
      } catch (err) {
        results.errors.push(`Commitment extraction failed: ${err.message}`)
      }
    }

    // ── STEP 6: Enrich manually added tasks ───────────────────────────
    const { data: manualTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('source_type', 'manual')
      .eq('ai_enriched', false)
      .eq('status', 'open')
      .limit(10)

    for (const task of (manualTasks || [])) {
      try {
        const keywords = task.title.split(' ').filter(w => w.length > 4).slice(0, 3)
        const { data: relatedEmails } = await supabase
          .from('emails')
          .select('thread_subject, body_preview, from_name')
          .or(keywords.map(k => `thread_subject.ilike.%${k}%`).join(','))
          .limit(3)

        if (relatedEmails && relatedEmails.length > 0) {
          const enrichedContext = await enrichTask(task, relatedEmails)
          await supabase
            .from('tasks')
            .update({ ai_context: enrichedContext, ai_enriched: true })
            .eq('id', task.id)
          results.tasks_enriched++
        }
      } catch (err) {
        results.errors.push(`Task enrichment failed: ${err.message}`)
      }
    }

    // ── STEP 7: Pre-meeting briefs ────────────────────────────────────
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('*')
      .gte('start_time', `${today}T00:00:00Z`)
      .lte('start_time', `${tomorrowStr}T23:59:59Z`)
      .order('start_time', { ascending: true })

    for (const event of (upcomingEvents || [])) {
      try {
        const { data: relatedEmails } = await supabase
          .from('emails')
          .select('*')
          .in('status', ['needs_reply', 'waiting_on'])
          .limit(5)

        const { data: openTasks } = await supabase
          .from('tasks')
          .select('title, urgency')
          .eq('status', 'open')
          .limit(5)

        const { data: projectCtx } = await supabase
          .from('ai_context')
          .select('content')
          .eq('context_type', 'project_profile')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const brief = await generatePreMeetingBrief(
          event,
          relatedEmails || [],
          openTasks || [],
          projectCtx?.content || null
        )
        await supabase.from('events').update({ body: brief }).eq('id', event.id)
        results.pre_meeting_briefs++
      } catch (err) {
        results.errors.push(`Pre-meeting brief failed ${event.title}: ${err.message}`)
      }
    }

    // ── STEP 8: Update contact profiles ──────────────────────────────
    const { data: activeContacts } = await supabase
      .from('contacts')
      .select('*')
      .order('last_contact_date', { ascending: false })
      .limit(10)

    for (const contact of (activeContacts || [])) {
      try {
        const { data: interactions } = await supabase
          .from('emails')
          .select('thread_subject, days_waiting, urgency, status')
          .eq('from_address', contact.email)
          .limit(10)

        if (interactions && interactions.length > 0) {
          const profile = await createContactProfile(contact, interactions)

          const { data: existingCtx } = await supabase
            .from('ai_context')
            .select('id')
            .eq('context_type', 'contact_profile')
            .eq('subject_id', contact.id)
            .maybeSingle()

          if (existingCtx) {
            await supabase
              .from('ai_context')
              .update({ content: profile, updated_at: new Date().toISOString() })
              .eq('id', existingCtx.id)
          } else {
            await supabase.from('ai_context').insert({
              context_type: 'contact_profile',
              subject_id: contact.id,
              subject_type: 'contact',
              content: profile,
              date: today
            })
          }
          results.contacts_updated++
        }
      } catch (err) {
        results.errors.push(`Contact profile failed ${contact.name}: ${err.message}`)
      }
    }

    // ── STEP 9: Generate daily brief ──────────────────────────────────
    try {
      const { data: rollingCtx } = await supabase
        .from('ai_context')
        .select('content')
        .eq('context_type', 'rolling_summary')
        .eq('subject_type', 'global')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { data: overdueOthers } = await supabase
        .from('others_commitments')
        .select('*')
        .eq('status', 'open')
        .lt('due_date', today)
        .limit(5)

      const overdueWithDays = (overdueOthers || []).map(c => ({
        ...c,
        days_overdue: Math.floor(
          (new Date(today) - new Date(c.due_date)) / (1000 * 60 * 60 * 24)
        )
      }))

      const { data: todayEvents } = await supabase
        .from('events')
        .select('title, start_time, location')
        .gte('start_time', `${today}T00:00:00Z`)
        .lte('start_time', `${today}T23:59:59Z`)
        .order('start_time', { ascending: true })

      const { data: openTasks } = await supabase
        .from('tasks')
        .select('title, urgency, due_date')
        .eq('status', 'open')
        .order('urgency', { ascending: false })
        .limit(5)

      const { data: criticalEmails } = await supabase
        .from('emails')
        .select('thread_subject, from_name, days_waiting, urgency')
        .eq('bucket', 1)
        .order('days_waiting', { ascending: false })
        .limit(5)

      const { data: openCommitments } = await supabase
        .from('commitments')
        .select('title, made_to, due_date, urgency')
        .eq('status', 'open')
        .limit(5)

      const { data: allOthersCommitments } = await supabase
        .from('others_commitments')
        .select('title, committed_by, due_date, status')
        .eq('status', 'open')
        .order('due_date', { ascending: true })
        .limit(8)

      const { data: recentMeetingNotes } = await supabase
        .from('meeting_notes')
        .select('title, summary, action_items, meeting_date')
        .order('meeting_date', { ascending: false })
        .limit(3)

      const briefContext = {
        date: today,
        meetings_today: (todayEvents || []).length,
        calendar: (todayEvents || []).map(e => ({
          title: e.title,
          time: e.start_time,
          location: e.location
        })),
        critical_emails: criticalEmails || [],
        open_tasks: openTasks || [],
        open_commitments: openCommitments || [],
        overdue_others: overdueWithDays,
        all_others_commitments: allOthersCommitments || [],
        meeting_notes: recentMeetingNotes || [],
        rolling_summary: rollingCtx?.content || null
      }

      const brief = await generateDailyBrief(briefContext)
      results.daily_brief = brief

      // Store daily brief in captures
      await supabase.from('captures').insert({
        content: brief,
        type: 'daily_brief',
        routed: true,
        routed_to: 'dashboard',
        ai_generated: true
      })

      // Write daily digest for memory
      const digest = await generateDailyDigest({
        date: today,
        tasks_created: results.tasks_created,
        commitments_extracted: results.my_commitments_extracted,
        others_commitments: results.others_commitments_extracted,
        threads_processed: results.threads_summarized,
        emails_snapshot: (criticalEmails || []).map(e => `${e.from_name}: ${e.thread_subject}`),
        tasks_snapshot: (openTasks || []).map(t => t.title)
      })

      await supabase.from('ai_context').insert({
        context_type: 'daily_digest',
        subject_type: 'global',
        content: digest,
        date: today
      })

      // Update rolling summary (Sundays or if no rolling summary exists yet)
      const dayOfWeek = new Date().getDay()
      const hasRolling = !!rollingCtx?.content

      if (dayOfWeek === 0 || !hasRolling) {
        const updatedRolling = await updateRollingContext(rollingCtx?.content, digest, today)
        if (rollingCtx) {
          await supabase
            .from('ai_context')
            .update({ content: updatedRolling, updated_at: new Date().toISOString() })
            .eq('context_type', 'rolling_summary')
            .eq('subject_type', 'global')
        } else {
          await supabase.from('ai_context').insert({
            context_type: 'rolling_summary',
            subject_type: 'global',
            content: updatedRolling,
            date: today
          })
        }
      }
    } catch (err) {
      results.errors.push(`Daily brief failed: ${err.message}`)
    }

    // ── STEP 10: Mark AI complete in pipeline ─────────────────────────
    await supabase
      .from('pipeline_runs')
      .upsert({
        run_date: today,
        ai_completed_at: new Date().toISOString(),
        status: 'complete'
      }, { onConflict: 'run_date' })

    return res.json({
      success: true,
      results,
      processed_at: new Date().toISOString()
    })

  } catch (err) {
    console.error('Nightly AI error:', err)
    return res.status(500).json({ error: err.message })
  }
}
