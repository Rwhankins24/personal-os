import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  getEvents,
  getMeetingNotes,
  getTasks, updateTask,
  getOthersCommitments,
  getEmails,
  getPendingDecisions,
  getContacts,
} from '../lib/api'

dayjs.extend(relativeTime)

// ── Design tokens ──────────────────────────────────────────────
const URGENCY_DOT = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
}

// ── Helpers ────────────────────────────────────────────────────

// Parse attendees from a JSONB field that may be:
//   [{name, email}, ...] | ["email@...", ...] | null
function parseAttendees(raw) {
  if (!raw || !Array.isArray(raw)) return { emails: [], names: [] }
  const emails = []
  const names  = []
  for (const a of raw) {
    if (typeof a === 'string') {
      // could be email or name
      if (a.includes('@')) emails.push(a.toLowerCase())
      else names.push(a.toLowerCase())
    } else if (typeof a === 'object' && a !== null) {
      if (a.email) emails.push(a.email.toLowerCase())
      if (a.name)  names.push(a.name.toLowerCase())
    }
  }
  return { emails, names }
}

// Extract first 3 significant words (>3 chars) from a title for keyword matching
function titleKeywords(title = '') {
  const stopWords = new Set(['the', 'and', 'with', 'for', 'from', 'this', 'that', 'have', 'will', 'are'])
  return title.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 3)
}

function fmtTime(iso) {
  if (!iso) return ''
  return dayjs(iso).format('h:mm A')
}

function fmtDate(iso) {
  if (!iso) return ''
  return dayjs(iso).format('ddd, MMM D, YYYY')
}

function computeDuration(start, end) {
  if (!start || !end) return null
  const mins = dayjs(end).diff(dayjs(start), 'minute')
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// Initials avatar for attendees
function Avatar({ name, email }) {
  const label = name || email || '?'
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('')
  const colors = [
    'bg-blue-200 text-blue-800',
    'bg-purple-200 text-purple-800',
    'bg-green-200 text-green-800',
    'bg-orange-200 text-orange-800',
    'bg-pink-200 text-pink-800',
    'bg-teal-200 text-teal-800',
  ]
  // deterministic color from label
  const idx = label.charCodeAt(0) % colors.length
  return (
    <span
      title={label}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold flex-shrink-0 ${colors[idx]}`}
    >
      {initials}
    </span>
  )
}

// Section header in all-caps small label style
function SectionLabel({ icon, label, note }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      {icon && <span className="text-sm">{icon}</span>}
      <span className="text-xs font-semibold text-[#6b6b67] uppercase tracking-wider">{label}</span>
      {note && <span className="text-xs text-gray-400 normal-case">{note}</span>}
    </div>
  )
}

// Delivery type icon for others' commitments
function deliveryIcon(type) {
  const map = { email: '📧', call: '📞', document: '📄', slack: '💬', meeting: '📅', report: '📊' }
  if (!type) return '📌'
  return map[type.toLowerCase()] || '📌'
}

// ── Expandable past meeting row ────────────────────────────────
function PastMeetingRow({ note }) {
  const [open, setOpen] = useState(false)
  const ryanItems  = (note.action_items || []).filter(i =>
    i.is_ryan_item || (i.assignee_email || '').toLowerCase().includes('hankinsr@claycorp.com')
  )
  const otherItems = (note.action_items || []).filter(i =>
    !i.is_ryan_item && !(i.assignee_email || '').toLowerCase().includes('hankinsr@claycorp.com')
  )
  const hasItems = ryanItems.length > 0 || otherItems.length > 0

  return (
    <div className="border border-[#e5e5e3] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm mt-0.5">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1a1a18] truncate">{note.title || note.meeting_title}</p>
          <p className="text-xs text-[#6b6b67]">
            {note.meeting_date ? fmtDate(note.meeting_date) : ''}
            {note.duration_raw ? ` · ${note.duration_raw}` : ''}
          </p>
          {note.short_summary && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{note.short_summary}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{open ? '▲' : '▼'}</span>
      </button>

      {open && hasItems && (
        <div className="border-t border-[#e5e5e3] px-3 pb-3 pt-2 bg-gray-50 space-y-2">
          {ryanItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-blue-700 mb-1">My action items</p>
              <ul className="space-y-0.5">
                {ryanItems.map((item, i) => (
                  <li key={i} className="text-xs text-[#1a1a18] flex items-start gap-1.5">
                    <span className="text-blue-400 flex-shrink-0 mt-0.5">•</span>
                    {item.text || item.description || item.action || JSON.stringify(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Others' action items</p>
              <ul className="space-y-0.5">
                {otherItems.map((item, i) => (
                  <li key={i} className="text-xs text-[#6b6b67] flex items-start gap-1.5">
                    <span className="text-gray-400 flex-shrink-0 mt-0.5">•</span>
                    {item.assignee_name ? <strong className="font-medium">{item.assignee_name}: </strong> : null}
                    {item.text || item.description || item.action || JSON.stringify(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {open && !hasItems && (
        <div className="border-t border-[#e5e5e3] px-3 py-2 bg-gray-50">
          <p className="text-xs text-gray-400">No action items recorded.</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function EventDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { data: events,      isLoading: loadingEvents }  = useQuery({ queryKey: ['events'],              queryFn: getEvents })
  const { data: meetingNotes }                            = useQuery({ queryKey: ['meeting-notes'],       queryFn: getMeetingNotes })
  const { data: tasks }                                   = useQuery({ queryKey: ['tasks'],               queryFn: getTasks })
  const { data: othersCommitments }                       = useQuery({ queryKey: ['others-commitments'],  queryFn: () => getOthersCommitments('open') })
  const { data: emails }                                  = useQuery({ queryKey: ['emails'],              queryFn: getEmails })
  const { data: pendingDecisions }                        = useQuery({ queryKey: ['pending-decisions'],   queryFn: getPendingDecisions })
  const { data: contacts }                                = useQuery({ queryKey: ['contacts'],            queryFn: getContacts })

  const completeTask = useMutation({
    mutationFn: (taskId) => updateTask(taskId, { status: 'complete' }),
    onSuccess: (updated) => {
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => t.id === updated.id ? updated : t)
      )
    },
  })

  // ── Find event ─────────────────────────────────────────────
  const event = (events || []).find(e => String(e.id) === String(id))

  if (loadingEvents) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-[#6b6b67]">Loading meeting context...</p>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
        <p className="text-gray-500">Meeting not found</p>
        <button onClick={() => navigate('/')} className="text-blue-600 text-sm hover:underline">← Back</button>
      </div>
    )
  }

  // ── Parse attendees ────────────────────────────────────────
  const { emails: attendeeEmails, names: attendeeNames } = parseAttendees(event.attendees)
  // Combined list for display
  const attendeeList = (() => {
    if (!event.attendees || !Array.isArray(event.attendees)) return []
    return event.attendees.map(a => {
      if (typeof a === 'string') return { name: a.includes('@') ? null : a, email: a.includes('@') ? a : null }
      return { name: a.name || null, email: a.email || null }
    })
  })()

  const keywords = titleKeywords(event.title || '')

  // Helper: does a string overlap with attendee emails/names?
  function matchesAttendee(str) {
    if (!str) return false
    const s = str.toLowerCase()
    return attendeeEmails.some(e => s.includes(e)) || attendeeNames.some(n => n.length > 2 && s.includes(n))
  }

  // ── Filter: past meetings ──────────────────────────────────
  const relatedMeetings = (meetingNotes || []).filter(note => {
    const participants = note.participants || []
    const titleLower   = (note.title || note.meeting_title || '').toLowerCase()
    // participants array: strings (names or emails)
    const participantMatch = participants.some(p => {
      const pl = (p || '').toLowerCase()
      return (
        attendeeEmails.some(e => pl.includes(e)) ||
        attendeeNames.some(n => n.length > 2 && pl.includes(n))
      )
    })
    // title contains any attendee last name
    const lastNameMatch = attendeeNames.some(fullName => {
      const parts = fullName.trim().split(/\s+/)
      const lastName = parts[parts.length - 1]
      return lastName && lastName.length > 2 && titleLower.includes(lastName)
    })
    return participantMatch || lastNameMatch
  })

  // ── Filter: related tasks (open only) ──────────────────────
  const relatedTasks = (tasks || []).filter(t => {
    if (t.status === 'done' || t.status === 'complete') return false
    const sourceLabel = (t.source_label || '').toLowerCase()
    const context     = (t.context || '').toLowerCase()
    const titleMatch  = attendeeNames.some(n => {
      const parts = n.trim().split(/\s+/)
      return parts.some(p => p.length > 2 && sourceLabel.includes(p))
    })
    const keywordMatch = keywords.some(kw => context.includes(kw))
    return titleMatch || keywordMatch
  })

  // ── Filter: others' commitments ────────────────────────────
  const relatedCommitments = (othersCommitments || []).filter(c => {
    const emailMatch = attendeeEmails.includes((c.committed_by_email || '').toLowerCase())
    const nameMatch  = attendeeNames.some(n => {
      const cbn = (c.committed_by_name || '').toLowerCase()
      return cbn.length > 2 && (cbn.includes(n) || n.includes(cbn))
    })
    return emailMatch || nameMatch
  })

  // ── Filter: related emails ─────────────────────────────────
  const relatedEmails = (emails || []).filter(em => {
    if (em.status === 'done' || em.bucket === 5) return false
    const fromMatch    = attendeeEmails.includes((em.from_address || '').toLowerCase())
    const subjectLower = (em.thread_subject || em.subject || '').toLowerCase()
    const subjectMatch = keywords.some(kw => subjectLower.includes(kw))
    return fromMatch || subjectMatch
  })

  // ── All open pending decisions ─────────────────────────────
  const openDecisions = (pendingDecisions || []).filter(d =>
    !d.resolved && d.status !== 'resolved' && d.status !== 'closed'
  )

  // ── Display values ─────────────────────────────────────────
  const duration = computeDuration(event.start_time, event.end_time)

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-[#1a1a18] truncate">{event.title}</h1>
            {event.high_stakes && (
              <span title={event.stakes_reason || 'High stakes'} className="text-base flex-shrink-0">🔥</span>
            )}
          </div>
          {event.join_link && (
            <a
              href={event.join_link}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Join
            </a>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ── Header card ─────────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <h2 className="text-xl font-bold text-[#1a1a18] leading-snug mb-2">{event.title}</h2>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#6b6b67]">
            <span>📅 {fmtDate(event.start_time)}</span>
            {event.start_time && (
              <span>
                🕐 {fmtTime(event.start_time)}
                {event.end_time && ` – ${fmtTime(event.end_time)}`}
              </span>
            )}
            {duration && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{duration}</span>
            )}
            {event.location && (
              <span>📍 {event.location}</span>
            )}
          </div>

          {attendeeList.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              {attendeeList.slice(0, 8).map((a, i) => (
                <Avatar key={i} name={a.name} email={a.email} />
              ))}
              {attendeeList.length > 8 && (
                <span className="text-xs text-[#6b6b67] ml-1">+{attendeeList.length - 8} more</span>
              )}
              <span className="text-xs text-[#6b6b67] ml-1">
                {attendeeList.length} attendee{attendeeList.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* ── AI Brief / Invite body ───────────────────────── */}
        {event.body ? (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4 border-l-4 border-l-amber-400">
            <SectionLabel icon="✨" label="AI Brief" />
            <div
              className="text-sm text-[#1a1a18] leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{
                __html: event.body
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\n\n/g, '<br><br>')
                  .replace(/\n/g, '<br>')
              }}
            />
            {event.high_stakes && event.stakes_reason && (
              <div className="mt-3 pt-3 border-t border-amber-100">
                <p className="text-xs text-amber-700 font-medium">🔥 {event.stakes_reason}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <SectionLabel icon="✨" label="AI Brief" />
            <p className="text-sm text-gray-400 italic">No AI brief yet.</p>
            {event.high_stakes && event.stakes_reason && (
              <p className="text-xs text-amber-700 font-medium mt-2">🔥 {event.stakes_reason}</p>
            )}
          </div>
        )}

        {/* ── Past meetings ────────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <SectionLabel icon="🕐" label="Past Meetings with These People" />
          {relatedMeetings.length === 0 ? (
            <p className="text-sm text-gray-400">No past meetings found with these attendees.</p>
          ) : (
            <div className="space-y-2">
              {relatedMeetings.map(note => (
                <PastMeetingRow key={note.id} note={note} />
              ))}
            </div>
          )}
        </div>

        {/* ── My open items ────────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <SectionLabel icon="✅" label="My Open Items" />
          {relatedTasks.length === 0 ? (
            <p className="text-sm text-gray-400">No open items tied to this meeting.</p>
          ) : (
            <ul className="space-y-2">
              {relatedTasks.map(task => {
                const overdue = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')
                return (
                  <li key={task.id} className="flex items-start gap-2.5">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${URGENCY_DOT[task.urgency] || 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/task/${task.id}`}
                        className="text-sm font-medium text-[#1a1a18] hover:text-blue-600 hover:underline leading-snug"
                      >
                        {task.title}
                      </Link>
                      {task.due_date && (
                        <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500' : 'text-[#6b6b67]'}`}>
                          Due {dayjs(task.due_date).format('MMM D')}
                          {overdue ? ' — overdue' : ''}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => completeTask.mutate(task.id)}
                      disabled={completeTask.isPending}
                      title="Mark complete"
                      className="flex-shrink-0 w-7 h-7 rounded-full border border-gray-300 text-gray-400 hover:border-green-500 hover:text-green-600 hover:bg-green-50 flex items-center justify-center text-xs transition-colors disabled:opacity-40"
                    >
                      ✓
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ── What they owe ────────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <SectionLabel icon="📬" label="What They Owe" />
          {relatedCommitments.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing outstanding from these attendees.</p>
          ) : (
            <ul className="space-y-2.5">
              {relatedCommitments.map(c => {
                const isOverdue = c.due_date && dayjs(c.due_date).isBefore(dayjs(), 'day')
                return (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <span className="text-base flex-shrink-0 mt-0.5">{deliveryIcon(c.delivery_type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] leading-snug">{c.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {c.committed_by_name && (
                          <span className="text-xs text-[#6b6b67]">{c.committed_by_name}</span>
                        )}
                        {c.due_date && (
                          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
                            Due {dayjs(c.due_date).format('MMM D')}
                            {isOverdue ? ' — overdue' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ── Related emails ───────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <SectionLabel icon="📧" label="Related Emails" />
          {relatedEmails.length === 0 ? (
            <p className="text-sm text-gray-400">No related email threads.</p>
          ) : (
            <ul className="space-y-2.5">
              {relatedEmails.map(em => {
                const daysWaiting = em.received_at
                  ? dayjs().diff(dayjs(em.received_at), 'day')
                  : null
                return (
                  <li key={em.id} className="flex items-start gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] truncate">
                        {em.from_name || em.from_address || 'Unknown sender'}
                      </p>
                      <p className="text-xs text-[#6b6b67] truncate">
                        {em.thread_subject || em.subject || '(no subject)'}
                      </p>
                    </div>
                    {daysWaiting !== null && daysWaiting >= 0 && (
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                        daysWaiting >= 7  ? 'bg-red-100 text-red-600' :
                        daysWaiting >= 3  ? 'bg-orange-100 text-orange-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {daysWaiting === 0 ? 'today' : `${daysWaiting}d`}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ── Open decisions ───────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <SectionLabel icon="⚖️" label="Open Decisions" note="(not filtered — all open)" />
          {openDecisions.length === 0 ? (
            <p className="text-sm text-gray-400">No open decisions.</p>
          ) : (
            <ul className="space-y-2.5">
              {openDecisions.map(d => (
                <li key={d.id} className="flex items-start gap-2.5">
                  <span className="text-sm flex-shrink-0 mt-0.5">🔷</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1a1a18] leading-snug">{d.title || d.decision_text || d.question}</p>
                    {d.blocking && (
                      <span className="mt-0.5 inline-block text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">blocking</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  )
}
