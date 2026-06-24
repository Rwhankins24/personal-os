// MeetingCategoryPanel — Primary + secondary category assignment + information-only toggle
// Includes inline category management modal: edit, delete, merge.

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMeetingCategories,
  getMeetingCategoryAssignments,
  assignPrimaryCategory,
  addSecondaryCategory,
  removeSecondaryCategory,
  setInformationOnly,
  createMeetingCategory,
  updateMeetingCategory,
  deleteMeetingCategory,
  mergeMeetingCategories,
} from '../lib/api'

const PRESET_COLORS = [
  '#1B2A4A', '#b91c1c', '#7c3aed', '#d97706',
  '#0369a1', '#065f46', '#dc2626', '#475569',
  '#C9A84C', '#0891b2', '#4f46e5', '#15803d',
]

// ── CategoryBadge ─────────────────────────────────────────────────────────────
function CategoryBadge({ category, onRemove, small }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}
      style={{ backgroundColor: category.color + '18', color: category.color, border: `1px solid ${category.color}40` }}
    >
      {category.name}
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="ml-0.5 hover:opacity-60 leading-none"
          title="Remove"
        >×</button>
      )}
    </span>
  )
}

// ── CategoryPickerPopover ─────────────────────────────────────────────────────
function CategoryPickerPopover({ categories, onSelect, onClose, placeholder = 'Search…' }) {
  const [query, setQuery]   = useState('')
  const inputRef            = useRef(null)
  const popoverRef          = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function handleClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const q        = query.trim().toLowerCase()
  const filtered = q ? categories.filter(c => c.name.toLowerCase().includes(q)) : categories
  const projectScoped = filtered.filter(c => c.project_id)
  const global        = filtered.filter(c => !c.project_id)

  function renderGroup(label, items) {
    if (!items.length) return null
    return (
      <div key={label} className="mb-1">
        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#9b9b97]">{label}</div>
        {items.map(cat => (
          <button
            key={cat.id}
            onMouseDown={e => { e.preventDefault(); onSelect(cat) }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#f5f4f2] rounded-lg transition-colors"
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
            <span className="text-xs text-[#1a1a18] leading-tight">{cat.name}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 top-full left-0 mt-1 w-56 bg-white border border-[#e5e5e3] rounded-xl shadow-lg py-2"
    >
      <div className="px-2 pb-2">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
        />
      </div>
      <div className="max-h-52 overflow-y-auto px-1">
        {projectScoped.length > 0 && renderGroup('This Project', projectScoped)}
        {global.length > 0        && renderGroup('Global', global)}
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-xs text-[#9b9b97] text-center">No matches</div>
        )}
      </div>
    </div>
  )
}

// ── CategoryManageModal ───────────────────────────────────────────────────────
function CategoryManageModal({ allCategories, projectId, onClose, onRefresh }) {
  // Per-row state: 'idle' | 'editing' | 'deleting' | 'merging' | 'merge-confirm'
  const [rowState,   setRowState]   = useState({}) // { [id]: state }
  const [editValues, setEditValues] = useState({}) // { [id]: { name, color } }
  const [mergeTarget, setMergeTarget] = useState({}) // { [id]: categoryObj }
  const [busy, setBusy] = useState({}) // { [id]: bool }

  const setRow = (id, state) => setRowState(p => ({ ...p, [id]: state }))
  const setBusyFor = (id, val) => setBusy(p => ({ ...p, [id]: val }))

  // ── Edit ──────────────────────────────────────────────────────────────────
  function startEdit(cat) {
    setEditValues(p => ({ ...p, [cat.id]: { name: cat.name, color: cat.color } }))
    setRow(cat.id, 'editing')
  }

  async function saveEdit(cat) {
    const vals = editValues[cat.id]
    if (!vals?.name?.trim()) return
    setBusyFor(cat.id, true)
    try {
      await updateMeetingCategory(cat.id, { name: vals.name.trim(), color: vals.color })
      onRefresh()
      setRow(cat.id, 'idle')
    } finally { setBusyFor(cat.id, false) }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete(cat) {
    setBusyFor(cat.id, true)
    try {
      await deleteMeetingCategory(cat.id)
      onRefresh()
    } finally { setBusyFor(cat.id, false) }
  }

  // ── Merge ─────────────────────────────────────────────────────────────────
  async function confirmMerge(sourceId) {
    const target = mergeTarget[sourceId]
    if (!target) return
    setBusyFor(sourceId, true)
    try {
      await mergeMeetingCategories(sourceId, target.id)
      onRefresh()
      setRow(sourceId, 'idle')
      setMergeTarget(p => { const n = {...p}; delete n[sourceId]; return n })
    } finally { setBusyFor(sourceId, false) }
  }

  // Group categories
  const projectScoped = allCategories.filter(c => c.project_id)
  const global        = allCategories.filter(c => !c.project_id)

  function renderRow(cat) {
    const state   = rowState[cat.id] || 'idle'
    const editing = editValues[cat.id] || { name: cat.name, color: cat.color }
    const isBusy  = busy[cat.id]

    // Categories available as merge targets (everything except this category)
    const mergeOptions = allCategories.filter(c => c.id !== cat.id)

    return (
      <div key={cat.id} className="py-2.5 border-b border-[#f0f0ee] last:border-0">

        {/* ── Idle row ── */}
        {state === 'idle' && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
            <span className="text-xs text-[#1a1a18] flex-1 leading-tight">{cat.name}</span>
            <button onClick={() => startEdit(cat)}
              className="text-[10px] text-[#9b9b97] hover:text-blue-500 px-1.5 py-0.5 rounded transition-colors">
              edit
            </button>
            <button onClick={() => setRow(cat.id, 'merging')}
              className="text-[10px] text-[#9b9b97] hover:text-purple-500 px-1.5 py-0.5 rounded transition-colors">
              merge
            </button>
            <button onClick={() => setRow(cat.id, 'deleting')}
              className="text-[10px] text-[#9b9b97] hover:text-red-500 px-1.5 py-0.5 rounded transition-colors">
              delete
            </button>
          </div>
        )}

        {/* ── Editing row ── */}
        {state === 'editing' && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: editing.color }} />
              <input
                autoFocus
                value={editing.name}
                onChange={e => setEditValues(p => ({ ...p, [cat.id]: { ...editing, name: e.target.value } }))}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(cat); if (e.key === 'Escape') setRow(cat.id, 'idle') }}
                className="flex-1 text-xs border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
            {/* Color dots */}
            <div className="flex flex-wrap gap-1.5 mb-2 pl-5">
              {PRESET_COLORS.map(c => (
                <button key={c}
                  onClick={() => setEditValues(p => ({ ...p, [cat.id]: { ...editing, color: c } }))}
                  className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ backgroundColor: c, borderColor: editing.color === c ? '#1a1a18' : 'transparent' }}
                />
              ))}
            </div>
            <div className="flex gap-2 pl-5">
              <button onClick={() => setRow(cat.id, 'idle')}
                className="text-[10px] px-2.5 py-1 border border-[#e5e5e3] rounded-lg text-[#6b6b67]">
                Cancel
              </button>
              <button onClick={() => saveEdit(cat)} disabled={isBusy || !editing.name.trim()}
                className="text-[10px] px-2.5 py-1 bg-[#1a1a18] text-white rounded-lg disabled:opacity-40">
                {isBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* ── Delete confirm ── */}
        {state === 'deleting' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p className="text-xs text-red-700 mb-2">
              Delete <strong>{cat.name}</strong>? All assignments will be cleared.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRow(cat.id, 'idle')}
                className="text-[10px] px-2.5 py-1 border border-red-200 rounded-lg text-red-500">
                Cancel
              </button>
              <button onClick={() => confirmDelete(cat)} disabled={isBusy}
                className="text-[10px] px-2.5 py-1 bg-red-600 text-white rounded-lg disabled:opacity-40">
                {isBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        {/* ── Merge: pick target ── */}
        {state === 'merging' && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
            <p className="text-xs text-purple-700 mb-2">
              Merge <strong>{cat.name}</strong> into…
            </p>
            <div className="relative">
              <CategoryPickerPopover
                categories={mergeOptions}
                placeholder="Search merge target…"
                onSelect={target => {
                  setMergeTarget(p => ({ ...p, [cat.id]: target }))
                  setRow(cat.id, 'merge-confirm')
                }}
                onClose={() => setRow(cat.id, 'idle')}
              />
            </div>
            <button onClick={() => setRow(cat.id, 'idle')}
              className="text-[10px] text-purple-500 mt-1">
              Cancel
            </button>
          </div>
        )}

        {/* ── Merge: confirm ── */}
        {state === 'merge-confirm' && mergeTarget[cat.id] && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
            <p className="text-xs text-purple-800 mb-1">
              Merge <strong>{cat.name}</strong> → <strong>{mergeTarget[cat.id].name}</strong>?
            </p>
            <p className="text-[10px] text-purple-600 mb-2">
              All assignments transfer to {mergeTarget[cat.id].name}. {cat.name} will be deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRow(cat.id, 'idle')}
                className="text-[10px] px-2.5 py-1 border border-purple-200 rounded-lg text-purple-500">
                Cancel
              </button>
              <button onClick={() => confirmMerge(cat.id)} disabled={isBusy}
                className="text-[10px] px-2.5 py-1 bg-purple-600 text-white rounded-lg disabled:opacity-40">
                {isBusy ? 'Merging…' : 'Confirm merge'}
              </button>
            </div>
          </div>
        )}

      </div>
    )
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e3]">
          <div>
            <p className="text-sm font-bold text-[#1B2A4A]">Manage Categories</p>
            <p className="text-[10px] text-[#9b9b97] mt-0.5">Edit, merge, or remove categories</p>
          </div>
          <button onClick={onClose}
            className="text-[#9b9b97] hover:text-[#1a1a18] text-lg leading-none px-1">
            ×
          </button>
        </div>

        {/* Category list */}
        <div className="overflow-y-auto flex-1 px-5 py-2">
          {projectScoped.length > 0 && (
            <div className="mb-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#9b9b97] mb-1">This Project</p>
              {projectScoped.map(renderRow)}
            </div>
          )}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#9b9b97] mb-1">Global</p>
            {global.map(renderRow)}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#e5e5e3]">
          <p className="text-[10px] text-[#9b9b97]">
            Merge transfers all meeting, knowledge, and pod assignments to the target category.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function MeetingCategoryPanel({ meetingId, projectId }) {
  const qc = useQueryClient()

  const [primaryPickerOpen,   setPrimaryPickerOpen]   = useState(false)
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false)
  const [showManageModal,     setShowManageModal]     = useState(false)
  const [showNewForm,         setShowNewForm]         = useState(false)
  const [newName,             setNewName]             = useState('')
  const [newColor,            setNewColor]            = useState('#1B2A4A')
  const [newScope,            setNewScope]            = useState('global')
  const [saving,              setSaving]              = useState(false)

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: allCategories = [] } = useQuery({
    queryKey: ['meeting-categories', projectId],
    queryFn:  () => getMeetingCategories(projectId),
  })

  const { data: assignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ['meeting-category-assignments', meetingId],
    queryFn:  () => getMeetingCategoryAssignments(meetingId),
    enabled:  !!meetingId,
  })

  const primary     = assignments?.primary     || null
  const secondaries = assignments?.secondaries  || []
  const infoOnly    = assignments?.information_only ?? false

  const secondaryIds          = new Set(secondaries.map(c => c.id))
  const primaryId             = primary?.id
  const availableForSecondary = allCategories.filter(c => c.id !== primaryId && !secondaryIds.has(c.id))

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['meeting-category-assignments', meetingId] })
    qc.invalidateQueries({ queryKey: ['meeting', meetingId] })
  }

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['meeting-categories', projectId] })
    invalidate()
  }

  const setPrimary = useMutation({
    mutationFn: (categoryId) => assignPrimaryCategory(meetingId, categoryId),
    onSuccess: invalidate,
  })

  const addSecondary = useMutation({
    mutationFn: (categoryId) => addSecondaryCategory(meetingId, categoryId),
    onSuccess: () => { setSecondaryPickerOpen(false); invalidate() },
  })

  const removeSecondary = useMutation({
    mutationFn: (categoryId) => removeSecondaryCategory(meetingId, categoryId),
    onSuccess: invalidate,
  })

  const toggleInfoOnly = useMutation({
    mutationFn: (val) => setInformationOnly(meetingId, val),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] })
      invalidate()
    },
  })

  const createCategory = useMutation({
    mutationFn: (data) => createMeetingCategory(data),
    onSuccess:  (created) => {
      qc.invalidateQueries({ queryKey: ['meeting-categories', projectId] })
      setShowNewForm(false)
      setNewName('')
      setNewColor('#1B2A4A')
      if (!primaryId) setPrimary.mutate(created.id)
    },
  })

  const handleCreateCategory = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createCategory.mutateAsync({
        name:       newName.trim(),
        color:      newColor,
        project_id: newScope === 'project' ? projectId : null,
      })
    } finally { setSaving(false) }
  }

  if (loadingAssignments) return null

  return (
    <>
      <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A]">Meeting Type</p>
          <button
            onClick={() => toggleInfoOnly.mutate(!infoOnly)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              infoOnly
                ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                : 'border-[#e5e5e3] text-[#9b9b97] hover:border-amber-300 hover:text-amber-600'
            }`}
            title="Information-only meetings don't generate action items — they build context"
          >
            <span>{infoOnly ? '📖' : '○'}</span>
            <span>Info Only</span>
          </button>
        </div>

        {infoOnly && (
          <div className="mb-3 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-700">
            This meeting won't generate action items — it builds context and understanding only.
          </div>
        )}

        {/* ── Primary ──────────────────────────────────────────────────────── */}
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9b9b97] mb-1.5">Primary</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {primary && <CategoryBadge category={primary} />}
            <div className="relative">
              <button
                onClick={() => { setPrimaryPickerOpen(v => !v); setSecondaryPickerOpen(false) }}
                className="text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1 text-[#4a4a48] hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center gap-1"
              >
                {primary ? 'change' : '+ set primary'}
                <span className="text-[10px] opacity-50">▾</span>
              </button>
              {primaryPickerOpen && (
                <CategoryPickerPopover
                  categories={allCategories}
                  placeholder="Search categories…"
                  onSelect={cat => { setPrimary.mutate(cat.id); setPrimaryPickerOpen(false) }}
                  onClose={() => setPrimaryPickerOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Secondary ────────────────────────────────────────────────────── */}
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9b9b97] mb-1.5">Secondary</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {secondaries.map(cat => (
              <CategoryBadge
                key={cat.id}
                category={cat}
                small
                onRemove={() => removeSecondary.mutate(cat.id)}
              />
            ))}
            {availableForSecondary.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setSecondaryPickerOpen(v => !v); setPrimaryPickerOpen(false) }}
                  className="text-[10px] border border-dashed border-[#d5d5d3] text-[#9b9b97] px-2 py-0.5 rounded-full hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center gap-0.5"
                >
                  + add <span className="opacity-50">▾</span>
                </button>
                {secondaryPickerOpen && (
                  <CategoryPickerPopover
                    categories={availableForSecondary}
                    placeholder="Search categories…"
                    onSelect={cat => { addSecondary.mutate(cat.id); setSecondaryPickerOpen(false) }}
                    onClose={() => setSecondaryPickerOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer actions ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-1">
          {showNewForm ? (
            <div className="w-full border border-[#e5e5e3] rounded-xl p-3 bg-[#fafaf8]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">New Category</p>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Category name…"
                className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory() }}
              />
              <div className="flex flex-wrap gap-1.5 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: newColor === c ? '#1a1a18' : 'transparent' }}
                  />
                ))}
              </div>
              {projectId && (
                <div className="flex gap-2 mb-2">
                  {['global', 'project'].map(s => (
                    <button key={s} onClick={() => setNewScope(s)}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                        newScope === s ? 'bg-[#1a1a18] text-white border-[#1a1a18]' : 'border-[#e5e5e3] text-[#6b6b67]'
                      }`}
                    >
                      {s === 'global' ? 'Global (all projects)' : 'This project only'}
                    </button>
                  ))}
                </div>
              )}
              {newName && (
                <div className="mb-2">
                  <CategoryBadge category={{ name: newName, color: newColor }} small />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowNewForm(false); setNewName('') }}
                  className="flex-1 py-1.5 text-xs rounded-lg border border-[#e5e5e3] text-[#6b6b67]">
                  Cancel
                </button>
                <button onClick={handleCreateCategory} disabled={!newName.trim() || saving}
                  className="flex-1 py-1.5 text-xs rounded-lg bg-[#1a1a18] text-white font-medium disabled:opacity-40">
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => setShowNewForm(true)}
                className="text-xs text-[#9b9b97] hover:text-blue-500 transition-colors">
                + new category
              </button>
              <span className="text-[#e5e5e3]">·</span>
              <button onClick={() => setShowManageModal(true)}
                className="text-xs text-[#9b9b97] hover:text-[#1a1a18] transition-colors">
                manage
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Manage modal ─────────────────────────────────────────────────────── */}
      {showManageModal && (
        <CategoryManageModal
          allCategories={allCategories}
          projectId={projectId}
          onClose={() => setShowManageModal(false)}
          onRefresh={invalidateAll}
        />
      )}
    </>
  )
}
