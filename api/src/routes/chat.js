const supabase  = require('../services/supabase')
const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Keyword extraction helpers ───────────────────────────────────────────
function extractDateRange(question) {
  const q = question.toLowerCase()
  const now = new Date()
  if (q.includes('today'))         return daysAgo(1)
  if (q.includes('yesterday'))     return daysAgo(2)
  if (q.includes('last week') || q.includes('this week')) return daysAgo(7)
  if (q.includes('last month') || q.includes('this month')) return daysAgo(30)
  if (q.includes('last year'))     return daysAgo(365)
  if (q.includes('recent') || q.includes('lately')) return daysAgo(14)
  return daysAgo(180) // default lookback
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ── Main chat handler ────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { question, history = [] } = req.body
  if (!question?.trim()) return res.status(400).json({ error: 'question required' })

  try {
    const since    = extractDateRange(question)
    const qLower   = question.toLowerCase()
    const keywords = qLower.split(/\s+/).filter(w => w.length > 3)

    // ── Parallel context fetch ────────────────────────────────────────
    const [
      knowledge,
      meetingNotes,
      emails,
      contacts,
      othersCommitments,
      myCommitments,
      tasks,
      intelligenceNotes,
      events,
    ] = await Promise.all([

      // Knowledge base — always include relevant entries
      supabase
        .from('knowledge_base')
        .select('topic, category, context, resolution, our_position, client_asks, risk_level, applies_to, project_refs')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(40)
        .then(r => r.data || []),

      // Meeting notes — full summary + transcript for deep context
      // Plaud uses meeting_date; Otter uses start_time — query both
      supabase
        .from('meeting_notes')
        .select(
          'id, title, meeting_date, start_time, source, participants, ' +
          'summary, short_summary, raw_transcript, full_transcript, transcript_word_count, ' +
          'action_items, action_items_raw, has_transcript, ' +
          'continuity_context, event_title, recurring_series_key'
        )
        .or(`meeting_date.gte.${since.split('T')[0]},start_time.gte.${since}`)
        .order('meeting_date', { ascending: false, nullsFirst: false })
        .limit(20)
        .then(r => r.data || []),

      // Emails — recent active threads with enriched context
      supabase
        .from('emails')
        .select('thread_subject, from_name, from_address, ai_summary, action_needed, thread_summary, body_preview, received_at, bucket, urgency, status')
        .gte('received_at', since)
        .neq('status', 'done')
        .order('received_at', { ascending: false })
        .limit(25)
        .then(r => r.data || []),

      // Contacts — all (for name resolution)
      supabase
        .from('contacts')
        .select('name, email, title, company, phone_mobile, relationship_warmth, last_contact_date')
        .limit(300)
        .then(r => r.data || []),

      // Others' open commitments
      supabase
        .from('others_commitments')
        .select('title, committed_by_name, committed_by_email, due_date, delivery_type, urgency, context')
        .eq('status', 'open')
        .order('due_date', { ascending: true })
        .limit(30)
        .then(r => r.data || []),

      // Ryan's commitments
      supabase
        .from('commitments')
        .select('title, made_to, due_date, status, commitment_type')
        .eq('status', 'open')
        .order('due_date', { ascending: true })
        .limit(20)
        .then(r => r.data || []),

      // Open tasks
      supabase
        .from('tasks')
        .select('title, context, urgency, due_date, status, bucket')
        .eq('status', 'open')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20)
        .then(r => r.data || []),

      // Pending decisions — intelligence_notes table doesn't exist as a flat table;
      // project intelligence lives as JSONB on projects (handled separately in projectIntelSection).
      // Use this slot for pending decisions instead — high-signal context for chat.
      supabase
        .from('pending_decisions')
        .select('title, context, urgency, status, due_date, blocking, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(20)
        .then(r => (r.data || []).map(d => ({
          note: `[${d.urgency || 'medium'}${d.blocking ? '/BLOCKING' : ''}] ${d.title}${d.context ? ` — ${d.context}` : ''}${d.due_date ? ` (due ${d.due_date})` : ''}`,
          category: 'pending_decision',
          created_at: d.created_at,
        }))),

      // Upcoming events
      supabase
        .from('events')
        .select('title, start_time, attendees, body, stakes_reason, pre_meeting_notes, post_meeting_notes')
        .gte('start_time', daysAgo(7))
        .order('start_time', { ascending: false })
        .limit(10)
        .then(r => r.data || []),
    ])

    // ── Project context: load pre-computed intelligence if question matches a project ──
    let projectIntelSection = null
    try {
      const { data: allProjects } = await supabase
        .from('projects')
        .select('id, name, keywords, project_context, project_context_updated_at')
        .eq('status', 'active')
        .not('project_context', 'is', null)

      for (const proj of (allProjects || [])) {
        const projectTerms = [
          proj.name,
          ...((proj.keywords || []))
        ].filter(Boolean).map(t => t.toLowerCase())

        const matched = projectTerms.some(term =>
          keywords.some(k => term.includes(k) || k.includes(term))
        )

        if (matched && proj.project_context) {
          const updatedAt = proj.project_context_updated_at
            ? new Date(proj.project_context_updated_at).toISOString().split('T')[0]
            : 'unknown date'
          projectIntelSection = `=== PROJECT INTELLIGENCE: ${proj.name} (as of ${updatedAt}) ===\n${proj.project_context}`
          break // use first match
        }
      }
    } catch (projCtxErr) {
      // Non-fatal — proceed without project context
    }

    // ── Score and filter by relevance ────────────────────────────────
    function scoreRelevance(text, keywords) {
      if (!text) return 0
      const t = text.toLowerCase()
      return keywords.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0)
    }

    function filterRelevant(items, textFn, threshold = 0) {
      return items
        .map(item => ({ item, score: scoreRelevance(textFn(item), keywords) }))
        .sort((a, b) => b.score - a.score)
        .filter(({ score }) => score > threshold || items.length <= 5)
        .slice(0, 8)
        .map(({ item }) => item)
    }

    const relMeetings = filterRelevant(meetingNotes,
      n => `${n.title} ${n.summary} ${n.short_summary} ${(n.participants || []).join(' ')} ${(n.raw_transcript || n.full_transcript || '').slice(0, 500)}`, 0)

    const relEmails = filterRelevant(emails,
      e => `${e.thread_subject} ${e.ai_summary} ${e.from_name}`)

    const relContacts = filterRelevant(contacts,
      c => `${c.name} ${c.company} ${c.email}`, 0)

    const relOthers = filterRelevant(othersCommitments,
      c => `${c.title} ${c.committed_by_name} ${c.context}`)

    const relMine = filterRelevant(myCommitments,
      c => `${c.title} ${c.made_to}`)

    const relTasks = filterRelevant(tasks,
      t => `${t.title} ${t.context}`)

    const relIntel = filterRelevant(intelligenceNotes,
      n => `${n.note}`)

    const relEvents = filterRelevant(events,
      e => `${e.title} ${(e.attendees || []).map(a => a.name || a).join(' ')} ${e.body}`)

    const relKnowledge = filterRelevant(knowledge,
      k => `${k.topic} ${k.category} ${k.context} ${k.resolution} ${k.our_position || ''} ${k.client_asks || ''} ${(k.applies_to || []).join(' ')} ${(k.project_refs || []).join(' ')}`,
      0)

    // ── Build context string ─────────────────────────────────────────
    const sections = []

    // Project intelligence goes FIRST — pre-computed rich narrative
    if (projectIntelSection) {
      sections.push(projectIntelSection)
    }

    if (relKnowledge.length) {
      sections.push("=== RYAN'S KNOWLEDGE BASE ===")
      relKnowledge.forEach(k => {
        const isContract = k.category === 'contract_legal'
        const parts = [`[${k.category}${k.risk_level ? ` / ${k.risk_level} risk` : ''}] ${k.topic}`]
        if (k.context)       parts.push(`${isContract ? "Where's the risk" : 'Context'}: ${k.context.slice(0, 400)}`)
        if (k.our_position)  parts.push(`Our position: ${k.our_position.slice(0, 300)}`)
        if (k.client_asks)   parts.push(`Client asks for: ${k.client_asks.slice(0, 300)}`)
        if (k.resolution)    parts.push(`${isContract ? "How resolved" : 'Resolution'}: ${k.resolution.slice(0, 300)}`)
        const tags = [...(k.applies_to || []), ...(k.project_refs || [])].filter(Boolean)
        if (tags.length)     parts.push(`Applies to: ${tags.join(', ')}`)
        sections.push(parts.join('\n'))
      })
    }

    if (relMeetings.length) {
      sections.push('=== MEETING NOTES ===')
      relMeetings.forEach((n, idx) => {
        const date = n.meeting_date || n.start_time?.split('T')[0] || 'unknown date'

        // Action items — combine both formats
        const rawItems = (n.action_items_raw || [])
          .map(a => `  • ${a.task_text || a.task || a} (${a.assignee_name || a.assignee || 'unassigned'})`)
        const structItems = (n.action_items || [])
          .filter(a => typeof a === 'string' ? true : a.task || a.task_text)
          .map(a => `  • ${typeof a === 'string' ? a : (a.task_text || a.task)} (${a.assignee || 'unassigned'})`)
        const allItems = [...new Set([...rawItems, ...structItems])]

        // Full summary — use richest available
        const fullSummary = n.summary || n.short_summary || 'no summary'

        // Transcript — include for high-relevance meetings or first 2 results
        // Keyword score determines depth: high match = more transcript
        const meetingKeywordScore = keywords.reduce((s, k) => {
          const text = `${n.title} ${n.summary || ''} ${n.raw_transcript || ''}`
          return s + (text.toLowerCase().includes(k) ? 1 : 0)
        }, 0)
        // Use whichever transcript field is populated
        const transcript = n.raw_transcript || n.full_transcript || ''
        const transcriptChars = meetingKeywordScore >= 3 ? 4000 : idx < 2 ? 2000 : 0
        const transcriptSnippet = transcriptChars && transcript
          ? `\nTranscript excerpt:\n${transcript.slice(0, transcriptChars)}${transcript.length > transcriptChars ? '\n[...truncated]' : ''}`
          : ''

        sections.push(
`[${date}] ${n.title}${n.event_title && n.event_title !== n.title ? ` (calendar: ${n.event_title})` : ''} (${n.source || 'recording'})${n.has_transcript ? ' ✓ transcript' : ''}
Participants: ${(n.participants || []).slice(0, 8).join(', ') || 'unknown'}
Summary: ${fullSummary.slice(0, 800)}
${allItems.length ? `Action items:\n${allItems.join('\n')}` : ''}${transcriptSnippet}${n.continuity_context ? `\nRecurring context: ${n.continuity_context.slice(0, 400)}` : ''}`)
      })
    }

    if (relEvents.length) {
      sections.push('=== MEETINGS / CALENDAR ===')
      relEvents.forEach(e => {
        const attendees = (e.attendees || []).map(a => a.name || a.email || a).slice(0, 6).join(', ')
        sections.push(`[${e.start_time?.split('T')[0]}] ${e.title}
Attendees: ${attendees}
${e.body ? `AI brief: ${e.body.slice(0, 300)}` : ''}
${e.post_meeting_notes ? `Post-meeting notes: ${e.post_meeting_notes}` : ''}
${e.pre_meeting_notes ? `Pre-meeting notes: ${e.pre_meeting_notes}` : ''}`)
      })
    }

    if (relEmails.length) {
      sections.push('=== ACTIVE EMAIL THREADS ===')
      relEmails.forEach(e => {
        // Use richest available context — action_needed > thread_summary > ai_summary > preview
        const context = e.action_needed || e.thread_summary || e.ai_summary || e.body_preview?.slice(0, 200) || ''
        sections.push(`From: ${e.from_name || e.from_address}
Subject: ${e.thread_subject}
Date: ${e.received_at?.split('T')[0]} | Status: ${e.status} | Bucket: ${e.bucket} | Urgency: ${e.urgency || 'normal'}
${context ? `Context: ${context.slice(0, 400)}` : ''}`)
      })
    }

    if (relOthers.length) {
      sections.push('=== WAITING ON OTHERS ===')
      relOthers.forEach(c => {
        sections.push(`${c.committed_by_name} owes: ${c.title}
Type: ${c.delivery_type || 'general'} | Due: ${c.due_date || 'no date'} | Urgency: ${c.urgency || 'normal'}
${c.context ? `Context: ${c.context?.slice(0, 150)}` : ''}`)
      })
    }

    if (relMine.length) {
      sections.push("=== RYAN'S COMMITMENTS ===")
      relMine.forEach(c => {
        sections.push(`To ${c.made_to}: ${c.title}
Due: ${c.due_date || 'no date'} | Type: ${c.commitment_type || 'general'}`)
      })
    }

    if (relTasks.length) {
      sections.push('=== OPEN TASKS ===')
      relTasks.forEach(t => {
        sections.push(`[${t.urgency || 'normal'}] ${t.title}
${t.context ? `Context: ${t.context?.slice(0, 150)}` : ''}
Due: ${t.due_date || 'no date'}`)
      })
    }

    if (relIntel.length) {
      sections.push('=== PENDING DECISIONS ===')
      relIntel.forEach(n => {
        sections.push(`[${n.created_at?.split('T')[0]}] ${n.note}`)
      })
    }

    if (relContacts.slice(0, 5).length) {
      sections.push('=== RELEVANT CONTACTS ===')
      relContacts.slice(0, 5).forEach(c => {
        sections.push(`${c.name} | ${c.title || 'no title'} | ${c.company || 'no company'} | ${c.email} | Last contact: ${c.last_contact_date?.split('T')[0] || 'unknown'}`)
      })
    }

    const context = sections.join('\n\n')

    // ── Build messages ────────────────────────────────────────────────
    // ── Detect overdue patterns across tasks ─────────────────────────
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const allCurrentTasks = relTasks || []
    const overdueTasks = allCurrentTasks.filter(t =>
      t.due_date && new Date(t.due_date) < today && t.status !== 'done'
    )
    // Count how often the same person appears in blocking/waiting items
    const blockingPersonCounts = {}
    ;(relOthers || []).filter(c => c.due_date && new Date(c.due_date) < today).forEach(c => {
      if (c.committed_by_name) {
        blockingPersonCounts[c.committed_by_name] = (blockingPersonCounts[c.committed_by_name] || 0) + 1
      }
    })
    const patternAlerts = Object.entries(blockingPersonCounts)
      .filter(([, count]) => count >= 2)
      .map(([name, count]) => `${name} has ${count} overdue deliverables to Ryan`)

    const systemPrompt = `You are Ryan Hankins' personal chief of staff AI, embedded in his Personal OS. You have access to his live data: emails, meeting notes, tasks, commitments, contacts, and intelligence.

Ryan is a Project Executive at Clayco managing complex construction projects including Pacific Fusion, Project Solis, Gotion BESS, and others. He thinks like an owner-side integrator — systems-first, pressure-tests assumptions, hates surprises.

Answer his questions directly and concisely. When recalling specific facts (what someone said, dates, numbers), be precise and cite your source (e.g., "from the June 3 meeting" or "per Courtney's email on June 2"). If you don't have enough data to answer confidently, say so briefly and suggest where he might find it.

Keep answers tight — no fluff. If the answer is a list, use bullet points. For quick factual questions, one or two sentences is fine. For complex questions, give structured analysis.

IMPORTANT BEHAVIORAL RULES:
- NEVER ask Ryan why something is late or overdue. Note it as context and move on.
- Do not ask follow-up clarifying questions unless you genuinely cannot answer without them.
- When you see overdue items, identify patterns (same person, same project) and surface those as insights — don't interrogate each item.
- If a pattern is detected, state it once clearly (e.g., "3 items waiting on Bob — that's a choke point").
${patternAlerts.length > 0 ? `\nDETECTED PATTERNS:\n${patternAlerts.join('\n')}` : ''}${overdueTasks.length > 2 ? `\n${overdueTasks.length} tasks currently overdue — treat as context, not topics requiring explanation.` : ''}

Today's date: ${new Date().toISOString().split('T')[0]}

CURRENT DATA:
${context || 'No relevant data found for this time period.'}`.trim()

    const messages = [
      ...history.slice(-6), // keep last 3 exchanges for context
      { role: 'user', content: question }
    ]

    // ── Call Claude Sonnet — better reasoning + longer answers ───────
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      system:     systemPrompt,
      messages,
    })

    const answer = response.content[0]?.text || 'No response generated.'
    res.json({ answer })

  } catch (err) {
    console.error('Chat error:', err.message)
    res.status(500).json({ error: 'Chat failed', detail: err.message })
  }
}
