import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getTasks, updateTask, getEmails, getProjects } from '../lib/api'

const STATUS_COLORS = {
  open:        'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  done:        'bg-green-100 text-green-700',
  blocked:     'bg-red-100 text-red-600',
}

const URGENCY_COLORS = {
  critical: 'bg-red-100 text-red-600',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-gray-100 text-gray-500',
}

const URGENCY_LABELS = {
  critical: '🔴 Critical',
  high:     '🟠 High',
  medium:   '🟡 Medium',
  low:      '⚪ Low',
}

export default function TaskDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState({})

  const { data: tasks,    isLoading } = useQuery({ queryKey: ['tasks'],    queryFn: getTasks })
  const { data: emails }              = useQuery({ queryKey: ['emails'],   queryFn: getEmails })
  const { data: projects }            = useQuery({ queryKey: ['projects'], queryFn: getProjects })

  const task = tasks?.find(t => t.id === id)

  const update = useMutation({
    mutationFn: (data) => updateTask(id, data),
    onSuccess: (updated) => {
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => t.id === id ? updated : t)
      )
      setEditing(false)
    },
  })

  const toggle = useMutation({
    mutationFn: (status) => updateTask(id, { status }),
    onSuccess: (updated) => {
      qc.setQueryData(['tasks'], old =>
        (old || []).map(t => t.id === id ? updated : t)
      )
    },
  })

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!task) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-[#6b6b67]">Task not found</p>
      <button onClick={() => navigate(-1)} className="text-blue-600 text-sm hover:underline">← Back</button>
    </div>
  )

  const isDone  = task.status === 'done' || task.status === 'complete'
  const overdue = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day') && !isDone

  const sourceEmail   = task.source_email_id  ? emails?.find(e => e.id === task.source_email_id)  : null
  const linkedProject = task.project_id       ? projects?.find(p => p.id === task.project_id)     : null

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* ── Sticky top bar ─────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <p className="text-sm font-semibold text-[#1a1a18] truncate flex-1 text-center">
            {task.title}
          </p>
          <button
            onClick={() => {
              setForm({
                title:    task.title,
                context:  task.context  || '',
                due_date: task.due_date || '',
                urgency:  task.urgency  || 'medium',
                notes:    task.notes    || '',
              })
              setEditing(v => !v)
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-100 flex-shrink-0"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {editing ? (
          /* Edit form */
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4 space-y-3">
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full text-lg font-semibold border-0 border-b border-gray-200 pb-2 focus:outline-none focus:border-blue-400"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Due date</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Urgency</label>
                <select
                  value={form.urgency}
                  onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {['critical', 'high', 'medium', 'low'].map(u => (
                    <option key={u} value={u}>{URGENCY_LABELS[u]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-[#6b6b67] block mb-1">Context</label>
              <input
                value={form.context}
                onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Why does this matter?"
              />
            </div>
            <div>
              <label className="text-xs text-[#6b6b67] block mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <button
              onClick={() => update.mutate(form)}
              disabled={!form.title?.trim() || update.isPending}
              className="px-4 py-2 bg-[#1a1a18] text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-800"
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : (
          <>
            {/* Main card */}
            <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
              <h1 className={`text-lg font-semibold leading-snug ${isDone ? 'line-through text-gray-400' : 'text-[#1a1a18]'}`}>
                {task.title}
              </h1>

              {/* Status + urgency badges */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {task.status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-600'}`}>
                    {task.status.replace('_', ' ')}
                  </span>
                )}
                {task.urgency && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${URGENCY_COLORS[task.urgency] || 'bg-gray-100 text-gray-500'}`}>
                    {URGENCY_LABELS[task.urgency] || task.urgency}
                  </span>
                )}
                {task.ai_extracted && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI extracted</span>
                )}
                {task.blocking && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">blocking</span>
                )}
              </div>

              {/* Due date */}
              {task.due_date && (
                <p className={`text-sm mt-2 ${overdue ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
                  Due {dayjs(task.due_date).format('MMMM D, YYYY')}
                  {overdue && ' — overdue'}
                </p>
              )}

              {/* Context / description */}
              {task.context && (
                <p className="text-sm text-[#6b6b67] mt-3 whitespace-pre-line">{task.context}</p>
              )}

              {/* Notes */}
              {task.notes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-[#6b6b67] uppercase tracking-wide mb-1.5">Notes</p>
                  <p className="text-sm text-[#1a1a18] whitespace-pre-wrap">{task.notes}</p>
                </div>
              )}

              {/* Source label */}
              {task.source_label && (
                <p className="text-xs text-[#9b9b97] mt-3">Source: {task.source_label}</p>
              )}

              {/* Action buttons */}
              <div className="mt-4 flex items-center gap-2">
                {isDone ? (
                  <button
                    onClick={() => toggle.mutate('open')}
                    disabled={toggle.isPending}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 font-medium transition-colors"
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      toggle.mutate('done', {
                        onSuccess: () => navigate(-1),
                      })
                    }}
                    disabled={toggle.isPending}
                    className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 font-medium transition-colors"
                  >
                    {toggle.isPending ? '…' : '✓ Mark Complete'}
                  </button>
                )}
              </div>
            </div>

            {/* Linked project */}
            {linkedProject && (
              <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
                <p className="text-xs text-[#6b6b67] uppercase tracking-wide mb-1.5">Project</p>
                <button
                  onClick={() => navigate(`/project/${linkedProject.id}`)}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {linkedProject.name} →
                </button>
                {linkedProject.client && (
                  <p className="text-xs text-[#6b6b67] mt-0.5">{linkedProject.client}</p>
                )}
              </div>
            )}

            {/* Source email */}
            {sourceEmail && (
              <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
                <p className="text-xs text-[#6b6b67] uppercase tracking-wide mb-1.5">Source Email</p>
                <p className="text-sm font-medium text-[#1a1a18]">
                  {sourceEmail.from_name || sourceEmail.from_address}
                </p>
                <p className="text-sm text-[#6b6b67] truncate">
                  {sourceEmail.thread_subject || sourceEmail.subject}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {dayjs(sourceEmail.received_at).format('MMM D, YYYY h:mm A')}
                </p>
              </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-gray-400 space-y-0.5">
              {task.created_at && <p>Created {dayjs(task.created_at).format('MMM D, YYYY h:mm A')}</p>}
              {task.updated_at && task.updated_at !== task.created_at && (
                <p>Updated {dayjs(task.updated_at).format('MMM D, YYYY h:mm A')}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
