import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getTasks, updateTask, deleteTask } from '../lib/api'
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

export default function TasksPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('all')
  const [urgencyFilter, setUrgencyFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)

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
    try {
      await Promise.all([...selected].map(id => updateTask(id, { status: 'done' })))
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => selected.has(t.id) ? { ...t, status: 'done' } : t)
      )
      exitSelectMode()
    } finally {
      setBulkSaving(false)
    }
  }

  const bulkDelete = async () => {
    if (!selected.size) return
    setBulkSaving(true)
    try {
      await Promise.all([...selected].map(id => deleteTask(id)))
      qc.setQueryData(['tasks'], old => (old || []).filter(t => !selected.has(t.id)))
      exitSelectMode()
    } finally {
      setBulkSaving(false)
    }
  }

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
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

  const filtered = (tasks || []).filter(t => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'done' && t.status !== 'done' && t.status !== 'complete') return false
      if (statusFilter === 'open' && t.status !== 'open') return false
      if (statusFilter === 'in_progress' && t.status !== 'in_progress') return false
    }
    if (urgencyFilter !== 'all' && t.urgency !== urgencyFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const ua = URGENCY_ORDER[a.urgency] ?? 4
    const ub = URGENCY_ORDER[b.urgency] ?? 4
    if (ua !== ub) return ua - ub
    // due_date ascending, undated last
    if (a.due_date && b.due_date) return dayjs(a.due_date).diff(dayjs(b.due_date))
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })

  const isDone = (t) => t.status === 'done' || t.status === 'complete'

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
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">Tasks</h1>
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

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2">
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Status</p>
            <PillToggle options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Urgency</p>
            <PillToggle options={urgencyOptions} value={urgencyFilter} onChange={setUrgencyFilter} />
          </div>
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

                    {/* Complete button */}
                    {!done && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          complete.mutate({ id: task.id })
                        }}
                        className="flex-shrink-0 w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
                        title="Mark complete"
                      >
                        ✓
                      </button>
                    )}
                  </div>

                  {/* Expanded detail — inline edit */}
                  {expanded && (
                    <div className="px-4 pb-3 pt-2 ml-5 bg-gray-50 border-t border-[#f0f0ee]">
                      <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide mb-2">Edit · click any field</p>
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
                      {task.source_label && (
                        <p className="text-xs text-[#9b9b97]">Source: {task.source_label}</p>
                      )}
                      {task.source_email_id && (
                        <p className="text-xs text-[#9b9b97]">Email ID: {task.source_email_id}</p>
                      )}
                      {task.notes && (
                        <p className="text-xs text-[#6b6b67] whitespace-pre-wrap">{task.notes}</p>
                      )}
                    </div>
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
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex justify-center px-4 pb-20">
          <div className="bg-[#1a1a18] text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 w-full max-w-lg">
            <span className="text-sm font-medium whitespace-nowrap">{selected.size} selected</span>
            <button
              onClick={bulkMarkDone}
              disabled={bulkSaving}
              className="flex-1 text-sm font-semibold bg-green-500 text-white px-4 py-2 rounded-xl disabled:opacity-40 hover:bg-green-400 transition-colors"
            >
              {bulkSaving ? 'Saving…' : '✓ Mark done'}
            </button>
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
    </div>
  )
}
