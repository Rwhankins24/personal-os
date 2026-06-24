'use strict'
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-trigger-secret')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { id } = req.query

  // ── POST — ingest a meeting from the plaud-pull GitHub Action ─────────────
  // Payload: { title, meeting_date, source, summary, action_items, participants,
  //            raw_transcript, external_id, has_transcript, transcript_word_count }
  if (req.method === 'POST') {
    const secret = req.headers['x-trigger-secret']
    if (!secret || secret !== process.env.TRIGGER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const {
        title, meeting_date, source = 'plaud', summary,
        action_items = [], participants = [],
        raw_transcript, external_id, has_transcript, transcript_word_count,
      } = req.body

      if (!external_id) return res.status(400).json({ error: 'external_id required' })

      const otterId = `plaud_${external_id}`

      // Idempotent — skip if already inserted
      const { data: existing } = await supabase
        .from('meeting_notes')
        .select('id')
        .eq('otter_id', otterId)
        .maybeSingle()

      if (existing) {
        return res.status(200).json({ id: existing.id, skipped: true })
      }

      // Map action_items array → action_items_raw schema
      const actionItemsRaw = action_items.map(item => ({
        task_text:      item.task || item.task_text || '',
        assignee_name:  item.assignee || item.assignee_name || null,
        assignee_email: item.assignee_email || null,
      })).filter(i => i.task_text)

      // T19:00:00Z = noon Phoenix (UTC-7, Arizona never observes DST)
      const startTime = meeting_date ? `${meeting_date}T19:00:00Z` : null

      const { data: inserted, error } = await supabase
        .from('meeting_notes')
        .insert({
          otter_id:               otterId,
          title:                  title || 'Untitled Meeting',
          meeting_date:           meeting_date || null,
          start_time:             startTime,
          short_summary:          summary || '',
          full_transcript:        raw_transcript || null,
          raw_transcript:         raw_transcript || null,
          action_items_raw:       actionItemsRaw,
          participants:           participants || [],
          source,
          intelligence_extracted: false,
          commitments_extracted:  false,
        })
        .select('id')
        .single()

      if (error) throw error

      return res.status(201).json({ id: inserted.id, created: true })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── PATCH — update a meeting note (user_notes, project_id, etc.)
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['user_notes', 'project_id', 'title', 'linked_pod_id', 'linked_observation_id', 'linked_knowledge_id', 'workspace_id']
    const updates = {}
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key]
    }
    const { data, error } = await supabase
      .from('meeting_notes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  // ── GET single meeting with full detail
  if (req.method === 'GET' && id) {
    try {
      // 1. The meeting record
      const { data: meeting, error } = await supabase
        .from('meeting_notes')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error

      // 2. Linked calendar event (for pre_meeting_notes)
      let event = null
      if (meeting.event_id) {
        const { data: ev } = await supabase
          .from('events')
          .select('id, title, start_time, pre_meeting_notes, attendees')
          .eq('id', meeting.event_id)
          .single()
        event = ev
      }

      // 3. Tasks extracted from this meeting
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, urgency, due_date, status, assigned_to_name, context')
        .eq('meeting_note_id', id)
        .order('urgency', { ascending: true })

      // 4. Others' commitments from this meeting
      // Primary: match by meeting_note_id (set on new records)
      // Fallback: match by source_label = meeting title (for older records)
      let { data: othersCommitments } = await supabase
        .from('others_commitments')
        .select('id, title, committed_by_name, committed_by_email, due_date, urgency, status, context')
        .eq('meeting_note_id', id)
        .order('urgency', { ascending: true })

      if (!othersCommitments?.length && meeting.title) {
        const { data: byLabel } = await supabase
          .from('others_commitments')
          .select('id, title, committed_by_name, committed_by_email, due_date, urgency, status, context')
          .eq('source_label', meeting.title)
          .in('status', ['open', 'pending'])
          .order('urgency', { ascending: true })
        othersCommitments = byLabel || []
      }

      // 5. Project intelligence (decisions, risks) filtered by this meeting's title
      let decisions = []
      let risks = []
      let techFacts = []
      let financialSignals = []
      let scheduleSignals = []
      let scopeSignals = []

      if (meeting.project_id) {
        const { data: project } = await supabase
          .from('projects')
          .select('decisions_made, risk_signals, intelligence_notes, key_facts, name')
          .eq('id', meeting.project_id)
          .single()

        if (project) {
          const src = (meeting.title || '').toLowerCase()
          // Filter by source matching this meeting's title
          const fromThisMeeting = (arr) => (arr || []).filter(item =>
            (item.source || '').toLowerCase().includes(src.split(' ').find(w => w.length > 4) || src)
          )
          decisions       = fromThisMeeting(project.decisions_made)
          risks           = fromThisMeeting(project.risk_signals)
          const notes     = fromThisMeeting(project.intelligence_notes)
          techFacts       = notes.filter(n => n.type === 'technical')
          financialSignals = notes.filter(n => n.type === 'financial')
          scheduleSignals  = notes.filter(n => n.type === 'schedule')
          scopeSignals     = notes.filter(n => n.type === 'scope')
        }
      }

      // 6. Pending decisions for this project (best proxy — no meeting_note_id on them)
      let pendingDecisions = []
      if (meeting.project_id) {
        const { data: pd } = await supabase
          .from('pending_decisions')
          .select('id, title, context, urgency, status')
          .eq('project_id', meeting.project_id)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(20)
        pendingDecisions = pd || []
      }

      return res.json({
        ...meeting,
        _event: event,
        _tasks: tasks || [],
        _others_commitments: othersCommitments || [],
        _decisions_made: decisions,
        _pending_decisions: pendingDecisions,
        _risks: risks,
        _tech_facts: techFacts,
        _financial_signals: financialSignals,
        _schedule_signals: scheduleSignals,
        _scope_signals: scopeSignals,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── GET all meetings (list)
  if (req.method === 'GET') {
    try {
      const { workspace_id } = req.query
      let listQuery = supabase
        .from('meeting_notes')
        .select('*')
        .order('meeting_date', { ascending: false })
        .order('start_time', { ascending: false })
      if (workspace_id) listQuery = listQuery.eq('workspace_id', workspace_id)
      const { data, error } = await listQuery

      if (error) throw error
      return res.json(data)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
