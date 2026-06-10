import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getTasks, updateTask } from '../lib/api'
import InlineEdit from '../components/InlineEdit'

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
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{sorted.length} items</span>
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
            {sorted.map(task => {
              const expanded = expandedId === task.id
              const overdue = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day') && !isDone(task)
              const done = isDone(task)

              return (
                <div key={task.id}>
                  <div
                    className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(expanded ? null : task.id)}
                  >
                    {/* Urgency dot */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${URGENCY_COLOR[task.urgency] || 'bg-gray-300'}`} />

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
                        <p className="text-xs text-[#9b9b97] mt-0.5 truncate">↳ {task.source_label}</p>
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
      </div>
    </div>
  )
}
