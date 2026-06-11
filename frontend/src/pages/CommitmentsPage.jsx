import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getCommitments, updateCommitment, getContacts } from '../lib/api'

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

const TYPE_STYLES = {
  hard:        'border-red-300 bg-red-50',
  soft:        'border-yellow-300 bg-yellow-50',
  conditional: 'border-blue-300 bg-blue-50',
}

const TYPE_BADGE = {
  hard:        'text-red-600 bg-red-50',
  soft:        'text-yellow-700 bg-yellow-50',
  conditional: 'text-blue-600 bg-blue-50',
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

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function CommitmentsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [typeFilter, setTypeFilter] = useState('all')

  const { data: commitments, isLoading } = useQuery({
    queryKey: ['commitments'],
    queryFn: getCommitments,
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  })

  const markDone = useMutation({
    mutationFn: ({ id }) => updateCommitment(id, { status: 'closed' }),
    onMutate: async ({ id }) => {
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

  const typeOptions = [
    { value: 'all',         label: 'All' },
    { value: 'hard',        label: 'Hard' },
    { value: 'soft',        label: 'Soft' },
    { value: 'conditional', label: 'Conditional' },
  ]

  const today = dayjs()

  const open = (commitments || []).filter(c => c.status !== 'closed' && c.status !== 'done')

  const filtered = open.filter(c => {
    if (typeFilter !== 'all' && c.commitment_type !== typeFilter) return false
    return true
  })

  // Group by made_to person
  const groups = {}
  for (const c of filtered) {
    const name = c.made_to || 'Unassigned'
    if (!groups[name]) groups[name] = []
    groups[name].push(c)
  }

  const sortedGroupNames = Object.keys(groups).sort((a, b) => {
    if (a === 'Unassigned') return 1
    if (b === 'Unassigned') return -1
    return a.localeCompare(b)
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
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">My Commitments</h1>
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{filtered.length} items</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3">
          <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Type</p>
          <PillToggle options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No commitments match this filter</p>
        ) : (
          <div className="space-y-3">
            {sortedGroupNames.map(name => {
              const personItems = groups[name]
              const initials = getInitials(name)

              return (
                <div key={name} className="bg-white border border-[#e5e5e3] rounded-2xl overflow-hidden">
                  {/* Person header */}
                  <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50 border-b border-[#f0f0ee]">
                    <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {initials}
                    </div>
                    <span className="text-sm font-semibold text-[#1a1a18]">{name}</span>
                    <span className="text-xs text-[#6b6b67] ml-auto">{personItems.length}</span>
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-[#f0f0ee]">
                    {personItems.map(c => {
                      const overdue = c.due_date && dayjs(c.due_date).isBefore(today, 'day')
                      const daysLate = overdue ? today.diff(dayjs(c.due_date), 'day') : 0
                      const typeStyle = TYPE_STYLES[c.commitment_type] || 'border-gray-200 bg-white'
                      const typeBadge = TYPE_BADGE[c.commitment_type] || 'text-gray-500 bg-gray-100'

                      return (
                        <div
                          key={c.id}
                          className={`flex items-start gap-3 px-4 py-3 group border-l-2 ${typeStyle}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-[#1a1a18] leading-snug">{c.title}</p>
                              {c.commitment_type && (
                                <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${typeBadge}`}>
                                  {c.commitment_type}
                                </span>
                              )}
                              {overdue && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium flex-shrink-0">
                                  {daysLate}d overdue
                                </span>
                              )}
                            </div>
                            {c.context && (
                              <p className="text-xs text-[#9b9b97] mt-0.5 truncate">{c.context}</p>
                            )}
                            {c.due_date && (
                              <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
                                Due {dayjs(c.due_date).format('MMM D, YYYY')}
                              </p>
                            )}
                            {c.implicit && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium mt-0.5 inline-block">
                                implied
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => markDone.mutate({ id: c.id })}
                            className="flex-shrink-0 w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs opacity-100 md:opacity-0 md:group-hover:opacity-100 mt-0.5"
                            title="Mark done"
                          >
                            ✓
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
