'use strict'
// personal-os — Nightly AI Job (standalone Node.js script)
// Runs in GitHub Actions or locally
// Uses process.env — NOT req/res
// process.exit(0) on success, process.exit(1) on fatal failure

const path = require('path')
require('dotenv').config({
  path: path.join(__dirname, '../../.env')
})

const { createClient } = require('@supabase/supabase-js')
const aiService = require('../services/ai')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const today = new Date().toISOString().split('T')[0]

// ─── IDEMPOTENCY CHECK
// If AI already ran today — exit immediately
async function checkAlreadyRan() {
  const { data } = await supabase
    .from('pipeline_runs')
    .select('ai_completed_at')
    .eq('run_date', today)
    .maybeSingle()

  if (data?.ai_completed_at) {
    console.log(`AI job already completed for ${today}. Exiting.`)
    process.exit(0)
  }
}

// ─── THREAD HISTORY QUERY
// Reads accumulated history from database
// Does NOT call Outlook
async function getThreadHistory(email) {
  const subject = (email.thread_subject || email.subject || '')
    .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
    .trim()
    .substring(0, 60)

  if (!subject) return []

  const { data } = await supabase
    .from('emails')
    .select(
      'id, from_name, from_address, received_at, ai_summary, ' +
      'body_preview, sent_body, status, bucket, days_waiting, tags'
    )
    .ilike('thread_subject', `%${subject}%`)
    .order('received_at', { ascending: true })
    .limit(20)

  return data || []
}

// ─── PROJECT KEYWORD MATCHING
async function findProjectByKeywords(text) {
  if (!text) return null

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, keywords')
    .eq('status', 'active')

  if (!projects?.length) return null

  const textLower = text.toLowerCase()

  for (const project of projects) {
    const nameParts = project.name.toLowerCase().split(' ')
    const keywords = [
      project.name.toLowerCase(),
      ...nameParts,
      ...(project.keywords || []).map(k => k.toLowerCase())
    ].filter(k => k && k.length > 2)

    if (keywords.some(k => textLower.includes(k))) {
      return project.id
    }
  }
  return null
}

// ─── LOG AI QUESTION
async function logAIQuestion(question, context, questionType, options = []) {
  try {
    await supabase.from('ai_questions').insert({
      question,
      context,
      question_type: questionType,
      response_type: questionType,
      options: options.length > 0 ? options : ['Yes', 'No'],
      conversation: [],
      answered_at: null,
      acted_on: false
    })
  } catch (err) {
    console.log(`Failed to log question: ${err.message}`)
  }
}

// ─── DETECT LINK TYPE
function detectLinks(bodyText) {
  if (!bodyText) return []

  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
  const urls = bodyText.match(urlRegex) || []

  return urls.map(url => {
    let type = 'reference'
    if (
      url.includes('teams.microsoft.com') ||
      url.includes('zoom.us') ||
      url.includes('meet.google.com') ||
      url.includes('webex.com')
    ) type = 'meeting'
    else if (
      url.includes('sharepoint.com') ||
      url.includes('drive.google.com') ||
      url.includes('dropbox.com') ||
      url.includes('onedrive')
    ) type = 'document'

    return { url, type }
  })
}

// ─── SEMANTIC DEDUPLICATION (source-priority-aware)
// Priority: manual=4 (never deleted), ai_otter=3, ai_email=2, system=1
async function deduplicateTable(tableName, emailField) {
  const SOURCE_PRIORITY = { manual: 4, ai_otter: 3, ai_email: 2, system: 1 }

  let selectFields = 'id, title, source_type, created_at'
  if (emailField) selectFields += `, ${emailField}`

  const { data: items } = await supabase
    .from(tableName)
    .select(selectFields)
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  if (!items?.length) return 0

  // Group items by fingerprint key
  const groups = new Map()

  for (const item of items) {
    const fingerprint = (item.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(' ')
      .filter(w => w.length > 4)
      .slice(0, 5)
      .join('|')

    const emailKey = emailField ? (item[emailField] || 'unknown') : 'any'
    const key = `${fingerprint}:${emailKey}`

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  const toDelete = []

  for (const [, group] of groups) {
    if (group.length <= 1) continue

    // Sort: highest priority first; ties broken by oldest created_at (keep original)
    group.sort((a, b) => {
      const pa = SOURCE_PRIORITY[a.source_type] || 0
      const pb = SOURCE_PRIORITY[b.source_type] || 0
      if (pb !== pa) return pb - pa
      return new Date(a.created_at) - new Date(b.created_at)
    })

    // Keep first (winner), queue the rest for deletion — never delete manual
    for (let i = 1; i < group.length; i++) {
      if (group[i].source_type !== 'manual') {
        toDelete.push(group[i].id)
      }
    }
  }

  if (toDelete.length > 0) {
    await supabase.from(tableName).delete().in('id', toDelete)
  }

  return toDelete.length
}

// ─── PROJECT KEYWORD BOOTSTRAP
// On first run: infer keywords from project names
async function bootstrapProjectKeywords() {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, keywords')
    .eq('status', 'active')

  for (const project of (projects || [])) {
    if (project.keywords && project.keywords.length > 0) continue

    // Generate keywords from project name
    const nameWords = project.name
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 2)

    const keywords = [
      project.name.toLowerCase(),
      ...nameWords
    ]

    await supabase
      .from('projects')
      .update({ keywords })
      .eq('id', project.id)

    console.log(`  Bootstrapped keywords for ${project.name}: ${keywords.join(', ')}`)
  }
}

// ─── MAIN JOB FUNCTION
async function main() {
  console.log(
    '\n═══════════════════════════════\n' +
    'PERSONAL OS — NIGHTLY AI JOB\n' +
    `Date: ${today}\n` +
    '═══════════════════════════════\n'
  )

  await checkAlreadyRan()

  const results = {
    date: today,
    threads_summarized: 0,
    tasks_created: 0,
    my_commitments_extracted: 0,
    others_commitments_extracted: 0,
    pre_meeting_briefs: 0,
    high_stakes_meetings_detected: 0,
    decisions_logged: 0,
    pending_decisions_created: 0,
    intelligence_notes_added: 0,
    risk_signals_detected: 0,
    contacts_created: 0,
    contacts_updated: 0,
    tasks_enriched: 0,
    questions_logged: 0,
    daily_brief: null,
    otter_meetings_processed: 0,
    otter_tasks_created: 0,
    otter_my_commitments: 0,
    otter_others_created: 0,
    cross_refs_created: 0,
    errors: []
  }

  // ── STEP 1: Bootstrap and hygiene ──────────────────────────────
  console.log('Step 1: Bootstrap and hygiene...')
  try {
    await bootstrapProjectKeywords()

    // Update overdue days on tasks
    const { data: overdueTasks } = await supabase
      .from('tasks')
      .select('id, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .not('due_date', 'is', null)

    for (const task of (overdueTasks || [])) {
      const days = Math.floor(
        (new Date(today) - new Date(task.due_date)) / (1000 * 60 * 60 * 24)
      )
      await supabase
        .from('tasks')
        .update({ overdue_days: days })
        .eq('id', task.id)
    }

    // Update overdue days on commitments
    const { data: overdueC } = await supabase
      .from('commitments')
      .select('id, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .not('due_date', 'is', null)

    for (const c of (overdueC || [])) {
      const days = Math.floor(
        (new Date(today) - new Date(c.due_date)) / (1000 * 60 * 60 * 24)
      )
      await supabase
        .from('commitments')
        .update({ overdue_days: days })
        .eq('id', c.id)
    }

    // Deduplicate others_commitments and tasks
    try {
      const othersDeleted = await deduplicateTable('others_commitments', 'committed_by_email')
      const tasksDeleted  = await deduplicateTable('tasks', null)
      console.log(`  Deduped: ${othersDeleted} commitments, ${tasksDeleted} tasks removed`)
    } catch (err) {
      // Non-fatal
    }

    console.log('  ✓ Hygiene complete')
  } catch (err) {
    results.errors.push(`Hygiene: ${err.message}`)
    console.log(`  ✗ Hygiene error: ${err.message}`)
  }

  // ── STEP 2: Get active emails ───────────────────────────────────
  console.log('Step 2: Fetching active emails...')
  const { data: activeEmails } = await supabase
    .from('emails')
    .select('*')
    .in('bucket', [1, 2])
    .in('status', ['needs_reply', 'waiting_on'])
    .order('days_waiting', { ascending: false })
    .limit(25)

  console.log(`  ✓ Found ${(activeEmails || []).length} active email threads`)

  // ── STEP 2.4: Load Plaud meetings from storage → meeting_notes ──
  console.log('Step 2.4: Loading Plaud meetings into meeting_notes...')
  let plaudMeetingsLoaded = 0
  try {
    // Download plaud-{today}.json from Supabase storage
    const plaudStorageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/daily-reports/plaud-${today}.json`
    const plaudRes = await fetch(plaudStorageUrl, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
    })

    if (plaudRes.ok) {
      const plaudReport = await plaudRes.json()
      const meetings = plaudReport.meetings || []

      // Load calendar events for today once — used to cross-ref all meetings
      const { data: todayCalendarEvents } = await supabase
        .from('events')
        .select('title, start_time, attendees')
        .gte('start_time', `${today}T00:00:00Z`)
        .lte('start_time', `${today}T23:59:59Z`)
        .not('attendees', 'is', null)

      for (const meeting of meetings) {
        if (!meeting.gmail_message_id) continue

        // Check if already inserted (idempotent)
        const { data: existing } = await supabase
          .from('meeting_notes')
          .select('id')
          .eq('otter_id', `plaud_${meeting.gmail_message_id}`)
          .maybeSingle()

        if (existing) continue

        // ── Cross-reference calendar to get real attendees + start_time ──
        // Match on keyword overlap between Plaud title and calendar event title
        let calendarMatch = null
        const plaudKeywords = (meeting.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 4)

        for (const event of (todayCalendarEvents || [])) {
          const eventTitle = (event.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '')
          const overlap = plaudKeywords.filter(w => eventTitle.includes(w)).length
          // Require 2+ keyword matches — avoids false positives on generic words
          if (overlap >= 2) {
            calendarMatch = event
            break
          }
        }

        // Build participant roster from calendar attendees
        // Format is mixed: emails ("TinneyC@claycorp.com") or names ("Bill Huie")
        let participantRoster = []
        if (calendarMatch?.attendees?.length) {
          // Resolve emails → names via contacts table where possible
          const attendeeEntries = calendarMatch.attendees
          const emails = attendeeEntries.filter(a => a.includes('@'))
          const names = attendeeEntries.filter(a => !a.includes('@'))

          // Look up names for email entries
          if (emails.length > 0) {
            const { data: contacts } = await supabase
              .from('contacts')
              .select('name, email')
              .in('email', emails.map(e => e.toLowerCase()))
            const emailToName = {}
            for (const c of (contacts || [])) {
              emailToName[c.email.toLowerCase()] = c.name
            }
            for (const email of emails) {
              const name = emailToName[email.toLowerCase()]
              participantRoster.push(name || email)
            }
          }
          participantRoster = [...participantRoster, ...names]
          console.log(`  ✓ Calendar match for "${meeting.title}": ${participantRoster.length} attendees from "${calendarMatch.title}"`)
        } else {
          console.log(`  ℹ No calendar match for "${meeting.title}" on ${meeting.date}`)
        }

        // Map Plaud fields → meeting_notes schema
        const actionItemsRaw = [
          ...(meeting.ryan_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: 'Ryan Hankins',
            assignee_email: 'hankinsr@claycorp.com'
          })),
          ...(meeting.others_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: i.assignee || 'Unknown',
            assignee_email: null
          })),
          ...(meeting.unattributed_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: null,
            assignee_email: null
          }))
        ]

        // Use real start_time from calendar if matched, otherwise default to noon
        const startTime = calendarMatch?.start_time || `${meeting.date}T12:00:00Z`

        await supabase.from('meeting_notes').insert({
          otter_id:               `plaud_${meeting.gmail_message_id}`,
          title:                  meeting.title,
          start_time:             startTime,
          short_summary:          meeting.summary || '',
          full_transcript:        meeting.transcript_text || null,
          action_items_raw:       actionItemsRaw,
          participants:           participantRoster,
          source:                 'plaud',
          intelligence_extracted: false,
          commitments_extracted:  false
        })
        plaudMeetingsLoaded++
      }
      console.log(`  ✓ Plaud: ${plaudMeetingsLoaded} meetings loaded into meeting_notes`)
    } else {
      console.log(`  ℹ Plaud storage: no report for ${today} (status ${plaudRes.status})`)
    }
  } catch (err) {
    // Non-fatal — pipeline continues without Plaud data
    console.log(`  ⚠ Plaud load error: ${err.message}`)
  }

  // ── STEP 2.5: Load existing items as AI dedup context ──────────
  // Loaded once here — available to both email (STEP 4/5) and future Otter extraction
  let existingTasksContext = ''
  let existingOthersContext = ''
  let existingMineContext = ''
  try {
    const { data: openTasks } = await supabase
      .from('tasks')
      .select('title, context, urgency')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openTasks?.length) {
      existingTasksContext = openTasks
        .map(t => `- ${t.title}${t.context ? ` (${t.context.slice(0, 60)})` : ''}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  try {
    const { data: openOthers } = await supabase
      .from('others_commitments')
      .select('title, committed_by_name')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openOthers?.length) {
      existingOthersContext = openOthers
        .map(c => `- ${c.committed_by_name || 'Unknown'}: ${c.title}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  try {
    const { data: openMine } = await supabase
      .from('commitments')
      .select('title, made_to')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openMine?.length) {
      existingMineContext = openMine
        .map(c => `- ${c.title}${c.made_to ? ` (to: ${c.made_to})` : ''}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  console.log(`  ✓ Context loaded: ${existingTasksContext.split('\n').filter(Boolean).length} tasks, ${existingOthersContext.split('\n').filter(Boolean).length} others, ${existingMineContext.split('\n').filter(Boolean).length} mine`)

  // ── Build meeting context for email analysis ──────────────────
  // Inject recent meeting summaries so email intelligence knows what
  // was discussed verbally — connects email threads to meeting decisions
  let meetingContext = ''
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: recentMeetingNotes } = await supabase
      .from('meeting_notes')
      .select('title, start_time, short_summary, action_items_raw, participants, source')
      .gte('start_time', sevenDaysAgo.toISOString())
      .order('start_time', { ascending: false })
      .limit(10)

    if (recentMeetingNotes?.length) {
      meetingContext = recentMeetingNotes.map(m => {
        const date = m.start_time?.split('T')[0] || 'unknown date'
        const source = m.source === 'plaud' ? 'Plaud' : 'Otter'
        const summary = (m.short_summary || '').slice(0, 400)
        const participants = (m.participants || []).slice(0, 8).join(', ')

        // Format action items — show assignee + task so AI can connect email follow-ups
        const actionItems = (m.action_items_raw || [])
          .slice(0, 12)
          .map(a => {
            const who = a.assignee_name || 'Unassigned'
            return `  - ${who}: ${a.task_text}`
          })
          .join('\n')

        let block = `[${date} — ${m.title} (${source})]`
        if (participants) block += `\nAttendees: ${participants}`
        block += `\nSummary: ${summary}`
        if (actionItems) block += `\nAction items:\n${actionItems}`
        return block
      }).join('\n\n')
      console.log(`  ✓ Meeting context: ${recentMeetingNotes.length} meetings from last 7 days`)
    }
  } catch (err) {
    console.log(`  ⚠ Meeting context load error: ${err.message}`)
  }

  // ── STEP 3: Summarize threads ───────────────────────────────────
  console.log('Step 3: Summarizing threads...')
  for (const email of (activeEmails || [])) {
    try {
      // Detect links
      const links = detectLinks(
        email.full_thread_content || email.body_preview || ''
      )

      const summary = await aiService.summarizeThread(email)

      await supabase
        .from('emails')
        .update({
          ai_summary: summary,
          links_detected: links
        })
        .eq('id', email.id)

      results.threads_summarized++

      // Log response pattern
      await supabase.from('pattern_log').insert({
        pattern_type: 'email_thread_processed',
        text_value: email.thread_subject,
        context: `bucket:${email.bucket} urgency:${email.urgency}`,
        subject_type: 'contact',
        date: today,
        metadata: {
          from_address: email.from_address,
          days_waiting: email.days_waiting,
          links_found: links.length
        }
      })
    } catch (err) {
      results.errors.push(`Summarize ${email.thread_subject}: ${err.message}`)
      console.log(`  ✗ Summarize error: ${err.message}`)
    }
  }
  console.log(`  ✓ Summarized ${results.threads_summarized} threads`)

  // ── STEP 3.5: Intelligence extraction ──────────────────────────
  console.log('Step 3.5: Extracting intelligence...')

  // Track topic clusters for unlinked intel
  const unlinkedClusters = {}

  for (const email of (activeEmails || [])) {
    try {
      const threadHistory = await getThreadHistory(email)
      const intel = await aiService.extractIntelligence(email, threadHistory, meetingContext)

      let projectId = email.project_id ||
        await findProjectByKeywords(email.thread_subject)

      if (projectId) {
        // Load current project data
        const { data: project } = await supabase
          .from('projects')
          .select('id, intelligence_notes, decisions_made, risk_signals, key_facts')
          .eq('id', projectId)
          .single()

        if (project) {
          const newNotes = [
            ...intel.technical_facts.map(f => ({
              ...f, type: 'technical', source: email.thread_subject, date: today
            })),
            ...intel.financial_signals.map(f => ({
              ...f, type: 'financial', source: email.thread_subject, date: today
            })),
            ...intel.schedule_signals.map(s => ({
              ...s, type: 'schedule', source: email.thread_subject, date: today
            })),
            ...intel.scope_signals.map(s => ({
              ...s, type: 'scope', source: email.thread_subject, date: today
            })),
            ...intel.implicit_commitments.map(c => ({
              ...c, type: 'implicit_commitment', source: email.thread_subject, date: today
            }))
          ]

          const qualifyingRisks = intel.risk_signals
            .filter(r =>
              r.involves_key_contact &&
              r.involves_active_project &&
              r.severity !== 'low'
            )
            .map(r => ({
              ...r, source: email.thread_subject, date: today, checked_off: false
            }))

          // Update project card
          await supabase
            .from('projects')
            .update({
              intelligence_notes: [
                ...(project.intelligence_notes || []),
                ...newNotes
              ].slice(-50),
              decisions_made: [
                ...(project.decisions_made || []),
                ...intel.decisions_made.map(d => ({
                  ...d, source: email.thread_subject, date: today
                }))
              ],
              risk_signals: [
                ...(project.risk_signals || []),
                ...qualifyingRisks
              ].slice(-20),
              key_facts: [
                ...(project.key_facts || []),
                ...intel.key_facts.map(f => ({
                  ...f, source: email.thread_subject, date: today
                }))
              ].slice(-30)
            })
            .eq('id', projectId)

          results.intelligence_notes_added += newNotes.length
          results.risk_signals_detected += qualifyingRisks.length

          // Log decisions to decisions table
          for (const d of intel.decisions_made) {
            const { data: existD } = await supabase
              .from('decisions')
              .select('id')
              .eq('title', d.decision)
              .eq('project_id', projectId)
              .maybeSingle()

            if (!existD) {
              await supabase.from('decisions').insert({
                title: d.decision,
                what_was_decided: d.decision,
                who_was_present: d.all_parties?.join(', '),
                decided_on: d.date || today,
                project_id: projectId,
                decision_maker: d.decided_by,
                all_parties: d.all_parties || [],
                source_type: 'ai_email',
                source_id: email.id,
                status: 'made'
              })
              results.decisions_logged++
            }
          }

          // Log pending decisions
          for (const p of intel.pending_decisions) {
            const { data: existP } = await supabase
              .from('pending_decisions')
              .select('id')
              .eq('title', p.decision)
              .eq('status', 'open')
              .maybeSingle()

            if (!existP) {
              await supabase.from('pending_decisions').insert({
                title: p.decision,
                context: p.decision,
                blocking: p.blocking,
                due_date: p.due_date,
                urgency: p.urgency || 'medium',
                project_id: projectId,
                source_type: 'ai_email',
                source_id: email.id,
                status: 'open'
              })
              results.pending_decisions_created++
            }
          }
        }
      } else {
        // No project match — store as unlinked
        const intelItems = [
          ...intel.technical_facts,
          ...intel.financial_signals,
          ...intel.key_facts,
          ...intel.decisions_made
        ]

        if (intelItems.length > 0) {
          // Extract topic from subject
          const topic = (email.thread_subject || '')
            .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
            .split(' ')
            .slice(0, 3)
            .join(' ')

          // Track clusters
          if (!unlinkedClusters[topic]) {
            unlinkedClusters[topic] = []
          }
          unlinkedClusters[topic].push(email)

          await supabase.from('unlinked_intelligence').insert({
            content: JSON.stringify(intelItems),
            intelligence_type: 'mixed',
            source_email_id: email.id,
            suggested_project: topic,
            status: 'unreviewed'
          })
        }
      }

      // Log relationship signals
      for (const s of intel.relationship_signals) {
        await supabase.from('pattern_log').insert({
          pattern_type: 'relationship_signal',
          text_value: s.signal,
          context: `${s.person}: ${s.type}`,
          subject_type: 'contact',
          date: today,
          metadata: {
            person: s.person,
            signal_type: s.type,
            evidence: s.evidence,
            source: email.thread_subject
          }
        })
      }
    } catch (err) {
      results.errors.push(`Intel ${email.thread_subject}: ${err.message}`)
    }
  }

  // Check for topic clusters suggesting new projects
  for (const [topic, emails] of Object.entries(unlinkedClusters)) {
    if (emails.length >= 3) {
      const { data: existingSuggestion } = await supabase
        .from('suggested_projects')
        .select('id')
        .ilike('name', `%${topic}%`)
        .eq('status', 'pending')
        .maybeSingle()

      if (!existingSuggestion) {
        await supabase.from('suggested_projects').insert({
          name: topic,
          email_count: emails.length,
          key_contacts: emails.map(e => ({
            name: e.from_name,
            email: e.from_address
          })),
          summary: `${emails.length} emails found about "${topic}" with no matching project card.`,
          sample_emails: emails.slice(0, 3).map(e => ({
            subject: e.thread_subject,
            from: e.from_name
          })),
          status: 'pending'
        })

        await logAIQuestion(
          `I found ${emails.length} emails about "${topic}" that don't match any existing project. Should I create a project card?`,
          `Emails: ${emails.map(e => e.thread_subject).join(', ')}`,
          'binary'
        )
        results.questions_logged++
      }
    }
  }

  console.log(
    `  ✓ Intelligence: ${results.intelligence_notes_added} notes, ` +
    `${results.decisions_logged} decisions, ` +
    `${results.pending_decisions_created} pending, ` +
    `${results.risk_signals_detected} risks`
  )

  // ── STEP 3.6b: Auto-expand project keywords ────────────────────
  console.log('Step 3.6b: Learning project keywords...')
  try {
    const { data: activeProjects } = await supabase
      .from('projects')
      .select('id, name, keywords')
      .eq('status', 'active')

    for (const project of (activeProjects || [])) {
      // Find emails linked to this project
      const { data: linkedEmails } = await supabase
        .from('emails')
        .select('thread_subject, from_name, from_address')
        .eq('project_id', project.id)
        .limit(20)

      if (!linkedEmails?.length) continue

      // Extract candidate keywords from thread subjects and sender names
      const candidates = new Map()

      for (const email of linkedEmails) {
        // Words from thread subject
        const words = (email.thread_subject || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 3)
          .filter(w => ![
            'from', 'with', 'this', 'that',
            'have', 'will', 'your', 'been',
            'more', 'week', 'next', 'last',
            'meet', 'call', 'zoom', 'team',
            'fwd', 'reply', 'over', 'about'
          ].includes(w))

        for (const word of words) {
          candidates.set(word, (candidates.get(word) || 0) + 1)
        }

        // Last name of sender as keyword (weighted higher)
        const nameParts = (email.from_name || '').split(' ')
        const lastName  = nameParts[nameParts.length - 1]?.toLowerCase()
        if (lastName && lastName.length > 3) {
          candidates.set(lastName, (candidates.get(lastName) || 0) + 2)
        }
      }

      // Keywords appearing 3+ times are strong candidates
      const currentKeywords = new Set(
        (project.keywords || []).map(k => k.toLowerCase())
      )

      const newKeywords = []
      for (const [word, count] of candidates) {
        if (count >= 3 && !currentKeywords.has(word)) {
          newKeywords.push(word)
        }
      }

      if (newKeywords.length > 0) {
        const updatedKeywords = [...(project.keywords || []), ...newKeywords]
        await supabase
          .from('projects')
          .update({ keywords: updatedKeywords })
          .eq('id', project.id)

        console.log(`  ${project.name}: added keywords ${newKeywords.join(', ')}`)
      }
    }
  } catch (err) {
    // Non-fatal
    console.log(`  Keyword learning error: ${err.message}`)
  }

  // ── STEP 3.6: Auto-create contacts (with deduplication) ────────
  console.log('Step 3.6: Updating contacts...')
  for (const email of (activeEmails || [])) {
    try {
      if (!email.from_address || !email.from_name) continue
      if (email.from_address === 'hankinsr@claycorp.com') continue

      // Priority 1: exact email match
      const { data: byEmail } = await supabase
        .from('contacts')
        .select('id, email, secondary_email')
        .eq('email', email.from_address)
        .maybeSingle()

      if (byEmail) {
        // Exact match — just update recency
        await supabase
          .from('contacts')
          .update({ last_contact_date: today, last_topic: email.thread_subject })
          .eq('id', byEmail.id)
        results.contacts_updated++
        continue
      }

      // Priority 2: name + domain match (same person, different address)
      const domain = email.from_address.split('@')[1] || ''
      const firstName = email.from_name.trim().split(/\s+/)[0]
      const { data: byNameDomain } = firstName.length > 2
        ? await supabase
            .from('contacts')
            .select('id, email, secondary_email')
            .ilike('name', `%${firstName}%`)
            .ilike('email', `%${domain}%`)
            .maybeSingle()
        : { data: null }

      if (byNameDomain) {
        // Same person, different address — add as secondary, update recency
        const updates = {
          last_contact_date: today,
          last_topic: email.thread_subject
        }
        if (!byNameDomain.secondary_email &&
            byNameDomain.email !== email.from_address) {
          updates.secondary_email = email.from_address
        }
        await supabase.from('contacts').update(updates).eq('id', byNameDomain.id)
        results.contacts_updated++
        continue
      }

      // Priority 3: exact name match across any domain
      // Catches same person with completely different email addresses (e.g. work vs personal)
      const nameParts = email.from_name.trim().split(/\s+/)
      const firstN    = nameParts[0]
      const lastN     = nameParts[nameParts.length - 1]
      if (firstN && lastN && firstN !== lastN) {
        const { data: byNameOnly } = await supabase
          .from('contacts')
          .select('id, email, secondary_email')
          .ilike('name', email.from_name.trim())
          .neq('email', email.from_address)
          .maybeSingle()

        if (byNameOnly) {
          // Same name, different email — store as secondary
          if (!byNameOnly.secondary_email) {
            await supabase
              .from('contacts')
              .update({ secondary_email: email.from_address })
              .eq('id', byNameOnly.id)
          }
          // Update recency regardless
          await supabase
            .from('contacts')
            .update({ last_contact_date: today, last_topic: email.thread_subject })
            .eq('id', byNameOnly.id)
          results.contacts_updated++
          continue
        }
      }

      // Priority 4: no match — create new
      const company = domain && !['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud'].includes(domain.split('.')[0])
        ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
        : null

      await supabase.from('contacts').insert({
        name: email.from_name,
        email: email.from_address,
        company: company,
        last_contact_date: today,
        last_topic: email.thread_subject,
        relationship_warmth: email.is_internal ? 'warm' : 'cool',
        notes: `Auto-created from: ${email.thread_subject}`
      })
      results.contacts_created++

    } catch (err) {
      // Non-fatal
    }
  }
  console.log(`  ✓ Contacts: ${results.contacts_created} created, ${results.contacts_updated} updated`)

  // ── STEP 3.7: Enrich contacts from email signatures ─────────────
  // Targets contacts that need enrichment — not just active email senders.
  // Includes: never enriched, missing key fields, or enriched > 30 days ago.
  console.log('Step 3.7: Enriching contacts from signatures...')
  let contactsEnriched = 0

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: contactsToEnrich } = await supabase
    .from('contacts')
    .select('*')
    .or(
      'enriched.is.null,' +
      'enriched.eq.false,' +
      'title.is.null,' +
      'phone_mobile.is.null,' +
      `enriched_at.lt.${thirtyDaysAgo.toISOString()}`
    )
    .limit(20)

  for (const contact of (contactsToEnrich || [])) {
    try {
      if (!contact.email) continue
      if (contact.email === 'hankinsr@claycorp.com') continue

      // Find their most recent emails regardless of bucket
      const { data: recentEmails } = await supabase
        .from('emails')
        .select('full_thread_content, body_preview, from_name, received_at')
        .eq('from_address', contact.email)
        .order('received_at', { ascending: false })
        .limit(3)

      if (!recentEmails?.length) continue

      // Use best available content — prefer full_thread_content
      const bestEmail = recentEmails.find(e => e.full_thread_content) || recentEmails[0]
      const content   = bestEmail.full_thread_content || bestEmail.body_preview

      if (!content || content.length < 100) continue

      const extracted = await aiService.extractContactFromSignature(
        content,
        contact.name,
        contact.email
      )

      if (!extracted || extracted.confidence === 'low') continue

      // Build updates — never overwrite existing good data
      const updates = {}

      // Title: set if empty
      if (extracted.title && !contact.title) {
        updates.title = extracted.title
      }

      // Company: set if empty; detect job change
      if (extracted.company) {
        if (!contact.company) {
          updates.company = extracted.company
        } else if (
          extracted.company.toLowerCase() !== contact.company.toLowerCase()
        ) {
          updates.company_pending    = extracted.company
          updates.job_change_detected = true

          await logAIQuestion(
            `${contact.name} may have changed jobs. Currently listed at ` +
            `"${contact.company}" but their recent email signature shows ` +
            `"${extracted.company}". Update their profile?`,
            `Source: recent email signature`,
            'binary'
          )
        }
      }

      // Phones — additive only
      if (extracted.phone_mobile) {
        if (!contact.phone_mobile) {
          updates.phone_mobile = extracted.phone_mobile
        } else if (
          contact.phone_mobile !== extracted.phone_mobile &&
          !contact.phone_mobile_2
        ) {
          updates.phone_mobile_2 = extracted.phone_mobile
        }
      }

      if (extracted.phone_office) {
        if (!contact.phone_office) {
          updates.phone_office = extracted.phone_office
        } else if (
          contact.phone_office !== extracted.phone_office &&
          !contact.phone_office_2
        ) {
          updates.phone_office_2 = extracted.phone_office
        }
      }

      if (extracted.linkedin && !contact.linkedin) updates.linkedin = extracted.linkedin
      if (extracted.address  && !contact.address)  updates.address  = extracted.address

      updates.enriched    = true
      updates.enriched_at = new Date().toISOString()

      if (Object.keys(updates).length > 2) { // more than just enriched + enriched_at
        await supabase.from('contacts').update(updates).eq('id', contact.id)
        contactsEnriched++
      }

    } catch (err) {
      // Non-fatal
      console.log(`  ⚠️  Enrich error for ${contact.email}: ${err.message}`)
    }
  }
  console.log(`  ✓ Enriched ${contactsEnriched} contacts from signatures`)

  // ── STEP 2.6: Process meeting transcripts (Otter + Plaud) ───────
  console.log('Step 2.6: Processing meeting intelligence (Otter + Plaud)...')
  try {
    const { data: unprocessedMeetings } = await supabase
      .from('meeting_notes')
      .select('*')
      .eq('intelligence_extracted', false)
      .order('start_time', { ascending: false })
      .limit(10)

    for (const meeting of (unprocessedMeetings || [])) {
      try {
        // PASS 1: Process metadata action items
        const actionItems = meeting.action_items_raw || []

        for (const item of actionItems) {
          const isRyan = item.assignee_email === 'hankinsr@claycorp.com'
          const projectId = await findProjectByKeywords(
            (meeting.title || '') + ' ' + (meeting.short_summary || '')
          )

          const meetingSource = meeting.source === 'plaud' ? 'plaud' : 'otter'
        const meetingSourceType = meeting.source === 'plaud' ? 'ai_plaud' : 'ai_otter'

        if (isRyan) {
            const { data: existing } = await supabase
              .from('tasks')
              .select('id')
              .eq('title', item.task_text)
              .eq('status', 'open')
              .maybeSingle()

            if (!existing) {
              await supabase.from('tasks').insert({
                title:            item.task_text,
                context:          `Action item from: ${meeting.title || 'Meeting'}`,
                status:           'open',
                source:           meetingSource,
                source_type:      meetingSourceType,
                source_label:     meeting.title || 'Meeting',
                source_date:      today,
                ai_enriched:      true,
                source_confidence: 0.9,
                project_id:       projectId || null
              })
              results.otter_tasks_created++
            }
          } else {
            const { data: existing } = await supabase
              .from('others_commitments')
              .select('id')
              .eq('title', item.task_text)
              .eq('status', 'open')
              .maybeSingle()

            if (!existing) {
              const { data: contact } = await supabase
                .from('contacts')
                .select('id, email')
                .ilike('name', `%${item.assignee_name}%`)
                .maybeSingle()

              await supabase.from('others_commitments').insert({
                committed_by_name:  item.assignee_name,
                committed_by_email: item.assignee_email || contact?.email || null,
                title:        item.task_text,
                context:      `Action item from meeting: ${meeting.title || 'Meeting'}`,
                source_type:  meetingSourceType,
                source_id:    meeting.id,
                source_label: meeting.title || 'Meeting',
                status:       'open',
                project_id:   projectId || null,
                urgency:      'medium'
              })
              results.otter_others_created++
            }
          }
        }

        // PASS 2: Full transcript extraction (skip all-hands)
        const participantCount = (meeting.participants || []).length
        const isAllHands = participantCount > 30 ||
          ['all hands', 'all-hands', 'operations mtg', 'company update'].some(phrase =>
            (meeting.title || '').toLowerCase().includes(phrase)
          )

        if (meeting.full_transcript && !isAllHands) {
          const attendeeRoster = meeting.participants || []

          const keywords = ((meeting.title || '') + ' ' + (meeting.short_summary || ''))
            .toLowerCase()
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 5)

          const { data: relatedEmails } = await supabase
            .from('emails')
            .select('thread_subject, from_name, ai_summary, body_preview, received_at')
            .or(keywords.map(k => `thread_subject.ilike.%${k}%`).join(','))
            .limit(5)

          const intel = await aiService.extractIntelligenceFromTranscript(
            meeting,
            attendeeRoster,
            relatedEmails || []
          )

          if (intel) {
            const projectId = await findProjectByKeywords(
              (meeting.title || '') + ' ' + (meeting.short_summary || '')
            )

            if (projectId) {
              const { data: project } = await supabase
                .from('projects')
                .select('intelligence_notes, decisions_made, risk_signals, key_facts')
                .eq('id', projectId)
                .single()

              if (project) {
                const newNotes = [
                  ...(intel.technical_facts || []).map(f => ({
                    ...f, type: 'technical', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.financial_signals || []).map(f => ({
                    ...f, type: 'financial', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.schedule_signals || []).map(s => ({
                    ...s, type: 'schedule', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.scope_signals || []).map(s => ({
                    ...s, type: 'scope', source: meeting.title, source_type: meetingSource, date: today
                  }))
                ]

                await supabase
                  .from('projects')
                  .update({
                    intelligence_notes: [
                      ...(project.intelligence_notes || []),
                      ...newNotes
                    ].slice(-50),
                    decisions_made: [
                      ...(project.decisions_made || []),
                      ...(intel.decisions_made || []).map(d => ({
                        ...d, source: meeting.title, source_type: 'otter', date: today
                      }))
                    ],
                    key_facts: [
                      ...(project.key_facts || []),
                      ...(intel.key_facts || []).map(f => ({
                        ...f, source: meeting.title, source_type: 'otter', date: today
                      }))
                    ].slice(-30)
                  })
                  .eq('id', projectId)

                // Log decisions
                for (const d of (intel.decisions_made || [])) {
                  const { data: existD } = await supabase
                    .from('decisions')
                    .select('id')
                    .eq('title', d.decision)
                    .eq('project_id', projectId)
                    .maybeSingle()

                  if (!existD) {
                    await supabase.from('decisions').insert({
                      title:           d.decision,
                      what_was_decided: d.decision,
                      who_was_present: d.all_parties?.join(', '),
                      decided_on:      today,
                      project_id:      projectId,
                      source_type:     'ai_otter',
                      source_id:       meeting.id,
                      status:          'made'
                    })
                    results.decisions_logged++
                  }
                }

                // Log pending decisions
                for (const p of (intel.pending_decisions || [])) {
                  const { data: existP } = await supabase
                    .from('pending_decisions')
                    .select('id')
                    .eq('title', p.decision)
                    .eq('status', 'open')
                    .maybeSingle()

                  if (!existP) {
                    await supabase.from('pending_decisions').insert({
                      title:       p.decision,
                      context:     p.decision,
                      blocking:    p.blocking,
                      due_date:    p.due_date,
                      urgency:     p.urgency || 'medium',
                      project_id:  projectId,
                      source_type: 'ai_otter',
                      source_id:   meeting.id,
                      status:      'open'
                    })
                    results.pending_decisions_created++
                  }
                }
              }
            }

            // Speaker attributions
            for (const sa of (intel.speaker_attributions || [])) {
              const { data: contact } = await supabase
                .from('contacts')
                .select('id')
                .ilike('name', `%${sa.likely_person}%`)
                .maybeSingle()

              await supabase.from('speaker_attributions').insert({
                meeting_id:               meeting.id,
                speaker_label:            sa.speaker_label,
                attributed_to_name:       sa.likely_person,
                attributed_to_contact_id: contact?.id || null,
                confidence:               sa.confidence,
                attribution_basis:        [sa.basis]
              })

              // Update last_contact_date for high-confidence attendees
              if (sa.confidence === 'high' && sa.likely_person && contact) {
                await supabase
                  .from('contacts')
                  .update({
                    last_contact_date: meeting.start_time?.split('T')[0] || today
                  })
                  .eq('id', contact.id)
              }
            }

            // Ryan's verbal commitments
            for (const c of (intel.verbal_commitments_ryan || [])) {
              const { data: existing } = await supabase
                .from('commitments')
                .select('id')
                .eq('title', c.title)
                .eq('status', 'open')
                .maybeSingle()

              if (!existing) {
                await supabase.from('commitments').insert({
                  title:           c.title,
                  made_to:         c.made_to,
                  urgency:         c.urgency,
                  due_date:        c.due_date,
                  status:          'open',
                  source_type:     'ai_otter',
                  commitment_type: c.commitment_type || 'hard',
                  implicit:        false,
                  made_on:         today
                })
                results.otter_my_commitments++
              }
            }

            // Others' verbal commitments
            for (const c of (intel.verbal_commitments_others || [])) {
              const { data: existing } = await supabase
                .from('others_commitments')
                .select('id')
                .eq('title', c.title)
                .eq('status', 'open')
                .maybeSingle()

              if (!existing) {
                await supabase.from('others_commitments').insert({
                  committed_by_name:  c.committed_by_name,
                  committed_by_email: c.committed_by_email || null,
                  title:        c.title,
                  context:      `Verbal commitment in: ${meeting.title}`,
                  due_date:     c.due_date,
                  urgency:      c.urgency,
                  source_type:  'ai_otter',
                  source_id:    meeting.id,
                  source_label: meeting.title,
                  status:       'open'
                })
                results.otter_others_created++
              }
            }
          }
        } else if (isAllHands) {
          console.log(`  Skipping full extraction for all-hands: ${meeting.title}`)
        }

        // Mark meeting as processed
        await supabase
          .from('meeting_notes')
          .update({
            intelligence_extracted: true,
            commitments_extracted:  true,
            extraction_date:        today
          })
          .eq('id', meeting.id)

        results.otter_meetings_processed++
      } catch (err) {
        results.errors.push(`Otter ${meeting.otter_id}: ${err.message}`)
      }
    }

    console.log(
      `  ✓ Otter: ${results.otter_meetings_processed} meetings, ` +
      `${results.otter_tasks_created} tasks, ` +
      `${results.otter_my_commitments} my commitments, ` +
      `${results.otter_others_created} others`
    )
  } catch (err) {
    results.errors.push(`Otter processing: ${err.message}`)
    console.log(`  ✗ Otter error: ${err.message}`)
  }

  // ── STEP 4: Extract tasks ───────────────────────────────────────
  console.log('Step 4: Extracting tasks...')
  const bucket1 = (activeEmails || []).filter(e => e.bucket === 1)

  for (const email of bucket1) {
    try {
      const threadHistory = await getThreadHistory(email)
      const tasks = await aiService.extractTasks(email, threadHistory, existingTasksContext)

      for (const task of tasks) {
        // Level 1: exact title match
        const { data: exactTask } = await supabase
          .from('tasks')
          .select('id, source_type')
          .eq('title', task.title)
          .eq('status', 'open')
          .maybeSingle()

        let existing = exactTask

        // Level 2: semantic similarity (keyword overlap)
        if (!existing) {
          const keyWords = task.title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 4)

          if (keyWords.length >= 2) {
            const { data: candidates } = await supabase
              .from('tasks')
              .select('id, title, source_type')
              .eq('status', 'open')
              .ilike('title', `%${keyWords[0]}%`)

            for (const candidate of (candidates || [])) {
              const candidateWords = candidate.title
                .toLowerCase().split(' ')
                .filter(w => w.length > 4)
              const overlap = keyWords.filter(w =>
                candidateWords.some(cw => cw.includes(w) || w.includes(cw))
              ).length

              if (overlap >= 3) {
                existing = candidate
                break
              }
            }
          }
        }

        if (!existing) {
          const projectId = await findProjectByKeywords(email.thread_subject)

          await supabase.from('tasks').insert({
            ...task,
            status: 'open',
            source: 'email',
            source_type: 'ai_email',
            source_label: email.thread_subject,
            source_date: today,
            ai_enriched: true,
            source_confidence: 0.85,
            project_id: projectId || null
          })
          results.tasks_created++
        } else if (existing.source_type && existing.source_type !== 'ai_email') {
          // CHANGE 5: Cross-source enrichment — same task seen from a different source
          // Patch cross_references on existing item instead of silently skipping
          try {
            const { data: fullTask } = await supabase
              .from('tasks')
              .select('cross_references')
              .eq('id', existing.id)
              .single()
            const crossRefs = fullTask?.cross_references || []
            const alreadyCrossReferenced = crossRefs.some(
              r => r.source_label === email.thread_subject
            )
            if (!alreadyCrossReferenced) {
              crossRefs.push({
                source_type: 'ai_email',
                source_label: email.thread_subject,
                date: today
              })
              await supabase
                .from('tasks')
                .update({ cross_references: crossRefs })
                .eq('id', existing.id)
            }
          } catch (err) { /* non-fatal */ }
        }
      }
    } catch (err) {
      results.errors.push(`Tasks: ${err.message}`)
    }
  }
  console.log(`  ✓ Tasks: ${results.tasks_created} created`)

  // ── STEP 5: Extract commitments ─────────────────────────────────
  console.log('Step 5: Extracting commitments...')
  for (const email of (activeEmails || [])) {
    try {
      const threadHistory = await getThreadHistory(email)

      // Others' commitments
      const othersC = await aiService.extractOthersCommitments(email, threadHistory, existingOthersContext)

      for (const c of othersC) {
        // Level 1: exact match (title + email)
        const { data: exactMatch } = await supabase
          .from('others_commitments')
          .select('id, source_type')
          .eq('title', c.title)
          .eq('committed_by_email', c.committed_by_email)
          .eq('status', 'open')
          .maybeSingle()

        let existing = exactMatch

        // Level 2: semantic similarity check (same person, overlapping keywords)
        if (!existing && c.committed_by_email) {
          const keyWords = c.title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 4)

          if (keyWords.length >= 2) {
            const { data: candidates } = await supabase
              .from('others_commitments')
              .select('id, title, source_type')
              .eq('status', 'open')
              .eq('committed_by_email', c.committed_by_email)
              .ilike('title', `%${keyWords[0]}%`)

            for (const candidate of (candidates || [])) {
              const candidateWords = candidate.title
                .toLowerCase().split(' ')
                .filter(w => w.length > 4)
              const overlap = keyWords.filter(w =>
                candidateWords.some(cw => cw.includes(w) || w.includes(cw))
              ).length

              if (overlap >= 3) {
                existing = candidate
                break
              }
            }
          }
        }

        if (!existing) {
          const projectId = await findProjectByKeywords(email.thread_subject)

          await supabase.from('others_commitments').insert({
            committed_by_name: c.committed_by_name,
            committed_by_email: c.committed_by_email,
            title: c.title,
            context: c.context,
            due_date: c.due_date,
            urgency: c.urgency,
            source_type: 'ai_email',
            source_id: email.id,
            source_label: email.thread_subject,
            ai_suggests_complete: c.ai_suggests_complete || false,
            fulfillment_evidence: c.fulfillment_evidence || null,
            status: 'open',
            project_id: projectId || null
          })
          results.others_commitments_extracted++
        } else if (existing && existing.source_type && existing.source_type !== 'ai_email' && !c.ai_suggests_complete) {
          // CHANGE 5: Cross-source enrichment for others_commitments
          try {
            const { data: fullC } = await supabase
              .from('others_commitments')
              .select('cross_references')
              .eq('id', existing.id)
              .single()
            const crossRefs = fullC?.cross_references || []
            const alreadyCrossReferenced = crossRefs.some(
              r => r.source_label === email.thread_subject
            )
            if (!alreadyCrossReferenced) {
              crossRefs.push({
                source_type: 'ai_email',
                source_label: email.thread_subject,
                date: today
              })
              await supabase
                .from('others_commitments')
                .update({ cross_references: crossRefs })
                .eq('id', existing.id)
            }
          } catch (err) { /* non-fatal */ }
        } else if (c.ai_suggests_complete) {
          // Suggest completion — don't auto-complete
          await supabase
            .from('others_commitments')
            .update({
              ai_suggests_complete: true,
              fulfillment_evidence: c.fulfillment_evidence,
              ai_suggestion_date: today
            })
            .eq('id', existing.id)

          // Log question for Ryan to confirm
          await logAIQuestion(
            `${c.committed_by_name} appears to have fulfilled their commitment: "${c.title}". Mark it complete?`,
            c.fulfillment_evidence || '',
            'binary'
          )
          results.questions_logged++
        }
      }

      // My commitments (from Bucket 2 sent body)
      if (email.bucket === 2) {
        const myC = await aiService.extractMyCommitments(email, threadHistory, existingMineContext)

        for (const c of myC) {
          const { data: existing } = await supabase
            .from('commitments')
            .select('id')
            .eq('title', c.title)
            .eq('status', 'open')
            .maybeSingle()

          if (!existing) {
            const projectId = await findProjectByKeywords(email.thread_subject)

            await supabase.from('commitments').insert({
              title: c.title,
              made_to: c.made_to,
              urgency: c.urgency,
              due_date: c.due_date,
              status: 'open',
              source_type: 'ai_email',
              commitment_type: c.commitment_type || 'hard',
              condition_text: c.condition_text || null,
              implicit: c.implicit || false,
              made_on: today,
              project_id: projectId || null
            })
            results.my_commitments_extracted++
          }
        }
      }
    } catch (err) {
      results.errors.push(`Commitments: ${err.message}`)
    }
  }
  console.log(
    `  ✓ Commitments: ${results.my_commitments_extracted} mine, ` +
    `${results.others_commitments_extracted} others`
  )

  // ── STEP 5.5: Cross-reference synthesis ────────────────────────
  console.log('Step 5.5: Cross-referencing sources...')
  try {
    const { data: otterItems } = await supabase
      .from('tasks')
      .select('*')
      .in('source_type', ['ai_otter', 'ai_plaud'])
      .eq('source_date', today)
      .limit(20)

    const { data: otterCommitments } = await supabase
      .from('commitments')
      .select('*')
      .in('source_type', ['ai_otter', 'ai_plaud'])
      .eq('made_on', today)
      .limit(10)

    const { data: recentEmails } = await supabase
      .from('emails')
      .select('id, thread_subject, from_name, ai_summary, body_preview, received_at')
      .in('bucket', [1, 2])
      .limit(20)

    const allOtterItems = [
      ...(otterItems || []),
      ...(otterCommitments || [])
    ]

    for (const item of allOtterItems) {
      const titleWords = (item.title || '')
        .toLowerCase()
        .split(' ')
        .filter(w => w.length > 4)
        .slice(0, 4)

      const relatedEmails = (recentEmails || []).filter(email => {
        const subject = (email.thread_subject || '').toLowerCase()
        return titleWords.some(w => subject.includes(w))
      })

      if (relatedEmails.length > 0) {
        const refs = relatedEmails.map(e => ({
          source_type:    'email',
          source_label:   e.thread_subject,
          reference_type: 'related',
          context:        e.ai_summary || e.body_preview,
          date:           e.received_at?.split('T')[0],
          confidence:     'medium'
        }))

        const table = item.made_on ? 'commitments' : 'tasks'

        await supabase
          .from(table)
          .update({ cross_references: refs })
          .eq('id', item.id)

        results.cross_refs_created += refs.length
      }
    }

    console.log(`  ✓ Cross-references: ${results.cross_refs_created}`)
  } catch (err) {
    // Non-fatal
    console.log(`  Cross-ref error: ${err.message}`)
  }

  // ── STEP 6: Enrich manual tasks ─────────────────────────────────
  console.log('Step 6: Enriching manual tasks...')
  const { data: manualTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('source_type', 'manual')
    .eq('ai_enriched', false)
    .eq('status', 'open')
    .limit(10)

  for (const task of (manualTasks || [])) {
    try {
      const keywords = task.title
        .split(' ')
        .filter(w => w.length > 4)
        .slice(0, 3)

      const { data: relatedEmails } = await supabase
        .from('emails')
        .select('thread_subject, body_preview, from_name, ai_summary')
        .or(keywords.map(k => `thread_subject.ilike.%${k}%`).join(','))
        .limit(3)

      if (relatedEmails?.length > 0) {
        const enriched = await aiService.enrichTask(task, relatedEmails)
        await supabase
          .from('tasks')
          .update({
            ai_context: enriched,
            ai_enriched: true
          })
          .eq('id', task.id)
        results.tasks_enriched++
      }
    } catch (err) {
      // Non-fatal
    }
  }
  console.log(`  ✓ Enriched ${results.tasks_enriched} tasks`)

  // ── STEP 7: Pre-meeting briefs ──────────────────────────────────
  console.log('Step 7: Pre-meeting briefs...')
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

      const stakeCheck = await aiService.detectHighStakesMeeting(
        event, relatedEmails || []
      )

      // Update event — targeted update only
      // Does not overwrite existing AI fields
      await supabase
        .from('events')
        .update({
          high_stakes: stakeCheck.high_stakes,
          stakes_reason: stakeCheck.reason,
          preparation_required: stakeCheck.preparation_required
        })
        .eq('id', event.id)

      if (stakeCheck.high_stakes) {
        results.high_stakes_meetings_detected++

        const { data: openTasks } = await supabase
          .from('tasks')
          .select('title, urgency')
          .eq('status', 'open')
          .limit(5)

        const { data: projectCtx } = await supabase
          .from('ai_context')
          .select('content')
          .eq('context_type', 'rolling_summary')
          .eq('subject_type', 'global')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const brief = await aiService.generatePreMeetingBrief(
          event,
          relatedEmails || [],
          openTasks || [],
          projectCtx?.content || null
        )
        await supabase
          .from('events')
          .update({ body: brief })
          .eq('id', event.id)
        results.pre_meeting_briefs++
      }
    } catch (err) {
      results.errors.push(`Brief ${event.title}: ${err.message}`)
    }
  }
  console.log(
    `  ✓ Briefs: ${results.pre_meeting_briefs} generated, ` +
    `${results.high_stakes_meetings_detected} high-stakes detected`
  )

  // ── STEP 8: Contact profiles ────────────────────────────────────
  console.log('Step 8: Updating contact profiles...')
  const { data: activeContacts } = await supabase
    .from('contacts')
    .select('*')
    .order('last_contact_date', { ascending: false })
    .limit(10)

  for (const contact of (activeContacts || [])) {
    try {
      const { data: interactions } = await supabase
        .from('emails')
        .select('thread_subject, days_waiting, urgency, status, ai_summary')
        .eq('from_address', contact.email)
        .order('received_at', { ascending: false })
        .limit(10)

      if (interactions?.length > 0) {
        const profile = await aiService.createContactProfile(contact, interactions)

        const { data: existing } = await supabase
          .from('ai_context')
          .select('id')
          .eq('context_type', 'contact_profile')
          .eq('subject_id', contact.id)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('ai_context')
            .update({
              content: profile,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
        } else {
          await supabase.from('ai_context').insert({
            context_type: 'contact_profile',
            subject_id: contact.id,
            subject_type: 'contact',
            content: profile,
            date: today
          })
        }
      }
    } catch (err) {
      // Non-fatal
    }
  }
  console.log('  ✓ Contact profiles updated')

  // ── STEP 9: Generate daily brief ───────────────────────────────
  console.log('Step 9: Generating daily brief...')
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
      .select('title, start_time, location, high_stakes')
      .gte('start_time', `${today}T00:00:00Z`)
      .lte('start_time', `${today}T23:59:59Z`)
      .order('start_time', { ascending: true })

    const { data: highStakesEvents } = await supabase
      .from('events')
      .select('title, start_time')
      .eq('high_stakes', true)
      .gte('start_time', `${today}T00:00:00Z`)
      .lte('start_time', `${today}T23:59:59Z`)

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
      .select('title, made_to, due_date, urgency, commitment_type')
      .eq('status', 'open')
      .limit(5)

    const { data: pendingDecisions } = await supabase
      .from('pending_decisions')
      .select('title, blocking, due_date')
      .eq('status', 'open')
      .order('due_date', { ascending: true })
      .limit(5)

    const { data: projectsWithRisks } = await supabase
      .from('projects')
      .select('name, risk_signals')
      .eq('status', 'active')

    // Load recent meeting notes for cross-source brief
    const { data: recentMeetings } = await supabase
      .from('meeting_notes')
      .select('title, start_time, short_summary')
      .order('start_time', { ascending: false })
      .limit(7)

    const riskSignalsList = (projectsWithRisks || [])
      .flatMap(p =>
        (p.risk_signals || [])
          .filter(r => !r.checked_off)
          .map(r => ({ ...r, project: p.name }))
      )
      .slice(0, 3)

    const briefContext = {
      date: today,
      meetings_today: (todayEvents || []).length,
      high_stakes_meetings: (highStakesEvents || []).length,
      calendar: (todayEvents || []).map(e => ({
        title: e.title,
        time: e.start_time,
        high_stakes: e.high_stakes || false
      })),
      critical_emails: criticalEmails || [],
      open_tasks: openTasks || [],
      open_commitments: openCommitments || [],
      overdue_others: overdueWithDays,
      pending_decisions: pendingDecisions || [],
      risk_signals: riskSignalsList,
      rolling_summary: rollingCtx?.content || null,
      recent_meetings: recentMeetings || []
    }

    const brief = await aiService.generateDailyBrief(briefContext)
    results.daily_brief = brief

    // Store brief — scheduled run type
    await supabase.from('captures').insert({
      content: brief,
      type: 'daily_brief',
      routed: true,
      routed_to: 'dashboard',
      ai_generated: true,
      run_type: 'scheduled'
    })
    console.log('  ✓ Daily brief generated')

    // Write daily digest for memory
    const digest = await aiService.generateDailyDigest({
      date: today,
      tasks_created: results.tasks_created,
      commitments_extracted: results.my_commitments_extracted,
      others_commitments: results.others_commitments_extracted,
      threads_processed: results.threads_summarized,
      decisions_logged: results.decisions_logged,
      pending_decisions: results.pending_decisions_created,
      intelligence_notes: results.intelligence_notes_added,
      risk_signals: results.risk_signals_detected,
      emails_snapshot: (criticalEmails || []).map(e =>
        `${e.from_name}: ${e.thread_subject}`
      ),
      tasks_snapshot: (openTasks || []).map(t => t.title)
    })

    await supabase.from('ai_context').insert({
      context_type: 'daily_digest',
      subject_type: 'global',
      content: digest,
      date: today
    })

    // Update rolling context on Sundays or first run
    const dayOfWeek = new Date().getDay()
    const hasRolling = !!rollingCtx?.content

    if (dayOfWeek === 0 || !hasRolling) {
      console.log('  Updating rolling context...')
      const updatedRolling = await aiService.updateRollingContext(
        rollingCtx?.content,
        digest,
        today
      )

      if (rollingCtx) {
        await supabase
          .from('ai_context')
          .update({
            content: updatedRolling,
            updated_at: new Date().toISOString()
          })
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
      console.log('  ✓ Rolling context updated')
    }
  } catch (err) {
    results.errors.push(`Daily brief: ${err.message}`)
    console.log(`  ✗ Brief error: ${err.message}`)
  }

  // ── STEP 9.5: 5-day lookahead ───────────────────────────────────
  console.log('Step 9.5: Building 5-day lookahead...')
  try {
    const fiveDaysOut = new Date()
    fiveDaysOut.setDate(fiveDaysOut.getDate() + 5)
    const fiveDaysStr = fiveDaysOut.toISOString().split('T')[0]

    const tomorrowDate = new Date()
    tomorrowDate.setDate(tomorrowDate.getDate() + 1)
    const tomorrowStrLA = tomorrowDate.toISOString().split('T')[0]

    const thirtyDaysOut = new Date()
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
    const thirtyDaysStr = thirtyDaysOut.toISOString().split('T')[0]

    const [
      upcomingHighStakes,
      upcomingTasks,
      upcomingCommitments,
      upcomingDecisions,
      longRunwayItems
    ] = await Promise.all([
      supabase.from('events').select('*')
        .eq('high_stakes', true)
        .gte('start_time', `${tomorrowStrLA}T00:00:00Z`)
        .lte('start_time', `${fiveDaysStr}T23:59:59Z`)
        .order('start_time', { ascending: true }),
      supabase.from('tasks').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr)
        .order('urgency', { ascending: false }),
      supabase.from('commitments').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr)
        .order('urgency', { ascending: false }),
      supabase.from('pending_decisions').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr),
      supabase.from('tasks').select('*')
        .eq('status', 'open')
        .gt('due_date', fiveDaysStr)
        .lte('due_date', thirtyDaysStr)
        .in('urgency', ['critical', 'high'])
        .order('due_date', { ascending: true })
        .limit(5)
    ])

    const lookaheadData = {
      generated_date: today,
      high_stakes_events: upcomingHighStakes.data || [],
      tasks_due: upcomingTasks.data || [],
      commitments_due: upcomingCommitments.data || [],
      decisions_due: upcomingDecisions.data || [],
      long_runway_items: longRunwayItems.data || [],
      date_range: {
        start: tomorrowStrLA,
        end: fiveDaysStr
      }
    }

    const { data: existingLookahead } = await supabase
      .from('ai_context')
      .select('id')
      .eq('context_type', 'lookahead')
      .eq('subject_type', 'global')
      .maybeSingle()

    if (existingLookahead) {
      await supabase
        .from('ai_context')
        .update({
          content: JSON.stringify(lookaheadData),
          date: today,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingLookahead.id)
    } else {
      await supabase.from('ai_context').insert({
        context_type: 'lookahead',
        subject_type: 'global',
        content: JSON.stringify(lookaheadData),
        date: today
      })
    }
    console.log('  ✓ 5-day lookahead updated')
  } catch (err) {
    results.errors.push(`Lookahead: ${err.message}`)
  }

  // ── STEP 10: Mark complete ──────────────────────────────────────
  console.log('Step 10: Marking complete...')
  const pendingQCount = results.questions_logged

  await supabase.from('pipeline_runs').upsert({
    run_date: today,
    ai_completed_at: new Date().toISOString(),
    status: 'complete',
    pending_questions: pendingQCount,
    error_count: results.errors.length
  }, { onConflict: 'run_date' })

  // ── FINAL REPORT ────────────────────────────────────────────────
  console.log('\n═══════════════════════════════')
  console.log('NIGHTLY AI JOB COMPLETE')
  console.log('═══════════════════════════════')
  console.log(JSON.stringify(results, null, 2))

  if (results.errors.length > 0) {
    console.log('\nErrors encountered:')
    results.errors.forEach(e => console.log(`  - ${e}`))
  }

  return results
}

// ── RUN ──────────────────────────────────────────────────────────
main()
  .then(results => {
    if (results.errors.length > 5) {
      console.log('Too many errors — exiting with code 1')
      process.exit(1)
    }
    process.exit(0)
  })
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
