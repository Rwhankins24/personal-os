// MeetingCategoryPanel — Primary + secondary category assignment + information-only toggle
// Saves immediately on every change. Sets needs_ai_reprocess on category changes.

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
// Shared searchable popover for both primary and secondary assignment.
// Props:
//   categories   — full list to pick from (already filtered by caller)
//   onSelect     — fn(category) called on pick
//   onClose      — fn() called when popover should dismiss
//   projectId    — used for group label only
//   placeholder  — input placeholder text
function CategoryPickerPopover({ categories, onSelect, onClose, projectId, placeholder = 'Search…' }) {
  const [query, setQuery] = useState('')
  const inputRef  = useRef(null)
  const popoverRef = useRef(null)

  // Auto-focus search input
  useEffect(() => { inputRef.current?.focus() }, [])

  // Click-outside to close
  useEffect(() => {
    function handleClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Escape to close
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? categories.filter(c => c.name.toLowerCase().includes(q))
    : categories

  // Group: project-scoped first, then global
  const projectScoped = filtered.filter(c => c.project_id)
  const global        = filtered.filter(c => !c.project_id)

  function renderGroup(label, items) {
    if (!items.length) return null
    return (
      <div key={label} className="mb-1">
        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#9b9b97]">
          {label}
        </div>
        {items.map(cat => (
          <button
            key={cat.id}
            onMouseDown={e => { e.preventDefault(); onSelect(cat) }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#f5f4f2] rounded-lg transition-colors"
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: cat.color }}
            />
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
      {/* Search input */}
      <div className="px-2 pb-2">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
        />
      </div>

      {/* Category list */}
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

// ── Main panel ────────────────────────────────────────────────────────────────
export default function MeetingCategoryPanel({ meetingId, projectId }) {
  const qc = useQueryClient()

  // Picker open state
  const [primaryPickerOpen,   setPrimaryPickerOpen]   = useState(false)
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false)

  // New category form state
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newColor,    setNewColor]    = useState('#1B2A4A')
  const [newScope,    setNewScope]    = useState('global')
  const [saving,      setSaving]      = useState(false)

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

  const secondaryIds = new Set(secondaries.map(c => c.id))
  const primaryId    = primary?.id

  // Available for secondary: exclude already-primary and already-secondary
  const availableForSecondary = allCategories.filter(
    c => c.id !== primaryId && !secondaryIds.has(c.id)
  )
  // Available for primary: all categories (can change primary freely)
  const availableForPrimary = allCategories

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['meeting-category-assignments', meetingId] })
    qc.invalidateQueries({ queryKey: ['meeting', meetingId] })
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
    } finally {
      setSaving(false)
    }
  }

  if (loadingAssignments) return null

  return (
    <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-[#1B2A4A]">Meeting Type</p>

        {/* Information Only toggle */}
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

      {/* ── Primary Category ─────────────────────────────────────────────── */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9b9b97] mb-1.5">Primary</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {primary && <CategoryBadge category={primary} />}

          {/* Trigger button */}
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
                categories={availableForPrimary}
                projectId={projectId}
                placeholder="Search categories…"
                onSelect={cat => {
                  setPrimary.mutate(cat.id)
                  setPrimaryPickerOpen(false)
                }}
                onClose={() => setPrimaryPickerOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Secondary Categories ─────────────────────────────────────────── */}
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

          {/* Add secondary trigger */}
          {availableForSecondary.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setSecondaryPickerOpen(v => !v); setPrimaryPickerOpen(false) }}
                className="text-[10px] border border-dashed border-[#d5d5d3] text-[#9b9b97] px-2 py-0.5 rounded-full hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center gap-0.5"
              >
                + add
                <span className="opacity-50">▾</span>
              </button>

              {secondaryPickerOpen && (
                <CategoryPickerPopover
                  categories={availableForSecondary}
                  projectId={projectId}
                  placeholder="Search categories…"
                  onSelect={cat => {
                    addSecondary.mutate(cat.id)
                    setSecondaryPickerOpen(false)
                  }}
                  onClose={() => setSecondaryPickerOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Create new category ──────────────────────────────────────────── */}
      {showNewForm ? (
        <div className="mt-3 border border-[#e5e5e3] rounded-xl p-3 bg-[#fafaf8]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-2">New Category</p>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Category name…"
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
            onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory() }}
          />

          {/* Color picker */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: newColor === c ? '#1a1a18' : 'transparent' }}
              />
            ))}
          </div>

          {/* Scope — only show project option when inside a project */}
          {projectId && (
            <div className="flex gap-2 mb-2">
              {['global', 'project'].map(s => (
                <button
                  key={s}
                  onClick={() => setNewScope(s)}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                    newScope === s
                      ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
                      : 'border-[#e5e5e3] text-[#6b6b67]'
                  }`}
                >
                  {s === 'global' ? 'Global (all projects)' : 'This project only'}
                </button>
              ))}
            </div>
          )}

          {/* Preview badge */}
          {newName && (
            <div className="mb-2">
              <CategoryBadge category={{ name: newName, color: newColor }} small />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setShowNewForm(false); setNewName('') }}
              className="flex-1 py-1.5 text-xs rounded-lg border border-[#e5e5e3] text-[#6b6b67]"
            >Cancel</button>
            <button
              onClick={handleCreateCategory}
              disabled={!newName.trim() || saving}
              className="flex-1 py-1.5 text-xs rounded-lg bg-[#1a1a18] text-white font-medium disabled:opacity-40"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="text-xs text-[#9b9b97] hover:text-blue-500 transition-colors"
        >
          + new category
        </button>
      )}
    </div>
  )
}
