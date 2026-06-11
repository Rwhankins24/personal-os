import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getMeetingNote, updateMeetingNote, getProjects, createTask } from '../lib/api'

const URGENCY_COLOR = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-yellow-50 text-yellow-700 border-yellow-200',
  low:      'bg-gray-50 text-gray-600 border-gray-200',
}

function Section({ title, count, color = '#1B2A4A', children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!count) return null
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{title}</span>
          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">{count}</span>
          <span className="text-xs text-gray-400 ml-auto">{open ? '▲' : '▼'}</span>
        </button>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {open && children}
    </div>
  )
}

function IntelCard({ items, renderItem }) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => renderItem(item, i))}
    </div>
  )
}

export default function MeetingDetail() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft,   setNotesDraft]   = useState('')
  const [promoted,     setPromoted]     = useState(new Set()) // ids promoted to my tasks

  const { data: meeting, isLoading } = useQuery({
    queryKey: ['meeting', id],
    queryFn:  () => getMeetingNote(id),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn:  () => import('../lib/api').then(m => m.getProjects()),
  })

  const update = useMutation({
    mutationFn: (data) => updateMeetingNote(id, data),
    onSuccess: (updated) => {
      qc.setQueryData(['meeting', id], old => ({ ...old, ...updated }))
    },
  })

  const saveNotes = () => {
    update.mutate({ user_notes: notesDraft })
    setEditingNotes(false)
  }

  const promoteToMyTask = async (item, sourceLabel) => {
    const key = item.id || item.title
    if (promoted.has(key)) return
    await createTask({
      title:       item.title,
      context:     `From meeting: ${meeting.title || 'Meeting'}${item.person_name ? ` (originally assigned to ${item.person_name})` : ''}`,
      urgency:     item.urgency || 'medium',
      due_date:    item.due_date || null,
      status:      'open',
      source:      'manual',
      source_label: sourceLabel || meeting.title,
      project_id:  meeting.project_id || null,
      meeting_note_id: meeting.id,
    })
    setPromoted(prev => new Set([...prev, key]))
  }

  const promoteAll = async (items, transform) => {
    for (const item of (items || [])) {
      const mapped = transform ? transform(item) : item
      const key = item.id || item.title
      if (!promoted.has(key)) {
        await promoteToMyTask(mapped, meeting.title)
      }
    }
  }

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!meeting) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <p className="text-sm text-[#6b6b67]">Meeting not found</p>
    </div>
  )

  const date     = meeting.meeting_date || meeting.start_time
  const project  = projects.find(p => p.id === meeting.project_id)
  const event    = meeting._event
  const duration = meeting.duration_minutes
    ? meeting.duration_minutes < 60
      ? `${meeting.duration_minutes}m`
      : `${Math.floor(meeting.duration_minutes / 60)}h${meeting.duration_minutes % 60 ? ` ${meeting.duration_minutes % 60}m` : ''}`
    : null

  return (
    <div className="min-h-screen bg-[#f8f8f6] pb-16">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-[#6b6b67] hover:text-[#1a1a18] text-lg">←</button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-[#1a1a18] truncate">{meeting.title || 'Untitled Meeting'}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {date && <span className="text-xs text-[#6b6b67]">{dayjs(date).format('MMM D, YYYY')}</span>}
              {duration && <span className="text-xs text-[#9b9b97]">⏱ {duration}</span>}
              {project && (
                <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                  {project.name}
                </span>
              )}
              {meeting.intelligence_extracted && (
                <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">analyzed</span>
              )}
            </div>
          </div>
          {event && (
            <button
              onClick={() => navigate(`/event/${event.id}`)}
              className="text-xs text-blue-600 hover:underline whitespace-nowrap"
            >
              📅 Calendar
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">

        {/* ── Pre-meeting notes from calendar (Ryan's input, top) ── */}
        {event?.pre_meeting_notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-2">Pre-Meeting Notes</p>
            <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-wrap">{event.pre_meeting_notes}</p>
          </div>
        )}

        {/* ── Ryan's meeting notes (editable) ────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A]">My Notes</p>
            {!editingNotes && (
              <button
                onClick={() => { setNotesDraft(meeting.user_notes || ''); setEditingNotes(true) }}
                className="text-xs text-blue-600 hover:underline"
              >
                {meeting.user_notes ? 'Edit' : '+ Add notes'}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div>
              <textarea
                autoFocus
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                rows={5}
                placeholder="Add your notes, observations, follow-ups…"
                className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setEditingNotes(false)}
                  className="flex-1 py-2 text-xs rounded-xl border border-[#e5e5e3] text-[#6b6b67]"
                >Cancel</button>
                <button
                  onClick={saveNotes}
                  className="flex-1 py-2 text-xs rounded-xl bg-[#1a1a18] text-white font-medium"
                >Save</button>
              </div>
            </div>
          ) : meeting.user_notes ? (
            <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-wrap">{meeting.user_notes}</p>
          ) : (
            <p className="text-xs text-[#9b9b97] italic">No notes yet</p>
          )}
        </div>

        {/* ── Summary ────────────────────────────────────────────── */}
        {(meeting.summary || meeting.short_summary) && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A] mb-2">Summary</p>
            {(() => {
              const raw = meeting.summary || meeting.short_summary || ''
              const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
              const hasStructure = lines.some(l => l.startsWith('##') || l.startsWith('•') || l.startsWith('-'))
              if (!hasStructure) {
                return <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-wrap">{raw}</p>
              }
              const sections = []
              let current = null
              for (const line of lines) {
                if (line.startsWith('##')) {
                  current = { heading: line.replace(/^##\s*/, ''), bullets: [] }
                  sections.push(current)
                } else if (line.startsWith('•') || line.startsWith('-')) {
                  if (!current) { current = { heading: null, bullets: [] }; sections.push(current) }
                  current.bullets.push(line.replace(/^[•\-]\s*/, ''))
                }
              }
              return (
                <div className="space-y-3">
                  {sections.map((s, i) => (
                    <div key={i}>
                      {s.heading && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6b67] mb-1">{s.heading}</p>
                      )}
                      <ul className="space-y-1">
                        {s.bullets.map((b, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm text-[#1a1a18]">
                            <span className="text-[#C9A84C] mt-0.5 shrink-0 text-xs">▸</span>
                            <span className="leading-relaxed">{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── Participants ────────────────────────────────────────── */}
        {(meeting.participants || []).length > 0 && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A] mb-2">Participants</p>
            <div className="flex flex-wrap gap-1.5">
              {meeting.participants.map((p, i) => (
                <span key={i} className="text-xs bg-gray-100 text-[#4a4a48] px-2 py-1 rounded-lg">{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── Intelligence sections ───────────────────────────────── */}
        {meeting.intelligence_extracted && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A] mb-4">Meeting Intelligence</p>

            {/* Ryan's Tasks */}
            <Section title="My Action Items" count={meeting._tasks?.length} color="#1B2A4A">
              <IntelCard items={meeting._tasks || []} renderItem={(t, i) => (
                <div key={i} className={`text-xs border rounded-lg px-3 py-2 ${URGENCY_COLOR[t.urgency] || URGENCY_COLOR.medium}`}>
                  <span className="font-medium">{t.title}</span>
                  {t.due_date && <span className="ml-2 opacity-70">due {t.due_date}</span>}
                  {t.context && <p className="mt-0.5 opacity-60">{t.context}</p>}
                </div>
              )} />
            </Section>

            {/* Others' Commitments */}
            <Section
              title="Others' Action Items"
              count={meeting._others_commitments?.length}
              color="#5a3a8a"
              action={
                (meeting._others_commitments?.length > 1) && (
                  <button
                    onClick={() => promoteAll(meeting._others_commitments)}
                    className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded font-medium hover:bg-purple-100 transition-colors whitespace-nowrap"
                  >
                    Promote all → My tasks
                  </button>
                )
              }
            >
              <IntelCard items={meeting._others_commitments || []} renderItem={(c, i) => {
                const key = c.id || c.title
                const done = promoted.has(key)
                return (
                  <div key={i} className="text-xs border border-purple-100 bg-purple-50 rounded-lg px-3 py-2 flex items-start gap-2">
                    <div className="flex-1">
                      <span className="font-semibold text-purple-800">{c.person_name}: </span>
                      <span className="text-purple-900">{c.title}</span>
                      {c.due_date && <span className="ml-2 text-purple-600">due {c.due_date}</span>}
                    </div>
                    <button
                      onClick={() => promoteToMyTask(c, meeting.title)}
                      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                        done
                          ? 'bg-green-100 text-green-700'
                          : 'bg-white text-purple-700 border border-purple-200 hover:bg-purple-100'
                      }`}
                    >
                      {done ? '✓ Added' : '→ My tasks'}
                    </button>
                  </div>
                )
              }} />
            </Section>

            {/* Decisions Made */}
            <Section title="Decisions Made" count={meeting._decisions_made?.length} color="#1a5c1a">
              <IntelCard items={meeting._decisions_made || []} renderItem={(d, i) => (
                <div key={i} className="text-xs border border-green-100 bg-green-50 rounded-lg px-3 py-2">
                  <p className="font-medium text-green-900">{d.decision || d.title || JSON.stringify(d)}</p>
                  {d.decided_by && <p className="mt-0.5 text-green-700">By: {d.decided_by}</p>}
                  {d.implications && <p className="mt-0.5 text-green-700 opacity-80">{d.implications}</p>}
                </div>
              )} />
            </Section>

            {/* Pending Decisions */}
            <Section
              title="Pending Decisions"
              count={meeting._pending_decisions?.length}
              color="#8a5a1a"
              action={
                (meeting._pending_decisions?.length > 1) && (
                  <button
                    onClick={() => promoteAll(meeting._pending_decisions, d => ({ ...d, title: `Decide: ${d.title}` }))}
                    className="text-[10px] bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded font-medium hover:bg-orange-100 transition-colors whitespace-nowrap"
                  >
                    Promote all → My tasks
                  </button>
                )
              }
            >
              <IntelCard items={meeting._pending_decisions || []} renderItem={(d, i) => {
                const key = d.id || d.title
                const done = promoted.has(key)
                return (
                  <div key={i} className={`text-xs border rounded-lg px-3 py-2 flex items-start gap-2 ${URGENCY_COLOR[d.urgency] || URGENCY_COLOR.medium}`}>
                    <div className="flex-1">
                      <p className="font-medium">{d.title}</p>
                      {d.context && <p className="mt-0.5 opacity-70">{d.context}</p>}
                    </div>
                    <button
                      onClick={() => promoteToMyTask({ ...d, title: `Decide: ${d.title}` }, meeting.title)}
                      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded font-medium border transition-colors ${
                        done ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white/60 hover:bg-white border-current'
                      }`}
                    >
                      {done ? '✓ Added' : '→ My tasks'}
                    </button>
                  </div>
                )
              }} />
            </Section>

            {/* Risks */}
            <Section title="Risks" count={meeting._risks?.length} color="#8a1a1a">
              <IntelCard items={meeting._risks || []} renderItem={(r, i) => (
                <div key={i} className="text-xs border border-red-100 bg-red-50 rounded-lg px-3 py-2">
                  <p className="font-medium text-red-900">{r.signal || r.fact || JSON.stringify(r)}</p>
                  {r.type && <span className="text-red-600 opacity-70">{r.type}</span>}
                  {r.severity && <span className="ml-2 text-red-600 font-semibold">[{r.severity.toUpperCase()}]</span>}
                </div>
              )} />
            </Section>

            {/* Financial */}
            <Section title="Financial Signals" count={meeting._financial_signals?.length} color="#1a3a7a" defaultOpen={false}>
              <IntelCard items={meeting._financial_signals || []} renderItem={(f, i) => (
                <div key={i} className="text-xs border border-blue-100 bg-blue-50 rounded-lg px-3 py-2">
                  <p className="font-medium text-blue-900">{f.amount || f.fact || JSON.stringify(f)}</p>
                  {(f.context || f.signal) && <p className="mt-0.5 text-blue-700">{f.context || f.signal}</p>}
                  {f.stated_by && <p className="mt-0.5 text-blue-500 opacity-70">— {f.stated_by}</p>}
                </div>
              )} />
            </Section>

            {/* Schedule */}
            <Section title="Schedule Signals" count={meeting._schedule_signals?.length} color="#1a5c5c" defaultOpen={false}>
              <IntelCard items={meeting._schedule_signals || []} renderItem={(s, i) => (
                <div key={i} className="text-xs border border-teal-100 bg-teal-50 rounded-lg px-3 py-2">
                  <p className="font-medium text-teal-900">{s.date_or_deadline || s.fact || JSON.stringify(s)}</p>
                  {(s.context || s.signal) && <p className="mt-0.5 text-teal-700">{s.context || s.signal}</p>}
                </div>
              )} />
            </Section>

            {/* Technical */}
            <Section title="Technical Facts" count={meeting._tech_facts?.length} color="#4a4a48" defaultOpen={false}>
              <IntelCard items={meeting._tech_facts || []} renderItem={(t, i) => (
                <div key={i} className="text-xs border border-gray-200 bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[#1a1a18]">{t.fact || t.signal || JSON.stringify(t)}</p>
                  {t.stated_by && <p className="mt-0.5 text-[#6b6b67] opacity-70">— {t.stated_by}</p>}
                </div>
              )} />
            </Section>

            {/* Scope */}
            <Section title="Scope Signals" count={meeting._scope_signals?.length} color="#5a1a5a" defaultOpen={false}>
              <IntelCard items={meeting._scope_signals || []} renderItem={(s, i) => (
                <div key={i} className="text-xs border border-pink-100 bg-pink-50 rounded-lg px-3 py-2">
                  <p className="font-medium text-pink-900">{s.signal || s.fact || JSON.stringify(s)}</p>
                  {s.type && <span className="text-pink-600 opacity-70">{s.type}</span>}
                </div>
              )} />
            </Section>
          </div>
        )}

        {/* ── Raw transcript (collapsed) ──────────────────────────── */}
        {(meeting.full_transcript || meeting.raw_transcript) && (
          <details className="bg-white border border-[#e5e5e3] rounded-2xl">
            <summary className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-[#6b6b67] cursor-pointer">
              Full Transcript
            </summary>
            <div className="px-4 pb-4">
              <p className="text-xs text-[#6b6b67] leading-relaxed whitespace-pre-wrap font-mono">
                {meeting.full_transcript || meeting.raw_transcript}
              </p>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
