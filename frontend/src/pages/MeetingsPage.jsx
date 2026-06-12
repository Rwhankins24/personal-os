import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import {
  getMeetingNotes, updateMeetingNote, getProjects, createProject,
  getTasks, updateTask, createTask,
  getOthersCommitments, updateOthersCommitment, createOthersCommitment,
} from '../lib/api'
import MeetingSummary from '../components/MeetingSummary'

dayjs.extend(duration)

const SOURCE_LABEL = {
  plaud: { icon: '🎙', label: 'Plaud' },
  otter: { icon: '🎙', label: 'Otter' },
  manual: { icon: '📝', label: 'Manual' },
}

function formatDuration(mins) {
  if (!mins || mins <= 0) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function getMeetingDuration(meeting) {
  // Try explicit duration_minutes field
  if (meeting.duration_minutes) return formatDuration(meeting.duration_minutes)
  // Calculate from start/end
  if (meeting.start_time && meeting.end_time) {
    const mins = dayjs(meeting.end_time).diff(dayjs(meeting.start_time), 'minute')
    return formatDuration(mins)
  }
  // Try raw_transcript length as rough proxy — skip
  return null
}

export default function MeetingsPage() {
  const navigate      = useNavigate()
  const qc            = useQueryClient()
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('all') // all | unlinked | linked
  const [editing,     setEditing]     = useState(null)  // meeting id being project-assigned
  const [selected,    setSelected]    = useState(new Set())
  const [bulkProject, setBulkProject] = useState('')
  const [bulkSaving,  setBulkSaving]  = useState(false)
  const [expandedId,  setExpandedId]  = useState(null)  // inline-expanded meeting card

  // Create project modal state
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newProjectName,    setNewProjectName]    = useState('')
  const [createForMeeting,  setCreateForMeeting]  = useState(null)
  const [creating,          setCreating]          = useState(false)

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ['meeting-notes'],
    queryFn:  getMeetingNotes,
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn:  getProjects,
  })
  // Load tasks + others_commitments so we can show/reconcile meeting items inline
  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn:  getTasks,
  })
  const { data: allOthers = [] } = useQuery({
    queryKey: ['others-commitments-all'],
    queryFn:  () => getOthersCommitments('all'),
  })

  const update = useMutation({
    mutationFn: ({ id, data }) => updateMeetingNote(id, data),
    onSuccess: (updated, { id }) => {
      qc.setQueryData(['meeting-notes'], old =>
        (old || []).map(m => m.id === id ? { ...m, ...updated } : m)
      )
      setEditing(null)
    },
  })

  const activeProjects = projects.filter(p => p.status === 'active' || !p.status)

  // ── Bulk select ──────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll  = () => setSelected(new Set(filtered.map(m => m.id)))
  const clearAll   = () => setSelected(new Set())

  // ── Inline task / others reconciliation ─────────────────────
  const markTaskDone = async (id) => {
    await updateTask(id, { status: 'done' })
    qc.setQueryData(['tasks'], old => (old || []).map(t => t.id === id ? { ...t, status: 'done' } : t))
  }
  const markOtherDone = async (id) => {
    await updateOthersCommitment(id, { status: 'closed' })
    qc.setQueryData(['others-commitments-all'], old => (old || []).map(c => c.id === id ? { ...c, status: 'closed' } : c))
  }
  // Push an extracted (un-persisted) item into tasks, then mark it done
  const pushTaskDone = async (meetingId, title) => {
    const t = await createTask({ title, status: 'done', source_type: 'meeting', meeting_note_id: meetingId })
    qc.setQueryData(['tasks'], old => [...(old || []), t])
  }
  // Push an extracted others item into others_commitments, then mark closed
  const pushOtherDone = async (meetingId, title, person) => {
    const c = await createOthersCommitment({ title, committed_by_name: person, status: 'closed', source_type: 'meeting', meeting_note_id: meetingId })
    qc.setQueryData(['others-commitments-all'], old => [...(old || []), c])
  }

  const bulkAssign = async () => {
    if (!bulkProject || selected.size === 0) return
    setBulkSaving(true)
    try {
      await Promise.all([...selected].map(id =>
        updateMeetingNote(id, { project_id: bulkProject })
      ))
      qc.setQueryData(['meeting-notes'], old =>
        (old || []).map(m => selected.has(m.id) ? { ...m, project_id: bulkProject } : m)
      )
      setSelected(new Set())
      setBulkProject('')
    } finally {
      setBulkSaving(false)
    }
  }

  // ── Create project ───────────────────────────────────────────
  const openCreateProject = (meetingId) => {
    setCreateForMeeting(meetingId)
    setNewProjectName('')
    setShowCreateProject(true)
  }

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    try {
      const proj = await createProject({ name: newProjectName.trim(), status: 'active' })
      await qc.invalidateQueries(['projects'])
      if (createForMeeting) {
        await updateMeetingNote(createForMeeting, { project_id: proj.id })
        qc.setQueryData(['meeting-notes'], old =>
          (old || []).map(m => m.id === createForMeeting ? { ...m, project_id: proj.id } : m)
        )
      } else if (bulkProject === '__new__') {
        setBulkProject(proj.id)
      }
      setShowCreateProject(false)
      setCreateForMeeting(null)
      setEditing(null)
    } finally {
      setCreating(false)
    }
  }

  // ── Filtering ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...meetings]

    if (filter === 'unlinked') list = list.filter(m => !m.project_id)
    if (filter === 'linked')   list = list.filter(m =>  m.project_id)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.summary || '').toLowerCase().includes(q) ||
        (m.participants || []).some(p => p.toLowerCase().includes(q))
      )
    }

    return list.sort((a, b) => {
      const da = a.meeting_date || a.start_time || ''
      const db = b.meeting_date || b.start_time || ''
      return db.localeCompare(da)
    })
  }, [meetings, filter, search])

  const unlinkedCount = meetings.filter(m => !m.project_id).length

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f8f6] pb-32">

      {/* ── Create Project Modal ──────────────────────────────── */}
      {showCreateProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={e => { if (e.target === e.currentTarget) setShowCreateProject(false) }}
        >
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#1a1a18] mb-4">Create new project</h3>
            <input
              autoFocus
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
              placeholder="Project name…"
              className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2.5 mb-4 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateProject(false)}
                className="flex-1 py-2.5 text-sm rounded-xl border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creating}
                className="flex-1 py-2.5 text-sm rounded-xl bg-[#1a1a18] text-white font-medium disabled:opacity-40"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="text-[#6b6b67] hover:text-[#1a1a18] transition-colors"
              >
                ←
              </button>
              <h1 className="text-lg font-semibold text-[#1a1a18]">Meetings</h1>
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 ? (
                <>
                  <button onClick={selectAll}  className="text-xs text-blue-600 hover:underline">All</button>
                  <button onClick={clearAll}   className="text-xs text-[#6b6b67] hover:underline">Clear</button>
                </>
              ) : (
                <button
                  onClick={selectAll}
                  className="text-xs text-[#6b6b67] hover:text-[#1a1a18]"
                >
                  Select all
                </button>
              )}
              <span className="text-xs text-[#9b9b97]">{filtered.length} of {meetings.length}</span>
            </div>
          </div>

          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search meetings, participants…"
            className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-[#f8f8f6]"
          />

          {/* Filter tabs */}
          <div className="flex gap-1">
            {[
              { key: 'all',      label: `All (${meetings.length})` },
              { key: 'unlinked', label: `No project (${unlinkedCount})`, warn: unlinkedCount > 0 },
              { key: 'linked',   label: `Linked (${meetings.length - unlinkedCount})` },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  filter === t.key
                    ? 'bg-[#1a1a18] text-white'
                    : t.warn
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-gray-100 text-[#6b6b67] hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[#6b6b67] text-center py-10">No meetings found</p>
        )}

        {filtered.map(meeting => {
          const date         = meeting.meeting_date || meeting.start_time
          const project      = activeProjects.find(p => p.id === meeting.project_id)
          const src          = SOURCE_LABEL[meeting.source] || { icon: '🎙', label: meeting.source || '' }
          const hasTranscript = !!(meeting.full_transcript || meeting.raw_transcript)
          const isEditing    = editing === meeting.id
          const isSelected   = selected.has(meeting.id)
          const dur          = getMeetingDuration(meeting)
          const isExpanded   = expandedId === meeting.id

          // Pull DB records linked to this meeting
          const meetingTasks   = allTasks.filter(t => t.meeting_note_id === meeting.id)
          const meetingOthers  = allOthers.filter(c => c.meeting_note_id === meeting.id)

          // Fall back to extracted_intelligence arrays if no DB records exist
          const intel      = meeting.extracted_intelligence || {}
          // Field names match ai.js return schema (ryan_action_items, verbal_commitments_others, etc.)
          const exTasks    = intel.ryan_action_items || []
          const exOthers   = [
            ...(intel.verbal_commitments_others || []),
            ...(intel.others_action_items       || []),
          ]
          const decisions  = intel.decisions_made || intel.decisions || []
          const risks      = intel.risk_signals   || []

          // Use DB records when available; else extracted items (for "push+done" flow)
          const showDbTasks   = meetingTasks.length  > 0
          const showDbOthers  = meetingOthers.length > 0

          return (
            <div
              key={meeting.id}
              className={`bg-white border rounded-2xl transition-colors ${
                isSelected   ? 'border-blue-300 bg-blue-50/30' :
                isExpanded   ? 'border-[#C9A84C]/50 shadow-sm'  : 'border-[#e5e5e3]'
              }`}
            >
              {/* Main clickable area */}
              <div
                className="p-4 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : meeting.id)}
              >
                {/* Top row: checkbox + title + project */}
                <div className="flex items-start gap-3">
                  {/* Checkbox — stop propagation so it doesn't nav */}
                  <button
                    onClick={e => { e.stopPropagation(); toggleSelect(meeting.id) }}
                    className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-blue-500 border-blue-500'
                        : 'border-[#d0d0cc] hover:border-blue-400'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a1a18] leading-snug group-hover:text-blue-700">
                      {meeting.title || 'Untitled Meeting'}
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {date && (
                        <span className="text-xs text-[#6b6b67] font-medium">
                          {dayjs(date).format('MMM D')}
                        </span>
                      )}
                      {dur && (
                        <span className="text-xs text-[#9b9b97]">· {dur}</span>
                      )}
                      {(meeting.participants || []).length > 0 && (
                        <span className="text-xs text-[#9b9b97]">
                          · {meeting.participants.length} attendee{meeting.participants.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {meeting.intelligence_extracted && (
                        <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium">analyzed</span>
                      )}
                      {hasTranscript && !meeting.intelligence_extracted && (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">transcript</span>
                      )}
                    </div>
                  </div>

                  {/* Project badge / assign button — stop propagation */}
                  <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {isEditing ? (
                      <select
                        autoFocus
                        defaultValue={meeting.project_id || ''}
                        onChange={e => {
                          if (e.target.value === '__new__') {
                            openCreateProject(meeting.id)
                            return
                          }
                          update.mutate({ id: meeting.id, data: { project_id: e.target.value || null } })
                        }}
                        onBlur={e => { if (e.target.value !== '__new__') setEditing(null) }}
                        className="text-xs border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white max-w-[140px]"
                      >
                        <option value="">No project</option>
                        {activeProjects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                        <option value="__new__">＋ Create new…</option>
                      </select>
                    ) : project ? (
                      <button
                        onClick={() => setEditing(meeting.id)}
                        className="text-[11px] bg-blue-50 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors font-medium max-w-[130px] truncate block"
                      >
                        {project.name}
                      </button>
                    ) : (
                      <button
                        onClick={() => setEditing(meeting.id)}
                        className="text-[11px] text-[#9b9b97] border border-dashed border-[#d0d0cc] px-2 py-1 rounded-lg hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50 transition-colors whitespace-nowrap"
                      >
                        + project
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsed hint — show first line of summary */}
                {!isExpanded && (meeting.summary || meeting.short_summary) && (
                  <p className="text-xs text-[#6b6b67] mt-2 ml-7 leading-relaxed line-clamp-1">
                    {(meeting.summary || meeting.short_summary || '')
                      .replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\n+/g, ' ').trim()}
                  </p>
                )}
              </div>

              {/* ── Full inline expansion ────────────────────────── */}
              {isExpanded && (
                <div className="border-t border-[#f0f0ee] px-4 pt-4 pb-5 space-y-5">

                  {/* Attendees */}
                  {(meeting.participants || []).length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">Attendees</p>
                      <div className="flex flex-wrap gap-1.5">
                        {meeting.participants.slice(0, 15).map((p, i) => (
                          <span key={i} className="text-xs bg-[#f0f0ee] text-[#1a1a18] px-2 py-0.5 rounded-full">{p}</span>
                        ))}
                        {meeting.participants.length > 15 && (
                          <span className="text-xs text-[#9b9b97]">+{meeting.participants.length - 15} more</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Full summary */}
                  {(meeting.summary || meeting.short_summary) && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">Summary</p>
                      <MeetingSummary text={meeting.summary || meeting.short_summary} />
                    </div>
                  )}

                  {/* My action items */}
                  {(showDbTasks ? meetingTasks : exTasks).length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">My Actions</p>
                      <div className="space-y-1.5">
                        {showDbTasks ? meetingTasks.map(t => (
                          <div key={t.id} className="flex items-start gap-2.5">
                            <button
                              onClick={() => markTaskDone(t.id)}
                              disabled={t.status === 'done'}
                              className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                                t.status === 'done'
                                  ? 'bg-green-500 border-green-500'
                                  : 'border-[#d0d0cc] hover:border-green-500'
                              }`}
                              title={t.status === 'done' ? 'Done' : 'Mark done'}
                            >
                              {t.status === 'done' && (
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                            <span className={`text-sm leading-snug ${t.status === 'done' ? 'line-through text-[#9b9b97]' : 'text-[#1a1a18]'}`}>
                              {t.title}
                              {t.due_date && <span className="text-xs text-[#9b9b97] ml-1.5">due {dayjs(t.due_date).format('MMM D')}</span>}
                            </span>
                          </div>
                        )) : exTasks.map((t, i) => {
                          const title = typeof t === 'string' ? t : (t.title || t.description || JSON.stringify(t))
                          return (
                            <div key={i} className="flex items-start gap-2.5">
                              <button
                                onClick={() => pushTaskDone(meeting.id, title)}
                                className="flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 border-[#d0d0cc] hover:border-green-500 flex items-center justify-center transition-colors"
                                title="Mark done + save to tasks"
                              />
                              <span className="text-sm text-[#1a1a18] leading-snug">{title}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Others' commitments */}
                  {(showDbOthers ? meetingOthers : exOthers).length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">Others' Commitments</p>
                      <div className="space-y-1.5">
                        {showDbOthers ? meetingOthers.map(c => (
                          <div key={c.id} className="flex items-start gap-2.5">
                            <button
                              onClick={() => markOtherDone(c.id)}
                              disabled={c.status === 'closed'}
                              className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                                c.status === 'closed'
                                  ? 'bg-green-500 border-green-500'
                                  : 'border-[#d0d0cc] hover:border-green-500'
                              }`}
                              title={c.status === 'closed' ? 'Closed' : 'Mark closed'}
                            >
                              {c.status === 'closed' && (
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                            <span className={`text-sm leading-snug ${c.status === 'closed' ? 'line-through text-[#9b9b97]' : 'text-[#1a1a18]'}`}>
                              {c.committed_by_name && <span className="font-medium text-[#1B2A4A]">{c.committed_by_name}: </span>}
                              {c.title}
                            </span>
                          </div>
                        )) : exOthers.map((c, i) => {
                          const title  = typeof c === 'string' ? c : (c.title || c.description || JSON.stringify(c))
                          const person = typeof c === 'object' ? (c.person || c.committed_by || c.committed_by_name || '') : ''
                          return (
                            <div key={i} className="flex items-start gap-2.5">
                              <button
                                onClick={() => pushOtherDone(meeting.id, title, person)}
                                className="flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 border-[#d0d0cc] hover:border-green-500 flex items-center justify-center transition-colors"
                                title="Mark done + save"
                              />
                              <span className="text-sm text-[#1a1a18] leading-snug">
                                {person && <span className="font-medium text-[#1B2A4A]">{person}: </span>}
                                {title}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Key decisions */}
                  {decisions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">Key Decisions</p>
                      <div className="space-y-1">
                        {decisions.map((d, i) => {
                          const text = typeof d === 'string' ? d : (d.decision || d.title || d.description || JSON.stringify(d))
                          return (
                            <div key={i} className="flex items-start gap-2">
                              <span className="text-[#C9A84C] text-xs mt-0.5 flex-shrink-0">▸</span>
                              <span className="text-sm text-[#1a1a18] leading-snug">{text}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Risk signals */}
                  {risks.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">Risk Signals</p>
                      <div className="space-y-1">
                        {risks.map((r, i) => {
                          const text = typeof r === 'string' ? r : (r.description || r.risk || r.title || JSON.stringify(r))
                          return (
                            <div key={i} className="flex items-start gap-2">
                              <span className="text-red-400 text-xs mt-0.5 flex-shrink-0">⚠</span>
                              <span className="text-sm text-[#1a1a18] leading-snug">{text}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Footer: view full detail */}
                  <div className="flex items-center justify-between pt-1 border-t border-[#f0f0ee]">
                    <span className="text-xs text-[#9b9b97]">
                      {meetingTasks.filter(t => t.status === 'done').length}/{meetingTasks.length || exTasks.length} tasks done
                      {meetingOthers.length > 0 && ` · ${meetingOthers.filter(c => c.status === 'closed').length}/${meetingOthers.length} others closed`}
                    </span>
                    <button
                      onClick={() => navigate(`/meeting/${meeting.id}`)}
                      className="text-xs text-[#1B2A4A] font-medium hover:underline"
                    >
                      View full detail →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Bulk Assign Floating Bar ──────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex justify-center px-4 pb-20">
          <div className="bg-[#1a1a18] text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 w-full max-w-lg">
            <span className="text-sm font-medium whitespace-nowrap">
              {selected.size} selected
            </span>
            <select
              value={bulkProject}
              onChange={e => {
                if (e.target.value === '__new__') {
                  setCreateForMeeting(null)
                  setNewProjectName('')
                  setShowCreateProject(true)
                  return
                }
                setBulkProject(e.target.value)
              }}
              className="flex-1 text-sm bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-white/40 min-w-0"
            >
              <option value="" className="text-black bg-white">Select project…</option>
              {activeProjects.map(p => (
                <option key={p.id} value={p.id} className="text-black bg-white">{p.name}</option>
              ))}
              <option value="__new__" className="text-black bg-white">＋ Create new project…</option>
            </select>
            <button
              onClick={bulkAssign}
              disabled={!bulkProject || bulkSaving}
              className="text-sm font-semibold bg-white text-[#1a1a18] px-4 py-2 rounded-xl disabled:opacity-40 whitespace-nowrap hover:bg-gray-100 transition-colors"
            >
              {bulkSaving ? 'Saving…' : 'Assign'}
            </button>
            <button
              onClick={clearAll}
              className="text-white/60 hover:text-white text-lg leading-none px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
