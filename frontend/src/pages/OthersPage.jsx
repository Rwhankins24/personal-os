import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getOthersCommitments, updateOthersCommitment, getContacts } from '../lib/api'

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

export default function OthersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('person')

  const { data: items, isLoading } = useQuery({
    queryKey: ['others-commitments'],
    queryFn: () => getOthersCommitments('open'),
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  })

  const update = useMutation({
    mutationFn: ({ id, updates }) => updateOthersCommitment(id, updates),
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: ['others-commitments'] })
      const prev = qc.getQueryData(['others-commitments'])
      qc.setQueryData(['others-commitments'], old =>
        (old || []).map(c => c.id === id ? { ...c, ...updates } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['others-commitments'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['others-commitments'] }),
  })

  const typeOptions = [
    { value: 'all',           label: 'All' },
    { value: 'blocking_ryan', label: '🚧 Blocking' },
    { value: 'to_ryan',       label: '📬 Owed to Me' },
    { value: 'general',       label: '📋 General' },
  ]

  const sortOptions = [
    { value: 'person',   label: 'By Person' },
    { value: 'due_date', label: 'By Due Date' },
  ]

  const today = dayjs()

  const filtered = (items || []).filter(c => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'blocking_ryan') return c.delivery_type === 'blocking_ryan'
    if (typeFilter === 'to_ryan') return c.delivery_type === 'to_ryan'
    if (typeFilter === 'general') return !c.delivery_type || c.delivery_type === 'general'
    return true
  })

  const getDaysOverdue = (item) => {
    if (!item.due_date) return 0
    const diff = today.diff(dayjs(item.due_date), 'day')
    return diff > 0 ? diff : 0
  }

  // Group by person
  const groupByPerson = (list) => {
    const groups = {}
    for (const c of list) {
      const name = c.committed_by_name || c.made_by || 'Unknown'
      if (!groups[name]) groups[name] = []
      groups[name].push(c)
    }
    return groups
  }

  // Sort items within each group
  const sortItems = (list) => {
    if (sortBy === 'due_date') {
      return [...list].sort((a, b) => {
        if (a.due_date && b.due_date) return dayjs(a.due_date).diff(dayjs(b.due_date))
        if (a.due_date) return -1
        if (b.due_date) return 1
        return 0
      })
    }
    return list
  }

  const groups = groupByPerson(filtered)
  const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b))

  // If sorting by due date, flatten and re-group as single list
  const flatSorted = sortBy === 'due_date'
    ? [...filtered].sort((a, b) => {
        if (a.due_date && b.due_date) return dayjs(a.due_date).diff(dayjs(b.due_date))
        if (a.due_date) return -1
        if (b.due_date) return 1
        return 0
      })
    : null

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
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">Waiting on Others</h1>
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{filtered.length} items</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2">
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Type</p>
            <PillToggle options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Sort</p>
            <PillToggle options={sortOptions} value={sortBy} onChange={setSortBy} />
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nothing here</p>
        ) : sortBy === 'due_date' ? (
          /* Flat list sorted by due date */
          <div className="bg-white border border-[#e5e5e3] rounded-2xl divide-y divide-[#f0f0ee]">
            {flatSorted.map(c => {
              const daysOverdue = getDaysOverdue(c)
              const personName = c.committed_by_name || c.made_by || 'Unknown'
              return (
                <CommitmentRow
                  key={c.id}
                  c={c}
                  personName={personName}
                  daysOverdue={daysOverdue}
                  update={update}
                  showPerson
                />
              )
            })}
          </div>
        ) : (
          /* Grouped by person */
          <div className="space-y-3">
            {sortedGroupNames.map(name => {
              const personItems = sortItems(groups[name])
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

                  {/* Commitments under person */}
                  <div className="divide-y divide-[#f0f0ee]">
                    {personItems.map(c => {
                      const daysOverdue = getDaysOverdue(c)
                      return (
                        <CommitmentRow
                          key={c.id}
                          c={c}
                          personName={name}
                          daysOverdue={daysOverdue}
                          update={update}
                          showPerson={false}
                        />
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

function CommitmentRow({ c, personName, daysOverdue, update, showPerson }) {
  const typeIcon = c.delivery_type === 'blocking_ryan' ? '🚧'
    : c.delivery_type === 'to_ryan' ? '📬'
    : '📋'

  return (
    <div className="flex items-start gap-3 px-4 py-3 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm flex-shrink-0">{typeIcon}</span>
          <p className="text-sm font-medium text-[#1a1a18] leading-snug">{c.title}</p>
          {c.urgency && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${URGENCY_TEXT[c.urgency] || 'text-gray-500 bg-gray-100'}`}>
              {c.urgency}
            </span>
          )}
          {daysOverdue > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium flex-shrink-0">
              {daysOverdue}d overdue
            </span>
          )}
        </div>
        {showPerson && (
          <p className="text-xs text-[#6b6b67] mt-0.5">{personName}</p>
        )}
        {c.context && (
          <p className="text-xs text-[#9b9b97] mt-0.5 truncate">{c.context}</p>
        )}
        {c.due_date && (
          <p className={`text-xs mt-0.5 ${daysOverdue > 0 ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
            Due {dayjs(c.due_date).format('MMM D, YYYY')}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
        {/* Mark done */}
        <button
          onClick={() => update.mutate({ id: c.id, updates: { status: 'closed' } })}
          className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
          title="Mark done"
        >
          ✓
        </button>

        {/* Escalate to blocking */}
        {c.delivery_type !== 'blocking_ryan' && (
          <button
            onClick={() => update.mutate({ id: c.id, updates: { delivery_type: 'blocking_ryan' } })}
            className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all text-xs"
            title="Mark as blocking me"
          >
            🚧
          </button>
        )}

        {/* De-escalate from blocking */}
        {c.delivery_type === 'blocking_ryan' && (
          <button
            onClick={() => update.mutate({ id: c.id, updates: { delivery_type: 'to_ryan' } })}
            className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-gray-400 hover:bg-gray-100 transition-all text-xs"
            title="Remove blocking flag"
          >
            ↓
          </button>
        )}
      </div>
    </div>
  )
}
