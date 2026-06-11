'use strict'
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { id } = req.query

  // ── PATCH — update a meeting note (user_notes, project_id, etc.)
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['user_notes', 'project_id', 'title']
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
      const { data: othersCommitments } = await supabase
        .from('others_commitments')
        .select('id, title, person_name, due_date, urgency, status, context')
        .eq('meeting_note_id', id)
        .order('urgency', { ascending: true })

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
      const { data, error } = await supabase
        .from('meeting_notes')
        .select('*')
        .order('meeting_date', { ascending: false })
        .order('start_time', { ascending: false })

      if (error) throw error
      return res.json(data)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
