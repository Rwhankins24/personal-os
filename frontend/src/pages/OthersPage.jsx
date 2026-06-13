import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getOthersCommitments, updateOthersCommitment, getContacts, createContact, createTask, getProjects } from '../lib/api'
import { useToast } from '../contexts/ToastContext'

function isSpeaker(name) {
  if (!name) return true
  const n = name.trim()
  return /^speaker\s*\d+\s*[-–]?\s*$/i.test(n) || n.toLowerCase() === 'unknown'
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
function BulkActionBar({ selectedIds, contacts, onReassign, onPromoteToMyTasks, onCancel, promoting }) {
  const [open, setOpen] = useState(false)

  if (selectedIds.size === 0) return null

  return (
    <div className="fixed left-0 right-0 z-[55] px-4 pb-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)' }}>
      <div className="max-w-2xl mx-auto bg-[#1a1a18] text-white rounded-2xl px-4 py-3 flex items-center gap-2 shadow-lg flex-wrap">
        <span className="text-sm font-medium flex-shrink-0">{selectedIds.size} selected</span>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Promote to my tasks */}
          <button
            onClick={onPromoteToMyTasks}
            disabled={promoting}
            className="text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {promoting ? 'Adding…' : `→ My tasks (${selectedIds.size})`}
          </button>
          {/* Reassign */}
          <div className="relative">
            <button
              onClick={() => setOpen(v => !v)}
              className="text-sm bg-white text-[#1a1a18] px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Reassign →
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
            className="text-sm text-gray-400 hover:text-white transition-colors px-1"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OthersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [typeFilter,    setTypeFilter]    = useState('all')
  const [contactFilter, setContactFilter] = useState('all')
  const [sortBy,        setSortBy]        = useState('person')
  const [selectMode,    setSelectMode]    = useState(false)
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [promoting,     setPromoting]     = useState(false)
  const [promotedIds,   setPromotedIds]   = useState(new Set())
  const [linkModalItem, setLinkModalItem] = useState(null)
  const [keepSeparate,  setKeepSeparate]  = useState(new Set()) // loser IDs opted out of merge

  const toast = useToast()

  const { data: items, isLoading } = useQuery({
    queryKey: ['others-commitments'],
    queryFn: () => getOthersCommitments('open'),
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  })

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
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

  // ── Duplicate merge helpers ────────────────────────────────
  // Map: winnerId → [loser items]
  const duplicatesByWinner = useMemo(() => {
    const map = {}
    for (const c of items || []) {
      if (c.potential_duplicate_of && c.status !== 'archived') {
        if (!map[c.potential_duplicate_of]) map[c.potential_duplicate_of] = []
        map[c.potential_duplicate_of].push(c)
      }
    }
    return map
  }, [items])

  // All losers not opted out — these will be merged on "Merge all"
  const pendingMerges = useMemo(() => {
    return Object.values(duplicatesByWinner).flat().filter(l => !keepSeparate.has(l.id))
  }, [duplicatesByWinner, keepSeparate])

  const doMerge = (loser, winner) => {
    const enrichment = {}
    if (!winner.due_date   && loser.due_date)   enrichment.due_date   = loser.due_date
    if (!winner.project_id && loser.project_id) enrichment.project_id = loser.project_id
    if (!winner.context    && loser.context)    enrichment.context    = loser.context
    if (!winner.urgency    && loser.urgency)    enrichment.urgency    = loser.urgency
    if (Object.keys(enrichment).length > 0) update.mutate({ id: winner.id, updates: enrichment })
    update.mutate({
      id: loser.id,
      updates: { status: 'archived', potential_duplicate_of: null, duplicate_confidence: null, duplicate_reviewed: true, duplicate_decision: 'merged' }
    })
  }

  const doKeepSeparate = (loser, winner) => {
    update.mutate({ id: winner.id, updates: { known_not_duplicate_with: [...(winner.known_not_duplicate_with || []), loser.id], duplicate_reviewed: true } })
    update.mutate({ id: loser.id, updates: { potential_duplicate_of: null, duplicate_confidence: null, duplicate_reviewed: true, duplicate_decision: 'separate', known_not_duplicate_with: [...(loser.known_not_duplicate_with || []), winner.id] } })
  }

  const handleMergeAll = () => {
    const allItems = items || []
    for (const loser of pendingMerges) {
      const winner = allItems.find(c => c.id === loser.potential_duplicate_of)
      if (winner) doMerge(loser, winner)
    }
    // Also resolve the kept-separate ones
    for (const loserId of keepSeparate) {
      const loser  = allItems.find(c => c.id === loserId)
      const winner = loser ? allItems.find(c => c.id === loser.potential_duplicate_of) : null
      if (loser && winner) doKeepSeparate(loser, winner)
    }
    setKeepSeparate(new Set())
    toast(`Merged ${pendingMerges.length} duplicate${pendingMerges.length !== 1 ? 's' : ''}`, { icon: '✓' })
  }

  const toggleKeepSeparate = (loserId) => {
    setKeepSeparate(prev => {
      const next = new Set(prev)
      next.has(loserId) ? next.delete(loserId) : next.add(loserId)
      return next
    })
  }

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
    toast(`Reassigned ${selectedIds.size} item${selectedIds.size !== 1 ? 's' : ''} to ${name}`, { icon: '👤' })
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  const handleBulkPromoteToMyTasks = async () => {
    if (promoting) return
    setPromoting(true)
    const allItems = items || []
    const toPromote = allItems.filter(c => selectedIds.has(c.id) && !promotedIds.has(c.id))
    for (const c of toPromote) {
      try {
        await createTask({
          title:        c.title,
          context:      `Promoted from Others: originally assigned to ${c.committed_by_name || c.person_name || 'unknown'}`,
          urgency:      c.urgency || 'medium',
          due_date:     c.due_date || null,
          status:       'open',
          source:       'manual',
          source_label: c.source_label || 'Others',
          project_id:   c.project_id || null,
        })
        setPromotedIds(prev => new Set([...prev, c.id]))
      } catch (_) { /* keep going */ }
    }
    const addedCount = toPromote.length
    setPromoting(false)
    setSelectedIds(new Set())
    setSelectMode(false)
    if (addedCount > 0) toast(`${addedCount} item${addedCount !== 1 ? 's' : ''} added to My Tasks`, { icon: '→' })
  }

  const handleSinglePromoteToMyTask = async (c) => {
    if (promotedIds.has(c.id)) return
    try {
      await createTask({
        title:        c.title,
        context:      `Promoted from Others: originally assigned to ${c.committed_by_name || c.person_name || 'unknown'}`,
        urgency:      c.urgency || 'medium',
        due_date:     c.due_date || null,
        status:       'open',
        source:       'manual',
        source_label: c.source_label || 'Others',
        project_id:   c.project_id || null,
      })
      setPromotedIds(prev => new Set([...prev, c.id]))
      toast('Added to My Tasks', { icon: '→' })
    } catch (_) {}
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
    const name  = (item.committed_by_name  || item.person_name || item.made_by || '').toLowerCase()
    if (email && keyEmailSet.has(email)) return true
    if (name  && keyNameSet.has(name))   return true
    return false
  }
  const isKeyName = (name) => {
    return keyNameSet.has((name || '').toLowerCase())
  }

  const keyCount      = (items || []).filter(isKeyPerson).length
  const linkedCount   = (items || []).filter(c => !!c.contact_id).length
  const unlinkedCount = (items || []).filter(c => !c.contact_id && !isSpeaker(c.committed_by_name || c.person_name)).length

  // Count winners (items that have at least one loser pointing at them)
  const loserWinnerIds = useMemo(() => {
    const ids = new Set()
    for (const c of (items || [])) {
      if (c.potential_duplicate_of && c.status !== 'archived') ids.add(c.potential_duplicate_of)
    }
    return ids
  }, [items])
  const dupesCount = loserWinnerIds.size

  const typeOptions = [
    { value: 'all',           label: 'All' },
    { value: 'key',           label: `⭐ Key${keyCount ? ` (${keyCount})` : ''}` },
    { value: 'blocking_ryan', label: '🚧 Blocking' },
    { value: 'to_ryan',       label: '📬 Owed to Me' },
    { value: 'general',       label: '📋 General' },
    { value: 'dupes',         label: `⚠ Dupes${dupesCount ? ` (${dupesCount})` : ''}` },
  ]

  const sortOptions = [
    { value: 'person',   label: 'By Person' },
    { value: 'due_date', label: 'By Due Date' },
  ]

  const filtered = (items || []).filter(c => {
    // exclude loser duplicates — they render as sub-rows under their winner
    if (c.potential_duplicate_of && c.status !== 'archived') return false
    // type filter
    if (typeFilter === 'blocking_ryan' && c.delivery_type !== 'blocking_ryan') return false
    if (typeFilter === 'to_ryan'       && c.delivery_type !== 'to_ryan')       return false
    if (typeFilter === 'general'       && c.delivery_type && c.delivery_type !== 'general') return false
    if (typeFilter === 'key'           && !isKeyPerson(c)) return false
    // dupes filter — show only winners (items with at least one loser queued)
    if (typeFilter === 'dupes'         && !loserWinnerIds.has(c.id)) return false
    // contact link filter
    if (contactFilter === 'linked'   && !c.contact_id) return false
    if (contactFilter === 'unlinked' && !!c.contact_id) return false
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
      const name = c.committed_by_name || c.person_name || c.made_by || 'Unknown'
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

      <div className="max-w-2xl mx-auto px-4 py-4 pb-36 space-y-3">
        {/* Filter bar */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-3 space-y-2">
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Type</p>
            <PillToggle options={typeOptions} value={typeFilter} onChange={setTypeFilter} />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Contact</p>
            <PillToggle
              options={[
                { value: 'all',      label: 'All' },
                { value: 'linked',   label: `🔗 Linked${linkedCount   ? ` (${linkedCount})`   : ''}` },
                { value: 'unlinked', label: `⬜ Unlinked${unlinkedCount ? ` (${unlinkedCount})` : ''}` },
              ]}
              value={contactFilter}
              onChange={setContactFilter}
            />
          </div>
          <div>
            <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Sort</p>
            <PillToggle options={sortOptions} value={sortBy} onChange={setSortBy} />
          </div>
        </div>

        {/* Merge pending banner */}
        {pendingMerges.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-amber-800 flex-1 font-medium">
              ⚠ {pendingMerges.length} duplicate{pendingMerges.length !== 1 ? 's' : ''} queued to merge
              {keepSeparate.size > 0 && <span className="text-amber-600 font-normal"> · {keepSeparate.size} kept separate</span>}
            </span>
            <button
              onClick={handleMergeAll}
              className="text-xs font-semibold px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
            >
              Merge all
            </button>
          </div>
        )}

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
              const personName = c.committed_by_name || c.person_name || c.made_by || 'Unknown'
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
                  promoted={promotedIds.has(c.id)}
                  onPromote={() => handleSinglePromoteToMyTask(c)}
                  allItems={items}
                  onLink={() => setLinkModalItem(c)}
                  duplicates={duplicatesByWinner[c.id] || []}
                  keepSeparate={keepSeparate}
                  onToggleKeep={toggleKeepSeparate}
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
                          promoted={promotedIds.has(c.id)}
                          onPromote={() => handleSinglePromoteToMyTask(c)}
                          allItems={items}
                          onLink={() => setLinkModalItem(c)}
                          duplicates={duplicatesByWinner[c.id] || []}
                          keepSeparate={keepSeparate}
                          onToggleKeep={toggleKeepSeparate}
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

      {/* Duplicate sub-items rendered inline in CommitmentRow — no bottom panel needed */}

      <BulkActionBar
        selectedIds={selectedIds}
        contacts={contacts}
        onReassign={handleBulkReassign}
        onPromoteToMyTasks={handleBulkPromoteToMyTasks}
        onCancel={() => { setSelectMode(false); setSelectedIds(new Set()) }}
        promoting={promoting}
      />

      {/* Link contact modal */}
      {linkModalItem && (
        <LinkContactModal
          item={linkModalItem}
          contacts={contacts}
          allItems={items}
          onLink={({ contact_id, committed_by_name, committed_by_email }) => {
            update.mutate({
              id: linkModalItem.id,
              updates: {
                contact_id,
                ...(committed_by_name  ? { committed_by_name }  : {}),
                ...(committed_by_email ? { committed_by_email } : {}),
              }
            })
            toast(`Linked to ${committed_by_name || 'contact'}`, { icon: '🔗' })
          }}
          onClose={() => setLinkModalItem(null)}
        />
      )}
    </div>
  )
}

function isInternal(email) {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return domain === 'claycorp.com' || domain === 'ljc.com'
}

// ── Inline duplicate sub-row ───────────────────────────────────
// Rendered under the primary CommitmentRow for each flagged duplicate.
// Pre-queued for merge; user can opt individual ones out.
function DuplicateSubRow({ loser, isKept, onToggleKeep }) {
  return (
    <div className={`flex items-start gap-2 px-4 py-2.5 border-t ${isKept ? 'border-gray-100 bg-gray-50/50' : 'border-amber-100 bg-amber-50/30'}`}>
      {/* indent indicator */}
      <span className="text-[#9b9b97] flex-shrink-0 text-xs pl-1 mt-0.5">↳</span>

      {/* content */}
      <div className="flex-1 min-w-0">
        {/* status chip + confidence */}
        <div className="flex items-center gap-1.5 mb-1">
          {isKept ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">keeping</span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">will merge</span>
          )}
          {loser.duplicate_confidence && (
            <span className="text-[10px] text-[#9b9b97]">{loser.duplicate_confidence}% match</span>
          )}
        </div>

        {/* duplicate title — wraps instead of truncates */}
        <p className={`text-xs leading-snug mb-1 ${isKept ? 'text-[#6b6b67]' : 'text-[#6b6b67] line-through'}`}>
          {loser.title}
        </p>

        {/* context snippet */}
        {loser.context && (
          <p className="text-[11px] text-[#9b9b97] leading-snug mb-0.5 italic">
            {loser.context.slice(0, 120)}{loser.context.length > 120 ? '…' : ''}
          </p>
        )}

        {/* source + person */}
        <div className="flex items-center gap-2 flex-wrap">
          {loser.source_label && (
            <span className="text-[10px] text-[#9b9b97]">📋 {loser.source_label}</span>
          )}
          {loser.committed_by_name && (
            <span className="text-[10px] text-[#9b9b97]">· {loser.committed_by_name}</span>
          )}
          {loser.source_date && (
            <span className="text-[10px] text-[#9b9b97]">· {dayjs(loser.source_date).format('MMM D')}</span>
          )}
        </div>
      </div>

      {/* toggle button */}
      <button
        onClick={e => { e.stopPropagation(); onToggleKeep(loser.id) }}
        className={`text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 transition-colors whitespace-nowrap mt-0.5 ${
          isKept
            ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            : 'text-[#9b9b97] border border-dashed border-gray-300 hover:border-gray-400 hover:text-[#6b6b67]'
        }`}
        title={isKept ? 'Re-queue for merge' : 'Keep this one separate'}
      >
        {isKept ? '↩ merge' : '✗ keep'}
      </button>
    </div>
  )
}

// ── Others commitment context panel ───────────────────────────
function OthersContextPanel({ c, allItems }) {
  const relatedCommitments = c.meeting_note_id
    ? (allItems || []).filter(i => i.meeting_note_id === c.meeting_note_id && i.id !== c.id).slice(0, 4)
    : []

  const personName = c.committed_by_name || c.person_name || c.made_by || 'Unknown'
  const initials = personName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const sourceIcon = () => {
    const st = c.source_type || ''
    if (st.includes('otter') || st.includes('plaud')) return '🎙'
    if (st === 'ai_email') return '📧'
    return '↳'
  }

  return (
    <div className="px-4 pb-3 pt-2 ml-5 border-t border-[#C9A84C]/30 bg-amber-50/20 space-y-2.5">
      {/* Source */}
      {c.source_label && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm">{sourceIcon()}</span>
          <span className="text-xs text-[#6b6b67]">{c.source_label}</span>
          {c.source_date && (
            <span className="text-xs text-[#9b9b97]">· {dayjs(c.source_date).format('MMM D')}</span>
          )}
        </div>
      )}

      {/* Person chip */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide">From</span>
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-[#6b6b67]">
          <span className="w-4 h-4 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
            {initials}
          </span>
          {personName}
        </span>
      </div>

      {/* Related from same meeting */}
      {relatedCommitments.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide mb-1">Related from this meeting</p>
          <div className="flex flex-wrap gap-1.5">
            {relatedCommitments.map(r => (
              <span key={r.id} className="flex items-center gap-1 text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.status === 'closed' || r.status === 'done' ? 'bg-green-500' : 'bg-amber-400'}`} />
                {r.title && r.title.length > 40 ? r.title.slice(0, 40) + '…' : r.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Context/notes */}
      {c.context && (
        <div>
          <p className="text-[10px] font-semibold text-[#9b9b97] uppercase tracking-wide mb-0.5">Notes</p>
          <p className="text-xs text-[#6b6b67] leading-snug whitespace-pre-wrap">{c.context}</p>
        </div>
      )}
    </div>
  )
}

// ── Link Contact Modal ─────────────────────────────────────────
function LinkContactModal({ item, contacts, allItems, onLink, onClose }) {
  const personName = item.committed_by_name || item.person_name || ''
  const [query,    setQuery]   = useState(personName)
  const [email,    setEmail]   = useState(item.committed_by_email || '')
  const [company,  setCompany] = useState('')
  const [saving,   setSaving]  = useState(false)
  const [tab,      setTab]     = useState('create') // start on create — matches user intent
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [tab])

  // ── Build unique name lookup from ALL activity (others_commitments)
  // Used to verify spelling before creating — no extra API calls needed
  const activityNames = useMemo(() => {
    const seen = new Map()
    for (const c of allItems || []) {
      const name = c.committed_by_name || c.person_name
      if (!name || isSpeaker(name)) continue
      const key = name.toLowerCase().trim()
      if (!seen.has(key)) {
        seen.set(key, { displayName: name, email: c.committed_by_email || null, count: 1 })
      } else {
        const ex = seen.get(key)
        ex.count++
        if (!ex.email && c.committed_by_email) ex.email = c.committed_by_email
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count)
  }, [allItems])

  // Activity matches for the current query — shown in Create tab for spelling verification
  const activityMatches = activityNames.filter(n =>
    query.trim().length >= 2 &&
    n.displayName.toLowerCase().includes(query.toLowerCase()) &&
    n.displayName.toLowerCase() !== query.toLowerCase()  // hide exact match (no need to confirm)
  ).slice(0, 5)

  // Contacts filter (Search tab)
  const filteredContacts = (contacts || [])
    .filter(c => !query.trim() || c.name?.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)
  const exactContactMatch = (contacts || []).find(c => c.name?.toLowerCase() === query.toLowerCase())

  const handleLinkExisting = (contact) => {
    onLink({ contact_id: contact.id, committed_by_name: contact.name, committed_by_email: contact.email || item.committed_by_email || null })
    onClose()
  }

  const handlePickActivityName = (n) => {
    setQuery(n.displayName)
    if (n.email && !email) setEmail(n.email)
  }

  const handleCreateAndLink = async () => {
    if (!query.trim()) return
    setSaving(true)
    try {
      const newContact = await createContact({
        name:    query.trim(),
        email:   email.trim()   || null,
        company: company.trim() || null,
      })
      onLink({ contact_id: newContact.id, committed_by_name: newContact.name, committed_by_email: newContact.email || null })
      onClose()
    } catch (e) {
      alert(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#e5e5e3]">
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a18]">Link to Contact</h2>
            <p className="text-xs text-[#6b6b67] mt-0.5 truncate max-w-[240px]">
              "{item.title?.slice(0, 50)}{item.title?.length > 50 ? '…' : ''}"
            </p>
          </div>
          <button onClick={onClose} className="text-[#6b6b67] hover:text-[#1a1a18] text-xl leading-none ml-3">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mx-4 mt-3 mb-0 bg-[#f3f3f1] rounded-lg p-1">
          {[['create', '+ Create New'], ['search', '🔍 Find Existing']].map(([t, lbl]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b67]'}`}>
              {lbl}
            </button>
          ))}
        </div>

        <div className="px-4 py-3">
          {/* ── CREATE TAB ─────────────────────────────────────── */}
          {tab === 'create' && (
            <div className="space-y-3">

              {/* Name + activity spelling suggestions */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Name *</label>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Full name"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />

                {/* Spelling suggestions from activity queue */}
                {activityMatches.length > 0 && (
                  <div className="mt-1.5">
                    <p className="text-[10px] text-[#9b9b97] mb-1">Names from your activity — tap to use:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {activityMatches.map(n => (
                        <button
                          key={n.displayName}
                          onClick={() => handlePickActivityName(n)}
                          className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors border border-blue-100"
                        >
                          {n.displayName}
                          {n.count > 1 && <span className="text-blue-400 ml-1">×{n.count}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Email</label>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@company.com"
                  type="email"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Company (new) */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Company</label>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="Organization or firm"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <button
                onClick={handleCreateAndLink}
                disabled={saving || !query.trim()}
                className="w-full py-2.5 bg-[#1a1a18] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-gray-800 flex items-center justify-center gap-2"
              >
                {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</> : 'Create & Link'}
              </button>
            </div>
          )}

          {/* ── SEARCH TAB ─────────────────────────────────────── */}
          {tab === 'search' && (
            <>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search contacts…"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {filteredContacts.length > 0 ? filteredContacts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleLinkExisting(c)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {c.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] leading-tight">{c.name}</p>
                      {(c.email || c.company) && (
                        <p className="text-xs text-[#9b9b97] truncate">{c.email || c.company}</p>
                      )}
                    </div>
                    {c.is_key_contact && <span className="ml-auto text-amber-500 text-xs flex-shrink-0">⭐</span>}
                  </button>
                )) : (
                  <p className="text-xs text-[#9b9b97] text-center py-4">No contacts match "{query}"</p>
                )}
              </div>
              {!exactContactMatch && query.trim().length > 1 && (
                <button
                  onClick={() => setTab('create')}
                  className="w-full mt-2 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                >
                  + Create "{query}" as new contact →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CommitmentRow({ c, personName, daysOverdue, update, showPerson, isKey, contacts, selectMode, selected, onToggleSelect, promoted, onPromote, allItems, onLink, duplicates = [], keepSeparate, onToggleKeep }) {
  const [reassigning, setReassigning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const toast = useToast()
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
    toast(`Reassigned to ${name}`, { icon: '👤' })
    setReassigning(false)
  }

  return (
    <div
      className={`group ${speaker ? 'bg-amber-50/40' : ''} ${selected ? 'bg-blue-50' : ''}`}
    >
    <div
      className={`px-4 py-3 ${selectMode ? 'cursor-pointer' : 'cursor-pointer'}`}
      onClick={selectMode ? onToggleSelect : () => setExpanded(v => !v)}
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
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <p className={`text-xs ${speaker ? 'text-amber-600 font-medium' : 'text-[#6b6b67]'}`}>
                {speaker ? `⚠ ${personName} — unattributed` : personName}
              </p>
              {internal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium flex-shrink-0">
                  Internal
                </span>
              )}
              {c.contact_id ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-medium flex-shrink-0" title="Linked to contact">
                  🔗 Linked
                </span>
              ) : !speaker && (
                <button
                  onClick={e => { e.stopPropagation(); onLink && onLink() }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-gray-300 text-[#9b9b97] hover:border-blue-400 hover:text-blue-500 flex-shrink-0 transition-colors"
                >
                  + link
                </button>
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
          {/* Link/Unlink contact */}
          {!speaker && (
            <button
              onClick={e => { e.stopPropagation(); onLink && onLink() }}
              className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs transition-all ${
                c.contact_id
                  ? 'border-green-300 text-green-600 bg-green-50'
                  : 'border-dashed border-gray-300 text-[#9b9b97] hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50'
              }`}
              title={c.contact_id ? 'Linked to contact' : 'Link to contact'}
            >
              🔗
            </button>
          )}
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
            onClick={e => { e.stopPropagation(); update.mutate({ id: c.id, updates: { status: 'closed' } }); toast('Marked complete', { icon: '✓' }) }}
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

          {/* Promote to my tasks */}
          <button
            onClick={e => { e.stopPropagation(); onPromote && onPromote() }}
            disabled={promoted}
            className={`h-7 px-2 rounded-full border flex items-center justify-center text-[10px] font-medium transition-all whitespace-nowrap ${
              promoted
                ? 'border-green-300 text-green-600 bg-green-50'
                : 'border-[#e5e5e3] text-[#6b6b67] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50'
            }`}
            title="Add to my tasks"
          >
            {promoted ? '✓ Mine' : '→ Me'}
          </button>
        </div>
      </div>
    </div>

      {/* Expanded context panel */}
      {expanded && !selectMode && (
        <OthersContextPanel c={c} allItems={allItems} />
      )}

      {/* Inline duplicate sub-rows — pre-queued for merge */}
      {duplicates.length > 0 && !selectMode && duplicates.map(loser => (
        <DuplicateSubRow
          key={loser.id}
          loser={loser}
          isKept={keepSeparate && keepSeparate.has(loser.id)}
          onToggleKeep={onToggleKeep}
        />
      ))}
    </div>
  )
}
