import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  getTasks, createTask, updateTask, deleteTask,
  getEvents, getEmails, updateEmail,
  getCommitments, updateCommitment,
  getMeetingNotes, createCapture,
} from '../lib/api'
import { useStore } from '../store/useStore'

// ── Helpers ───────────────────────────────────────────────────

const URGENCY_COLOR = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
}

const WS_COLOR = {
  work:     { bg: 'bg-work-light',     text: 'text-work',     dot: 'bg-work'     },
  personal: { bg: 'bg-personal-light', text: 'text-personal', dot: 'bg-personal' },
  other:    { bg: 'bg-other-light',    text: 'text-other',    dot: 'bg-other'     },
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-gray-400">
      <span className="text-3xl mb-2">{icon}</span>
      <p className="text-sm">{message}</p>
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white border border-[#e5e5e3] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ title, count, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[#1a1a18]">{title}</h2>
        {count !== undefined && (
          <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {action}
    </div>
  )
}

// ── WorkspaceBar ──────────────────────────────────────────────

function WorkspaceBar({ workspace, setWorkspace }) {
  const tabs = ['all', 'work', 'personal', 'other']
  return (
    <div className="flex items-center gap-1 bg-white border border-[#e5e5e3] rounded-xl px-2 py-1.5 w-fit">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => setWorkspace(tab)}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-all capitalize ${
            workspace === tab
              ? tab === 'all'     ? 'bg-[#1a1a18] text-white'
              : tab === 'work'    ? 'bg-work text-white'
              : tab === 'personal'? 'bg-personal text-white'
              :                     'bg-other text-white'
              : 'text-[#6b6b67] hover:text-[#1a1a18] hover:bg-gray-50'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

// ── DateHeader ────────────────────────────────────────────────

function DateHeader() {
  const now = dayjs()
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1a1a18]">
        {now.format('dddd, MMMM D')}
      </h1>
      <p className="text-xs text-[#6b6b67] mt-0.5">
        Last synced {now.format('h:mm A')}
      </p>
    </div>
  )
}

// ── StatCards ─────────────────────────────────────────────────

function StatCards({ tasks, emails, events, commitments }) {
  const todayUTC    = new Date().toISOString().split('T')[0]
  const openTasks   = tasks?.filter(t => t.status !== 'done').length ?? 0
  const needsReply  = emails?.filter(e => e.status === 'needs_reply').length ?? 0
  const todayEvents = events?.filter(e => e.start_time?.split('T')[0] === todayUTC).length ?? 0
  const openCommit  = commitments?.filter(c => c.status === 'open').length ?? 0

  const stats = [
    { label: 'Meetings Today', value: todayEvents,   icon: '📅' },
    { label: 'Open Tasks',     value: openTasks,     icon: '✅' },
    { label: 'Needs Reply',    value: needsReply,    icon: '📬' },
    { label: 'Commitments',    value: openCommit,    icon: '🤝' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map(s => (
        <Card key={s.label} className="flex items-center gap-3">
          <span className="text-2xl">{s.icon}</span>
          <div>
            <p className="text-2xl font-bold text-[#1a1a18]">{s.value}</p>
            <p className="text-xs text-[#6b6b67]">{s.label}</p>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── CalendarStrip ─────────────────────────────────────────────

function CalendarStrip({ events, isLoading }) {
  const todayUTC    = new Date().toISOString().split('T')[0]
  const todayEvents = events?.filter(e => e.start_time?.split('T')[0] === todayUTC) ?? []

  function fmtTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <Card>
      <SectionHeader title="Today's Schedule" count={todayEvents.length} />
      {isLoading ? <Spinner /> : todayEvents.length === 0 ? (
        <EmptyState icon="📅" message="No meetings today — clear runway" />
      ) : (
        <div className="space-y-2">
          {todayEvents.map(event => {
            const wsName = event.workspaces?.name || 'work'
            const c = WS_COLOR[wsName] || WS_COLOR.work
            return (
              <div key={event.id} className={`flex items-center gap-3 p-2 rounded-lg ${c.bg}`}>
                <div className={`w-1 h-10 rounded-full ${c.dot} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a18] truncate">{event.title}</p>
                  <p className="text-xs text-[#6b6b67]">
                    {fmtTime(event.start_time)}
                    {event.end_time && ` – ${fmtTime(event.end_time)}`}
                    {event.location && ` · ${event.location}`}
                  </p>
                </div>
                {event.join_link && (
                  <a
                    href={event.join_link}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-xs font-medium ${c.text} hover:underline flex-shrink-0`}
                  >
                    Join
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── TaskPanel ─────────────────────────────────────────────────

function TaskPanel({ tasks, isLoading }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: ({ id, status }) => updateTask(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const open = tasks?.filter(t => t.status !== 'done').slice(0, 5) ?? []

  return (
    <Card>
      <SectionHeader
        title="Tasks"
        count={open.length}
        action={
          <span className="text-xs text-[#6b6b67]">
            {tasks?.filter(t => t.status === 'done').length ?? 0} done today
          </span>
        }
      />
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="✅" message="No open tasks" />
      ) : (
        <div className="space-y-2">
          {open.map(task => (
            <div key={task.id} className="flex items-start gap-3 group">
              <input
                type="checkbox"
                checked={task.status === 'done'}
                onChange={() => toggle.mutate({
                  id: task.id,
                  status: task.status === 'done' ? 'open' : 'done',
                })}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#1a1a18] leading-snug">{task.title}</p>
                {task.context && (
                  <p className="text-xs text-[#6b6b67] mt-0.5 truncate">{task.context}</p>
                )}
              </div>
              {task.urgency && (
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[task.urgency] || 'bg-gray-300'}`} />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── CommitmentsPanel ──────────────────────────────────────────

function CommitmentsPanel({ commitments, isLoading }) {
  const qc = useQueryClient()
  const close = useMutation({
    mutationFn: (id) => updateCommitment(id, { status: 'closed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commitments'] }),
  })

  const open = commitments?.filter(c => c.status === 'open').slice(0, 4) ?? []

  return (
    <Card>
      <SectionHeader title="Commitments" count={open.length} />
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="🤝" message="No open commitments" />
      ) : (
        <div className="space-y-2">
          {open.map(c => {
            const overdue = c.due_date && dayjs(c.due_date).isBefore(dayjs(), 'day')
            return (
              <div key={c.id} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[c.urgency] || 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1a1a18] leading-snug">{c.title}</p>
                  <p className="text-xs text-[#6b6b67] mt-0.5">
                    {c.made_to && `To: ${c.made_to}`}
                    {c.due_date && (
                      <span className={overdue ? 'text-red-500 font-medium' : ''}>
                        {c.made_to ? ' · ' : ''}Due {dayjs(c.due_date).format('MMM D')}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => close.mutate(c.id)}
                  className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0"
                >
                  ✓
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── EmailQueue ────────────────────────────────────────────────

function EmailQueue({ emails, isLoading }) {
  const qc = useQueryClient()
  const mark = useMutation({
    mutationFn: ({ id, status }) => updateEmail(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  })

  const needsReply  = emails?.filter(e => e.status === 'needs_reply') ?? []
  const waitingOn   = emails?.filter(e => e.status === 'waiting_on')  ?? []

  return (
    <Card>
      <SectionHeader title="Email Queue" count={needsReply.length + waitingOn.length} />
      {isLoading ? <Spinner /> : needsReply.length === 0 && waitingOn.length === 0 ? (
        <EmptyState icon="📬" message="Inbox zero — nothing needs action" />
      ) : (
        <div className="space-y-3">
          {needsReply.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-2">Needs Reply</p>
              <div className="space-y-2">
                {needsReply.slice(0, 3).map(email => (
                  <div key={email.id} className="flex items-start gap-2 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] truncate">{email.from_name || email.from_address}</p>
                      <p className="text-xs text-[#6b6b67] truncate">{email.subject}</p>
                    </div>
                    <button
                      onClick={() => mark.mutate({ id: email.id, status: 'done' })}
                      className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      ✓
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {waitingOn.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[#6b6b67] uppercase tracking-wide mb-2">Waiting On</p>
              <div className="space-y-2">
                {waitingOn.slice(0, 2).map(email => (
                  <div key={email.id} className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1a1a18] truncate">{email.from_name || email.from_address}</p>
                      <p className="text-xs text-[#6b6b67] truncate">{email.subject}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ── MeetingNotes ──────────────────────────────────────────────

function MeetingNotesPanel({ notes, isLoading }) {
  const recent = notes?.slice(0, 3) ?? []

  return (
    <Card>
      <SectionHeader title="Recent Meetings" count={recent.length} />
      {isLoading ? <Spinner /> : recent.length === 0 ? (
        <EmptyState icon="📝" message="No meeting notes yet" />
      ) : (
        <div className="space-y-3">
          {recent.map(note => (
            <div key={note.id} className="border-b border-[#e5e5e3] last:border-0 pb-3 last:pb-0">
              <p className="text-sm font-medium text-[#1a1a18]">{note.title || 'Untitled Meeting'}</p>
              <p className="text-xs text-[#6b6b67] mt-0.5">
                {note.meeting_date && dayjs(note.meeting_date).format('MMM D, h:mm A')}
                {note.source && ` · ${note.source}`}
              </p>
              {note.ai_summary && (
                <p className="text-xs text-[#6b6b67] mt-1 line-clamp-2">{note.ai_summary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── QuickAdd ──────────────────────────────────────────────────

function QuickAdd() {
  const [value, setValue]   = useState('')
  const [type, setType]     = useState('text')
  const qc = useQueryClient()

  const add = useMutation({
    mutationFn: () => createCapture({ content: value, type }),
    onSuccess: () => {
      setValue('')
      qc.invalidateQueries({ queryKey: ['captures'] })
    },
  })

  const handleKey = (e) => {
    if (e.key === 'Enter' && value.trim()) add.mutate()
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e5e5e3] px-6 py-3">
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 text-[#6b6b67] bg-white"
        >
          <option value="text">📝 Note</option>
          <option value="url">🔗 URL</option>
          <option value="voice">🎙 Voice</option>
        </select>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Quick capture — type and press Enter..."
          className="flex-1 text-sm border border-[#e5e5e3] rounded-lg px-4 py-2 text-[#1a1a18] placeholder-[#6b6b67] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => value.trim() && add.mutate()}
          disabled={!value.trim() || add.isPending}
          className="px-4 py-2 bg-[#1a1a18] text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-800 transition-colors"
        >
          {add.isPending ? '...' : 'Capture'}
        </button>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────

export default function Dashboard() {
  const { workspace, setWorkspace } = useStore()

  const { data: tasks,       isLoading: loadingTasks }       = useQuery({ queryKey: ['tasks'],        queryFn: getTasks })
  const { data: events,      isLoading: loadingEvents }      = useQuery({ queryKey: ['events'],       queryFn: getEvents })
  const { data: emails,      isLoading: loadingEmails }      = useQuery({ queryKey: ['emails'],       queryFn: getEmails })
  const { data: commitments, isLoading: loadingCommitments } = useQuery({ queryKey: ['commitments'], queryFn: getCommitments })
  const { data: notes,       isLoading: loadingNotes }       = useQuery({ queryKey: ['notes'],        queryFn: getMeetingNotes })

  return (
    <div className="min-h-screen bg-[#f8f8f6] pb-20">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#f8f8f6] border-b border-[#e5e5e3] px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[#1a1a18] text-lg">Personal OS</span>
            <WorkspaceBar workspace={workspace} setWorkspace={setWorkspace} />
          </div>
          <DateHeader />
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-4">

        {/* Stat cards */}
        <StatCards
          tasks={tasks}
          emails={emails}
          events={events}
          commitments={commitments}
        />

        {/* Calendar strip */}
        <CalendarStrip events={events} isLoading={loadingEvents} />

        {/* Tasks + Commitments */}
        <div className="grid grid-cols-2 gap-4">
          <TaskPanel tasks={tasks} isLoading={loadingTasks} />
          <CommitmentsPanel commitments={commitments} isLoading={loadingCommitments} />
        </div>

        {/* Emails + Meeting Notes */}
        <div className="grid grid-cols-2 gap-4">
          <EmailQueue emails={emails} isLoading={loadingEmails} />
          <MeetingNotesPanel notes={notes} isLoading={loadingNotes} />
        </div>

      </div>

      {/* Quick capture bar */}
      <QuickAdd />
    </div>
  )
}
