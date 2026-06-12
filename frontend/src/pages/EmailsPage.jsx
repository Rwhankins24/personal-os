import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getEmails, updateEmail, getContacts, createOthersCommitment } from '../lib/api'

const URGENCY_TEXT = {
  critical: 'text-red-600 bg-red-50',
  high:     'text-orange-600 bg-orange-50',
  medium:   'text-yellow-700 bg-yellow-50',
  low:      'text-gray-500 bg-gray-100',
  normal:   'text-gray-500 bg-gray-100',
}

const BUCKET_LABELS = { 1: 'Critical', 2: 'Action', 3: 'Monitor', 4: 'Low', 5: 'Done' }
const BUCKET_COLORS = {
  1: 'text-red-600 bg-red-50',
  2: 'text-orange-600 bg-orange-50',
  3: 'text-blue-600 bg-blue-50',
  4: 'text-gray-500 bg-gray-100',
  5: 'text-green-700 bg-green-50',
}

function findContactByName(name, contacts) {
  if (!name || !contacts?.length) return null
  const lower = name.toLowerCase().trim()
  let match = contacts.find(c => c.name?.toLowerCase() === lower)
  if (!match) {
    match = contacts.find(c => {
      const cn = (c.name || '').toLowerCase()
      return cn.length > 1 && (lower.includes(cn) || cn.includes(lower))
    })
  }
  return match || null
}

function ContactLink({ name, contacts, className = '' }) {
  if (!name) return <span className={className}>Unknown sender</span>
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

export default function EmailsPage() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  // Primary: status tab (Needs Reply vs Waiting On)
  const [statusTab,    setStatusTab]    = useState('reply')
  // Secondary filters
  const [contextTab,   setContextTab]   = useState('all')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [expandedId,   setExpandedId]   = useState(null)
  // Bulk select
  const [selectMode,   setSelectMode]   = useState(false)
  const [selected,     setSelected]     = useState(new Set())
  // Assign modal
  const [showAssign,   setShowAssign]   = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [assigning,    setAssigning]    = useState(false)

  const { data: emails, isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: getEmails,
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  })

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

  const markDone = useMutation({
    mutationFn: ({ id }) => updateEmail(id, { bucket: 5, status: 'done' }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['emails'] })
      const prev = qc.getQueryData(['emails'])
      qc.setQueryData(['emails'], old =>
        (old || []).map(e => e.id === id ? { ...e, bucket: 5, status: 'done' } : e)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['emails'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  })

  const allEmails = emails || []

  // Context filter
  function matchesContext(e) {
    if (contextTab === 'all') return true
    if (contextTab === 'work') return e.context_type === 'work' || e.context_type === 'mixed' || !e.context_type
    if (contextTab === 'personal') return e.context_type === 'personal' || e.context_type === 'mixed'
    return true
  }

  // Bucket filter
  function matchesBucket(e) {
    if (bucketFilter === 'all') return true
    return String(e.bucket) === bucketFilter
  }

  // Dedup utility (same sender + normalized subject)
  function dedupEmails(list) {
    const seen = new Map()
    return list.filter(e => {
      const norm = (e.thread_subject || e.subject || '')
        .replace(/^(re|fwd?|fw|aw):\s*/gi, '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, '').trim()
        .split(/\s+/).slice(0, 6).join(' ')
      const key = `${(e.from_address || '').toLowerCase()}::${norm}`
      if (!key || key === '::') return true
      if (seen.has(key)) return false
      seen.set(key, true)
      return true
    })
  }

  // Status tab buckets
  const hasIdentity = e => (e.from_name || e.from_address) || (e.thread_subject || e.subject)
  const needsReplyAll  = dedupEmails(allEmails.filter(e => e.status === 'needs_reply' && hasIdentity(e)))
  const waitingOnAll   = dedupEmails(allEmails.filter(e => (e.status === 'waiting_on' || e.status === 'resolved') && hasIdentity(e)))
  const isReplyTab     = statusTab === 'reply'

  const baseSet = isReplyTab ? needsReplyAll : waitingOnAll
  const filtered = baseSet.filter(e => matchesContext(e) && matchesBucket(e))

  // Sort: bucket priority, then days_waiting desc
  const sorted = [...filtered].sort((a, b) => {
    const ba = a.bucket ?? 99, bb = b.bucket ?? 99
    if (ba !== bb) return ba - bb
    return (b.days_waiting ?? 0) - (a.days_waiting ?? 0)
  })

  const contextOptions = [
    { value: 'all',      label: 'All' },
    { value: 'work',     label: 'Work' },
    { value: 'personal', label: 'Personal' },
  ]

  const bucketOptions = [
    { value: 'all', label: 'All' },
    { value: '1',   label: 'Critical' },
    { value: '2',   label: 'Action' },
    { value: '3',   label: 'Monitor' },
    { value: '4',   label: 'Low' },
  ]

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => { navigate(-1) }}
            className="flex items-center gap-1 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">Email Queue</h1>
          {!isReplyTab && (
            <button
              onClick={() => {
                setSelectMode(s => !s)
                setSelected(new Set())
              }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex-shrink-0 ${
                selectMode
                  ? 'bg-[#1a1a18] text-white'
                  : 'bg-gray-100 text-[#6b6b67] hover:bg-gray-200'
              }`}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{sorted.length} shown</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-36 space-y-3">
        {/* Status tabs — primary toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setStatusTab('reply')}
            className={`text-sm px-4 py-2 rounded-xl font-medium transition-all ${
              isReplyTab
                ? 'bg-red-100 text-red-700 border border-red-200'
                : 'bg-white text-[#6b6b67] border border-[#e5e5e3] hover:border-gray-400'
            }`}
          >
            Needs Reply
            {needsReplyAll.length > 0 && (
              <span className="ml-1.5 text-xs bg-red-600 text-white rounded-full px-1.5 py-0.5">
                {needsReplyAll.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setStatusTab('waiting')}
            className={`text-sm px-4 py-2 rounded-xl font-medium transition-all ${
              !isReplyTab
                ? 'bg-gray-200 text-gray-700 border border-gray-300'
                : 'bg-white text-[#6b6b67] border border-[#e5e5e3] hover:border-gray-400'
            }`}
          >
            Waiting On
            {waitingOnAll.filter(e => e.status === 'waiting_on').length > 0 && (
              <span className="ml-1.5 text-xs bg-gray-600 text-white rounded-full px-1.5 py-0.5">
                {waitingOnAll.filter(e => e.status === 'waiting_on').length}
              </span>
            )}
          </button>
        </div>

        {/* Secondary filters */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2.5">
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Context</p>
            <PillToggle options={contextOptions} value={contextTab} onChange={setContextTab} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Priority</p>
            <PillToggle options={bucketOptions} value={bucketFilter} onChange={setBucketFilter} />
          </div>
        </div>

        {/* Email list */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {isReplyTab ? 'No emails need reply' : 'Nothing waiting on others'}
          </p>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl divide-y divide-[#f0f0ee]">
            {sorted.map(email => {
              const expanded   = expandedId === email.id
              const isResolved = email.status === 'resolved'
              const waitingLong = (email.days_waiting ?? 0) > 5
              const bucketNum  = email.bucket

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
                <div key={email.id} className={isResolved ? 'opacity-50' : ''}>
                  <div
                    className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors group"
                    onClick={() => {
                      if (selectMode) {
                        setSelected(prev => {
                          const next = new Set(prev)
                          next.has(email.id) ? next.delete(email.id) : next.add(email.id)
                          return next
                        })
                      } else {
                        setExpandedId(expanded ? null : email.id)
                      }
                    }}
                  >
                    {selectMode && (
                      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                        selected.has(email.id)
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300'
                      }`}>
                        {selected.has(email.id) && <span className="text-white text-[10px] font-bold">✓</span>}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: name + category + days + deadline */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <ContactLink
                          name={email.from_name || email.from_address}
                          contacts={contacts}
                          className={`text-sm font-semibold text-[#1a1a18] ${isResolved ? 'line-through' : ''}`}
                        />
                        {email.email_category && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${catStyle}`}>
                            {catLabel}
                          </span>
                        )}
                        {email.days_waiting > 0 && (
                          <span className={`text-xs font-medium flex-shrink-0 ${
                            waitingLong ? 'text-red-500' : 'text-orange-400'
                          }`}>
                            {email.days_waiting}d
                          </span>
                        )}
                        {email.extracted_deadline && (
                          <span className="text-[10px] text-red-500 font-medium flex-shrink-0">
                            due {email.extracted_deadline}
                          </span>
                        )}
                        {bucketNum && BUCKET_LABELS[bucketNum] && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${BUCKET_COLORS[bucketNum] || 'text-gray-500 bg-gray-100'}`}>
                            {BUCKET_LABELS[bucketNum]}
                          </span>
                        )}
                      </div>

                      {/* Row 2: action_needed — the primary context line */}
                      {(email.action_needed || email.ai_summary) && (
                        <p className="text-sm text-[#1a1a18] mt-1 line-clamp-2 leading-snug">
                          {email.action_needed || email.ai_summary}
                        </p>
                      )}

                      {/* Row 3: subject (secondary) */}
                      <p className={`text-[11px] text-[#9b9b97] mt-0.5 truncate ${isResolved ? 'line-through' : ''}`}>
                        {email.thread_subject || email.subject || '(no subject)'}
                      </p>
                    </div>

                    {/* Action buttons (hover) */}
                    <div className="flex-shrink-0 flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {isReplyTab && (
                        <button
                          onClick={e => { e.stopPropagation(); mark.mutate({ id: email.id, status: 'done' }) }}
                          className="text-xs text-[#6b6b67] hover:text-green-600 px-2 py-1 rounded hover:bg-green-50"
                          title="Mark replied"
                        >
                          ✓ Done
                        </button>
                      )}
                      {!isReplyTab && !isResolved && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); mark.mutate({ id: email.id, status: 'resolved' }) }}
                            className="text-xs text-[#6b6b67] hover:text-green-600 px-2 py-1 rounded hover:bg-green-50"
                          >
                            ✓ Got it
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); mark.mutate({ id: email.id, status: 'archived' }) }}
                            className="text-xs text-gray-300 hover:text-gray-500 px-1 py-1 rounded"
                          >
                            No longer waiting
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expanded && (
                    <div className="px-4 pb-4 bg-gray-50 border-t border-[#f0f0ee] space-y-2">
                      {/* Additional context */}
                      {email.latest_sender_name && email.latest_sender_name !== email.from_name && (
                        <p className="text-xs text-[#6b6b67] pt-2">
                          Latest reply from: <span className="font-medium text-[#1a1a18]">{email.latest_sender_name}</span>
                        </p>
                      )}
                      {email.thread_message_count > 1 && (
                        <p className="text-xs text-[#9b9b97]">{email.thread_message_count} messages in thread</p>
                      )}
                      {/* Thread summary — full arc */}
                      {email.thread_summary && (
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                          <p className="text-[10px] text-blue-600 font-medium mb-1 uppercase tracking-wide">Thread Summary</p>
                          <p className="text-xs text-[#1a1a18] leading-relaxed">{email.thread_summary}</p>
                        </div>
                      )}
                      {/* Body preview fallback */}
                      {!email.thread_summary && (email.body_preview || email.ai_summary) && (
                        <div className="bg-white rounded-lg p-3 border border-[#e5e5e3]">
                          <p className="text-xs text-[#1a1a18] leading-relaxed whitespace-pre-line">
                            {email.body_preview || email.ai_summary}
                          </p>
                        </div>
                      )}
                      {/* Tags + meta */}
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {email.email_type && (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-[#6b6b67]">{email.email_type}</span>
                        )}
                        {(email.tags || []).map(tag => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">{tag}</span>
                        ))}
                        {email.received_at && (
                          <span className="text-xs text-[#9b9b97]">
                            {dayjs(email.received_at).format('MMM D, YYYY')}
                          </span>
                        )}
                        {email.waiting_since && !isReplyTab && (
                          <span className="text-xs text-[#9b9b97]">
                            Waiting since {dayjs(email.waiting_since).format('MMM D')}
                          </span>
                        )}
                      </div>
                      {/* Thread participants */}
                      {(email.thread_participants || []).length > 0 && (
                        <p className="text-xs text-[#9b9b97]">
                          Participants: {email.thread_participants.join(', ')}
                        </p>
                      )}
                      {/* Quick actions */}
                      <div className="flex gap-2 pt-1">
                        {isReplyTab && (
                          <button
                            onClick={() => mark.mutate({ id: email.id, status: 'done' })}
                            className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                          >
                            ✓ Mark Replied
                          </button>
                        )}
                        <button
                          onClick={() => markDone.mutate({ id: email.id })}
                          className="text-xs bg-gray-100 text-[#6b6b67] px-3 py-1.5 rounded-lg hover:bg-gray-200"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Floating bulk action bar ── */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg">
          <div className="bg-[#1a1a18] rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl">
            <span className="text-white text-sm font-medium flex-1">
              {selected.size} selected
            </span>
            <button
              onClick={async () => {
                // Bulk mark done
                for (const id of selected) {
                  await updateEmail(id, { status: 'done' })
                }
                qc.invalidateQueries({ queryKey: ['emails'] })
                setSelected(new Set())
                setSelectMode(false)
              }}
              className="text-xs bg-white/10 text-white px-3 py-1.5 rounded-lg hover:bg-white/20"
            >
              ✓ Mark done
            </button>
            <button
              onClick={() => { setShowAssign(true); setContactSearch('') }}
              className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-600"
            >
              Assign to →
            </button>
          </div>
        </div>
      )}

      {/* ── Assign to contact modal ── */}
      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl max-h-[70vh] flex flex-col">
            <div className="px-4 pt-4 pb-2 border-b border-[#e5e5e3]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[#1a1a18]">
                  Assign {selected.size} email{selected.size !== 1 ? 's' : ''} to...
                </p>
                <button onClick={() => setShowAssign(false)} className="text-[#6b6b67] text-lg leading-none">×</button>
              </div>
              <input
                autoFocus
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                placeholder="Search by name or company..."
                className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {(contacts || [])
                .filter(c => {
                  if (!contactSearch) return true
                  const q = contactSearch.toLowerCase()
                  return (c.name || '').toLowerCase().includes(q) ||
                         (c.company || '').toLowerCase().includes(q) ||
                         (c.email || '').toLowerCase().includes(q)
                })
                .slice(0, 30)
                .map(contact => (
                  <button
                    key={contact.id}
                    disabled={assigning}
                    onClick={async () => {
                      setAssigning(true)
                      try {
                        const selectedEmails = sorted.filter(e => selected.has(e.id))
                        for (const email of selectedEmails) {
                          await createOthersCommitment({
                            committed_by_name:  contact.name,
                            committed_by_email: contact.email,
                            title:              email.action_needed || email.thread_subject || email.subject,
                            context:            `Assigned from Waiting On email: "${email.thread_subject}"${email.days_waiting > 0 ? ` (${email.days_waiting}d)` : ''}`,
                            due_date:           email.extracted_deadline || null,
                            urgency:            email.days_waiting >= 7 ? 'high' : email.days_waiting >= 3 ? 'medium' : 'normal',
                            source_type:        'manual',
                            source_id:          email.id,
                            source_label:       email.thread_subject,
                            status:             'open',
                            delivery_type:      'to_ryan',
                          })
                          await updateEmail(email.id, { has_linked_commitment: true })
                        }
                        qc.invalidateQueries({ queryKey: ['emails'] })
                        qc.invalidateQueries({ queryKey: ['others-commitments'] })
                        setShowAssign(false)
                        setSelectMode(false)
                        setSelected(new Set())
                      } finally {
                        setAssigning(false)
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {(contact.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] truncate">{contact.name}</p>
                      <p className="text-xs text-[#9b9b97] truncate">{contact.company || contact.email}</p>
                    </div>
                    {assigning && <span className="text-xs text-[#9b9b97]">...</span>}
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
