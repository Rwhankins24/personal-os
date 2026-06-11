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

// ── Bulk action bar ────────────────────────────────────────────
function BulkActionBar({ selectedIds, contacts, onReassign, onCancel }) {
  const [open, setOpen] = useState(false)

  if (selectedIds.size === 0) return null

  return (
    <div className="fixed bottom-14 left-0 right-0 z-20 px-4 pb-2">
      <div className="max-w-2xl mx-auto bg-[#1a1a18] text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg">
        <span className="text-sm font-medium flex-1">{selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected</span>
        <div className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            className="text-sm bg-white text-[#1a1a18] px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100 transition-colors"
          >
            Reassign {selectedIds.size} →
          </button>
          {open && (
            <div className="absolute bottom-full mb-2 right-0 w-64 bg-white rounded-xl shadow-xl border border-[#e5e5e3] p-2 z-30">
              <ReassignDropdown
                contacts={contacts}
                onSelect={(person) => { onReassign(person); setOpen(false) }}
                onClose={() => setOpen(false)}
              />
            </div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function OthersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('person')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

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

  const toggleSelectMode = () => {
    setSelectMode(v => !v)
    setSelectedIds(new Set())
  }

  const toggleItemSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkReassign = ({ name, email }) => {
    selectedIds.forEach(id => {
      update.mutate({
        id,
        updates: {
          committed_by_name: name,
          ...(email ? { committed_by_email: email } : {}),
        }
      })
    })
    setSelectedIds(new Set())
    setSelectMode(false)
  }

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
          <button
            onClick={toggleSelectMode}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-all flex-shrink-0 ${
              selectMode
                ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
                : 'bg-white text-[#6b6b67] border-[#e5e5e3] hover:border-gray-400'
            }`}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
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
                  selectMode={selectMode}
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={() => toggleItemSelect(c.id)}
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
                          selectMode={selectMode}
                          selected={selectedIds.has(c.id)}
                          onToggleSelect={() => toggleItemSelect(c.id)}
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

      {/* Potential duplicates review section */}
      {!isLoading && (
        <div className="max-w-2xl mx-auto px-4 pb-4">
          <OthersDuplicatesSection
            allItems={items || []}
            update={update}
          />
        </div>
      )}

      <BulkActionBar
        selectedIds={selectedIds}
        contacts={contacts}
        onReassign={handleBulkReassign}
        onCancel={() => { setSelectMode(false); setSelectedIds(new Set()) }}
      />
    </div>
  )
}

function isInternal(email) {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return domain === 'claycorp.com' || domain === 'ljc.com'
}

// ── Potential Duplicates Section (Others) ─────────────────────────
function OthersDuplicatesSection({ allItems, update }) {
  const [open, setOpen] = useState(false)
  const [collapsedPersons, setCollapsedPersons] = useState({})

  // Items flagged as potential duplicates
  const flagged = (allItems || []).filter(c => c.potential_duplicate_of && c.status !== 'archived')

  // Build pairs: flagged item + canonical
  const pairs = flagged.map(loser => {
    const winner = (allItems || []).find(c => c.id === loser.potential_duplicate_of)
    return { loser, winner }
  }).filter(p => p.winner)

  if (pairs.length === 0) return null

  // Group by person
  const byPerson = {}
  for (const pair of pairs) {
    const name = pair.loser.committed_by_name || pair.winner?.committed_by_name || 'Unknown'
    if (!byPerson[name]) byPerson[name] = []
    byPerson[name].push(pair)
  }

  const handleMerge = (loser, winner) => {
    // Enrich winner with any data loser has that winner is missing
    const enrichment = {}
    if (!winner.due_date   && loser.due_date)   enrichment.due_date   = loser.due_date
    if (!winner.project_id && loser.project_id) enrichment.project_id = loser.project_id
    if (!winner.context    && loser.context)    enrichment.context    = loser.context
    if (!winner.urgency    && loser.urgency)    enrichment.urgency    = loser.urgency
    if (Object.keys(enrichment).length > 0) {
      update.mutate({ id: winner.id, updates: enrichment })
    }
    // Archive loser, mark reviewed — nightly job won't re-flag
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
    // Mark both as reviewed — nightly job checks before re-flagging
    update.mutate({
      id: winner.id,
      updates: {
        known_not_duplicate_with: [...(winner.known_not_duplicate_with || []), loser.id],
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

  const handleResolveAllForPerson = (personPairs) => {
    for (const { loser, winner } of personPairs) handleMerge(loser, winner)
  }

  const handleResolveAll = () => {
    for (const { loser, winner } of pairs) handleMerge(loser, winner)
  }

  const togglePersonCollapse = (name) => {
    setCollapsedPersons(prev => ({ ...prev, [name]: !prev[name] }))
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
          {/* Global resolve all */}
          <div className="flex justify-end">
            <button
              onClick={handleResolveAll}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors"
            >
              Resolve all (merge all)
            </button>
          </div>

          {/* Per-person groups */}
          {Object.entries(byPerson).map(([personName, personPairs]) => {
            const initials = getInitials(personName)
            const personCollapsed = collapsedPersons[personName]

            return (
              <div key={personName} className="border border-amber-100 rounded-xl overflow-hidden">
                {/* Person header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/60 border-b border-amber-100">
                  <div className="w-6 h-6 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {initials}
                  </div>
                  <span className="text-sm font-semibold text-[#1a1a18] flex-1">{personName}</span>
                  <button
                    onClick={() => handleResolveAllForPerson(personPairs)}
                    className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white font-medium hover:bg-green-700 transition-colors mr-1"
                  >
                    Resolve all for {personName.split(' ')[0]}
                  </button>
                  <button
                    onClick={() => togglePersonCollapse(personName)}
                    className="text-xs text-amber-600"
                  >
                    {personCollapsed ? '▼' : '▲'}
                  </button>
                </div>

                {!personCollapsed && (
                  <div className="divide-y divide-amber-50">
                    {personPairs.map(({ loser, winner }) => (
                      <div key={loser.id} className="p-3 space-y-2">
                        {/* Pair side by side */}
                        <div className="flex gap-2 items-start">
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
                            onClick={() => handleMerge(loser)}
                            className="text-xs px-3 py-1 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors flex-1"
                          >
                            Merge (keep "{winner.title.slice(0, 28)}{winner.title.length > 28 ? '…' : ''}")
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
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CommitmentRow({ c, personName, daysOverdue, update, showPerson, isKey, contacts, selectMode, selected, onToggleSelect }) {
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
    <div
      className={`px-4 py-3 group ${speaker ? 'bg-amber-50/40' : ''} ${selectMode ? 'cursor-pointer' : ''} ${selected ? 'bg-blue-50' : ''}`}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={e => e.stopPropagation()}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0"
          />
        )}
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

        {/* Action buttons — hidden in select mode */}
        <div className={`flex items-center gap-1 flex-shrink-0 mt-0.5 ${selectMode ? 'hidden' : ''}`}>
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
