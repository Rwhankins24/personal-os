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
      const intel = await aiService.extractIntelligence(email, threadHistory)

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

  // ── STEP 3.6: Auto-create contacts ─────────────────────────────
  console.log('Step 3.6: Updating contacts...')
  for (const email of (activeEmails || [])) {
    try {
      if (!email.from_address || !email.from_name) continue
      if (email.from_address === 'hankinsr@claycorp.com') continue

      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', email.from_address)
        .maybeSingle()

      if (!existing) {
        const domain = email.from_address.split('@')[1] || ''
        const company = domain.split('.')[0].charAt(0).toUpperCase() +
          domain.split('.')[0].slice(1)

        await supabase.from('contacts').insert({
          name: email.from_name,
          email: email.from_address,
          company: company,
          last_contact_date: today,
          last_topic: email.thread_subject,
          relationship_warmth: email.is_internal ? 'warm' : 'normal',
          notes: `Auto-created from: ${email.thread_subject}`
        })
        results.contacts_created++
      } else {
        await supabase
          .from('contacts')
          .update({
            last_contact_date: today,
            last_topic: email.thread_subject
          })
          .eq('id', existing.id)
        results.contacts_updated++
      }
    } catch (err) {
      // Non-fatal
    }
  }
  console.log(`  ✓ Contacts: ${results.contacts_created} created, ${results.contacts_updated} updated`)

  // ── STEP 4: Extract tasks ───────────────────────────────────────
  console.log('Step 4: Extracting tasks...')
  const bucket1 = (activeEmails || []).filter(e => e.bucket === 1)

  for (const email of bucket1) {
    try {
      const threadHistory = await getThreadHistory(email)
      const tasks = await aiService.extractTasks(email, threadHistory)

      for (const task of tasks) {
        const { data: existing } = await supabase
          .from('tasks')
          .select('id')
          .eq('title', task.title)
          .eq('status', 'open')
          .maybeSingle()

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
      const othersC = await aiService.extractOthersCommitments(email, threadHistory)

      for (const c of othersC) {
        const { data: existing } = await supabase
          .from('others_commitments')
          .select('id')
          .eq('title', c.title)
          .eq('committed_by_email', c.committed_by_email)
          .eq('status', 'open')
          .maybeSingle()

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
        const myC = await aiService.extractMyCommitments(email, threadHistory)

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
      rolling_summary: rollingCtx?.content || null
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
