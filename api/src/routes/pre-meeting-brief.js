// personal-os — On-demand pre-meeting brief generator
// POST /api/pre-meeting-brief  { event_id }
// Pulls all relevant context and generates a structured brief via Claude Sonnet.
// Saves the result to events.body and returns it immediately.

const { createClient } = require('@supabase/supabase-js')
const Anthropic        = require('@anthropic-ai/sdk')

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const RYAN_EMAIL = 'hankinsr@claycorp.com'

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { event_id } = req.body || {}
  if (!event_id) return res.status(400).json({ error: 'event_id required' })

  try {
    // ── 1. Load event ─────────────────────────────────────────────
    const { data: event, error: evtErr } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .single()
    if (evtErr || !event) return res.status(404).json({ error: 'Event not found' })

    const attendeeNames  = (event.attendees || []).map(a =>
      typeof a === 'string' ? a : (a.name || a.email || '')
    ).filter(Boolean)
    const attendeeEmails = (event.attendees || []).map(a =>
      typeof a === 'string' && a.includes('@') ? a : (a.email || '')
    ).filter(Boolean)

    // ── 2. Pull context in parallel ───────────────────────────────
    const eventDate = event.start_time?.split('T')[0] || new Date().toISOString().split('T')[0]
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

    const [
      priorMeetings,
      projectData,
      openTasks,
      othersCommitments,
      myCommitments,
      recentEmails,
      pendingDecisions,
    ] = await Promise.all([

      // Prior meetings with these attendees or matching title pattern
      supabase
        .from('meeting_notes')
        .select('title, meeting_date, start_time, summary, short_summary, continuity_context, action_items_raw, participants, raw_transcript, full_transcript, has_transcript')
        .or(
          attendeeNames.slice(0, 4).map(n => `participants.cs.{"${n}"}`).join(',') ||
          `title.ilike.%${event.title?.split(' ')[0] || 'meeting'}%`
        )
        .gte('meeting_date', sixMonthsAgo)
        .order('meeting_date', { ascending: false })
        .limit(6)
        .then(r => r.data || []),

      // Project context document if available
      supabase
        .from('projects')
        .select('name, project_context, status, phase')
        .eq('status', 'active')
        .not('project_context', 'is', null)
        .limit(10)
        .then(r => r.data || []),

      // Open tasks (all — filter by relevance below)
      supabase
        .from('tasks')
        .select('title, context, urgency, due_date, source_label')
        .eq('status', 'open')
        .in('urgency', ['critical', 'high'])
        .limit(20)
        .then(r => r.data || []),

      // What attendees owe Ryan
      supabase
        .from('others_commitments')
        .select('title, committed_by_name, committed_by_email, due_date, context, delivery_type')
        .eq('status', 'open')
        .limit(30)
        .then(r => r.data || []),

      // What Ryan owes attendees
      supabase
        .from('commitments')
        .select('title, made_to, due_date, status')
        .eq('status', 'open')
        .limit(20)
        .then(r => r.data || []),

      // Recent emails from/to attendees
      supabase
        .from('emails')
        .select('thread_subject, from_name, from_address, action_needed, ai_summary, days_waiting, status, received_at')
        .neq('status', 'done')
        .gte('received_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('received_at', { ascending: false })
        .limit(50)
        .then(r => r.data || []),

      // Pending decisions
      supabase
        .from('pending_decisions')
        .select('title, context, urgency, status')
        .eq('status', 'open')
        .limit(20)
        .then(r => r.data || []),
    ])

    // ── 3. Filter context to what's relevant to this meeting ─────
    const eventKeywords = (event.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['meeting','weekly','call','with','update','review','sync'].includes(w))

    function isRelevant(text) {
      if (!text) return false
      const t = text.toLowerCase()
      return attendeeNames.some(n => t.includes(n.toLowerCase().split(' ')[0])) ||
             attendeeEmails.some(e => t.includes(e.toLowerCase().split('@')[0])) ||
             eventKeywords.some(k => t.includes(k))
    }

    const relTasks = openTasks.filter(t => isRelevant(`${t.title} ${t.context} ${t.source_label}`))
    const relOthers = othersCommitments.filter(c =>
      attendeeNames.some(n => (c.committed_by_name || '').toLowerCase().includes(n.toLowerCase().split(' ')[0])) ||
      attendeeEmails.some(e => (c.committed_by_email || '').toLowerCase().includes(e.toLowerCase()))
    )
    const relMine = myCommitments.filter(c =>
      attendeeNames.some(n => (c.made_to || '').toLowerCase().includes(n.toLowerCase().split(' ')[0]))
    )
    const relEmails = recentEmails.filter(e =>
      attendeeEmails.some(ae => (e.from_address || '').includes(ae.split('@')[0])) ||
      isRelevant(`${e.thread_subject} ${e.ai_summary} ${e.from_name}`)
    )
    const relDecisions = pendingDecisions.filter(d => isRelevant(`${d.title} ${d.context}`))

    // Find matching project context
    const matchingProject = projectData.find(p =>
      eventKeywords.some(k => p.name.toLowerCase().includes(k))
    )

    // Sort meetings — most recent first, prefer ones with transcripts
    const sortedMeetings = priorMeetings.sort((a, b) => {
      const da = a.meeting_date || a.start_time?.split('T')[0] || '0'
      const db = b.meeting_date || b.start_time?.split('T')[0] || '0'
      return db.localeCompare(da)
    })

    const latestMeeting   = sortedMeetings[0]
    const continuityNote  = sortedMeetings.find(m => m.continuity_context)?.continuity_context

    // ── 4. Build prompt ───────────────────────────────────────────
    const now = new Date(event.start_time || Date.now())
    const timeStr = now.toLocaleString('en-US', {
      timeZone: 'America/Phoenix',
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    })

    const sections = []

    if (matchingProject?.project_context) {
      sections.push(`PROJECT INTELLIGENCE (${matchingProject.name}):\n${matchingProject.project_context}`)
    }

    if (latestMeeting) {
      const transcript = latestMeeting.raw_transcript || latestMeeting.full_transcript || ''
      const date = latestMeeting.meeting_date || latestMeeting.start_time?.split('T')[0]
      sections.push(
        `LAST MEETING WITH THESE PEOPLE (${date} — "${latestMeeting.title}"):\n` +
        (latestMeeting.summary || latestMeeting.short_summary || '') +
        (transcript ? `\n\nTranscript excerpt:\n${transcript.slice(0, 3000)}` : '')
      )
    }

    if (continuityNote && continuityNote !== (latestMeeting?.continuity_context)) {
      sections.push(`RECURRING SERIES CONTEXT:\n${continuityNote}`)
    }

    if (relTasks.length) {
      sections.push('OPEN TASKS (critical/high, relevant to this meeting):\n' +
        relTasks.map(t => `• [${t.urgency}] ${t.title}${t.context ? ` — ${t.context}` : ''}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n')
      )
    }

    if (relOthers.length) {
      sections.push('WHAT THESE PEOPLE OWE YOU:\n' +
        relOthers.map(c => `• ${c.committed_by_name}: ${c.title}${c.due_date ? ` (due ${c.due_date})` : ''}${c.context ? ` — ${c.context}` : ''}`).join('\n')
      )
    }

    if (relMine.length) {
      sections.push('YOUR OPEN COMMITMENTS TO THEM:\n' +
        relMine.map(c => `• To ${c.made_to}: ${c.title}${c.due_date ? ` (due ${c.due_date})` : ''}`).join('\n')
      )
    }

    if (relEmails.length) {
      sections.push('RECENT EMAIL THREADS:\n' +
        relEmails.slice(0, 6).map(e =>
          `• ${e.from_name || e.from_address} — "${e.thread_subject}" (${e.days_waiting}d)\n  ${e.action_needed || e.ai_summary || ''}`
        ).join('\n')
      )
    }

    if (relDecisions.length) {
      sections.push('PENDING DECISIONS:\n' +
        relDecisions.slice(0, 5).map(d => `• [${d.urgency || 'open'}] ${d.title}`).join('\n')
      )
    }

    if (event.pre_meeting_notes) {
      sections.push(`YOUR PRE-MEETING NOTES:\n${event.pre_meeting_notes}`)
    }

    const contextBlock = sections.join('\n\n---\n\n')

    const prompt = `You are Ryan Hankins' chief of staff. Generate a structured pre-meeting brief for the following meeting.

MEETING: ${event.title}
TIME: ${timeStr}
ATTENDEES: ${attendeeNames.join(', ') || 'unknown'}
${event.location ? `LOCATION: ${event.location}` : ''}

CONTEXT:
${contextBlock || 'No prior context available.'}

Generate a tight, executive-level brief. Ryan is a Project Executive at Clayco — direct, no fluff, focused on decisions and risks.

Format exactly as follows (use these exact headers):

**What this meeting is about**
1-2 sentences on purpose and stakes.

**Critical items to raise**
Bullet list — the 3-5 most important things Ryan must address. Be specific. Include who owns what.

**What they owe you**
Bullet list of open commitments from attendees. If none, say "Nothing outstanding."

**Your open commitments to them**
Bullet list of what Ryan has promised these people. If none, say "None open."

**Open decisions needing resolution**
Bullet list of pending decisions. If none, omit this section.

**From the last meeting**
2-3 sentences on what happened last time and what carried forward. If no prior meeting found, omit.

**Walk out with**
The 2-3 specific outcomes Ryan should have by end of this meeting.`

    // ── 5. Call Claude Sonnet ─────────────────────────────────────
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }]
    })

    const brief = response.content[0]?.text || 'Brief generation failed.'

    // ── 6. Save to event ──────────────────────────────────────────
    await supabase
      .from('events')
      .update({
        body:                brief,
        preparation_required: true
      })
      .eq('id', event_id)

    return res.json({ brief, event_id })

  } catch (err) {
    console.error('Pre-meeting brief error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
