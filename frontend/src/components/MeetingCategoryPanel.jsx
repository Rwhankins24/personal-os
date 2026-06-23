// MeetingCategoryPanel — Primary + secondary category assignment + information-only toggle
// Saves immediately on every change. Sets needs_ai_reprocess on category changes.

import { useState } from 'react'
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

export default function MeetingCategoryPanel({ meetingId, projectId }) {
  const qc = useQueryClient()
  const [showNewForm, setShowNewForm]   = useState(false)
  const [newName, setNewName]           = useState('')
  const [newColor, setNewColor]         = useState('#1B2A4A')
  const [newScope, setNewScope]         = useState('global') // 'global' | 'project'
  const [showSecondaryPicker, setShowSecondaryPicker] = useState(false)
  const [saving, setSaving]             = useState(false)

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: allCategories = [] } = useQuery({
    queryKey: ['meeting-categories', projectId],
    queryFn:  () => getMeetingCategories(projectId),
  })

  const { data: assignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ['meeting-category-assignments', meetingId],
    queryFn:  () => getMeetingCategoryAssignments(meetingId),
    enabled:  !!meetingId,
  })

  const primary      = assignments?.primary || null
  const secondaries  = assignments?.secondaries || []
  const infoOnly     = assignments?.information_only ?? false

  // IDs already assigned as secondary (exclude from secondary picker)
  const secondaryIds = new Set(secondaries.map(c => c.id))
  const primaryId    = primary?.id

  // Categories available for secondary (not already primary, not already secondary)
  const availableForSecondary = allCategories.filter(
    c => c.id !== primaryId && !secondaryIds.has(c.id)
  )

  // ── Mutations ──────────────────────────────────────────────────────────────
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
    onSuccess: () => {
      setShowSecondaryPicker(false)
      invalidate()
    },
  })

  const removeSecondary = useMutation({
    mutationFn: (categoryId) => removeSecondaryCategory(meetingId, categoryId),
    onSuccess: invalidate,
  })

  const toggleInfoOnly = useMutation({
    mutationFn: (val) => setInformationOnly(meetingId, val),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] })
      invalidate()
    },
  })

  const createCategory = useMutation({
    mutationFn: (data) => createMeetingCategory(data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['meeting-categories', projectId] })
      setShowNewForm(false)
      setNewName('')
      setNewColor('#1B2A4A')
      // Immediately assign as primary if no primary set
      if (!primaryId) {
        setPrimary.mutate(created.id)
      }
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

      {/* Primary Category */}
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9b9b97] mb-1.5">Primary</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {primary ? (
            <CategoryBadge category={primary} />
          ) : (
            <span className="text-xs text-[#9b9b97] italic">None set</span>
          )}

          {/* Primary picker — inline dropdown */}
          <div className="relative">
            <select
              value={primaryId || ''}
              onChange={e => setPrimary.mutate(e.target.value || null)}
              className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 bg-white text-[#4a4a48] appearance-none pr-5 cursor-pointer hover:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath fill=\'%236b6b67\' d=\'M4 6l4 4 4-4\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }}
            >
              <option value="">— change primary —</option>
              {allCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.project_id ? ' (project)' : ''}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Secondary Categories */}
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

          {/* Add secondary */}
          {showSecondaryPicker ? (
            <div className="relative">
              <select
                autoFocus
                size={1}
                onChange={e => { if (e.target.value) addSecondary.mutate(e.target.value) }}
                defaultValue=""
                className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-white text-[#4a4a48] focus:outline-none focus:ring-1 focus:ring-blue-300"
                onBlur={() => setShowSecondaryPicker(false)}
              >
                <option value="" disabled>Pick category…</option>
                {availableForSecondary.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.project_id ? ' (project)' : ''}</option>
                ))}
              </select>
            </div>
          ) : (
            availableForSecondary.length > 0 && (
              <button
                onClick={() => setShowSecondaryPicker(true)}
                className="text-[10px] border border-dashed border-[#d5d5d3] text-[#9b9b97] px-2 py-0.5 rounded-full hover:border-blue-300 hover:text-blue-500 transition-colors"
              >
                + add
              </button>
            )
          )}
        </div>
      </div>

      {/* Create new category */}
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
                style={{
                  backgroundColor: c,
                  borderColor: newColor === c ? '#1a1a18' : 'transparent',
                }}
              />
            ))}
          </div>
          {/* Scope — only show project option if we have a projectId */}
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
          {/* Preview */}
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
