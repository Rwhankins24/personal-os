import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getOthersCommitments, updateOthersCommitment, getContacts } from '../lib/api'

function isSpeaker(name) {
  if (!name) return true
  return /^speaker\s*\d+$/i.test(name.trim()) || name.trim().toLowerCase() === 'unknown'
}

// ── Inline reassign typeahead ──────────────────────────────────
function ReassignDropdown({ contacts, onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = (contacts || [])
    .filter(c => c.name && c.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 7)

  const exactMatch = (contacts || []).find(
    c => c.name?.toLowerCase() === query.toLowerCase()
  )

  const handleKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && query.trim()) {
      if (exactMatch) {
        onSelect({ name: exactMatch.name, email: exactMatch.email || null })
      } else {
        onSelect({ name: query.trim(), email: null })
      }
    }
  }

  return (
    <div className="mt-2 relative" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type a name…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1a1a18] bg-white"
      />
      {query.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e5e5e3] rounded-xl shadow-lg z-30 overflow-hidden">
          {filtered.length > 0 ? (
            filtered.map(c => (
              <button
                key={c.id}
                onClick={() => onSelect({ name: c.name, email: c.email || null })}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[#f8f8f6] flex items-center gap-2 border-b border-[#f0f0ee] last:border-0"
              >
                <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                <span className="font-medium text-[#1a1a18]">{c.name}</span>
                {c.company && <span className="text-[#9b9b97] truncate">{c.company}</span>}
              </button>
            ))
          ) : null}
          {!exactMatch && query.trim().length > 1 && (
            <button
              onClick={() => onSelect({ name: query.trim(), email: null })}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-blue-600 flex items-center gap-2"
            >
              <span className="text-base">+</span>
              Add "{query.trim()}" as new person
            </button>
          )}
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

  const today = dayjs()

  // Build key contact lookup by email + name — must come before keyCount
  const keyEmailSet = new Set(
    (contacts || []).filter(c => c.is_key_contact).map(c => (c.email || '').toLowerCase()).filter(Boolean)
  )
  const keyNameSet = new Set(
    (contacts || []).filter(c => c.is_key_contact).map(c => (c.name || '').toLowerCase()).filter(Boolean)
  )
  const isKeyPerson = (item) => {
    const email = (item.committed_by_email || '').toLowerCase()
    const name  = (item.committed_by_name  || item.made_by || '').toLowerCase()
    if (email && keyEmailSet.has(email)) return true
    if (name  && keyNameSet.has(name))   return true
    return false
  }
  const isKeyName = (name) => {
    return keyNameSet.has((name || '').toLowerCase())
  }

  const keyCount = (items || []).filter(isKeyPerson).length

  const typeOptions = [
    { value: 'all',           label: 'All' },
    { value: 'key',           label: `⭐ Key${keyCount ? ` (${keyCount})` : ''}` },
    { value: 'blocking_ryan', label: '🚧 Blocking' },
    { value: 'to_ryan',       label: '📬 Owed to Me' },
    { value: 'general',       label: '📋 General' },
  ]

  const sortOptions = [
    { value: 'person',   label: 'By Person' },
    { value: 'due_date', label: 'By Due Date' },
  ]

  const filtered = (items || []).filter(c => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'blocking_ryan') return c.delivery_type === 'blocking_ryan'
    if (typeFilter === 'to_ryan') return c.delivery_type === 'to_ryan'
    if (typeFilter === 'general') return !c.delivery_type || c.delivery_type === 'general'
    if (typeFilter === 'key') return isKeyPerson(c)
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
  // Key contacts float to top, then alpha
  const sortedGroupNames = Object.keys(groups).sort((a, b) => {
    const aKey = isKeyName(a) ? 0 : 1
    const bKey = isKeyName(b) ? 0 : 1
    if (aKey !== bKey) return aKey - bKey
    return a.localeCompare(b)
  })

  // If sorting by due date, key contacts sort first within same date, then by date
  const flatSorted = sortBy === 'due_date'
    ? [...filtered].sort((a, b) => {
        const aKey = isKeyPerson(a) ? 0 : 1
        const bKey = isKeyPerson(b) ? 0 : 1
        if (aKey !== bKey) return aKey - bKey
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
                  isKey={isKeyPerson(c)}
                  contacts={contacts}
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
              const keyContact = isKeyName(name)
              // Detect internal from any item's email in the group
              const groupInternal = personItems.some(i => isInternal(i.committed_by_email))
              return (
                <div key={name} className={`bg-white rounded-2xl overflow-hidden ${keyContact ? 'border border-amber-300' : 'border border-[#e5e5e3]'}`}>
                  {/* Person header */}
                  <div className={`flex items-center gap-2.5 px-4 py-3 border-b ${keyContact ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-[#f0f0ee]'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${keyContact ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'}`}>
                      {initials}
                    </div>
                    <span className="text-sm font-semibold text-[#1a1a18]">{name}</span>
                    {keyContact && <span className="text-xs text-amber-500" title="Key contact">⭐</span>}
                    {groupInternal && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium">
                        Internal
                      </span>
                    )}
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
                          isKey={keyContact}
                          contacts={contacts}
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

function isInternal(email) {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return domain === 'claycorp.com' || domain === 'ljc.com'
}

function CommitmentRow({ c, personName, daysOverdue, update, showPerson, isKey, contacts }) {
  const [reassigning, setReassigning] = useState(false)
  const speaker = isSpeaker(personName)
  const internal = isInternal(c.committed_by_email)

  const typeIcon = c.delivery_type === 'blocking_ryan' ? '🚧'
    : c.delivery_type === 'to_ryan' ? '📬'
    : '📋'

  const handleReassign = ({ name, email }) => {
    update.mutate({
      id: c.id,
      updates: {
        committed_by_name: name,
        ...(email ? { committed_by_email: email } : {})
      }
    })
    setReassigning(false)
  }

  return (
    <div className={`px-4 py-3 group ${speaker ? 'bg-amber-50/40' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm flex-shrink-0">{typeIcon}</span>
            <p className="text-sm font-medium text-[#1a1a18] leading-snug">{c.title}</p>
            {isKey && <span className="text-xs text-amber-500 flex-shrink-0" title="Key contact">⭐</span>}
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

          {/* Person name — amber + reassign hint if Speaker */}
          {showPerson && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className={`text-xs ${speaker ? 'text-amber-600 font-medium' : 'text-[#6b6b67]'}`}>
                {speaker ? `⚠ ${personName} — unattributed` : personName}
              </p>
              {internal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium flex-shrink-0">
                  Internal
                </span>
              )}
              {speaker && !reassigning && (
                <button
                  onClick={() => setReassigning(true)}
                  className="text-[10px] text-amber-600 underline hover:text-amber-800"
                >
                  assign
                </button>
              )}
            </div>
          )}

          {c.context && (
            <p className="text-xs text-[#9b9b97] mt-0.5 truncate">{c.context}</p>
          )}
          {c.due_date && (
            <p className={`text-xs mt-0.5 ${daysOverdue > 0 ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
              Due {dayjs(c.due_date).format('MMM D, YYYY')}
            </p>
          )}

          {/* Inline reassign dropdown */}
          {reassigning && (
            <ReassignDropdown
              contacts={contacts}
              onSelect={handleReassign}
              onClose={() => setReassigning(false)}
            />
          )}
        </div>

        {/* Action buttons — always visible */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {/* Reassign */}
          {!speaker && (
            <button
              onClick={e => { e.stopPropagation(); setReassigning(r => !r) }}
              className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs transition-all ${
                reassigning ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-[#e5e5e3] text-[#6b6b67] hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50'
              }`}
              title="Reassign"
            >
              👤
            </button>
          )}

          {/* Mark done */}
          <button
            onClick={e => { e.stopPropagation(); update.mutate({ id: c.id, updates: { status: 'closed' } }) }}
            className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
            title="Mark done"
          >
            ✓
          </button>

          {/* Escalate to blocking */}
          {c.delivery_type !== 'blocking_ryan' && (
            <button
              onClick={e => { e.stopPropagation(); update.mutate({ id: c.id, updates: { delivery_type: 'blocking_ryan' } }) }}
              className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center hover:border-orange-400 hover:bg-orange-50 transition-all text-xs"
              title="Mark as blocking me"
            >
              🚧
            </button>
          )}

          {/* De-escalate from blocking */}
          {c.delivery_type === 'blocking_ryan' && (
            <button
              onClick={e => { e.stopPropagation(); update.mutate({ id: c.id, updates: { delivery_type: 'to_ryan' } }) }}
              className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-gray-400 hover:bg-gray-100 transition-all text-xs"
              title="Remove blocking flag"
            >
              ↓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
