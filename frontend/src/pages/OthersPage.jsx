import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getOthersCommitments, updateOthersCommitment, getContacts, createContact, createTask, getProjects } from '../lib/api'
import { useToast } from '../contexts/ToastContext'
import WorkspaceBar from '../components/WorkspaceBar'
import { useStore } from '../store/useStore'

function isSpeaker(name) {
  if (!name) return true
  const n = name.trim()
  return /^speaker\s*\d+\s*[-–]?\s*$/i.test(n) || n.toLowerCase() === 'unknown'
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
function BulkActionBar({ selectedIds, onPromoteToMyTasks, onMarkDone, onMerge, onCancel, promoting, saving }) {
  if (selectedIds.size === 0) return null

  return (
    <div className="fixed left-0 right-0 z-[55] px-4 pb-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)' }}>
      <div className="max-w-2xl mx-auto bg-[#1a1a18] text-white rounded-2xl px-4 py-3 flex items-center gap-2 shadow-lg flex-wrap">
        <span className="text-sm font-medium flex-shrink-0">{selectedIds.size} selected</span>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Mark done */}
          <button
            onClick={onMarkDone}
            disabled={saving}
            className="text-sm bg-green-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-green-400 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? 'Saving…' : '✓ Done'}
          </button>
          {/* Merge — only when 2+ selected */}
          {selectedIds.size >= 2 && (
            <button
              onClick={onMerge}
              disabled={saving}
              className="text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-400 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              ⛓ Merge
            </button>
          )}
          {/* Promote to my tasks */}
          <button
            onClick={onPromoteToMyTasks}
            disabled={promoting}
            className="text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {promoting ? 'Adding…' : '→ My tasks'}
          </button>
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

  const [search,        setSearch]        = useState('')
  const [typeFilter,    setTypeFilter]    = useState('all')
  const [contactFilter, setContactFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [sortBy,        setSortBy]        = useState('person')
  const [selectMode,    setSelectMode]    = useState(false)
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [promoting,     setPromoting]     = useState(false)
  const [promotedIds,   setPromotedIds]   = useState(new Set())
  const [linkModalItem, setLinkModalItem] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [recentlyCompleted, setRecentlyCompleted] = useState(() => new Map())
  const recentlyCompletedRef = useRef(new Map())

  const toast = useToast()

  const { workspace } = useStore()

  const { data: commitments = [], isLoading } = useQuery({
    queryKey: ['others', workspace],
    queryFn: () => getOthersCommitments('all', null, workspace !== 'all' ? workspace : null),
  })
  const items = commitments

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
      await qc.cancelQueries({ queryKey: ['others', workspace] })
      const prev = qc.getQueryData(['others', workspace])
      qc.setQueryData(['others', workspace], old =>
        (old || []).map(c => c.id === id ? { ...c, ...updates } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['others', workspace], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['others', workspace] }),
  })

  // markDone: close item + show 5-sec undo window before hiding
  const markDone = useCallback((id) => {
    update.mutate({ id, updates: { status: 'closed' } })
    if (recentlyCompletedRef.current.has(id)) {
      clearTimeout(recentlyCompletedRef.current.get(id))
    }
    const timerId = setTimeout(() => {
      recentlyCompletedRef.current.delete(id)
      setRecentlyCompleted(new Map(recentlyCompletedRef.current))
    }, 5000)
    recentlyCompletedRef.current.set(id, timerId)
    setRecentlyCompleted(new Map(recentlyCompletedRef.current))
  }, [update])

  const undoComplete = useCallback((id) => {
    if (recentlyCompletedRef.current.has(id)) {
      clearTimeout(recentlyCompletedRef.current.get(id))
      recentlyCompletedRef.current.delete(id)
      setRecentlyCompleted(new Map(recentlyCompletedRef.current))
    }
    update.mutate({ id, updates: { status: 'open' } })
  }, [update])


  const [bulkSaving, setBulkSaving] = useState(false)
  const [mergeModal, setMergeModal] = useState(false)

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

  const handleBulkMarkDone = async () => {
    if (bulkSaving) return
    setBulkSaving(true)
    const ids = [...selectedIds]
    try {
      await Promise.all(ids.map(id => updateOthersCommitment(id, { status: 'closed' })))
      qc.setQueryData(['others', workspace], old =>
        (old || []).map(c => ids.includes(c.id) ? { ...c, status: 'closed' } : c)
      )
      // Add each to the 5-sec undo window
      ids.forEach(id => {
        if (recentlyCompletedRef.current.has(id)) clearTimeout(recentlyCompletedRef.current.get(id))
        const timerId = setTimeout(() => {
          recentlyCompletedRef.current.delete(id)
          setRecentlyCompleted(new Map(recentlyCompletedRef.current))
        }, 5000)
        recentlyCompletedRef.current.set(id, timerId)
      })
      setRecentlyCompleted(new Map(recentlyCompletedRef.current))
      toast(`${ids.length} item${ids.length !== 1 ? 's' : ''} marked done`, { icon: '✓' })
      setSelectedIds(new Set())
      setSelectMode(false)
    } finally {
      setBulkSaving(false)
    }
  }

  const handleMerge = async (keeperId) => {
    const losers = [...selectedIds].filter(id => id !== keeperId)
    setBulkSaving(true)
    try {
      await Promise.all(losers.map(id => updateOthersCommitment(id, { parent_id: keeperId })))
      qc.setQueryData(['others', workspace], old =>
        (old || []).map(c => losers.includes(c.id) ? { ...c, parent_id: keeperId } : c)
      )
      toast(`Merged ${selectedIds.size} items into 1`, { icon: '⛓' })
      setMergeModal(false)
      setSelectedIds(new Set())
      setSelectMode(false)
    } finally {
      setBulkSaving(false)
    }
  }

const handleBulkPromoteToMyTasks = async () => {
    if (promoting) return
    setPromoting(true)
    const allItems = items || []
    const toPromote = allItems.filter(c => selectedIds.has(c.id) && !promotedIds.has(c.id))
    const promoted = []
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
        await updateOthersCommitment(c.id, { status: 'archived' })
        promoted.push(c.id)
      } catch (_) { /* keep going */ }
    }
    if (promoted.length > 0) {
      setPromotedIds(prev => new Set([...prev, ...promoted]))
      qc.setQueryData(['others', workspace], old =>
        (old || []).map(c => promoted.includes(c.id) ? { ...c, status: 'archived' } : c)
      )
    }
    const addedCount = promoted.length
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
      await updateOthersCommitment(c.id, { status: 'archived' })
      setPromotedIds(prev => new Set([...prev, c.id]))
      qc.setQueryData(['others', workspace], old =>
        (old || []).map(item => item.id === c.id ? { ...item, status: 'archived' } : item)
      )
      toast('Added to My Tasks', { icon: '→' })
    } catch (_) {}
  }

  // ── Auto-link by name match ───────────────────────────────────
  // When contacts load, any item whose committed_by_name matches a contact
  // name (case-insensitive) gets its contact_id auto-set — no manual Assign needed
  useEffect(() => {
    if (!contacts?.length || !items?.length) return
    const contactByName = new Map(
      contacts.map(c => [(c.name || '').toLowerCase().trim(), c])
    )
    const toLink = items.filter(item => {
      if (item.contact_id) return false // already linked
      const name = (item.committed_by_name || item.person_name || '').toLowerCase().trim()
      return name && contactByName.has(name)
    })
    if (toLink.length === 0) return
    // Fire updates in background — failures are non-fatal
    toLink.forEach(item => {
      const contact = contactByName.get((item.committed_by_name || item.person_name || '').toLowerCase().trim())
      updateOthersCommitment(item.id, { contact_id: contact.id })
        .then(() => {
          qc.setQueryData(['others', workspace], old =>
            (old || []).map(c => c.id === item.id ? { ...c, contact_id: contact.id } : c)
          )
        })
        .catch(() => {}) // silent — next load will retry
    })
  }, [contacts, items]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const typeOptions = [
    { value: 'all',           label: 'All' },
    { value: 'key',           label: `⭐ Key${keyCount ? ` (${keyCount})` : ''}` },
    { value: 'blocking_ryan', label: '🚧 Blocking' },
    { value: 'to_ryan',       label: '📬 Owed to Me' },
    { value: 'general',       label: '📋 General' },
  ]

  const sortOptions = [
    { value: 'person',   label: 'By Person' },
    { value: 'due_date', label: 'Due Date' },
    { value: 'newest',   label: 'Newest' },
    { value: 'oldest',   label: 'Oldest' },
  ]

  const isItemDone = (c) => c.status === 'closed' || c.status === 'done'
  const completedCount = (items || []).filter(isItemDone).length

  // Map: parentId → [child items]
  const childrenByParent = useMemo(() => {
    const map = {}
    for (const c of items || []) {
      if (c.parent_id) {
        if (!map[c.parent_id]) map[c.parent_id] = []
        map[c.parent_id].push(c)
      }
    }
    return map
  }, [items])

  const filtered = (items || []).filter(c => {
    // children render under their parent — exclude from main list
    if (c.parent_id) return false

    // hide closed/done items unless in 5-sec undo window or showCompleted is on
    if (isItemDone(c) && !showCompleted && !recentlyCompleted.has(c.id)) return false
    // type filter
    if (typeFilter === 'blocking_ryan' && c.delivery_type !== 'blocking_ryan') return false
    if (typeFilter === 'to_ryan'       && c.delivery_type !== 'to_ryan')       return false
    if (typeFilter === 'general'       && c.delivery_type && c.delivery_type !== 'general') return false
    if (typeFilter === 'key'           && !isKeyPerson(c)) return false
    // contact link filter
    if (contactFilter === 'linked'   && !c.contact_id) return false
    if (contactFilter === 'unlinked' && !!c.contact_id) return false
    // project filter
    if (projectFilter !== 'all') {
      if (projectFilter === 'none' && c.project_id) return false
      if (projectFilter !== 'none' && c.project_id !== projectFilter) return false
    }
    // search
    if (search.trim()) {
      const q = search.toLowerCase()
      if (
        !c.title?.toLowerCase().includes(q) &&
        !(c.committed_by_name || c.person_name || '').toLowerCase().includes(q) &&
        !c.context?.toLowerCase().includes(q) &&
        !c.source_label?.toLowerCase().includes(q)
      ) return false
    }
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

  // Flat sort for non-person views
  const flatSorted = (sortBy === 'due_date' || sortBy === 'newest' || sortBy === 'oldest')
    ? [...filtered].sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
        if (sortBy === 'oldest') return new Date(a.created_at || 0) - new Date(b.created_at || 0)
        // due_date: key contacts first, then by date
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
          <h1 className="text-sm font-semibold text-[#1a1a18]">Waiting on Others</h1>
          <WorkspaceBar compact />
          <button
            onClick={() => setShowCompleted(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all flex-1 text-left ${
              showCompleted
                ? 'bg-gray-100 text-[#6b6b67] border-gray-200'
                : 'text-[#9b9b97] border-transparent hover:border-gray-200'
            }`}
          >
            {showCompleted ? `Hide completed (${completedCount})` : completedCount > 0 ? `+${completedCount} done` : ''}
          </button>
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
          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items, people, context..."
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-[#e5e5e3] rounded-lg bg-[#f8f8f6] text-[#1a1a18] placeholder-[#9b9b97] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >×</button>
            )}
          </div>
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
          {projects && projects.length > 0 && (
            <div>
              <p className="text-xs text-[#6b6b67] mb-1.5 font-medium">Project</p>
              <div className="flex flex-wrap gap-1">
                {[{ id: 'all', name: 'All' }, { id: 'none', name: 'No project' }, ...projects].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setProjectFilter(p.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all ${
                      projectFilter === p.id
                        ? 'bg-[#1a1a18] text-white'
                        : 'text-[#6b6b67] hover:bg-gray-100'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nothing here</p>
        ) : flatSorted ? (
          /* Flat list — due date, newest, oldest */
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
                  selectMode={selectMode}
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={() => toggleItemSelect(c.id)}
                  promoted={promotedIds.has(c.id)}
                  onPromote={() => handleSinglePromoteToMyTask(c)}
                  allItems={items}
                  onLink={() => setLinkModalItem(c)}
                  children={childrenByParent[c.id] || []}
                  onMarkDone={markDone}
                  onUndoComplete={undoComplete}
                  isRecentlyDone={recentlyCompleted.has(c.id)}
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
                          selectMode={selectMode}
                          selected={selectedIds.has(c.id)}
                          onToggleSelect={() => toggleItemSelect(c.id)}
                          promoted={promotedIds.has(c.id)}
                          onPromote={() => handleSinglePromoteToMyTask(c)}
                          allItems={items}
                          onLink={() => setLinkModalItem(c)}
                          children={childrenByParent[c.id] || []}
                          onMarkDone={markDone}
                          onUndoComplete={undoComplete}
                          isRecentlyDone={recentlyCompleted.has(c.id)}
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

      <BulkActionBar
        selectedIds={selectedIds}
        onMarkDone={handleBulkMarkDone}
        onMerge={() => setMergeModal(true)}
        onPromoteToMyTasks={handleBulkPromoteToMyTasks}
        onCancel={() => { setSelectMode(false); setSelectedIds(new Set()) }}
        promoting={promoting}
        saving={bulkSaving}
      />

      {/* Merge modal — pick the keeper */}
      {mergeModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setMergeModal(false)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#e5e5e3]">
              <div>
                <h2 className="text-sm font-semibold text-[#1a1a18]">Merge {selectedIds.size} items</h2>
                <p className="text-xs text-[#6b6b67] mt-0.5">The kept item becomes the parent. Others become sub-items, visible when you expand it.</p>
              </div>
              <button onClick={() => setMergeModal(false)} className="text-[#6b6b67] hover:text-[#1a1a18] text-xl leading-none">×</button>
            </div>
            <div className="px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
              {(items || []).filter(c => selectedIds.has(c.id)).map(c => (
                <button
                  key={c.id}
                  onClick={() => handleMerge(c.id)}
                  disabled={bulkSaving}
                  className="w-full text-left px-4 py-3 rounded-xl border border-[#e5e5e3] hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-40 group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1a1a18] leading-snug group-hover:text-blue-700">{c.title}</p>
                      {c.committed_by_name && <p className="text-xs text-[#9b9b97] mt-0.5">from {c.committed_by_name}</p>}
                      {c.context && <p className="text-xs text-[#9b9b97] mt-0.5 line-clamp-1">{c.context}</p>}
                      {c.source_label && <p className="text-[10px] text-[#9b9b97] mt-0.5">↳ {c.source_label}</p>}
                    </div>
                    <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 flex-shrink-0 font-medium">Keep →</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="px-5 pb-4 pt-2">
              <p className="text-[10px] text-[#9b9b97] text-center">The kept item will inherit notes from the archived ones.</p>
            </div>
          </div>
        </div>
      )}

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
  const [query,    setQuery]   = useState(
    personName && !isSpeaker(personName) ? personName : (item.committed_by_email || '')
  )
  const [email,    setEmail]   = useState(item.committed_by_email || '')
  const [title,    setTitle]   = useState('')
  const [company,  setCompany] = useState('')
  const [saving,   setSaving]  = useState(false)
  const [error,    setError]   = useState('')
  const [tab,      setTab]     = useState('search') // default: find existing contact
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

  // Contacts filter (Search tab) — match on name, email, or company
  const filteredContacts = (contacts || [])
    .filter(c => {
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return (
        c.name?.toLowerCase().includes(q)    ||
        c.email?.toLowerCase().includes(q)   ||
        c.company?.toLowerCase().includes(q)
      )
    })
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
    setError('')
    try {
      const newContact = await createContact({
        name:     query.trim(),
        title:    title.trim()   || null,
        email:    email.trim()   || null,
        company:  company.trim() || null,
        source:   'manual',
        enriched: false,
      })
      onLink({ contact_id: newContact.id, committed_by_name: newContact.name, committed_by_email: newContact.email || null })
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to create contact')
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
          {[['search', 'Find Contact'], ['create', '+ Create New']].map(([t, lbl]) => (
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

              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. VP Development"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Email</label>
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@company.com"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Company */}
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Company</label>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="Organization or firm"
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

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

function CommitmentRow({ c, personName, daysOverdue, update, showPerson, isKey, selectMode, selected, onToggleSelect, promoted, onPromote, allItems, onLink, children = [], onMarkDone, onUndoComplete, isRecentlyDone }) {
  const [expanded,     setExpanded]     = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState('')
  const speaker = isSpeaker(personName)
  const internal = isInternal(c.committed_by_email)

  const typeIcon = c.delivery_type === 'blocking_ryan' ? '🚧'
    : c.delivery_type === 'to_ryan' ? '📬'
    : '📋'

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
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (titleDraft.trim()) update.mutate({ id: c.id, updates: { title: titleDraft.trim() } })
                    setEditingTitle(false)
                  }
                  if (e.key === 'Escape') { setEditingTitle(false) }
                }}
                onBlur={() => {
                  if (titleDraft.trim()) update.mutate({ id: c.id, updates: { title: titleDraft.trim() } })
                  setEditingTitle(false)
                }}
                onClick={e => e.stopPropagation()}
                className="text-sm font-medium text-[#1a1a18] leading-snug border-b border-blue-400 outline-none bg-transparent flex-1 min-w-0"
              />
            ) : (
              <p
                className="text-sm font-medium text-[#1a1a18] leading-snug cursor-text"
                onDoubleClick={e => { e.stopPropagation(); setTitleDraft(c.title); setEditingTitle(true) }}
              >{c.title}</p>
            )}
            {children.length > 0 && !expanded && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium flex-shrink-0" title={`${children.length} sub-item${children.length !== 1 ? 's' : ''}`}>
                ⛓ {children.length}
              </span>
            )}
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

          {/* Person name */}
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
              {c.contact_id && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-medium flex-shrink-0" title="Linked to contact">
                  🔗 Linked
                </span>
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
        </div>

        {/* Action buttons — hidden in select mode */}
        <div className={`flex items-center gap-1 flex-shrink-0 mt-0.5 ${selectMode ? 'hidden' : ''}`}>
          {/* Assign / Linked button */}
          <button
            onClick={e => { e.stopPropagation(); onLink && onLink() }}
            className={`h-7 px-2 rounded-full border flex items-center justify-center text-[10px] font-medium transition-all whitespace-nowrap ${
              c.contact_id
                ? 'border-green-300 text-green-600 bg-green-50'
                : 'border-dashed border-gray-300 text-[#9b9b97] hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50'
            }`}
            title={c.contact_id ? 'Linked to contact' : 'Assign to contact'}
          >
            {c.contact_id ? '🔗 Linked' : 'Assign'}
          </button>

          {/* Mark done / Undo */}
          {(() => {
            const done = c.status === 'closed' || c.status === 'done'
            if (done && isRecentlyDone) return (
              <button
                onClick={e => { e.stopPropagation(); onUndoComplete && onUndoComplete(c.id) }}
                className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all font-medium border border-amber-200 whitespace-nowrap"
              >
                Undo
              </button>
            )
            if (done) return (
              <button
                onClick={e => { e.stopPropagation(); onUndoComplete && onUndoComplete(c.id) }}
                className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-gray-300 hover:text-amber-600 hover:bg-amber-50 hover:border-amber-300 transition-all text-xs"
                title="Mark incomplete"
              >
                ↩
              </button>
            )
            return (
              <button
                onClick={e => { e.stopPropagation(); onMarkDone ? onMarkDone(c.id) : update.mutate({ id: c.id, updates: { status: 'closed' } }) }}
                className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
                title="Mark done"
              >
                ✓
              </button>
            )
          })()}

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

      {/* Children sub-items */}
      {expanded && !selectMode && children.length > 0 && (
        <div className="border-t border-[#f0f0ee] bg-gray-50/50">
          {children.map(child => (
            <div key={child.id} className="flex items-start gap-2 px-6 py-2 border-b border-[#f0f0ee] last:border-0">
              <span className="text-[#9b9b97] text-xs mt-0.5 flex-shrink-0">↳</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#1a1a18] leading-snug">{child.title}</p>
                <p className="text-xs text-[#9b9b97] mt-0.5">
                  {child.committed_by_name || child.person_name || ''}
                  {child.source_label ? ` · ${child.source_label}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
