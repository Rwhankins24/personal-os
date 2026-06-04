import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getEmails, updateEmail, getContacts } from '../lib/api'

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

const BUCKET_LABELS = {
  1: 'Critical',
  2: 'Action',
  3: 'Monitor',
  4: 'Low',
  5: 'Done',
}

const BUCKET_COLORS = {
  1: 'text-red-600 bg-red-50',
  2: 'text-orange-600 bg-orange-50',
  3: 'text-blue-600 bg-blue-50',
  4: 'text-gray-500 bg-gray-100',
  5: 'text-green-700 bg-green-50',
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
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [bucketFilter, setBucketFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  const { data: emails, isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: getEmails,
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
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

  const bucketOptions = [
    { value: 'all', label: 'All' },
    { value: '1',   label: 'Critical (1)' },
    { value: '2',   label: 'Action (2)' },
    { value: '3',   label: 'Monitor (3)' },
    { value: '4',   label: 'Low (4)' },
    { value: '5',   label: 'Done (5)' },
  ]

  const typeOptions = [
    { value: 'all',      label: 'All' },
    { value: 'internal', label: 'Internal' },
    { value: 'external', label: 'External' },
  ]

  const filtered = (emails || []).filter(e => {
    if (bucketFilter !== 'all' && String(e.bucket) !== bucketFilter) return false
    if (typeFilter !== 'all' && e.email_type !== typeFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const ba = a.bucket ?? 99
    const bb = b.bucket ?? 99
    if (ba !== bb) return ba - bb
    return (b.days_waiting ?? 0) - (a.days_waiting ?? 0)
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
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">Emails</h1>
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{sorted.length} items</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2">
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Bucket</p>
            <PillToggle options={bucketOptions} value={bucketFilter} onChange={setBucketFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Type</p>
            <PillToggle options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
          </div>
        </div>

        {/* Email list */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No emails match this filter</p>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl divide-y divide-[#f0f0ee]">
            {sorted.map(email => {
              const expanded = expandedId === email.id
              const waitingLong = (email.days_waiting ?? 0) > 3
              const bucketNum = email.bucket
              const bucketLabel = BUCKET_LABELS[bucketNum]
              const bucketColor = BUCKET_COLORS[bucketNum] || 'text-gray-500 bg-gray-100'

              return (
                <div key={email.id}>
                  <div
                    className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(expanded ? null : email.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-[#1a1a18] truncate">
                          {email.from_name || email.from_address || 'Unknown'}
                        </p>
                        {email.days_waiting > 0 && (
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${
                            waitingLong ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-[#6b6b67]'
                          }`}>
                            {email.days_waiting}d
                          </span>
                        )}
                        {bucketLabel && (
                          <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${bucketColor}`}>
                            {bucketLabel}
                          </span>
                        )}
                        {email.urgency && (
                          <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${URGENCY_TEXT[email.urgency] || 'text-gray-500 bg-gray-100'}`}>
                            {email.urgency}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6b6b67] mt-0.5 truncate">
                        {email.thread_subject || email.subject || '(no subject)'}
                      </p>
                    </div>

                    {/* Done button */}
                    {email.status !== 'done' && bucketNum !== 5 && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          markDone.mutate({ id: email.id })
                        }}
                        className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all"
                      >
                        Done
                      </button>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {expanded && (
                    <div className="px-4 pb-3 bg-gray-50 border-t border-[#f0f0ee] space-y-1.5">
                      {email.latest_sender && email.latest_sender !== email.from_name && (
                        <p className="text-xs text-[#6b6b67] pt-2">
                          Latest sender: <span className="font-medium text-[#1a1a18]">{email.latest_sender}</span>
                        </p>
                      )}
                      {email.body_preview && (
                        <p className="text-sm text-[#1a1a18] line-clamp-4 pt-1">{email.body_preview}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {email.email_type && (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-[#6b6b67]">{email.email_type}</span>
                        )}
                        {email.received_at && (
                          <span className="text-xs text-[#9b9b97]">
                            {dayjs(email.received_at).format('MMM D, YYYY')}
                          </span>
                        )}
                      </div>
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
