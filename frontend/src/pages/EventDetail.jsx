import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getEvents, updateEvent, getMeetingNotes, getContacts } from '../lib/api'

// ── Helpers ────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return ''
  return dayjs(iso).format('dddd, MMMM D · h:mm A')
}
function duration(start, end) {
  if (!start || !end) return null
  const mins = dayjs(end).diff(dayjs(start), 'minute')
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function parseAttendees(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return []
  return raw.map(a => {
    if (typeof a === 'string') {
      return a.includes('@') ? { email: a, name: a.split('@')[0] } : { name: a, email: null }
    }
    return { name: a.name || a.email || 'Unknown', email: a.email || null }
  })
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function notesOverlap(note, attendeeEmails, attendeeNames) {
  const participants = (note.participants || []).map(p => p.toLowerCase())
  for (const email of attendeeEmails) {
    if (participants.some(p => p.includes(email.toLowerCase()))) return true
  }
  for (const name of attendeeNames) {
    const last = name.split(' ').pop().toLowerCase()
    if (last.length > 2 && participants.some(p => p.includes(last))) return true
  }
  return false
}

// ── Auto-save notes field ──────────────────────────────────────
function NotesField({ icon, label, placeholder, value: initialValue, onSave }) {
  const [value, setValue]   = useState(initialValue || '')
  const [status, setStatus] = useState('idle')
  const timerRef = useRef(null)

  useEffect(() => { setValue(initialValue || '') }, [initialValue])

  const handleChange = useCallback((e) => {
    const v = e.target.value
    setValue(v)
    setStatus('idle')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setStatus('saving')
      try {
        await onSave(v)
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 2000)
      } catch { setStatus('idle') }
    }, 800)
  }, [onSave])

  return (
    <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#1a1a18] uppercase tracking-wide">{icon} {label}</p>
        {status === 'saving' && <span className="text-[10px] text-[#9b9b97]">Saving…</span>}
        {status === 'saved'  && <span className="text-[10px] text-green-500">✓ Saved</span>}
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        rows={4}
        className="w-full text-sm text-[#1a1a18] placeholder-[#c0c0bc] resize-none focus:outline-none leading-relaxed"
      />
    </div>
  )
}

// ── Past recording row ─────────────────────────────────────────
function RecordingRow({ note }) {
  const [open, setOpen] = useState(false)
  const ryanItems   = (note.action_items_raw || []).filter(
    a => a.is_ryan_item || a.assignee_email === 'hankinsr@claycorp.com'
  )
  const othersItems = (note.action_items_raw || []).filter(
    a => !a.is_ryan_item && a.assignee_email !== 'hankinsr@claycorp.com'
  )
  const source = note.otter_id?.startsWith('plaud_') ? 'Plaud' : 'Otter'

  return (
    <div
      className="border border-[#e5e5e3] rounded-xl p-3 cursor-pointer hover:bg-[#f8f8f6] transition-colors"
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#1a1a18] flex-1 truncate">{note.title || 'Untitled'}</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-[#9b9b97] bg-gray-100 px-1.5 py-0.5 rounded">{source}</span>
          {note.duration_raw && <span className="text-[10px] text-[#9b9b97]">{note.duration_raw}</span>}
          <span className="text-[10px] text-[#9b9b97]">{note.start_time?.split('T')[0]}</span>
          <span className="text-[10px] text-[#9b9b97]">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {!open && note.short_summary && (
        <p className="text-xs text-[#6b6b67] mt-1 line-clamp-2">{note.short_summary}</p>
      )}

      {open && (
        <div className="mt-2 space-y-2 border-t border-[#f0f0ee] pt-2">
          {note.short_summary && (
            <p className="text-xs text-[#6b6b67] leading-relaxed">{note.short_summary}</p>
          )}
          {ryanItems.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1">My items</p>
              {ryanItems.map((item, i) => (
                <p key={i} className="text-xs text-[#1a1a18] ml-2">· {item.task_text}</p>
              ))}
            </div>
          )}
          {othersItems.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#6b6b67] uppercase tracking-wide mb-1">Others' items</p>
              {othersItems.map((item, i) => (
                <p key={i} className="text-xs text-[#6b6b67] ml-2">
                  · {item.assignee_name ? `${item.assignee_name}: ` : ''}{item.task_text}
                </p>
              ))}
            </div>
          )}
          {ryanItems.length === 0 && othersItems.length === 0 && (
            <p className="text-xs text-[#9b9b97] italic">No action items recorded.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────
export default function EventDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { data: allEvents, isLoading } = useQuery({
    queryKey: ['events'], queryFn: getEvents, staleTime: 2 * 60 * 1000
  })
  const { data: allNotes = [] } = useQuery({
    queryKey: ['meeting-notes'], queryFn: getMeetingNotes, staleTime: 5 * 60 * 1000
  })
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'], queryFn: getContacts, staleTime: 5 * 60 * 1000
  })

  const event = (allEvents || []).find(e => String(e.id) === String(id))

  const save = useMutation({
    mutationFn: (updates) => updateEvent(id, updates),
    onSuccess: (updated) => {
      qc.setQueryData(['events'], old =>
        (old || []).map(e => String(e.id) === String(id) ? { ...e, ...updated } : e)
      )
    }
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
        <p className="text-sm text-[#6b6b67]">Loading…</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#6b6b67]">Meeting not found.</p>
        <button onClick={() => navigate(-1)} className="text-xs text-blue-500 underline">← Back</button>
      </div>
    )
  }

  const attendees      = parseAttendees(event.attendees)
  const attendeeEmails = attendees.map(a => a.email).filter(Boolean)
  const attendeeNames  = attendees.map(a => a.name).filter(Boolean)
  const isPast         = dayjs(event.end_time || event.start_time).isBefore(dayjs())
  const dur            = duration(event.start_time, event.end_time)

  const relatedNotes = allNotes
    .filter(n => notesOverlap(n, attendeeEmails, attendeeNames))
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))

  const findContact = (email, name) => {
    if (email) {
      const c = contacts.find(c => c.email?.toLowerCase() === email.toLowerCase())
      if (c) return c
    }
    if (name) {
      const lower = name.toLowerCase()
      return contacts.find(c =>
        c.name?.toLowerCase().includes(lower) || lower.includes((c.name || '').toLowerCase())
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0">
            ← Back
          </button>
          <p className="text-sm font-semibold text-[#1a1a18] flex-1 truncate">{event.title}</p>
          {event.high_stakes && <span title={event.stakes_reason}>🔥</span>}
          {event.join_link && (
            <a
              href={event.join_link}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 flex-shrink-0"
            >
              Join
            </a>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">

        {/* Header */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <p className="text-sm font-semibold text-[#1a1a18]">{fmtDate(event.start_time)}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-[#6b6b67]">
            {dur && <span>{dur}</span>}
            {event.location && <span>· {event.location}</span>}
            {isPast && <span className="text-[#9b9b97]">· Past</span>}
          </div>
          {attendees.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {attendees.map((a, i) => {
                const contact = findContact(a.email, a.name)
                const circle = (
                  <div
                    className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-bold"
                    title={a.name}
                  >
                    {getInitials(a.name)}
                  </div>
                )
                return contact
                  ? <Link key={i} to={`/contact/${contact.id}`} className="flex-shrink-0">{circle}</Link>
                  : <div key={i} className="flex-shrink-0">{circle}</div>
              })}
              <span className="text-xs text-[#9b9b97]">
                {attendees.length} attendee{attendees.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* AI Brief */}
        <div className={`rounded-2xl p-4 border ${event.body ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e5e5e3]'}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">✨ AI Brief</p>
          {event.body ? (
            <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-line">{event.body}</p>
          ) : (
            <p className="text-xs text-[#9b9b97] italic">
              {isPast
                ? 'No brief was generated for this meeting.'
                : 'Brief generates tonight — add notes below to shape it.'}
            </p>
          )}
          {event.stakes_reason && (
            <p className="text-xs text-amber-600 mt-2 border-t border-amber-200 pt-2">🔥 {event.stakes_reason}</p>
          )}
        </div>

        {/* Notes — pre (upcoming) or post + collapsed pre (past) */}
        {!isPast ? (
          <NotesField
            icon="📝"
            label="Pre-meeting notes"
            placeholder="Topics to cover, background context, what you want to walk out with, concerns to flag…"
            value={event.pre_meeting_notes}
            onSave={(v) => save.mutateAsync({ pre_meeting_notes: v })}
          />
        ) : (
          <>
            <NotesField
              icon="📋"
              label="Post-meeting notes"
              placeholder="What happened, decisions made, action items, anything the recording won't capture…"
              value={event.post_meeting_notes}
              onSave={(v) => save.mutateAsync({ post_meeting_notes: v })}
            />
            {event.pre_meeting_notes && (
              <details className="bg-white border border-[#e5e5e3] rounded-2xl">
                <summary className="px-4 py-3 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide cursor-pointer select-none">
                  📝 Pre-meeting notes
                </summary>
                <p className="px-4 pb-3 text-sm text-[#6b6b67] leading-relaxed whitespace-pre-line">
                  {event.pre_meeting_notes}
                </p>
              </details>
            )}
          </>
        )}

        {/* Recordings with these people */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#1a1a18] uppercase tracking-wide">🎙 Recordings with these people</p>
            <span className="text-xs text-[#9b9b97]">{relatedNotes.length} found</span>
          </div>
          {relatedNotes.length === 0 ? (
            <p className="text-xs text-[#9b9b97] italic">No past recordings found with these attendees.</p>
          ) : (
            <div className="space-y-2">
              {relatedNotes.slice(0, 6).map(note => (
                <RecordingRow key={note.id || note.otter_id} note={note} />
              ))}
              {relatedNotes.length > 6 && (
                <p className="text-xs text-[#9b9b97] text-center pt-1">+ {relatedNotes.length - 6} more</p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
