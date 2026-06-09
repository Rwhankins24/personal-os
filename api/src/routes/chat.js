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
  return daysAgo(60) // default lookback
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
        .select('topic, category, context, resolution, applies_to')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(20)
        .then(r => r.data || []),

      // Meeting notes — search title + participants + summary
      supabase
        .from('meeting_notes')
        .select('title, start_time, short_summary, action_items_raw, participants, source')
        .gte('start_time', since)
        .order('start_time', { ascending: false })
        .limit(15)
        .then(r => r.data || []),

      // Emails — recent active threads
      supabase
        .from('emails')
        .select('thread_subject, from_name, from_address, ai_summary, body_preview, received_at, bucket, urgency')
        .gte('received_at', since)
        .neq('status', 'done')
        .order('received_at', { ascending: false })
        .limit(20)
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

      // Intelligence notes
      supabase
        .from('intelligence_notes')
        .select('note, category, project_id, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(r => r.data || []),

      // Upcoming events
      supabase
        .from('events')
        .select('title, start_time, attendees, body, stakes_reason, pre_meeting_notes, post_meeting_notes')
        .gte('start_time', daysAgo(7))
        .order('start_time', { ascending: false })
        .limit(10)
        .then(r => r.data || []),
    ])

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
      n => `${n.title} ${n.short_summary} ${(n.participants || []).join(' ')}`)

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
      k => `${k.topic} ${k.context} ${k.resolution} ${(k.applies_to || []).join(' ')}`)

    // ── Build context string ─────────────────────────────────────────
    const sections = []

    if (relKnowledge.length) {
      sections.push("=== RYAN'S KNOWLEDGE BASE ===")
      relKnowledge.forEach(k => {
        sections.push(`[${k.category}] ${k.topic}
Context: ${k.context?.slice(0, 300) || ''}
Resolution/Learning: ${k.resolution?.slice(0, 300) || ''}
Applies to: ${(k.applies_to || []).join(', ')}`)
      })
    }

    if (relMeetings.length) {
      sections.push('=== MEETING NOTES ===')
      relMeetings.forEach(n => {
        const items = (n.action_items_raw || []).map(a => `  • ${a.task_text || a} (${a.assignee_name || 'unassigned'})`).join('\n')
        sections.push(`[${n.start_time?.split('T')[0] || 'unknown date'}] ${n.title} (${n.source || 'recording'})
Summary: ${n.short_summary || 'no summary'}
Participants: ${(n.participants || []).slice(0, 8).join(', ')}
${items ? `Action items:\n${items}` : ''}`)
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
        sections.push(`From: ${e.from_name} <${e.from_address}>
Subject: ${e.thread_subject}
Date: ${e.received_at?.split('T')[0]}
${e.ai_summary ? `Summary: ${e.ai_summary}` : `Preview: ${e.body_preview?.slice(0, 200)}`}
Status: bucket ${e.bucket}, urgency: ${e.urgency || 'normal'}`)
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
      sections.push('=== INTELLIGENCE NOTES ===')
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
    const systemPrompt = `You are Ryan Hankins' personal chief of staff AI, embedded in his Personal OS. You have access to his live data: emails, meeting notes, tasks, commitments, contacts, and intelligence.

Ryan is a Project Executive at Clayco managing complex construction projects including Pacific Fusion, Project Solis, Gotion BESS, and others. He thinks like an owner-side integrator — systems-first, pressure-tests assumptions, hates surprises.

Answer his questions directly and concisely. When recalling specific facts (what someone said, dates, numbers), be precise and cite your source (e.g., "from the June 3 meeting" or "per Courtney's email on June 2"). If you don't have enough data to answer confidently, say so briefly and suggest where he might find it.

Keep answers tight — no fluff. If the answer is a list, use bullet points. For quick factual questions, one or two sentences is fine. For complex questions, give structured analysis.

Today's date: ${new Date().toISOString().split('T')[0]}

CURRENT DATA:
${context || 'No relevant data found for this time period.'}`.trim()

    const messages = [
      ...history.slice(-6), // keep last 3 exchanges for context
      { role: 'user', content: question }
    ]

    // ── Call Claude Haiku (fast + cheap) ─────────────────────────────
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
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
