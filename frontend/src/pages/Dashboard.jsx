import { useState, useRef, useCallback } from 'react'
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
  getProjects, createProject,
  getContacts,
  getCaptures, createCapture,
  getPendingDecisions, updatePendingDecision,
  getUnlinkedIntelligence, updateUnlinkedIntelligence,
  getAIQuestions, answerAIQuestion,
  getPipelineStatus,
  getMeetingNotes,
  getKnowledge,
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

// ── Client-side dedup utilities ───────────────────────────────
function dedupEmails(emails) {
  const seen = new Map()
  return (emails || []).filter(e => {
    const normSubject = (e.thread_subject || e.subject || '')
      .replace(/^(re|fwd?|fw|aw):\s*/gi, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/).slice(0, 6).join(' ')
    const sender = (e.from_address || '').toLowerCase()
    const key = `${sender}::${normSubject}`
    if (!key || key === '::') return true // can't dedup without key
    if (seen.has(key)) return false
    seen.set(key, true)
    return true
  })
}

function dedupByTitle(items) {
  const seen = new Map()
  return (items || []).filter(item => {
    const norm = (item.title || item.description || item.what || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/).slice(0, 6).join(' ')
    if (!norm) return true
    if (seen.has(norm)) return false
    seen.set(norm, true)
    return true
  })
}

function SectionHeader({ title, count, badge, action, to }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {to ? (
          <Link to={to} className="text-sm font-semibold text-[#1a1a18] hover:text-blue-600 hover:underline transition-colors">
            {title}
          </Link>
        ) : (
          <h2 className="text-sm font-semibold text-[#1a1a18]">{title}</h2>
        )}
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
function StatCards({ tasks, emails, events, commitments, decisions, questions,
                     onOpenTasks, onNeedsReply, onDecisions, onQuestions }) {
  const todayUTC    = new Date().toISOString().split('T')[0]
  const openTasks   = tasks?.filter(t => t.status !== 'done' && t.status !== 'complete' && t.status !== 'archived').length ?? 0
  const needsReply  = emails?.filter(e => e.status === 'needs_reply').length ?? 0
  const todayEvents = events?.filter(e => e.start_time?.split('T')[0] === todayUTC).length ?? 0
  const openDecisions = decisions?.length ?? 0
  const pendingQs   = questions?.length ?? 0

  const stats = [
    { label: 'Meetings',     value: todayEvents,   icon: '📅', alert: false,            onClick: null },
    { label: 'Open Tasks',   value: openTasks,     icon: '✅', alert: openTasks > 10,   onClick: onOpenTasks },
    { label: 'Needs Reply',  value: needsReply,    icon: '📬', alert: needsReply > 5,   onClick: onNeedsReply },
    { label: 'Decisions',    value: openDecisions, icon: '🧠', alert: openDecisions > 0, onClick: onDecisions },
    { label: 'AI Questions', value: pendingQs,     icon: '❓', alert: pendingQs > 0,    onClick: onQuestions },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {stats.map(s => (
        <Card
          key={s.label}
          className={`flex items-center gap-2.5 transition-all ${s.alert ? 'border-orange-200 bg-orange-50' : ''} ${s.onClick ? 'cursor-pointer hover:border-blue-300 hover:shadow-sm active:scale-95' : ''}`}
          onClick={s.onClick || undefined}
        >
          <span className="text-xl">{s.icon}</span>
          <div>
            <p className={`text-xl font-bold ${s.alert ? 'text-orange-600' : 'text-[#1a1a18]'}`}>{s.value}</p>
            <p className="text-xs text-[#6b6b67]">{s.label}</p>
          </div>
          {s.onClick && <span className="ml-auto text-gray-300 text-xs">↓</span>}
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
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:space-y-1.5 snap-x snap-mandatory">
          {todayEvents.map(event => {
            const now = new Date()
            const start = new Date(event.start_time)
            const end   = event.end_time ? new Date(event.end_time) : null
            const isNow = start <= now && (!end || end >= now)
            const isPast = end ? end < now : start < now

            return (
              <Link key={event.id} to={`/event/${event.id}`} className="block flex-shrink-0 md:flex-shrink snap-start w-64 md:w-auto">
                <div className={`flex items-center gap-3 p-2 rounded-lg h-full ${
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
                      onClick={e => e.stopPropagation()}
                      className="text-xs font-medium text-blue-600 hover:underline flex-shrink-0"
                    >
                      Join
                    </a>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Task panel ─────────────────────────────────────────────────
function TaskPanel({ tasks, isLoading, showAll, setShowAll }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

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

  const open = dedupByTitle(
    (tasks || []).filter(t => t.status !== 'done' && t.status !== 'complete' && t.status !== 'archived')
  )
  const shown = showAll ? open : open.slice(0, 6)

  return (
    <Card>
      <SectionHeader
        title="Tasks"
        count={open.length}
        to="/tasks"
        action={
          <span className="text-xs text-[#6b6b67]">
            {(tasks || []).filter(t => t.status === 'done' || t.status === 'complete').length} done
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
                  checked={task.status === 'done' || task.status === 'complete'}
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
                    <p className="text-xs text-[#6b6b67] mt-0.5 line-clamp-2 leading-snug">{task.context}</p>
                  )}
                  {task.source_label && !task.context && (
                    <p className="text-xs text-[#9b9b97] mt-0.5 truncate italic">from: {task.source_label}</p>
                  )}
                  {task.source_label && task.context && (
                    <p className="text-xs text-[#9b9b97] mt-0.5 truncate">↳ {task.source_label}</p>
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
          {!showAll && open.length > 6 && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-3 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left"
            >
              + {open.length - 6} more — tap to show all
            </button>
          )}
          {showAll && open.length > 6 && (
            <button
              onClick={() => setShowAll(false)}
              className="mt-3 text-xs text-[#6b6b67] hover:underline w-full text-left"
            >
              Show less ↑
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
  const [showAll, setShowAll] = useState(false)
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

  const open = dedupByTitle(
    (commitments || []).filter(c => c.status === 'open')
  )

  return (
    <Card>
      <SectionHeader title="My Commitments" count={open.length} to="/commitments-list" />
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="🤝" message="No open commitments" />
      ) : (
        <div className="space-y-2">
          {(showAll ? open : open.slice(0, 4)).map(c => {
            const overdue = c.due_date && dayjs(c.due_date).isBefore(dayjs(), 'day')
            return (
              <div key={c.id} className={`flex items-start gap-2.5 group p-1.5 rounded-lg border-l-2 ${
                c.urgency === 'critical' ? 'border-l-red-400 bg-red-50' :
                c.urgency === 'high'     ? 'border-l-orange-400 bg-orange-50' :
                c.urgency === 'medium'   ? 'border-l-yellow-400 bg-yellow-50' :
                'border-l-gray-200 bg-transparent'
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-[#1a1a18] leading-snug">{c.title}</p>
                    {c.implicit && <PillBadge label="implied" color="yellow" />}
                    {c.commitment_type && c.commitment_type !== 'hard' && (
                      <PillBadge label={c.commitment_type} color="gray" />
                    )}
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
                  className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                  title="Mark done"
                >
                  ✓
                </button>
              </div>
            )
          })}
          {!showAll && open.length > 4 && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left">
              + {open.length - 4} more — tap to show all
            </button>
          )}
          {showAll && open.length > 4 && (
            <button onClick={() => setShowAll(false)} className="mt-2 text-xs text-[#6b6b67] hover:underline w-full text-left">
              Show less ↑
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Quick Question ─────────────────────────────────────────────
// One question at a time, right in the flow. Tap anywhere on the card
// to focus the input. Enter submits. Skip sends it to the back of the queue.
function QuickQuestion({ question: q, remaining }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [active, setActive] = useState(false)
  const inputRef = useRef(null)

  const answer = useMutation({
    mutationFn: ({ id, text }) => answerAIQuestion(id, text),
    onSuccess: () => {
      setText('')
      setActive(false)
      qc.invalidateQueries({ queryKey: ['ai-questions'] })
    },
  })

  const skip = useMutation({
    mutationFn: (id) => answerAIQuestion(id, '__skip__'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-questions'] }),
  })

  const handleCardClick = () => {
    setActive(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
      e.preventDefault()
      answer.mutate({ id: q.id, text: text.trim() })
    }
    if (e.key === 'Escape') setActive(false)
  }

  const typeLabel = {
    context_person:     '👤 Who is this?',
    context_meeting:    '📅 Meeting context',
    context_importance: '❓ Still relevant?',
    overdue_commitment: '⚠️ Overdue',
    stalled_decision:   '⏸ Stalled decision',
    binary:             '❓ Quick check',
  }[q.question_type] || '💬 Quick input'

  return (
    <div
      className="bg-white border border-blue-200 rounded-2xl p-4 cursor-text shadow-sm"
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide mr-2">
            {typeLabel}
          </span>
          {remaining > 0 && (
            <span className="text-xs text-[#6b6b67]">+{remaining} more</span>
          )}
          <p className="text-sm text-[#1a1a18] mt-1 leading-snug">{q.question}</p>
          {q.context && (
            <p className="text-xs text-[#6b6b67] mt-0.5 italic truncate">{q.context}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); skip.mutate(q.id) }}
          className="text-xs text-[#9b9b97] hover:text-[#6b6b67] flex-shrink-0 mt-0.5"
          title="Skip for now"
        >skip</button>
      </div>

      {active ? (
        <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer, press Enter to save…"
            className="flex-1 text-sm border border-blue-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-[#f8f9ff]"
          />
          <button
            onClick={() => text.trim() && answer.mutate({ id: q.id, text: text.trim() })}
            disabled={!text.trim() || answer.isPending}
            className="text-xs bg-blue-600 text-white px-3 py-2 rounded-lg disabled:opacity-40 hover:bg-blue-700 flex-shrink-0"
          >
            {answer.isPending ? '…' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-xs text-blue-500 hover:text-blue-700">
          Tap to answer…
        </div>
      )}
    </div>
  )
}

// ── Others' Commitments panel ──────────────────────────────────
// Three sub-sections:
//   blocking_ryan — manually flagged by Ryan as blocking his work (highest priority)
//   to_ryan       — AI-detected as owed directly to Ryan
//   general       — others' actions not specifically owed to Ryan
function OthersCommitmentsPanel({ contacts }) {
  const qc = useQueryClient()
  const [collapsed, setCollapsed] = useState({ blocking_ryan: false, to_ryan: false, general: true })

  const { data, isLoading } = useQuery({
    queryKey: ['others-commitments'],
    queryFn: () => getOthersCommitments('open'),
    refetchInterval: 180000,
  })

  const update = useMutation({
    mutationFn: ({ id, updates }) => updateOthersCommitment(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['others-commitments'] }),
  })

  const items = dedupByTitle(data || [])

  // Split into three buckets
  const blocking = items.filter(c => c.delivery_type === 'blocking_ryan')
  const toRyan   = items.filter(c => c.delivery_type === 'to_ryan')
  const general  = items.filter(c => !c.delivery_type || c.delivery_type === 'general')

  // Group items by person name within a bucket
  const groupByPerson = (list) => {
    const groups = {}
    for (const c of list) {
      const name = c.committed_by_name || c.made_by || 'Unknown'
      if (!groups[name]) groups[name] = []
      groups[name].push(c)
    }
    return groups
  }

  const CommitmentRow = ({ c }) => (
    <div key={c.id} className="flex items-start gap-2 group py-1">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm text-[#1a1a18] leading-snug">{c.title}</p>
          {c.ai_suggests_complete && <PillBadge label="AI: may be done" color="green" />}
          {c.days_overdue > 0 && <PillBadge label={`${c.days_overdue}d late`} color="red" />}
        </div>
        {c.due_date && (
          <p className={`text-xs mt-0.5 ${c.days_overdue > 0 ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
            Due {dayjs(c.due_date).format('MMM D')}
          </p>
        )}
        {c.context && (
          <p className="text-xs text-[#6b6b67] mt-0.5 italic truncate">{c.context}</p>
        )}
        {c.ai_suggests_complete && c.fulfillment_evidence && (
          <p className="text-xs text-green-600 mt-0.5 italic truncate">"{c.fulfillment_evidence}"</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100">
        {/* Escalate to blocking */}
        {c.delivery_type !== 'blocking_ryan' && (
          <button
            onClick={() => update.mutate({ id: c.id, updates: { delivery_type: 'blocking_ryan' } })}
            className="text-xs text-orange-400 hover:text-orange-600 px-1"
            title="Mark as blocking me"
          >🚧</button>
        )}
        {/* De-escalate from blocking */}
        {c.delivery_type === 'blocking_ryan' && (
          <button
            onClick={() => update.mutate({ id: c.id, updates: { delivery_type: 'to_ryan' } })}
            className="text-xs text-[#6b6b67] hover:text-gray-800 px-1"
            title="Remove blocking flag"
          >↓</button>
        )}
        {/* Mark done */}
        <button
          onClick={() => update.mutate({ id: c.id, updates: { status: 'closed' } })}
          className="text-xs text-[#6b6b67] hover:text-green-600 px-1"
          title="Mark done"
        >✓</button>
      </div>
    </div>
  )

  const PersonGroup = ({ name, items: groupItems }) => (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
        </div>
        <ContactLink name={name} contacts={contacts} className="text-xs font-semibold text-[#1a1a18]" />
        <span className="text-xs text-[#6b6b67]">({groupItems.length})</span>
      </div>
      <div className="pl-8 space-y-0.5">
        {groupItems.map(c => <CommitmentRow key={c.id} c={c} />)}
      </div>
    </div>
  )

  const SubSection = ({ title, icon, items: sectionItems, sectionKey, emptyMsg, headerClass }) => {
    const groups = groupByPerson(sectionItems)
    const isCollapsed = collapsed[sectionKey]
    return (
      <div className="mb-4">
        <button
          onClick={() => setCollapsed(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
          className={`flex items-center gap-2 w-full text-left mb-2 ${headerClass}`}
        >
          <span className="text-xs font-bold uppercase tracking-wide">{icon} {title}</span>
          <span className="text-xs text-[#6b6b67]">({sectionItems.length})</span>
          <span className="ml-auto text-xs text-[#6b6b67]">{isCollapsed ? '▸' : '▾'}</span>
        </button>
        {!isCollapsed && (
          sectionItems.length === 0
            ? <p className="text-xs text-[#6b6b67] italic pl-1">{emptyMsg}</p>
            : Object.entries(groups).map(([name, groupItems]) => (
                <PersonGroup key={name} name={name} items={groupItems} />
              ))
        )}
      </div>
    )
  }

  return (
    <Card>
      <SectionHeader title="Waiting On Others" count={items.length} to="/others" />
      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon="⏳" message="Nothing waiting on others" />
      ) : (
        <div>
          <SubSection
            title="Blocking Me"
            icon="🚧"
            items={blocking}
            sectionKey="blocking_ryan"
            emptyMsg="Nothing blocking you right now"
            headerClass="text-red-600"
          />
          <SubSection
            title="Owed to Me"
            icon="📬"
            items={toRyan}
            sectionKey="to_ryan"
            emptyMsg="No items specifically owed to you"
            headerClass="text-orange-600"
          />
          <SubSection
            title="Their Actions"
            icon="📋"
            items={general}
            sectionKey="general"
            emptyMsg="No tracked general commitments"
            headerClass="text-[#6b6b67]"
          />
        </div>
      )}
    </Card>
  )
}

// ── Email queue ────────────────────────────────────────────────
function EmailQueue({ emails, isLoading, contacts, showAllReply, setShowAllReply }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('reply')
  const [showAllWaiting, setShowAllWaiting] = useState(false)
  const [contextTab, setContextTab] = useState('all')

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

  function matchesContextTab(e) {
    if (contextTab === 'all') return true
    if (contextTab === 'work') return e.context_type === 'work' || e.context_type === 'mixed' || !e.context_type
    if (contextTab === 'personal') return e.context_type === 'personal' || e.context_type === 'mixed'
    return true
  }

  const needsReply = dedupEmails(
    (emails || []).filter(e => e.status === 'needs_reply' && matchesContextTab(e))
  )

  // Waiting On: include 'resolved' items (shown greyed at bottom), exclude 'archived'
  const waitingOnAll = dedupEmails(
    (emails || []).filter(e => (e.status === 'waiting_on' || e.status === 'resolved') && matchesContextTab(e))
  )
  const waitingOn = [
    ...waitingOnAll.filter(e => e.status !== 'resolved'),
    ...waitingOnAll.filter(e => e.status === 'resolved'),
  ]

  const isReplyTab   = tab === 'reply'
  const shownAll     = isReplyTab ? (showAllReply || false) : showAllWaiting
  const setShownAll  = isReplyTab ? setShowAllReply : setShowAllWaiting
  const shown        = isReplyTab ? needsReply : waitingOn
  const CAP          = 8
  const visibleItems = shownAll ? shown : shown.slice(0, CAP)

  return (
    <Card>
      <SectionHeader title="Email Queue" to="/emails" />
      {/* Context filter tabs */}
      <div className="flex gap-1 mb-2">
        {[
          { value: 'all', label: 'All' },
          { value: 'work', label: 'Work' },
          { value: 'personal', label: 'Personal' },
        ].map(ct => (
          <button
            key={ct.value}
            onClick={() => setContextTab(ct.value)}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${
              contextTab === ct.value ? 'bg-[#1a1a18] text-white' : 'text-[#6b6b67] hover:bg-gray-100'
            }`}
          >
            {ct.label}
          </button>
        ))}
      </div>
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
          Waiting On {waitingOnAll.filter(e => e.status === 'waiting_on').length > 0 &&
            `(${waitingOnAll.filter(e => e.status === 'waiting_on').length})`}
        </button>
      </div>
      {isLoading ? <Spinner /> : shown.length === 0 ? (
        <EmptyState icon={isReplyTab ? '📬' : '⏳'} message={
          isReplyTab ? 'No emails need reply' : 'Nothing waiting'
        } />
      ) : (
        <div className="space-y-2">
          {visibleItems.map(email => {
            const isResolved = email.status === 'resolved'

            // Category label + color
            const CATEGORY_STYLE = {
              submittal:         'bg-blue-50 text-blue-700',
              question:          'bg-purple-50 text-purple-700',
              action_request:    'bg-orange-50 text-orange-700',
              follow_up:         'bg-yellow-50 text-yellow-700',
              approval_pending:  'bg-red-50 text-red-700',
              informational:     'bg-gray-100 text-gray-500',
              question_to_ryan:  'bg-purple-50 text-purple-700',
              approval_needed:   'bg-red-50 text-red-700',
              action_needed:     'bg-orange-50 text-orange-700',
              submittal_received:'bg-blue-50 text-blue-700',
              fyi:               'bg-gray-100 text-gray-400',
              introduction:      'bg-green-50 text-green-700',
            }
            const catStyle = CATEGORY_STYLE[email.email_category] || 'bg-gray-100 text-gray-500'
            const catLabel = (email.email_category || '').replace(/_/g, ' ')

            return (
              <div
                key={email.id}
                className={`flex items-start gap-2 group transition-opacity ${isResolved ? 'opacity-40' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  {/* Row 1: name + category + days */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <ContactLink
                      name={email.from_name || email.from_address}
                      contacts={contacts}
                      className={`text-sm font-medium text-[#1a1a18] ${isResolved ? 'line-through' : ''}`}
                    />
                    {email.email_category && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${catStyle}`}>
                        {catLabel}
                      </span>
                    )}
                    {email.days_waiting > 0 && (
                      <span className={`text-xs flex-shrink-0 font-medium ${email.days_waiting > 5 ? 'text-red-500' : 'text-orange-400'}`}>
                        {email.days_waiting}d
                      </span>
                    )}
                    {email.extracted_deadline && (
                      <span className="text-[10px] text-red-500 flex-shrink-0 font-medium">
                        due {email.extracted_deadline}
                      </span>
                    )}
                  </div>

                  {/* Row 2: subject (secondary, smaller) */}
                  <p className={`text-[11px] text-[#9b9b97] truncate ${isResolved ? 'line-through' : ''}`}>
                    {email.thread_subject || email.subject}
                  </p>

                  {/* Row 3: action_needed (primary context — what actually matters) */}
                  {(email.action_needed || email.ai_summary) && (
                    <p className="text-xs text-[#1a1a18] mt-0.5 line-clamp-2 leading-snug font-normal">
                      {email.action_needed || email.ai_summary}
                    </p>
                  )}
                </div>

                {/* Needs Reply: single checkmark */}
                {isReplyTab && (
                  <button
                    onClick={() => mark.mutate({ id: email.id, status: 'done' })}
                    className="text-xs text-[#6b6b67] hover:text-green-600 flex-shrink-0 opacity-0 group-hover:opacity-100"
                    title="Mark replied"
                  >
                    ✓
                  </button>
                )}

                {/* Waiting On: checkmark (resolved) + archive (no longer waiting) */}
                {!isReplyTab && !isResolved && (
                  <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => mark.mutate({ id: email.id, status: 'resolved' })}
                      className="text-xs text-[#6b6b67] hover:text-green-600"
                      title="Mark resolved"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => mark.mutate({ id: email.id, status: 'archived' })}
                      className="text-[10px] text-gray-300 hover:text-gray-500 leading-none"
                      title="No longer waiting"
                    >
                      No longer waiting
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {!shownAll && shown.length > CAP && (
            <button onClick={() => setShownAll(true)} className="mt-2 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left">
              + {shown.length - CAP} more — tap to show all
            </button>
          )}
          {shownAll && shown.length > CAP && (
            <button onClick={() => setShownAll(false)} className="mt-2 text-xs text-[#6b6b67] hover:underline w-full text-left">
              Show less ↑
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Pending Decisions panel ────────────────────────────────────
function PendingDecisionsPanel({ showAll, setShowAll }) {
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
      <SectionHeader title="Pending Decisions" count={items.length} to="/decisions" />
      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon="🧠" message="No pending decisions" />
      ) : (
        <div className="space-y-3">
          {(showAll ? items : items.slice(0, 4)).map(d => (
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
          {!showAll && items.length > 4 && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left">
              + {items.length - 4} more decisions — tap to show all
            </button>
          )}
          {showAll && items.length > 4 && (
            <button onClick={() => setShowAll(false)} className="mt-2 text-xs text-[#6b6b67] hover:underline w-full text-left">
              Show less ↑
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

// ── AI Questions panel ─────────────────────────────────────────
function AIQuestionsPanel({ showAll, setShowAll }) {
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
          {(showAll ? items : items.slice(0, 4)).map(q => (
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
          {!showAll && items.length > 4 && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left">
              + {items.length - 4} more questions — tap to show all
            </button>
          )}
          {showAll && items.length > 4 && (
            <button onClick={() => setShowAll(false)} className="mt-2 text-xs text-[#6b6b67] hover:underline w-full text-left">
              Show less ↑
            </button>
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

function UnlinkedIntelPanel({ projects }) {
  const qc = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['unlinked-intel'],
    queryFn: getUnlinkedIntelligence,
    refetchInterval: 300000,
  })

  const [openMenuId, setOpenMenuId]       = useState(null)
  const [creatingForId, setCreatingForId] = useState(null)
  const [newProjectName, setNewProjectName] = useState('')

  const activeProjects = (projects || []).filter(p => p.status === 'active')

  const linkMutation = useMutation({
    mutationFn: ({ id, projectId }) =>
      updateUnlinkedIntelligence(id, { status: 'filed', suggested_project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unlinked-intel'] }),
  })

  const createAndLink = useMutation({
    mutationFn: async ({ id, name }) => {
      const project = await createProject({ name, status: 'active' })
      await updateUnlinkedIntelligence(id, { status: 'filed', suggested_project_id: project.id })
    },
    onSuccess: () => {
      setCreatingForId(null)
      setNewProjectName('')
      qc.invalidateQueries({ queryKey: ['unlinked-intel'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const dismiss = useMutation({
    mutationFn: (id) => updateUnlinkedIntelligence(id, { status: 'dismissed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unlinked-intel'] }),
  })

  const items = data || []
  if (items.length === 0 && !isLoading) return null

  return (
    <Card>
      <SectionHeader title="Unlinked Intelligence" count={items.length} badge="needs filing" />
      {isLoading ? <Spinner /> : (
        <div className="space-y-3">
          {(showAll ? items : items.slice(0, 3)).map(item => {
            const subItems   = parseIntelContent(item.content)
            const sourceLabel = item.source_email_id ? 'from email'
              : item.source_type === 'meeting' ? 'from meeting'
              : item.source_type || null

            return (
              <div key={item.id} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">

                {/* Source + type badges */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {item.intel_type  && <PillBadge label={item.intel_type} color="purple" />}
                  {sourceLabel      && <PillBadge label={sourceLabel}     color="blue"   />}
                </div>

                {/* Readable content */}
                {subItems ? (
                  <div className="mb-2">
                    {subItems.slice(0, 3).map((obj, i) => (
                      <IntelSubItem key={i} obj={obj} />
                    ))}
                    {subItems.length > 3 && (
                      <p className="text-xs text-[#6b6b67] mt-1">
                        +{subItems.length - 3} more in this batch
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#1a1a18] leading-snug mb-2">
                    {item.content && item.content.trim().startsWith('[')
                      ? `${(item.content.match(/\{/g) || []).length} intelligence items need filing`
                      : item.content}
                  </p>
                )}

                {/* Filing actions */}
                {creatingForId === item.id ? (
                  <div className="flex gap-2">
                    <input
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      placeholder="New project name..."
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newProjectName.trim()) {
                          createAndLink.mutate({ id: item.id, name: newProjectName.trim() })
                        }
                        if (e.key === 'Escape') { setCreatingForId(null); setNewProjectName('') }
                      }}
                    />
                    <button
                      onClick={() => newProjectName.trim() &&
                        createAndLink.mutate({ id: item.id, name: newProjectName.trim() })}
                      disabled={!newProjectName.trim() || createAndLink.isPending}
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-blue-700"
                    >
                      {createAndLink.isPending ? '…' : 'Create'}
                    </button>
                    <button
                      onClick={() => { setCreatingForId(null); setNewProjectName('') }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Link to project: toggle select */}
                    {openMenuId === item.id ? (
                      <select
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        defaultValue=""
                        autoFocus
                        onChange={e => {
                          if (e.target.value) {
                            linkMutation.mutate({ id: item.id, projectId: e.target.value })
                            setOpenMenuId(null)
                          }
                        }}
                        onBlur={() => setOpenMenuId(null)}
                      >
                        <option value="" disabled>Select project…</option>
                        {activeProjects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => { setOpenMenuId(item.id); setCreatingForId(null) }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Link to project ▾
                      </button>
                    )}

                    <button
                      onClick={() => { setCreatingForId(item.id); setOpenMenuId(null); setNewProjectName('') }}
                      className="text-xs text-[#6b6b67] hover:text-[#1a1a18]"
                    >
                      Create new project
                    </button>

                    <button
                      onClick={() => dismiss.mutate(item.id)}
                      className="text-xs text-gray-400 hover:text-red-400"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {!showAll && items.length > 3 && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-sm text-blue-600 hover:underline cursor-pointer w-full text-left">
              + {items.length - 3} more — tap to show all
            </button>
          )}
          {showAll && items.length > 3 && (
            <button onClick={() => setShowAll(false)} className="mt-2 text-xs text-[#6b6b67] hover:underline w-full text-left">
              Show less ↑
            </button>
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
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e5e5e3] px-3 md:px-6 py-2.5 z-10" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
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

// ── AI Job button ──────────────────────────────────────────────
function AIJobButton() {
  const [status, setStatus] = useState('idle')

  const trigger = async () => {
    if (status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch('https://personal-os-five-black.vercel.app/api/jobs/trigger-nightly', {
        method: 'POST',
        headers: { 'x-trigger-secret': '0557601ac4f4c8f0d42923bba2fb083b' },
      })
      if (res.ok) { setStatus('done'); setTimeout(() => setStatus('idle'), 3000) }
      else         { setStatus('error'); setTimeout(() => setStatus('idle'), 3000) }
    } catch {
      setStatus('error'); setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const label = { idle: '▶ AI Job', loading: 'Queuing…', done: '✓ Queued', error: '✗ Failed' }[status]

  const cls = {
    idle:    'bg-[#1a1a18] text-white hover:bg-gray-800',
    loading: 'bg-gray-400 text-white cursor-not-allowed',
    done:    'bg-green-600 text-white',
    error:   'bg-red-500 text-white',
  }[status]

  return (
    <button
      onClick={trigger}
      disabled={status === 'loading'}
      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${cls[status] || cls.idle}`}
    >
      {status === 'loading' && <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />}
      {label}
    </button>
  )
}

// ── Dashboard ──────────────────────────────────────────────────
export default function Dashboard() {
  const [workspace, setWorkspace] = useState('all')

  // ── Lifted expand/collapse state (for stat card navigation) ──
  const [showAllTasks,     setShowAllTasks]     = useState(false)
  const [showAllReply,     setShowAllReply]     = useState(false)
  const [showAllDecisions, setShowAllDecisions] = useState(false)
  const [showAllQuestions, setShowAllQuestions] = useState(false)

  // ── Panel refs for scroll-to navigation ──────────────────────
  const tasksRef     = useRef(null)
  const emailRef     = useRef(null)
  const decisionsRef = useRef(null)
  const questionsRef = useRef(null)

  function scrollTo(ref) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onOpenTasks = useCallback(() => {
    setShowAllTasks(true)
    setTimeout(() => scrollTo(tasksRef), 50)
  }, [])

  const onNeedsReply = useCallback(() => {
    setShowAllReply(true)
    setTimeout(() => scrollTo(emailRef), 50)
  }, [])

  const onDecisions = useCallback(() => {
    setShowAllDecisions(true)
    setTimeout(() => scrollTo(decisionsRef), 50)
  }, [])

  const onQuestions = useCallback(() => {
    setShowAllQuestions(true)
    setTimeout(() => scrollTo(questionsRef), 50)
  }, [])

  const { data: tasks,       isLoading: loadingTasks }   = useQuery({ queryKey: ['tasks'],       queryFn: getTasks,        refetchInterval: 120000 })
  const { data: events,      isLoading: loadingEvents }  = useQuery({ queryKey: ['events'],      queryFn: getEvents,       refetchInterval: 120000 })
  const { data: emails,      isLoading: loadingEmails }  = useQuery({ queryKey: ['emails'],      queryFn: getEmails,       refetchInterval: 120000 })
  const { data: commitments, isLoading: loadingCommit }  = useQuery({ queryKey: ['commitments'], queryFn: getCommitments,  refetchInterval: 120000 })
  const { data: projects,    isLoading: loadingProjects} = useQuery({ queryKey: ['projects'],    queryFn: getProjects,     refetchInterval: 300000 })
  const { data: contacts }   = useQuery({ queryKey: ['contacts'],    queryFn: getContacts,     refetchInterval: 300000 })
  const { data: decisions }  = useQuery({ queryKey: ['pending-decisions'], queryFn: getPendingDecisions, refetchInterval: 300000 })
  const { data: questions }  = useQuery({ queryKey: ['ai-questions'],      queryFn: getAIQuestions,     refetchInterval: 300000 })
  const { data: meetingNotes = [] } = useQuery({
    queryKey: ['meeting-notes'],
    queryFn: () => getMeetingNotes(),
    refetchInterval: 300000
  })

  const { data: proposedKnowledge = [] } = useQuery({
    queryKey: ['knowledge-proposed'],
    queryFn:  () => getKnowledge('proposed'),
    refetchInterval: 300000,
  })
  const [expandedMeeting, setExpandedMeeting] = useState(null)

  const now = dayjs()

  return (
    <div className="min-h-screen bg-[#f8f8f6]" style={{ paddingBottom: 'max(4rem, calc(4rem + env(safe-area-inset-bottom)))' }}>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-3 md:px-6 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[#1a1a18] text-base tracking-tight">Personal OS</span>
            <WorkspaceBar workspace={workspace} setWorkspace={setWorkspace} />
            <Link
              to="/projects"
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Projects
            </Link>
            <Link
              to="/contacts"
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Contacts
            </Link>
            <Link
              to="/knowledge"
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1.5"
            >
              Knowledge
              {proposedKnowledge.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium leading-none">
                  ⚡ Review
                </span>
              )}
            </Link>
            <AIJobButton />
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
          onOpenTasks={onOpenTasks}
          onNeedsReply={onNeedsReply}
          onDecisions={onDecisions}
          onQuestions={onQuestions}
        />

        {/* Calendar — full width */}
        <CalendarStrip events={events} isLoading={loadingEvents} />

        {/* Quick Question — surfaces one question at a time, prominent + frictionless */}
        {questions?.length > 0 && (
          <QuickQuestion
            question={questions[0]}
            remaining={questions.length - 1}
            onAnswered={() => {}}
          />
        )}

        {/* Two-column grid: action left, intelligence right */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* LEFT column */}
          <div className="space-y-3">
            <div ref={tasksRef}>
              <TaskPanel tasks={tasks} isLoading={loadingTasks} showAll={showAllTasks} setShowAll={setShowAllTasks} />
            </div>
            <CommitmentsPanel commitments={commitments} isLoading={loadingCommit} contacts={contacts} />
            <OthersCommitmentsPanel contacts={contacts} />
          </div>

          {/* RIGHT column */}
          <div className="space-y-3">
            <div ref={emailRef}>
              <EmailQueue emails={emails} isLoading={loadingEmails} contacts={contacts} showAllReply={showAllReply} setShowAllReply={setShowAllReply} />
            </div>
            <div ref={decisionsRef}>
              <PendingDecisionsPanel showAll={showAllDecisions} setShowAll={setShowAllDecisions} />
            </div>
            <div ref={questionsRef}>
              <AIQuestionsPanel showAll={showAllQuestions} setShowAll={setShowAllQuestions} />
            </div>
          </div>
        </div>

        {/* Projects — full width */}
        <ProjectsPanel projects={projects} isLoading={loadingProjects} />

        {/* Unlinked intelligence — only renders if data exists */}
        <UnlinkedIntelPanel projects={projects} />

        {/* Recent Meetings (Otter) */}
        <div className="bg-white rounded-2xl border border-[#e5e5e3] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#1a1a18] text-sm">Recent Meetings</h2>
            <span className="text-xs text-[#6b6b67] bg-[#f0f0ee] px-2 py-0.5 rounded-full">from Plaud</span>
          </div>
          {meetingNotes.length === 0 ? (
            <p className="text-xs text-[#9b9b97] py-4 text-center">No meetings recorded yet</p>
          ) : (
            <div className="space-y-2">
              {meetingNotes.map(m => {
                const isExpanded = expandedMeeting === m.otter_id
                const dateStr = m.start_time ? m.start_time.split('T')[0] : 'unknown'
                const participantCount = (m.participants || []).length
                const ryanItems = (m.action_items_raw || []).filter(a => a.is_ryan_item || a.assignee_email === 'hankinsr@claycorp.com')
                const othersItems = (m.action_items_raw || []).filter(a => !a.is_ryan_item && a.assignee_email !== 'hankinsr@claycorp.com')
                const summaryPreview = m.short_summary ? m.short_summary.slice(0, 100) + (m.short_summary.length > 100 ? '...' : '') : ''
                return (
                  <div
                    key={m.otter_id}
                    className="border border-[#e5e5e3] rounded-xl p-3 cursor-pointer hover:bg-[#f8f8f6] transition-colors"
                    onClick={() => setExpandedMeeting(isExpanded ? null : m.otter_id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#1a1a18] truncate flex-1 mr-2">{m.title || 'Untitled meeting'}</span>
                      <span className="text-xs text-[#9b9b97] shrink-0">{dateStr}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {m.duration_raw && <span className="text-xs text-[#6b6b67]">{m.duration_raw}</span>}
                      {participantCount > 0 && <span className="text-xs text-[#9b9b97]">{participantCount} attendees</span>}
                    </div>
                    {!isExpanded && summaryPreview && (
                      <p className="text-xs text-[#6b6b67] mt-1 leading-relaxed">{summaryPreview}</p>
                    )}
                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        {m.short_summary && (
                          <p className="text-xs text-[#6b6b67] leading-relaxed">{m.short_summary}</p>
                        )}
                        {ryanItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-[#3b82f6] mb-1">My action items</p>
                            <ul className="space-y-0.5">
                              {ryanItems.map((item, i) => (
                                <li key={i} className="text-xs text-[#3b82f6]">- {item.task_text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {othersItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-[#6b6b67] mb-1">Others action items</p>
                            <ul className="space-y-0.5">
                              {othersItems.map((item, i) => (
                                <li key={i} className="text-xs text-[#9b9b97]">- {item.assignee_name}: {item.task_text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* Sync FAB — above the chat bar */}
      <div className="fixed bottom-16 right-4 z-20">
        <SyncButton />
      </div>

    </div>
  )
}
