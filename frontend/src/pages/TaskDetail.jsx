import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getTasks, updateTask, getEmails, getProjects } from '../lib/api'

const URGENCY_LABELS = { critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium', low: '⚪ Low' }

export default function TaskDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({})

  const { data: tasks, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: getTasks })
  const { data: emails }           = useQuery({ queryKey: ['emails'], queryFn: getEmails })
  const { data: projects }         = useQuery({ queryKey: ['projects'], queryFn: getProjects })

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
      <p className="text-gray-500">Task not found</p>
      <button onClick={() => navigate('/')} className="text-blue-600 text-sm hover:underline">← Back</button>
    </div>
  )

  const sourceEmail  = task.source_email_id  ? emails?.find(e => e.id === task.source_email_id)  : null
  const linkedProject = task.project_id ? projects?.find(p => p.id === task.project_id) : null
  const isDone       = task.status === 'done'
  const overdue      = task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day') && !isDone

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18]"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggle.mutate(isDone ? 'open' : 'done')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                isDone
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {isDone ? 'Reopen' : '✓ Mark Done'}
            </button>
            <button
              onClick={() => {
                setForm({
                  title:    task.title,
                  context:  task.context || '',
                  due_date: task.due_date || '',
                  urgency:  task.urgency || 'medium',
                  notes:    task.notes || '',
                })
                setEditing(v => !v)
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-100"
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {editing ? (
          <div className="bg-white border border-[#e5e5e3] rounded-xl p-4 space-y-3">
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full text-lg font-semibold border-0 border-b border-gray-200 pb-2 focus:outline-none focus:border-blue-400"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Due date</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Urgency</label>
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
              <label className="text-xs text-gray-500 block mb-1">Context</label>
              <input
                value={form.context}
                onChange={e => setForm(f => ({ ...f, context: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Why does this matter?"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Notes</label>
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
            {/* Title + status */}
            <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => toggle.mutate(isDone ? 'open' : 'done')}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0"
                />
                <div className="flex-1">
                  <h1 className={`text-lg font-semibold leading-snug ${isDone ? 'line-through text-gray-400' : 'text-[#1a1a18]'}`}>
                    {task.title}
                  </h1>
                  {task.context && (
                    <p className="text-sm text-[#6b6b67] mt-1">{task.context}</p>
                  )}
                </div>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {task.urgency && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {URGENCY_LABELS[task.urgency] || task.urgency}
                  </span>
                )}
                {task.due_date && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${overdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                    Due {dayjs(task.due_date).format('MMM D, YYYY')}
                    {overdue && ' — overdue'}
                  </span>
                )}
                {task.ai_extracted && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI extracted</span>
                )}
                {task.blocking && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">blocking</span>
                )}
                {task.status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isDone ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {task.status}
                  </span>
                )}
              </div>

              {task.notes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Notes</p>
                  <p className="text-sm text-[#1a1a18] whitespace-pre-wrap">{task.notes}</p>
                </div>
              )}
            </div>

            {/* Linked project */}
            {linkedProject && (
              <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Project</p>
                <button
                  onClick={() => navigate(`/project/${linkedProject.id}`)}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {linkedProject.name} →
                </button>
                {linkedProject.client && (
                  <p className="text-xs text-gray-500 mt-0.5">{linkedProject.client}</p>
                )}
              </div>
            )}

            {/* Source email */}
            {sourceEmail && (
              <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Source Email</p>
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
