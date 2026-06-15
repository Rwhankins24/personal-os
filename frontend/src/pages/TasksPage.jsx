import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getTasks, updateTask, deleteTask, getProjects } from '../lib/api'
import { useToast } from '../contexts/ToastContext'
import InlineEdit from '../components/InlineEdit'

// ── Potential Duplicates Section ──────────────────────────────────
function PotentialDuplicatesSection({ allTasks, update }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  // Items flagged as potential duplicates (have potential_duplicate_of set)
  const flagged = (allTasks || []).filter(t => t.potential_duplicate_of && t.status !== 'archived')

  // Build pairs: flagged item + the item it points to
  const pairs = flagged.map(loser => {
    const winner = (allTasks || []).find(t => t.id === loser.potential_duplicate_of)
    return { loser, winner }
  }).filter(p => p.winner)

  if (pairs.length === 0) return null

  // Group by project
  const grouped = {}
  for (const pair of pairs) {
    const key = pair.loser.project_id || pair.winner?.project_id || '__none__'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(pair)
  }

  const handleMerge = (loser, winner) => {
    // Enrich winner with any data the loser has that winner is missing
    const winnerEnrichment = {}
    if (!winner.due_date   && loser.due_date)   winnerEnrichment.due_date   = loser.due_date
    if (!winner.project_id && loser.project_id) winnerEnrichment.project_id = loser.project_id
    if (!winner.context    && loser.context)    winnerEnrichment.context    = loser.context
    if (!winner.urgency    && loser.urgency)    winnerEnrichment.urgency    = loser.urgency

    if (Object.keys(winnerEnrichment).length > 0) {
      update.mutate({ id: winner.id, updates: winnerEnrichment })
    }

    // Archive loser, mark as reviewed so nightly job never re-flags
    update.mutate({
      id: loser.id,
      updates: {
        status: 'archived',
        potential_duplicate_of: null,
        duplicate_confidence: null,
        duplicate_reviewed: true,
        duplicate_decision: 'merged'
      }
    })
  }

  const handleKeepSeparate = (loser, winner) => {
    // Mark BOTH items as reviewed — nightly job checks this before re-flagging
    const knownWith = [...(winner.known_not_duplicate_with || []), loser.id]
    update.mutate({
      id: winner.id,
      updates: {
        known_not_duplicate_with: knownWith,
        duplicate_reviewed: true
      }
    })
    update.mutate({
      id: loser.id,
      updates: {
        potential_duplicate_of: null,
        duplicate_confidence: null,
        duplicate_reviewed: true,
        duplicate_decision: 'separate',
        known_not_duplicate_with: [...(loser.known_not_duplicate_with || []), winner.id]
      }
    })
  }

  const handleResolveAll = () => {
    for (const { loser, winner } of pairs) {
      handleMerge(loser, winner)
    }
  }

  return (
    <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-3 bg-amber-50 text-left hover:bg-amber-100 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-semibold text-amber-800 flex-1">
          ⚠️ Potential Duplicates ({pairs.length})
        </span>
        <span className="text-xs text-amber-600">{open ? '▲ Collapse' : '▼ Expand'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-4">
          <div className="flex justify-end">
            <button
              onClick={handleResolveAll}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors"
            >
              Resolve all (merge all)
            </button>
          </div>

          {Object.entries(grouped).map(([projectKey, groupPairs]) => (
            <div key={projectKey} className="space-y-2">
              {projectKey !== '__none__' && (
                <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide">Project</p>
              )}
              {groupPairs.map(({ loser, winner }) => (
                <div key={loser.id} className="border border-amber-100 rounded-xl p-3 bg-amber-50/30">
                  {/* Pair titles side by side */}
                  <div className="flex gap-2 items-start mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-[#9b9b97] uppercase mb-0.5">Keep</p>
                      <p className="text-sm font-medium text-[#1a1a18] leading-snug">{winner.title}</p>
                      {winner.source_label && (
                        <p className="text-xs text-[#9b9b97] truncate mt-0.5">↳ {winner.source_label}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-center justify-center px-2">
                      <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {loser.duplicate_confidence != null ? `${loser.duplicate_confidence}%` : '?'}
                      </span>
                      <span className="text-[10px] text-[#9b9b97] mt-0.5">conf</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-[#9b9b97] uppercase mb-0.5">Maybe dup</p>
                      <p className="text-sm font-medium text-[#6b6b67] leading-snug line-through">{loser.title}</p>
                      {loser.source_label && (
                        <p className="text-xs text-[#9b9b97] truncate mt-0.5">↳ {loser.source_label}</p>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleMerge(loser, winner)}
                      className="text-xs px-3 py-1 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors flex-1"
                    >
                      Merge (keep "{winner.title.slice(0, 25)}{winner.title.length > 25 ? '…' : ''}")
                    </button>
                    <button
                      onClick={() => handleKeepSeparate(loser, winner)}
                      className="text-xs px-3 py-1 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-100 transition-colors"
                    >
                      Keep separate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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

const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

function PillToggle({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-3 py-1 rounded-full font-medium transition-all border ${
            value === opt.value
              ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
              : 'bg-white text-[#6b6b67] border-[#e5e5e3] hover:border-gray-400'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Task expanded context panel ───────────────────────────────
function TaskContextPanel({ task, allTasks, projects, update }) {
  const [tab, setTab] = useState('context')
  const [editUrgency, setEditUrgency] = useState(task.urgency || 'medium')
  const [editDue, setEditDue] = useState(task.due_date || '')
  const [editNotes, setEditNotes] = useState(task.notes || '')
  const [saving, setSaving] = useState(false)

  const project = projects && task.project_id
    ? projects.find(p => p.id === task.project_id)
    : null

  const relatedTasks = task.meeting_note_id
    ? (allTasks || []).filter(t => t.meeting_note_id === task.meeting_note_id && t.id !== task.id).slice(0, 4)
    : []

  const overdue = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')
    && task.status !== 'done' && task.status !== 'complete'

  const sourceIcon = () => {
    const st = task.source_type || ''
    if (st.includes('otter') || st.includes('plaud') || st === 'upload') return '🎙'
    if (st === 'ai_email') return '📧'
    return '↳'
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await update.mutateAsync({ id: task.id, updates: {
        urgency:   editUrgency,
        due_date:  editDue || null,
        notes:     editNotes || null,
      }})
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 pb-3 pt-2 ml-5 border-t border-[#C9A84C]/30 bg-amber-50/20">
      {/* Tab row */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => setTab('context')}
          className={`text-xs font-semibold pb-0.5 transition-colors ${tab === 'context' ? 'text-[#C9A84C] border-b-2 border-[#C9A84C]' : 'text-[#9b9b97] hover:text-[#1a1a18]'}`}
        >
          Context
        </button>
        <button
          onClick={() => setTab('edit')}
          className={`text-xs font-semibold pb-0.5 transition-colors ${tab === 'edit' ? 'text-[#C9A84C] border-b-2 border-[#C9A84C]' : 'text-[#9b9b97] hover:text-[#1a1a18]'}`}
        >
          Edit
        </button>
      </div>

      {tab === 'context' && (
        <div className="space-y-2.5">
          {/* Source */}
          {task.source_label && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm">{sourceIcon()}</span>
              <span className="text-xs text-[#6b6b67]">{task.source_label}</span>
              {task.source_date && (
                <span className="text-xs text-[#9b9b97]">· {dayjs(task.source_date).format('MMM D')}</span>
              )}
            </div>
          )}

          {/* Project chip */}
          {project && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide">Project</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-[#C9A84C]/60 text-[#C9A84C] font-medium bg-amber-50">
                {project.name}
              </span>
            </div>
          )}

          {/* Related from same meeting */}
          {relatedTasks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide mb-1">Related from this meeting</p>
              <div className="flex flex-wrap gap-1.5">
                {relatedTasks.map(t => (
                  <span key={t.id} className="flex items-center gap-1 text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.status === 'done' || t.status === 'complete' ? 'bg-green-500' : 'bg-amber-400'}`} />
                    {t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Context/notes block */}
          {task.context && (
            <div>
              <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide mb-0.5">Notes</p>
              <p className="text-xs text-[#6b6b67] leading-snug whitespace-pre-wrap">{task.context}</p>
            </div>
          )}

          {/* Due date */}
          {task.due_date && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide">Due</span>
              <span className={`text-xs font-medium ${overdue ? 'text-red-600 bg-red-50 px-2 py-0.5 rounded-full' : 'text-[#6b6b67]'}`}>
                {overdue ? 'Overdue · ' : ''}{dayjs(task.due_date).format('MMM D, YYYY')}
              </span>
            </div>
          )}

          {/* Compact quick-edit strip */}
          <div className="flex items-center gap-2 pt-1 border-t border-[#f0f0ee] flex-wrap">
            <select
              value={editUrgency}
              onChange={e => setEditUrgency(e.target.value)}
              className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 bg-white text-[#1a1a18] focus:outline-none"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              type="date"
              value={editDue}
              onChange={e => setEditDue(e.target.value)}
              className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 bg-white text-[#1a1a18] focus:outline-none"
            />
            <input
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Add a note…"
              className="flex-1 min-w-[80px] text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 bg-white text-[#1a1a18] focus:outline-none"
            />
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="text-xs px-2 py-1 bg-[#1a1a18] text-white rounded-lg disabled:opacity-40 hover:bg-gray-800 transition-colors"
            >
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'edit' && (
        <div>
          <InlineEdit
            item={task}
            type="task"
            onSave={(id, patch) => update.mutate({ id, updates: patch })}
          />
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {task.status && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-[#6b6b67]">
                {task.status}
              </span>
            )}
            {task.ai_extracted && (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">AI extracted</span>
            )}
          </div>
          {task.source_email_id && (
            <p className="text-xs text-[#9b9b97] mt-1">Email ID: {task.source_email_id}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function TasksPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [urgencyFilter, setUrgencyFilter] = useState('all')
  const [sortBy,        setSortBy]        = useState('urgency') // urgency | newest | oldest | due
  const [projectFilter, setProjectFilter] = useState('all')    // 'all' | project id
  const [expandedId,    setExpandedId]    = useState(null)
  const [selectMode,    setSelectMode]    = useState(false)
  const [selected,      setSelected]      = useState(new Set())
  const [bulkSaving,    setBulkSaving]    = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  // recentlyCompleted: Map<taskId, timeoutId> — 5-sec undo window after marking done
  const [recentlyCompleted, setRecentlyCompleted] = useState(() => new Map())
  const recentlyCompletedRef = useRef(new Map())
  const [mergeModal, setMergeModal] = useState(false) // open merge picker

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(sorted.map(t => t.id)))
  const clearAll  = () => setSelected(new Set())

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const bulkMarkDone = async () => {
    if (!selected.size) return
    setBulkSaving(true)
    const count = selected.size
    try {
      await Promise.all([...selected].map(id => updateTask(id, { status: 'done' })))
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => selected.has(t.id) ? { ...t, status: 'done' } : t)
      )
      toast(`${count} task${count !== 1 ? 's' : ''} marked complete`, { icon: '✓' })
      exitSelectMode()
    } finally {
      setBulkSaving(false)
    }
  }

  const bulkDelete = async () => {
    if (!selected.size) return
    setBulkSaving(true)
    const count = selected.size
    try {
      await Promise.all([...selected].map(id => deleteTask(id)))
      qc.setQueryData(['tasks'], old => (old || []).filter(t => !selected.has(t.id)))
      toast(`${count} task${count !== 1 ? 's' : ''} deleted`, { icon: '🗑', type: 'info' })
      exitSelectMode()
    } finally {
      setBulkSaving(false)
    }
  }

  // Merge: keep one task, archive the rest (append their context as notes)
  const handleMerge = async (keeperId) => {
    const losers = [...selected].filter(id => id !== keeperId)
    const keeper = (tasks || []).find(t => t.id === keeperId)
    const loserTasks = (tasks || []).filter(t => losers.includes(t.id))
    // Build combined notes: keeper notes + loser titles/context
    const extra = loserTasks
      .map(t => `• ${t.title}${t.context ? ` — ${t.context}` : ''}`)
      .join('\n')
    const mergedNotes = [keeper?.notes, extra].filter(Boolean).join('\n\n[Merged from:]\n')
    setBulkSaving(true)
    try {
      await updateTask(keeperId, { notes: mergedNotes || null })
      await Promise.all(losers.map(id => updateTask(id, { status: 'archived' })))
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => {
          if (t.id === keeperId) return { ...t, notes: mergedNotes || null }
          if (losers.includes(t.id)) return { ...t, status: 'archived' }
          return t
        })
      )
      toast(`Merged ${selected.size} tasks into 1`, { icon: '⛓' })
      setMergeModal(false)
      exitSelectMode()
    } finally {
      setBulkSaving(false)
    }
  }

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
  })

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  const update = useMutation({
    mutationFn: ({ id, updates }) => updateTask(id, updates),
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const prev = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], old => (old || []).map(t => t.id === id ? { ...t, ...updates } : t))
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['tasks'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const complete = useMutation({
    mutationFn: ({ id }) => updateTask(id, { status: 'done' }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const prev = qc.getQueryData(['tasks'])
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => t.id === id ? { ...t, status: 'done' } : t)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['tasks'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  // markDone: fire API + show 5-sec undo window, then auto-hide
  const markDone = useCallback((id) => {
    complete.mutate({ id })
    // Clear any existing timer for this id
    if (recentlyCompletedRef.current.has(id)) {
      clearTimeout(recentlyCompletedRef.current.get(id))
    }
    const timerId = setTimeout(() => {
      recentlyCompletedRef.current.delete(id)
      setRecentlyCompleted(new Map(recentlyCompletedRef.current))
    }, 5000)
    recentlyCompletedRef.current.set(id, timerId)
    setRecentlyCompleted(new Map(recentlyCompletedRef.current))
  }, [complete])

  const undoComplete = useCallback((id) => {
    // Cancel the hide timer
    if (recentlyCompletedRef.current.has(id)) {
      clearTimeout(recentlyCompletedRef.current.get(id))
      recentlyCompletedRef.current.delete(id)
      setRecentlyCompleted(new Map(recentlyCompletedRef.current))
    }
    // Restore to open
    update.mutate({ id, updates: { status: 'open' } })
  }, [update])

  const statusOptions = [
    { value: 'all',         label: 'All' },
    { value: 'open',        label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'done',        label: 'Done' },
  ]

  const urgencyOptions = [
    { value: 'all',      label: 'All' },
    { value: 'critical', label: 'Critical' },
    { value: 'high',     label: 'High' },
    { value: 'medium',   label: 'Medium' },
    { value: 'low',      label: 'Low' },
  ]

  const isDone = (t) => t.status === 'done' || t.status === 'complete'

  const filtered = (tasks || []).filter(t => {
    // Hide completed unless: showCompleted is on, OR in 5-sec undo window, OR status filter explicitly set to 'done'
    if (isDone(t) && !showCompleted && !recentlyCompleted.has(t.id) && statusFilter !== 'done') return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'done' && !isDone(t)) return false
      if (statusFilter === 'open' && t.status !== 'open') return false
      if (statusFilter === 'in_progress' && t.status !== 'in_progress') return false
    }
    if (urgencyFilter !== 'all' && t.urgency !== urgencyFilter) return false
    if (projectFilter !== 'all') {
      if (projectFilter === 'none' && t.project_id) return false
      if (projectFilter !== 'none' && t.project_id !== projectFilter) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      if (
        !t.title?.toLowerCase().includes(q) &&
        !t.context?.toLowerCase().includes(q) &&
        !t.source_label?.toLowerCase().includes(q) &&
        !t.notes?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const completedCount = (tasks || []).filter(isDone).length

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }
    if (sortBy === 'oldest') {
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    }
    if (sortBy === 'due') {
      if (a.due_date && b.due_date) return dayjs(a.due_date).diff(dayjs(b.due_date))
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    }
    // default: urgency
    const ua = URGENCY_ORDER[a.urgency] ?? 4
    const ub = URGENCY_ORDER[b.urgency] ?? 4
    if (ua !== ub) return ua - ub
    if (a.due_date && b.due_date) return dayjs(a.due_date).diff(dayjs(b.due_date))
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <h1 className="text-sm font-semibold text-[#1a1a18]">Tasks</h1>
          <button
            onClick={() => setShowCompleted(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all flex-1 text-left ${
              showCompleted
                ? 'bg-gray-100 text-[#6b6b67] border-gray-200'
                : 'text-[#9b9b97] border-transparent hover:border-gray-200'
            }`}
          >
            {showCompleted ? `Hide completed (${completedCount})` : completedCount > 0 ? `+${completedCount} done` : ''}
          </button>
          {selectMode ? (
            <div className="flex items-center gap-2">
              <button onClick={selectAll}  className="text-xs text-blue-600 hover:underline">All</button>
              <button onClick={clearAll}   className="text-xs text-[#6b6b67] hover:underline">Clear</button>
              <button onClick={exitSelectMode} className="text-xs text-[#6b6b67] hover:underline">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18]"
            >
              Select
            </button>
          )}
          <span className="text-xs text-[#9b9b97] flex-shrink-0">{sorted.length} items</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-36 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-[#e5e5e3] rounded-lg bg-[#f8f8f6] text-[#1a1a18] placeholder-[#9b9b97] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >×</button>
            )}
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Status</p>
            <PillToggle options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Urgency</p>
            <PillToggle options={urgencyOptions} value={urgencyFilter} onChange={setUrgencyFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Sort</p>
            <PillToggle
              options={[
                { value: 'urgency', label: 'Urgency' },
                { value: 'newest',  label: 'Newest' },
                { value: 'oldest',  label: 'Oldest' },
                { value: 'due',     label: 'Due date' },
              ]}
              value={sortBy}
              onChange={setSortBy}
            />
          </div>
          {projects && projects.length > 0 && (
            <div>
              <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Project</p>
              <div className="flex flex-wrap gap-1">
                {[{ id: 'all', name: 'All' }, { id: 'none', name: 'No project' }, ...projects].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setProjectFilter(p.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${
                      projectFilter === p.id
                        ? 'bg-[#1a1a18] text-white'
                        : 'text-[#6b6b67] hover:bg-gray-100'
                    }`}
                  >
                    {p.name}
                    {p.id !== 'all' && p.id !== 'none' && (
                      <span className="ml-1 opacity-60 text-[10px]">
                        {(tasks || []).filter(t => t.project_id === p.id && !isDone(t)).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Task list */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No tasks match this filter</p>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl divide-y divide-[#f0f0ee]">
            {sorted.filter(t => t.status !== 'archived').map(task => {
              const expanded = expandedId === task.id
              const overdue = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day') && !isDone(task)
              const done = isDone(task)

              return (
                <div key={task.id}>
                  <div
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${selected.has(task.id) ? 'bg-blue-50/40' : ''}`}
                    onClick={() => selectMode ? toggleSelect(task.id) : setExpandedId(expanded ? null : task.id)}
                  >
                    {/* Checkbox (select mode) or urgency dot */}
                    {selectMode ? (
                      <div className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        selected.has(task.id) ? 'bg-blue-500 border-blue-500' : 'border-[#d0d0cc]'
                      }`}>
                        {selected.has(task.id) && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    ) : (
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[task.urgency] || 'bg-gray-300'}`} />
                    )}

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium leading-snug ${done ? 'line-through text-gray-400' : 'text-[#1a1a18]'}`}>
                          {task.title}
                        </p>
                        {task.due_date && (
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                            overdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-[#6b6b67]'
                          }`}>
                            {overdue ? 'Overdue · ' : 'Due '}
                            {dayjs(task.due_date).format('MMM D')}
                          </span>
                        )}
                      </div>
                      {task.context && (
                        <p className="text-xs text-[#6b6b67] mt-0.5 line-clamp-2 leading-snug">{task.context}</p>
                      )}
                      {task.source_label && (
                        <p className="text-xs text-[#9b9b97] mt-0.5 truncate">
                          {task.source_type === 'ai_otter' || task.source_type === 'plaud' || task.source_type === 'ai_plaud'
                            ? `🎙 ${task.source_label}`
                            : task.source_type === 'ai_email'
                            ? `📧 ${task.source_label}`
                            : `↳ ${task.source_label}`}
                        </p>
                      )}
                    </div>

                    {/* Complete / Undo buttons */}
                    {done && recentlyCompleted.has(task.id) ? (
                      <button
                        onClick={e => { e.stopPropagation(); undoComplete(task.id) }}
                        className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all font-medium border border-amber-200 whitespace-nowrap"
                      >
                        Undo
                      </button>
                    ) : !done ? (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          markDone(task.id)
                        }}
                        className="flex-shrink-0 w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
                        title="Mark complete"
                      >
                        ✓
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); undoComplete(task.id) }}
                        className="flex-shrink-0 text-xs px-2 py-0.5 rounded text-gray-300 hover:text-amber-600 hover:bg-amber-50 transition-all"
                        title="Mark incomplete"
                      >
                        ↩
                      </button>
                    )}
                  </div>

                  {/* Expanded detail — enriched context + edit */}
                  {expanded && (
                    <TaskContextPanel
                      task={task}
                      allTasks={tasks}
                      projects={projects}
                      update={update}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Potential duplicates review section */}
        {!isLoading && (
          <PotentialDuplicatesSection
            allTasks={tasks || []}
            update={update}
          />
        )}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed left-0 right-0 z-[60] flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)' }}>
          <div className="bg-[#1a1a18] text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 w-full max-w-lg">
            <span className="text-sm font-medium whitespace-nowrap">{selected.size} selected</span>
            <button
              onClick={bulkMarkDone}
              disabled={bulkSaving}
              className="flex-1 text-sm font-semibold bg-green-500 text-white px-4 py-2 rounded-xl disabled:opacity-40 hover:bg-green-400 transition-colors"
            >
              {bulkSaving ? 'Saving…' : '✓ Done'}
            </button>
            {selected.size >= 2 && (
              <button
                onClick={() => setMergeModal(true)}
                disabled={bulkSaving}
                className="text-sm font-semibold bg-blue-500 text-white px-4 py-2 rounded-xl disabled:opacity-40 hover:bg-blue-400 transition-colors"
              >
                ⛓ Merge
              </button>
            )}
            <button
              onClick={bulkDelete}
              disabled={bulkSaving}
              className="text-sm font-semibold bg-red-500 text-white px-4 py-2 rounded-xl disabled:opacity-40 hover:bg-red-400 transition-colors"
            >
              Delete
            </button>
            <button onClick={exitSelectMode} className="text-white/60 hover:text-white text-lg leading-none px-1">✕</button>
          </div>
        </div>
      )}

      {/* Merge modal — pick the keeper */}
      {mergeModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setMergeModal(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#e5e5e3]">
              <div>
                <h2 className="text-sm font-semibold text-[#1a1a18]">Merge {selected.size} tasks</h2>
                <p className="text-xs text-[#6b6b67] mt-0.5">Pick the one to keep. The others get archived.</p>
              </div>
              <button onClick={() => setMergeModal(false)} className="text-[#6b6b67] hover:text-[#1a1a18] text-xl leading-none">×</button>
            </div>
            <div className="px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
              {(tasks || []).filter(t => selected.has(t.id)).map(t => (
                <button
                  key={t.id}
                  onClick={() => handleMerge(t.id)}
                  disabled={bulkSaving}
                  className="w-full text-left px-4 py-3 rounded-xl border border-[#e5e5e3] hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-40 group"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium flex-shrink-0 uppercase">
                      {t.urgency || 'med'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] leading-snug group-hover:text-blue-700">{t.title}</p>
                      {t.context && <p className="text-xs text-[#9b9b97] mt-0.5 line-clamp-1">{t.context}</p>}
                      {t.source_label && <p className="text-[10px] text-[#9b9b97] mt-0.5">↳ {t.source_label}</p>}
                    </div>
                    <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 flex-shrink-0 font-medium">Keep →</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="px-5 pb-4 pt-2">
              <p className="text-[10px] text-[#9b9b97] text-center">The kept task will inherit notes from the archived ones.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
