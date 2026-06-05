import { useState, useEffect, useRef } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import {
  createTask,
  createCommitment,
  createOthersCommitment,
  createPendingDecision,
  getContacts,
} from '../lib/api'
import { useQuery } from '@tanstack/react-query'

const TYPES = [
  { value: 'task',       label: 'Task',             icon: '✅', desc: 'Something I need to do' },
  { value: 'commitment', label: 'My Commitment',     icon: '🤝', desc: 'Something I promised to someone' },
  { value: 'waiting',    label: 'Waiting On',        icon: '👤', desc: 'Something someone owes me' },
  { value: 'decision',   label: 'Pending Decision',  icon: '🔷', desc: 'Something that needs to be decided' },
]

const URGENCY_OPTIONS = [
  { value: 'critical', label: '🔴 Critical' },
  { value: 'high',     label: '🟠 High' },
  { value: 'medium',   label: '🟡 Medium' },
  { value: 'low',      label: '⚪ Low' },
]

const DELIVERY_OPTIONS = [
  { value: 'blocking_ryan', label: '🚧 Blocking me' },
  { value: 'to_ryan',       label: '📬 Owed to me' },
  { value: 'general',       label: '📋 General' },
]

function ContactSearch({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen]   = useState(false)
  const ref               = useRef(null)

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    staleTime: 5 * 60 * 1000,
  })

  const filtered = query.length > 1
    ? contacts.filter(c =>
        c.name?.toLowerCase().includes(query.toLowerCase()) ||
        c.company?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : []

  useEffect(() => {
    function click(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e5e5e3] rounded-xl shadow-lg z-50 overflow-hidden">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setQuery(c.name); onChange(c.name); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 border-b border-[#f0f0ee] last:border-0"
            >
              <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {(c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-[#1a1a18] leading-tight">{c.name}</p>
                {c.company && <p className="text-[11px] text-[#9b9b97]">{c.company}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CaptureModal({ onClose }) {
  const qc = useQueryClient()
  const [type,    setType]    = useState('task')
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const firstRef = useRef(null)

  // Shared state
  const [title,    setTitle]   = useState('')
  const [dueDate,  setDueDate] = useState('')
  const [context,  setContext] = useState('')

  // Task-specific
  const [urgency,  setUrgency] = useState('medium')

  // My Commitment
  const [madeTo,   setMadeTo]  = useState('')
  const [commitType, setCommitType] = useState('hard')

  // Waiting On
  const [fromName,     setFromName]     = useState('')
  const [deliveryType, setDeliveryType] = useState('general')
  const [ocUrgency,    setOcUrgency]    = useState('medium')

  // Reset fields when type changes
  useEffect(() => {
    setTitle(''); setDueDate(''); setContext('')
    setUrgency('medium'); setMadeTo(''); setCommitType('hard')
    setFromName(''); setDeliveryType('general'); setOcUrgency('medium')
    setError('')
    setTimeout(() => firstRef.current?.focus(), 50)
  }, [type])

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required')

      if (type === 'task') {
        return createTask({
          title: title.trim(),
          urgency,
          due_date: dueDate || null,
          context: context.trim() || null,
          status: 'open',
          source: 'manual',
          source_type: 'manual',
          bucket: urgency === 'critical' ? 1 : urgency === 'high' ? 2 : 3,
        })
      }

      if (type === 'commitment') {
        if (!madeTo.trim()) throw new Error('Who did you commit to?')
        return createCommitment({
          title: title.trim(),
          made_to: madeTo.trim(),
          due_date: dueDate || null,
          commitment_type: commitType,
          context: context.trim() || null,
          status: 'open',
          source: 'manual',
          source_type: 'manual',
        })
      }

      if (type === 'waiting') {
        if (!fromName.trim()) throw new Error('Who are you waiting on?')
        return createOthersCommitment({
          title: title.trim(),
          committed_by_name: fromName.trim(),
          due_date: dueDate || null,
          delivery_type: deliveryType,
          urgency: ocUrgency,
          context: context.trim() || null,
          status: 'open',
          source: 'manual',
          source_type: 'manual',
        })
      }

      if (type === 'decision') {
        return createPendingDecision({
          title: title.trim(),
          description: context.trim() || null,
          due_date: dueDate || null,
          status: 'open',
          source: 'manual',
          source_type: 'manual',
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['commitments'] })
      qc.invalidateQueries({ queryKey: ['others-commitments'] })
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        setTitle(''); setDueDate(''); setContext(''); setMadeTo(''); setFromName('')
        firstRef.current?.focus()
      }, 1200)
    },
    onError: (err) => setError(err.message),
  })

  const currentType = TYPES.find(t => t.value === type)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Type selector tabs */}
        <div className="grid grid-cols-4 border-b border-[#e5e5e3]">
          {TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-all ${
                type === t.value
                  ? 'bg-[#1a1a18] text-white'
                  : 'text-[#6b6b67] hover:bg-gray-50'
              }`}
            >
              <span className="text-base">{t.icon}</span>
              <span className="text-[10px] leading-tight">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="px-4 pt-4 pb-5 space-y-3">
          <p className="text-xs text-[#9b9b97]">{currentType?.desc}</p>

          {/* Title — always first */}
          <div>
            <input
              ref={firstRef}
              value={title}
              onChange={e => { setTitle(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) mutation.mutate() }}
              placeholder={
                type === 'task'       ? 'What needs to be done?' :
                type === 'commitment' ? 'What did you commit to?' :
                type === 'waiting'    ? "What are you waiting on?" :
                'What needs to be decided?'
              }
              className="w-full text-sm font-medium border border-[#e5e5e3] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1a1a18] placeholder-[#c0c0bc]"
            />
          </div>

          {/* Task fields */}
          {type === 'task' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Urgency</label>
                <select value={urgency} onChange={e => setUrgency(e.target.value)}
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white">
                  {URGENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Due date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white" />
              </div>
            </div>
          )}

          {/* My Commitment fields */}
          {type === 'commitment' && (
            <>
              <div>
                <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Who did you commit to?</label>
                <ContactSearch value={madeTo} onChange={setMadeTo} placeholder="Name or company..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Type</label>
                  <select value={commitType} onChange={e => setCommitType(e.target.value)}
                    className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white">
                    <option value="hard">Hard deadline</option>
                    <option value="soft">Soft deadline</option>
                    <option value="conditional">Conditional</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Due date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white" />
                </div>
              </div>
            </>
          )}

          {/* Waiting On fields */}
          {type === 'waiting' && (
            <>
              <div>
                <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Who are you waiting on?</label>
                <ContactSearch value={fromName} onChange={setFromName} placeholder="Name or company..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Type</label>
                  <select value={deliveryType} onChange={e => setDeliveryType(e.target.value)}
                    className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white">
                    {DELIVERY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Due date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Urgency</label>
                <select value={ocUrgency} onChange={e => setOcUrgency(e.target.value)}
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white">
                  {URGENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Pending Decision fields */}
          {type === 'decision' && (
            <div>
              <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">Deadline</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white" />
            </div>
          )}

          {/* Context — always available */}
          <div>
            <label className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide block mb-1">
              Context <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Background, details, or notes…"
              rows={2}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] resize-none placeholder-[#c0c0bc]"
            />
          </div>

          {/* Error */}
          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || saved}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                saved
                  ? 'bg-green-500 text-white'
                  : 'bg-[#1a1a18] text-white hover:opacity-90 disabled:opacity-40'
              }`}
            >
              {saved ? '✓ Saved' : mutation.isPending ? 'Saving…' : `Add ${currentType?.label}`}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm text-[#6b6b67] border border-[#e5e5e3] hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
