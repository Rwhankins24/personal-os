import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { marked } from 'marked'
import {
  getTasks, updateTask,
  getEvents,
  getEmails, updateEmail,
  getCommitments, updateCommitment,
  getOthersCommitments, updateOthersCommitment,
  getProjects,
  getContacts,
  getCaptures, createCapture,
  getPendingDecisions, updatePendingDecision,
  getUnlinkedIntelligence, updateUnlinkedIntelligence,
  getAIQuestions, answerAIQuestion,
  getPipelineStatus,
} from '../lib/api'
import SyncButton from '../components/SyncButton'

dayjs.extend(relativeTime)

// ── Markdown renderer ──────────────────────────────────────────
function MarkdownBlock({ content, className = '' }) {
  if (!content) return null
  const html = marked.parse(content, { breaks: true, gfm: true })
  return (
    <div
      className={`prose prose-sm max-w-none text-[#1a1a18] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── Design tokens ──────────────────────────────────────────────
const URGENCY_COLOR = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
}

const URGENCY_TEXT = {
  critical: 'text-red-600 bg-red-50',
  high:     'text-orange-600 bg-orange-50',
  medium:   'text-yellow-700 bg-yellow-50',
  low:      'text-gray-500 bg-gray-100',
}

const WARMTH_COLOR = {
  hot:    'bg-red-100 text-red-700',
  warm:   'bg-orange-100 text-orange-700',
  cool:   'bg-blue-100 text-blue-700',
  cold:   'bg-gray-100 text-gray-500',
}

// ── ContactLink ────────────────────────────────────────────────
// Matches a display name against the contacts list (exact then partial),
// returns a tappable link if found, otherwise plain text.
function findContactByName(name, contacts) {
  if (!name || !contacts?.length) return null
  const lower = name.toLowerCase().trim()
  // Exact match
  let match = contacts.find(c => c.name?.toLowerCase() === lower)
  if (!match) {
    // Contact name contained in the display string, or vice versa
    match = contacts.find(c => {
      const cn = (c.name || '').toLowerCase()
      return cn.length > 1 && (lower.includes(cn) || cn.includes(lower))
    })
  }
  return match || null
}

function ContactLink({ name, contacts, className = '' }) {
  if (!name) return null
  const contact = findContactByName(name, contacts)
  if (!contact) return <span className={className}>{name}</span>
  return (
    <Link
      to={`/contact/${contact.id}`}
      className={`hover:underline hover:text-blue-600 transition-colors ${className}`}
      onClick={e => e.stopPropagation()}
    >
      {name}
    </Link>
  )
}

// ── Shared components ──────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-gray-400">
      <span className="text-2xl mb-1.5">{icon}</span>
      <p className="text-xs">{message}</p>
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white border border-[#e5e5e3] rounded-xl p-3 md:p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ title, count, badge, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[#1a1a18]">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">{count}</span>
        )}
        {badge && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </div>
      {action}
    </div>
  )
}

function PillBadge({ label, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-600',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[color] || colors.gray}`}>
      {label}
    </span>
  )
}

// ── Workspace tab bar ──────────────────────────────────────────
function WorkspaceBar({ workspace, setWorkspace }) {
  const tabs = ['all', 'work', 'personal', 'other']
  return (
    <div className="flex items-center gap-1">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => setWorkspace(tab)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize ${
            workspace === tab
              ? 'bg-[#1a1a18] text-white'
              : 'text-[#6b6b67] hover:text-[#1a1a18] hover:bg-gray-100'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

// ── Pipeline status banner ─────────────────────────────────────
function PipelineBanner() {
  const { data: status } = useQuery({
    queryKey: ['pipeline-status'],
    queryFn: getPipelineStatus,
    refetchInterval: 300000, // 5 min
    retry: false,
  })

  if (!status) return null

  const steps = [
    { key: 'email_pull_completed_at',   label: 'Email pull' },
    { key: 'upload_completed_at',       label: 'Upload' },
    { key: 'processing_completed_at',   label: 'Processing' },
    { key: 'ai_completed_at',           label: 'AI analysis' },
  ]

  const lastCompleted = steps.filter(s => status[s.key]).pop()
  const allDone = !!status.ai_completed_at
  const anyStarted = !!status.email_pull_completed_at

  if (!anyStarted) return (
    <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
      No pipeline run today — tap Sync to start
    </div>
  )

  return (
    <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${
      allDone
        ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-blue-50 border-blue-200 text-blue-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${allDone ? 'bg-green-500' : 'bg-blue-400 animate-pulse'}`} />
      {allDone
        ? `Full pipeline complete · AI finished ${dayjs(status.ai_completed_at).fromNow()}`
        : `Pipeline in progress · ${lastCompleted?.label || 'Starting'} done`}
      <div className="ml-auto flex items-center gap-1">
        {steps.map(s => (
          <div key={s.key} title={s.label} className={`w-1.5 h-1.5 rounded-full ${status[s.key] ? 'bg-green-500' : 'bg-gray-200'}`} />
        ))}
      </div>
    </div>
  )
}

// ── Stat cards ─────────────────────────────────────────────────
function StatCards({ tasks, emails, events, commitments, decisions, questions }) {
  const todayUTC    = new Date().toISOString().split('T')[0]
  const openTasks   = tasks?.filter(t => t.status !== 'done' && t.status !== 'archived').length ?? 0
  const needsReply  = emails?.filter(e => e.status === 'needs_reply').length ?? 0
  const todayEvents = events?.filter(e => e.start_time?.split('T')[0] === todayUTC).length ?? 0
  const openDecisions = decisions?.length ?? 0
  const pendingQs   = questions?.length ?? 0

  const stats = [
    { label: 'Meetings',    value: todayEvents,    icon: '📅', alert: false },
    { label: 'Open Tasks',  value: openTasks,      icon: '✅', alert: openTasks > 10 },
    { label: 'Needs Reply', value: needsReply,     icon: '📬', alert: needsReply > 5 },
    { label: 'Decisions',   value: openDecisions,  icon: '🧠', alert: openDecisions > 0 },
    { label: 'AI Questions',value: pendingQs,      icon: '❓', alert: pendingQs > 0 },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {stats.map(s => (
        <Card key={s.label} className={`flex items-center gap-2.5 ${s.alert ? 'border-orange-200 bg-orange-50' : ''}`}>
          <span className="text-xl">{s.icon}</span>
          <div>
            <p className={`text-xl font-bold ${s.alert ? 'text-orange-600' : 'text-[#1a1a18]'}`}>{s.value}</p>
            <p className="text-xs text-[#6b6b67]">{s.label}</p>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Calendar strip ─────────────────────────────────────────────
function CalendarStrip({ events, isLoading }) {
  const todayUTC    = new Date().toISOString().split('T')[0]
  const todayEvents = (events || [])
    .filter(e => e.start_time?.split('T')[0] === todayUTC)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

  function fmtTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <Card>
      <SectionHeader title="Today's Schedule" count={todayEvents.length} />
      {isLoading ? <Spinner /> : todayEvents.length === 0 ? (
        <EmptyState icon="📅" message="No meetings today" />
      ) : (
        <div className="space-y-1.5">
          {todayEvents.map(event => {
            const now = new Date()
            const start = new Date(event.start_time)
            const end   = event.end_time ? new Date(event.end_time) : null
            const isNow = start <= now && (!end || end >= now)
            const isPast = end ? end < now : start < now

            return (
              <div key={event.id} className={`flex items-center gap-3 p-2 rounded-lg ${
                isNow ? 'bg-blue-50 border border-blue-200' :
                isPast ? 'opacity-50' : 'bg-gray-50'
              }`}>
                {event.high_stakes && (
                  <span title={event.stakes_reason || 'High stakes'} className="text-sm">🔥</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[#1a1a18] truncate">{event.title}</p>
                    {isNow && <PillBadge label="NOW" color="blue" />}
                  </div>
                  <p className="text-xs text-[#6b6b67]">
                    {fmtTime(event.start_time)}
                    {event.end_time && ` – ${fmtTime(event.end_time)}`}
                    {event.location && ` · ${event.location}`}
                  </p>
                  {event.preparation_required && (
                    <p className="text-xs text-orange-500 mt-0.5">⚡ Prep needed</p>
                  )}
                </div>
                {event.join_link && (
                  <a
                    href={event.join_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-blue-600 hover:underline flex-shrink-0"
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

// ── Task panel ─────────────────────────────────────────────────
function TaskPanel({ tasks, isLoading }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showAll, setShowAll] = useState(false)

  const toggle = useMutation({
    mutationFn: ({ id, status }) => updateTask(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const prev = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => t.id === id ? { ...t, status } : t)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['tasks'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const open = (tasks || []).filter(t => t.status !== 'done' && t.status !== 'archived')
  const shown = showAll ? open : open.slice(0, 6)

  return (
    <Card>
      <SectionHeader
        title="Tasks"
        count={open.length}
        action={
          <span className="text-xs text-[#6b6b67]">
            {(tasks || []).filter(t => t.status === 'done').length} done
          </span>
        }
      />
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="✅" message="All clear" />
      ) : (
        <>
          <div className="space-y-2">
            {shown.map(task => (
              <div key={task.id} className="flex items-start gap-2.5 group">
                <input
                  type="checkbox"
                  checked={task.status === 'done'}
                  onChange={() => toggle.mutate({
                    id: task.id,
                    status: task.status === 'done' ? 'open' : 'done',
                  })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0"
                />
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/task/${task.id}`)}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-[#1a1a18] leading-snug">{task.title}</p>
                    {task.ai_extracted && <PillBadge label="AI" color="purple" />}
                    {task.blocking && <PillBadge label="blocking" color="red" />}
                  </div>
                  {task.context && (
                    <p className="text-xs text-[#6b6b67] mt-0.5 truncate">{task.context}</p>
                  )}
                  {task.due_date && (
                    <p className={`text-xs mt-0.5 ${
                      dayjs(task.due_date).isBefore(dayjs(), 'day') ? 'text-red-500' : 'text-[#6b6b67]'
                    }`}>
                      Due {dayjs(task.due_date).format('MMM D')}
                    </p>
                  )}
                </div>
                {task.urgency && (
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[task.urgency] || 'bg-gray-300'}`} />
                )}
              </div>
            ))}
          </div>
          {open.length > 6 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="mt-3 text-xs text-blue-600 hover:underline"
            >
              {showAll ? 'Show less' : `Show ${open.length - 6} more`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

// ── My Commitments panel ───────────────────────────────────────
function CommitmentsPanel({ commitments, isLoading, contacts }) {
  const qc = useQueryClient()
  const close = useMutation({
    mutationFn: (id) => updateCommitment(id, { status: 'closed' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['commitments'] })
      const prev = qc.getQueryData(['commitments'])
      qc.setQueryData(['commitments'], old =>
        (old || []).map(c => c.id === id ? { ...c, status: 'closed' } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['commitments'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['commitments'] }),
  })

  const open = (commitments || []).filter(c => c.status === 'open')

  return (
    <Card>
      <SectionHeader title="My Commitments" count={open.length} />
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="🤝" message="No open commitments" />
      ) : (
        <div className="space-y-2">
          {open.slice(0, 5).map(c => {
            const overdue = c.due_date && dayjs(c.due_date).isBefore(dayjs(), 'day')
            return (
              <div key={c.id} className="flex items-start gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[c.urgency] || 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-[#1a1a18] leading-snug">{c.title}</p>
                    {c.implicit && <PillBadge label="implied" color="yellow" />}
                  </div>
                  <p className="text-xs text-[#6b6b67] mt-0.5">
                    {c.made_to && (
                      <span>To: <ContactLink name={c.made_to} contacts={contacts} className="text-xs text-[#6b6b67]" /></span>
                    )}
                    {c.due_date && (
                      <span className={overdue ? 'text-red-500 font-medium ml-1' : 'ml-1'}>
                        Due {dayjs(c.due_date).format('MMM D')}
                        {overdue && ` (${dayjs().diff(dayjs(c.due_date), 'day')}d late)`}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => close.mutate(c.id)}
                  className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100"
                >
                  ✓
                </button>
              </div>
            )
          })}
          {open.length > 5 && (
            <p className="text-xs text-[#6b6b67]">+{open.length - 5} more</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Others' Commitments panel ──────────────────────────────────
function OthersCommitmentsPanel({ contacts }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['others-commitments'],
    queryFn: () => getOthersCommitments('open'),
    refetchInterval: 180000,
  })

  const update = useMutation({
    mutationFn: ({ id, updates }) => updateOthersCommitment(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['others-commitments'] }),
  })

  const items = data || []

  return (
    <Card>
      <SectionHeader title="Waiting On Others" count={items.length} />
      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon="⏳" message="Nothing waiting on others" />
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map(c => (
            <div key={c.id} className="flex items-start gap-2.5 group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm text-[#1a1a18] leading-snug">{c.title}</p>
                  {c.ai_suggests_complete && (
                    <PillBadge label="AI: may be done" color="green" />
                  )}
                </div>
                <p className="text-xs text-[#6b6b67] mt-0.5">
                  {c.made_by && (
                    <span>From: <ContactLink name={c.made_by} contacts={contacts} className="text-xs text-[#6b6b67]" /></span>
                  )}
                  {c.due_date && (
                    <span className={c.days_overdue > 0 ? 'text-red-500 font-medium ml-1' : 'ml-1'}>
                      Due {dayjs(c.due_date).format('MMM D')}
                      {c.days_overdue > 0 && ` (${c.days_overdue}d late)`}
                    </span>
                  )}
                </p>
                {c.ai_suggests_complete && c.fulfillment_evidence && (
                  <p className="text-xs text-green-600 mt-0.5 italic truncate">
                    "{c.fulfillment_evidence}"
                  </p>
                )}
              </div>
              <button
                onClick={() => update.mutate({ id: c.id, updates: { status: 'closed' } })}
                className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                title="Mark done"
              >
                ✓
              </button>
            </div>
          ))}
          {items.length > 5 && (
            <p className="text-xs text-[#6b6b67]">+{items.length - 5} more</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Email queue ────────────────────────────────────────────────
function EmailQueue({ emails, isLoading, contacts }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('reply')

  const mark = useMutation({
    mutationFn: ({ id, status }) => updateEmail(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['emails'] })
      const prev = qc.getQueryData(['emails'])
      qc.setQueryData(['emails'], old =>
        (old || []).map(e => e.id === id ? { ...e, status } : e)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['emails'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  })

  const needsReply = (emails || []).filter(e => e.status === 'needs_reply')
  const waitingOn  = (emails || []).filter(e => e.status === 'waiting_on')
  const shown      = tab === 'reply' ? needsReply : waitingOn

  return (
    <Card>
      <SectionHeader title="Email Queue" />
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab('reply')}
          className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${
            tab === 'reply' ? 'bg-red-100 text-red-700' : 'text-[#6b6b67] hover:bg-gray-100'
          }`}
        >
          Needs Reply {needsReply.length > 0 && `(${needsReply.length})`}
        </button>
        <button
          onClick={() => setTab('waiting')}
          className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${
            tab === 'waiting' ? 'bg-gray-200 text-gray-700' : 'text-[#6b6b67] hover:bg-gray-100'
          }`}
        >
          Waiting On {waitingOn.length > 0 && `(${waitingOn.length})`}
        </button>
      </div>
      {isLoading ? <Spinner /> : shown.length === 0 ? (
        <EmptyState icon={tab === 'reply' ? '📬' : '⏳'} message={
          tab === 'reply' ? 'No emails need reply' : 'Nothing waiting'
        } />
      ) : (
        <div className="space-y-2">
          {shown.slice(0, 7).map(email => (
            <div key={email.id} className="flex items-start gap-2 group">
              <div className="flex-1 min-w-0">
                <ContactLink
                  name={email.from_name || email.from_address}
                  contacts={contacts}
                  className="text-sm font-medium text-[#1a1a18] block truncate"
                />
                <p className="text-xs text-[#6b6b67] truncate">
                  {email.thread_subject || email.subject}
                </p>
                {email.days_waiting > 0 && tab === 'reply' && (
                  <p className="text-xs text-orange-400">{email.days_waiting}d waiting</p>
                )}
              </div>
              {tab === 'reply' && (
                <button
                  onClick={() => mark.mutate({ id: email.id, status: 'done' })}
                  className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100"
                >
                  ✓
                </button>
              )}
            </div>
          ))}
          {shown.length > 7 && (
            <p className="text-xs text-[#6b6b67]">+{shown.length - 7} more</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Pending Decisions panel ────────────────────────────────────
function PendingDecisionsPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['pending-decisions'],
    queryFn: getPendingDecisions,
    refetchInterval: 300000,
  })
  const [deciding, setDeciding] = useState(null)
  const [outcome, setOutcome]   = useState('')

  const decide = useMutation({
    mutationFn: ({ id, outcome }) => updatePendingDecision(id, { status: 'decided', outcome }),
    onSuccess: () => {
      setDeciding(null)
      setOutcome('')
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
    },
  })

  const dismiss = useMutation({
    mutationFn: (id) => updatePendingDecision(id, { status: 'dismissed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-decisions'] }),
  })

  const items = data || []

  return (
    <Card>
      <SectionHeader title="Pending Decisions" count={items.length} />
      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon="🧠" message="No pending decisions" />
      ) : (
        <div className="space-y-3">
          {items.slice(0, 4).map(d => (
            <div key={d.id} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a18] leading-snug">{d.question}</p>
                  {d.context && (
                    <p className="text-xs text-[#6b6b67] mt-0.5 line-clamp-2">{d.context}</p>
                  )}
                  {d.projects?.name && (
                    <PillBadge label={d.projects.name} color="blue" />
                  )}
                </div>
                {d.urgency && (
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[d.urgency] || 'bg-gray-300'}`} />
                )}
              </div>
              {deciding === d.id ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={outcome}
                    onChange={e => setOutcome(e.target.value)}
                    placeholder="Decision outcome..."
                    className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    autoFocus
                  />
                  <button
                    onClick={() => decide.mutate({ id: d.id, outcome })}
                    disabled={!outcome.trim()}
                    className="text-xs bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-green-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setDeciding(null)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 flex gap-2">
                  <button
                    onClick={() => setDeciding(d.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Record decision
                  </button>
                  <button
                    onClick={() => dismiss.mutate(d.id)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
          {items.length > 4 && (
            <p className="text-xs text-[#6b6b67]">+{items.length - 4} more decisions</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── AI Questions panel ─────────────────────────────────────────
function AIQuestionsPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['ai-questions'],
    queryFn: getAIQuestions,
    refetchInterval: 300000,
  })
  const [answering, setAnswering]   = useState(null)
  const [answerText, setAnswerText] = useState('')

  const answer = useMutation({
    mutationFn: ({ id, text }) => answerAIQuestion(id, text),
    onSuccess: () => {
      setAnswering(null)
      setAnswerText('')
      qc.invalidateQueries({ queryKey: ['ai-questions'] })
    },
  })

  const items = data || []

  return (
    <Card>
      <SectionHeader title="AI Needs Input" count={items.length} badge={items.length > 0 ? 'from Claude' : undefined} />
      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon="❓" message="No pending questions" />
      ) : (
        <div className="space-y-3">
          {items.slice(0, 4).map(q => (
            <div key={q.id} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
              <p className="text-sm text-[#1a1a18] leading-snug">{q.question}</p>
              {q.context && (
                <p className="text-xs text-[#6b6b67] mt-0.5 line-clamp-2 italic">{q.context}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{dayjs(q.created_at).fromNow()}</p>
              {answering === q.id ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={answerText}
                    onChange={e => setAnswerText(e.target.value)}
                    placeholder="Your answer..."
                    className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    autoFocus
                  />
                  <button
                    onClick={() => answer.mutate({ id: q.id, text: answerText })}
                    disabled={!answerText.trim()}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-blue-700"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setAnswering(null)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAnswering(q.id)}
                  className="mt-1 text-xs text-blue-600 hover:underline"
                >
                  Answer
                </button>
              )}
            </div>
          ))}
          {items.length > 4 && (
            <p className="text-xs text-[#6b6b67]">+{items.length - 4} more questions</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Projects panel ─────────────────────────────────────────────
function ProjectsPanel({ projects, isLoading }) {
  const navigate = useNavigate()

  const active = (projects || []).filter(p => p.status === 'active')

  function riskCount(p) {
    return (p.risk_signals || []).length
  }

  return (
    <Card>
      <SectionHeader title="Active Projects" count={active.length} />
      {isLoading ? <Spinner /> : active.length === 0 ? (
        <EmptyState icon="🏗️" message="No active projects" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {active.slice(0, 6).map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/project/${p.id}`)}
              className="border border-[#e5e5e3] rounded-lg p-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-[#1a1a18] leading-snug">{p.name}</p>
                {riskCount(p) > 0 && (
                  <PillBadge label={`${riskCount(p)} risks`} color="red" />
                )}
              </div>
              <p className="text-xs text-[#6b6b67] mt-1 truncate">{p.client || p.location || '—'}</p>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {(p.decisions_made || []).length > 0 && (
                  <PillBadge label={`${(p.decisions_made || []).length} decisions`} color="blue" />
                )}
                {p.current_phase && (
                  <PillBadge label={p.current_phase} color="gray" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Unlinked Intelligence panel ────────────────────────────────

// Parse item.content — may be a JSON array of intel objects or a plain string
function parseIntelContent(raw) {
  if (!raw) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    // Normalise: wrap single object in array
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return null
  }
}

// Extract the human-readable text from an intel sub-item
function intelText(obj) {
  if (typeof obj === 'string') return obj
  return (
    obj.fact        ||
    obj.decision    ||
    obj.signal      ||
    obj.description ||
    obj.text        ||
    obj.content     ||
    Object.values(obj).find(v => typeof v === 'string' && v.length > 5) ||
    JSON.stringify(obj)
  )
}

const CATEGORY_COLOR = {
  financial:   'blue',
  technical:   'purple',
  schedule:    'orange',
  scope:       'yellow',
  risk:        'red',
  decision:    'green',
  relationship:'gray',
  contractual: 'blue',
}

function IntelSubItem({ obj }) {
  const text      = intelText(obj)
  const statedBy  = typeof obj === 'object' ? (obj.stated_by || obj.source || null) : null
  const category  = typeof obj === 'object' ? (obj.category || obj.type || obj.intel_type || null) : null
  const color     = category ? (CATEGORY_COLOR[category.toLowerCase()] || 'gray') : 'gray'

  return (
    <div className="py-1.5 border-b border-gray-100 last:border-0">
      <p className="text-sm text-[#1a1a18] leading-snug">{text}</p>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        {category  && <PillBadge label={category}       color={color} />}
        {statedBy  && <span className="text-xs text-[#6b6b67]">via {statedBy}</span>}
      </div>
    </div>
  )
}

function UnlinkedIntelPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['unlinked-intel'],
    queryFn: getUnlinkedIntelligence,
    refetchInterval: 300000,
  })

  const update = useMutation({
    mutationFn: ({ id, status }) => updateUnlinkedIntelligence(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unlinked-intel'] }),
  })

  const items = data || []
  if (items.length === 0 && !isLoading) return null

  return (
    <Card>
      <SectionHeader title="Unlinked Intelligence" count={items.length} badge="needs filing" />
      {isLoading ? <Spinner /> : (
        <div className="space-y-1">
          {items.slice(0, 5).map(item => {
            const subItems = parseIntelContent(item.content)

            return (
              <div key={item.id} className="flex items-start gap-2 group rounded-lg hover:bg-gray-50 px-1 py-1 -mx-1">
                <div className="flex-1 min-w-0">
                  {/* Source badge row */}
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    {item.intel_type && <PillBadge label={item.intel_type} color="purple" />}
                    {item.source_email_id && <PillBadge label="from email" color="blue" />}
                  </div>

                  {subItems ? (
                    // Parsed JSON array — render each sub-item
                    <div>
                      {subItems.slice(0, 4).map((obj, i) => (
                        <IntelSubItem key={i} obj={obj} />
                      ))}
                      {subItems.length > 4 && (
                        <p className="text-xs text-[#6b6b67] mt-1">
                          +{subItems.length - 4} more in this batch
                        </p>
                      )}
                    </div>
                  ) : (
                    // Parse failed — clean fallback
                    item.content && item.content.trim().startsWith('[') ? (
                      <p className="text-sm text-[#6b6b67] italic">
                        {item.content.trim().match(/^\[.*\]$/s)
                          ? `${(item.content.match(/\{/g) || []).length} intelligence items need filing`
                          : item.content}
                      </p>
                    ) : (
                      <p className="text-sm text-[#1a1a18] leading-snug">{item.content}</p>
                    )
                  )}
                </div>

                <button
                  onClick={() => update.mutate({ id: item.id, status: 'reviewed' })}
                  className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                  title="Mark reviewed"
                >
                  ✓
                </button>
              </div>
            )
          })}
          {items.length > 5 && (
            <p className="text-xs text-[#6b6b67] pt-1">+{items.length - 5} more items</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Quick capture bar ──────────────────────────────────────────
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
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e5e5e3] px-3 md:px-6 py-2.5 z-10">
      <div className="max-w-5xl mx-auto flex items-center gap-2">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="text-sm border border-[#e5e5e3] rounded-lg px-2 py-1.5 text-[#6b6b67] bg-white"
        >
          <option value="text">📝</option>
          <option value="url">🔗</option>
          <option value="task">✅</option>
        </select>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Quick capture — Enter to save..."
          className="flex-1 text-sm border border-[#e5e5e3] rounded-lg px-3 py-1.5 text-[#1a1a18] placeholder-[#6b6b67] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => value.trim() && add.mutate()}
          disabled={!value.trim() || add.isPending}
          className="px-3 py-1.5 bg-[#1a1a18] text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-800 transition-colors"
        >
          {add.isPending ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Daily Brief ────────────────────────────────────────────────
function DailyBrief() {
  const [collapsed, setCollapsed] = useState(false)

  const { data: brief } = useQuery({
    queryKey: ['daily-brief'],
    queryFn: async () => {
      // First: check ai_context table for type='daily_brief'
      // Fallback: check captures
      const captures = await getCaptures()
      const briefCapture = (captures || [])
        .filter(c => c.type === 'daily_brief')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      return briefCapture?.content || null
    },
    refetchInterval: 300000,
  })

  return (
    <Card className={brief ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-white' : ''}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🧠</span>
          <h2 className="text-sm font-semibold text-[#1a1a18]">AI Daily Brief</h2>
          {brief && <PillBadge label="today" color="blue" />}
        </div>
        {brief && (
          <button
            onClick={() => setCollapsed(v => !v)}
            className="text-xs text-[#6b6b67] hover:text-[#1a1a18]"
          >
            {collapsed ? 'Expand ↓' : 'Collapse ↑'}
          </button>
        )}
      </div>
      {!brief ? (
        <p className="text-sm text-[#6b6b67] italic">Brief generates after nightly AI run. Sync + wait for analysis.</p>
      ) : collapsed ? null : (
        <MarkdownBlock content={brief} className="text-sm" />
      )}
    </Card>
  )
}

// ── Dashboard ──────────────────────────────────────────────────
export default function Dashboard() {
  const [workspace, setWorkspace] = useState('all')

  const { data: tasks,       isLoading: loadingTasks }   = useQuery({ queryKey: ['tasks'],       queryFn: getTasks,        refetchInterval: 120000 })
  const { data: events,      isLoading: loadingEvents }  = useQuery({ queryKey: ['events'],      queryFn: getEvents,       refetchInterval: 120000 })
  const { data: emails,      isLoading: loadingEmails }  = useQuery({ queryKey: ['emails'],      queryFn: getEmails,       refetchInterval: 120000 })
  const { data: commitments, isLoading: loadingCommit }  = useQuery({ queryKey: ['commitments'], queryFn: getCommitments,  refetchInterval: 120000 })
  const { data: projects,    isLoading: loadingProjects} = useQuery({ queryKey: ['projects'],    queryFn: getProjects,     refetchInterval: 300000 })
  const { data: contacts }   = useQuery({ queryKey: ['contacts'],    queryFn: getContacts,     refetchInterval: 300000 })
  const { data: decisions }  = useQuery({ queryKey: ['pending-decisions'], queryFn: getPendingDecisions, refetchInterval: 300000 })
  const { data: questions }  = useQuery({ queryKey: ['ai-questions'],      queryFn: getAIQuestions,     refetchInterval: 300000 })

  const now = dayjs()

  return (
    <div className="min-h-screen bg-[#f8f8f6] pb-16">

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-3 md:px-6 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[#1a1a18] text-base tracking-tight">Personal OS</span>
            <WorkspaceBar workspace={workspace} setWorkspace={setWorkspace} />
            <Link
              to="/contacts"
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Contacts
            </Link>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-[#1a1a18]">{now.format('dddd, MMMM D')}</p>
            <p className="text-xs text-[#6b6b67]">{now.format('h:mm A')}</p>
          </div>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-3 md:px-6 py-4 space-y-3">

        {/* Pipeline banner */}
        <PipelineBanner />

        {/* Daily brief — full width */}
        <DailyBrief />

        {/* Stat cards */}
        <StatCards
          tasks={tasks}
          emails={emails}
          events={events}
          commitments={commitments}
          decisions={decisions}
          questions={questions}
        />

        {/* Calendar — full width */}
        <CalendarStrip events={events} isLoading={loadingEvents} />

        {/* Two-column grid: action left, intelligence right */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* LEFT column */}
          <div className="space-y-3">
            <TaskPanel tasks={tasks} isLoading={loadingTasks} />
            <CommitmentsPanel commitments={commitments} isLoading={loadingCommit} contacts={contacts} />
            <OthersCommitmentsPanel contacts={contacts} />
          </div>

          {/* RIGHT column */}
          <div className="space-y-3">
            <EmailQueue emails={emails} isLoading={loadingEmails} contacts={contacts} />
            <PendingDecisionsPanel />
            <AIQuestionsPanel />
          </div>
        </div>

        {/* Projects — full width */}
        <ProjectsPanel projects={projects} isLoading={loadingProjects} />

        {/* Unlinked intelligence — only renders if data exists */}
        <UnlinkedIntelPanel />

      </div>

      {/* Quick capture */}
      <QuickAdd />

      {/* Sync FAB — bottom right above capture bar */}
      <div className="fixed bottom-14 right-4 z-20">
        <SyncButton />
      </div>

    </div>
  )
}
