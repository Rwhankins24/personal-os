import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { getMeetingNotes, updateMeetingNote, getProjects } from '../lib/api'

const SOURCE_LABEL = {
  plaud: { icon: '🎙', label: 'Plaud' },
  otter: { icon: '🎙', label: 'Otter' },
  manual: { icon: '📝', label: 'Manual' },
}

export default function MeetingsPage() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('all') // all | unlinked | linked
  const [editing, setEditing] = useState(null)  // meeting id being project-assigned

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ['meeting-notes'],
    queryFn:  getMeetingNotes,
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn:  getProjects,
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

  const activeProjects = projects.filter(p => p.status === 'active')

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
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold text-[#1a1a18]">Meetings</h1>
            <span className="text-xs text-[#6b6b67]">{filtered.length} of {meetings.length}</span>
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

      {/* ── List ───────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[#6b6b67] text-center py-10">No meetings found</p>
        )}

        {filtered.map(meeting => {
          const date      = meeting.meeting_date || meeting.start_time
          const project   = activeProjects.find(p => p.id === meeting.project_id)
          const src       = SOURCE_LABEL[meeting.source] || { icon: '🎙', label: meeting.source || '' }
          const hasTranscript = !!(meeting.full_transcript || meeting.raw_transcript)
          const isEditing = editing === meeting.id

          return (
            <div
              key={meeting.id}
              className="bg-white border border-[#e5e5e3] rounded-2xl p-4"
            >
              {/* Title row */}
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1a1a18] leading-snug">
                    {meeting.title || 'Untitled Meeting'}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {date && (
                      <span className="text-xs text-[#6b6b67]">
                        {dayjs(date).format('MMM D, YYYY')}
                      </span>
                    )}
                    <span className="text-xs text-[#9b9b97]">{src.icon} {src.label}</span>
                    {hasTranscript && (
                      <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">transcript</span>
                    )}
                    {meeting.intelligence_extracted && (
                      <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">analyzed</span>
                    )}
                  </div>
                </div>

                {/* Project badge / assign button */}
                <div className="flex-shrink-0">
                  {isEditing ? (
                    <select
                      autoFocus
                      defaultValue={meeting.project_id || ''}
                      onChange={e => {
                        update.mutate({
                          id:   meeting.id,
                          data: { project_id: e.target.value || null },
                        })
                      }}
                      onBlur={() => setEditing(null)}
                      className="text-xs border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    >
                      <option value="">No project</option>
                      {activeProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  ) : project ? (
                    <button
                      onClick={() => setEditing(meeting.id)}
                      className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                    >
                      {project.name}
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditing(meeting.id)}
                      className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      + Assign project
                    </button>
                  )}
                </div>
              </div>

              {/* Summary preview */}
              {meeting.summary && (
                <p className="text-xs text-[#6b6b67] mt-2 line-clamp-2 leading-relaxed">
                  {meeting.summary}
                </p>
              )}

              {/* Participants */}
              {(meeting.participants || []).length > 0 && (
                <p className="text-xs text-[#9b9b97] mt-1.5">
                  {meeting.participants.slice(0, 5).join(', ')}
                  {meeting.participants.length > 5 && ` +${meeting.participants.length - 5} more`}
                </p>
              )}

              {/* Intelligence summary row */}
              {meeting.intelligence_extracted && (
                <div className="flex gap-3 mt-2 pt-2 border-t border-gray-50 flex-wrap">
                  {meeting.event_id && (
                    <button
                      onClick={() => navigate(`/event/${meeting.event_id}`)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      📅 View event
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
