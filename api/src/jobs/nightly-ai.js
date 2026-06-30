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
  createContactProfile,
  extractIntelligenceFromTranscript,
} = require('../services/ai')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── Calendar ↔ Recording matching ────────────────────────────────────
// Recordings arrive 1-2 days after the meeting. Match by:
//   1. Title token overlap (normalized, ignore common words)
//   2. Date proximity window ±48 hours
//   3. Participant / attendee overlap (bonus score)
// Returns the best-match event ID or null if confidence < threshold.

// ── Category-specific extraction hints ───────────────────────────────────────
function getCategoryExtractionHints(categoryName) {
  const hints = {
    'OAC':                   '- Schedule status, RFI/submittal log updates\n- Open owner issues and commitments\n- Cost impacts discussed\n- Next OAC date and agenda items',
    'Settlement Discussion':  '- Dollar amounts or ranges mentioned\n- Each party\'s position and movement\n- Mediator/attorney involvement\n- Next steps and deadlines\n- What was agreed vs. still open',
    'Design Review':          '- Design changes or revisions required\n- Coordination issues between disciplines\n- Owner/architect decisions needed\n- Impact on cost or schedule\n- Outstanding design deliverables',
    'Change Order / PCO':     '- Scope description and cause\n- Cost and schedule impact amounts\n- Which party is responsible\n- Approval status and next steps\n- Any rejection or pushback',
    'RFI Review':             '- RFI numbers and subjects discussed\n- Responses provided or outstanding\n- Design clarification impacts\n- Who owes responses and by when',
    'Subcontractor Coord.':   '- Sequence and coordination conflicts\n- Material or equipment lead times\n- Crew availability / manpower\n- Safety or quality issues raised\n- Commitments made by sub',
    'Safety':                 '- Incidents or near-misses described\n- Corrective actions required\n- Responsible parties and deadlines\n- Regulatory or compliance concerns',
    'Internal Review':        '- Strategic decisions made\n- Resource or staffing issues\n- Financial targets or concerns\n- Action items for team members',
    'Pursuit / BD':           '- Client priorities and hot buttons\n- Competitive landscape mentioned\n- Win themes or differentiators\n- Next pursuit milestones and owners\n- Fee or proposal strategy discussed',
    'Client Check-in':        '- Client satisfaction signals\n- Upcoming decisions or approvals\n- Relationship health indicators\n- Asks or concerns from client',
    'Close-out':              '- Punch list status and count\n- Certificate of substantial completion\n- Retainage or final payment status\n- Outstanding warranty or training items',
    'Preconstruction':        '- Budget or GMP status\n- Design completeness and gaps\n- Long-lead procurement needs\n- Schedule milestones and risks',
  }
  return hints[categoryName] || '- Key decisions made\n- Action items and owners\n- Risks or issues raised\n- Financial or schedule impacts'
}

const STOP_WORDS = new Set(['the','a','an','and','or','of','in','at','for','with','to','on','is','this','call','meeting','sync','standup','check-in','checkin','weekly','monthly'])

function tokenize(str) {
  return (str || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
}

function titleScore(a, b) {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (!ta.size || !tb.size) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.min(ta.size, tb.size) // Jaccard-ish on smaller set
}

function participantScore(recParticipants, evtAttendees) {
  if (!recParticipants?.length || !evtAttendees?.length) return 0
  const rp = new Set((recParticipants).map(p => p.toLowerCase().trim()))
  const ea = new Set((evtAttendees).map(a => (typeof a === 'string' ? a : a?.name || a?.email || '').toLowerCase().trim()))
  let overlap = 0
  for (const p of rp) {
    for (const a of ea) {
      if (a.includes(p) || p.includes(a)) { overlap++; break }
    }
  }
  return overlap / Math.min(rp.size, ea.size)
}

async function matchRecordingToEvent(supabase, recording) {
  if (recording.event_id) return null // already matched

  const refDate = recording.start_time || recording.meeting_date
  if (!refDate) return null

  const ref = new Date(refDate)
  const windowStart = new Date(ref.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const windowEnd   = new Date(ref.getTime() + 48 * 60 * 60 * 1000).toISOString()

  const { data: candidates } = await supabase
    .from('events')
    .select('id, title, start_time, attendees')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)

  if (!candidates?.length) return null

  let best = null, bestScore = 0
  for (const evt of candidates) {
    const ts = titleScore(recording.title, evt.title)
    const ps = participantScore(recording.participants, evt.attendees)
    // Weight: title 60%, participants 40%
    const score = ts * 0.6 + ps * 0.4
    if (score > bestScore) { bestScore = score; best = evt }
  }

  // Threshold: require at least 0.25 confidence (1+ shared title tokens)
  return bestScore >= 0.25 ? { event_id: best.id, match_score: bestScore, matched_title: best.title } : null
}

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

    // ── STEP 1b: Match unlinked recordings → calendar events ─────────
    // Recordings arrive 1-2 days late; match by title similarity + date window ±48h
    results.calendar_matches = 0
    const { data: unlinkedRecordings } = await supabase
      .from('meeting_notes')
      .select('id, title, meeting_date, start_time, participants, event_id')
      .is('event_id', null)
      .not('title', 'is', null)

    for (const rec of (unlinkedRecordings || [])) {
      try {
        const match = await matchRecordingToEvent(supabase, rec)
        if (match) {
          await supabase
            .from('meeting_notes')
            .update({ event_id: match.event_id })
            .eq('id', rec.id)
          results.calendar_matches++
        }
      } catch (err) {
        // non-fatal
      }
    }

    // ── STEP 2.6: Reprocess meetings tagged with a new/changed category ──────
    // When a user assigns or changes a category, needs_ai_reprocess = true.
    // This step re-extracts intelligence with category context overnight.
    results.meetings_reprocessed = 0
    try {
      const { data: allMeetingCategories } = await supabase
        .from('meeting_categories')
        .select('id, name, description')
      const categoryMap = new Map((allMeetingCategories || []).map(c => [c.id, c]))

      const { data: reprocessQueue } = await supabase
        .from('meeting_notes')
        .select('id, title, meeting_date, start_time, participants, raw_transcript, full_transcript, short_summary, action_items_raw, duration_raw, primary_category_id, information_only')
        .eq('needs_ai_reprocess', true)
        .limit(5)

      for (const meeting of (reprocessQueue || [])) {
        try {
          const primaryCat = meeting.primary_category_id ? categoryMap.get(meeting.primary_category_id) : null
          const nowISO = new Date().toISOString()
          const meetingDate = meeting.meeting_date || meeting.start_time?.split('T')[0] || today
          const catLabel = primaryCat ? ` [${primaryCat.name}]` : ''

          // information_only: clear flag, skip extraction
          if (meeting.information_only) {
            await supabase.from('meeting_notes').update({ needs_ai_reprocess: false, last_ai_processed_at: nowISO }).eq('id', meeting.id)
            results.meetings_reprocessed++
            continue
          }

          // No transcript — clear flag, nothing to extract
          if (!(meeting.raw_transcript || meeting.full_transcript)) {
            await supabase.from('meeting_notes').update({ needs_ai_reprocess: false, last_ai_processed_at: nowISO }).eq('id', meeting.id)
            continue
          }

          const categoryHint = primaryCat
            ? `\n\nMEETING TYPE: ${primaryCat.name}${primaryCat.description ? ` — ${primaryCat.description}` : ''}.\nExtract intelligence specifically relevant to ${primaryCat.name} meetings:\n${getCategoryExtractionHints(primaryCat.name)}`
            : ''

          const intel = await extractIntelligenceFromTranscript(meeting, meeting.participants || [], [], categoryHint)

          if (intel) {
            for (const item of (intel.ryan_action_items || [])) {
              const title = item.title || item.task_text || item.task
              if (!title) continue
              const { data: existing } = await supabase.from('tasks').select('id').eq('title', title).eq('status', 'open').maybeSingle()
              if (!existing) {
                await supabase.from('tasks').insert({ title, context: `From meeting: ${meeting.title}${catLabel}`, urgency: item.urgency || 'medium', due_date: item.due_date || null, status: 'open', source: 'meeting', source_type: 'ai_plaud', source_label: meeting.title, source_date: meetingDate, ai_enriched: true, source_confidence: 0.85 })
                results.tasks_created++
              }
            }
            for (const c of (intel.verbal_commitments_ryan || [])) {
              if (!c.title) continue
              const { data: existing } = await supabase.from('commitments').select('id').eq('title', c.title).eq('status', 'open').maybeSingle()
              if (!existing) {
                await supabase.from('commitments').insert({ title: c.title, made_to: c.made_to || null, due_date: c.due_date || null, status: 'open', commitment_type: c.commitment_type || 'verbal', source_type: 'ai_plaud', made_on: meetingDate, ai_context: `From meeting: ${meeting.title}${catLabel}` })
                results.my_commitments_extracted++
              }
            }
            for (const c of [...(intel.verbal_commitments_others || []), ...(intel.others_action_items || [])]) {
              const title = c.title || c.commitment_text || c.task_text
              if (!title) continue
              const { data: existing } = await supabase.from('others_commitments').select('id').eq('title', title).eq('status', 'open').maybeSingle()
              if (!existing) {
                await supabase.from('others_commitments').insert({ title, committed_by_name: c.committed_by_name || c.assigned_to_name || 'Unknown', committed_by_email: c.committed_by_email || c.assigned_to_email || null, due_date: c.due_date || null, urgency: c.urgency || 'medium', status: 'open', source_type: 'ai_plaud', source_id: meeting.id, source_label: meeting.title, ai_context: `From meeting: ${meeting.title}${catLabel}` })
                results.others_commitments_extracted++
              }
            }
            if (intel.meeting_outcome?.summary) {
              await supabase.from('meeting_notes').update({ summary: intel.meeting_outcome.summary }).eq('id', meeting.id)
            }
          }

          await supabase.from('meeting_notes').update({ needs_ai_reprocess: false, last_ai_processed_at: nowISO }).eq('id', meeting.id)
          results.meetings_reprocessed++
        } catch (meetErr) {
          results.errors.push(`Meeting reprocess failed "${meeting.title}": ${meetErr.message}`)
        }
      }
    } catch (step26Err) {
      results.errors.push(`Step 2.6 (meeting reprocess) failed: ${step26Err.message}`)
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

    // ── STEP 7.5: Auto-create contacts from real email senders ───────
    const { data: uniqueSenders } = await supabase
      .from('emails')
      .select('from_address, from_name')
      .not('from_address', 'is', null)
      .not('from_address', 'ilike', '%noreply%')
      .not('from_address', 'ilike', '%no-reply%')
      .not('from_address', 'ilike', '%donotreply%')
      .not('from_address', 'ilike', '%@claycorp.com')

    const seenAddresses = new Set()
    for (const sender of (uniqueSenders || [])) {
      if (seenAddresses.has(sender.from_address)) continue
      seenAddresses.add(sender.from_address)

      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', sender.from_address)
        .maybeSingle()

      if (!existing) {
        // Get most recent email from this sender for last_contact_date
        const { data: lastEmail } = await supabase
          .from('emails')
          .select('received_at, thread_subject')
          .eq('from_address', sender.from_address)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        await supabase.from('contacts').insert({
          name: sender.from_name || sender.from_address,
          email: sender.from_address,
          last_contact_date: lastEmail?.received_at?.split('T')[0] || today,
          last_topic: lastEmail?.thread_subject || null
        })
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

      // Yesterday's digest — what actually happened
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]

      const { data: yesterdayDigest } = await supabase
        .from('ai_context')
        .select('content')
        .eq('context_type', 'daily_digest')
        .eq('date', yesterdayStr)
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
        yesterday_digest: yesterdayDigest?.content || null,
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
