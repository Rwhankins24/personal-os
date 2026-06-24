// EntityCategoryPicker — lightweight single-category picker for knowledge entries,
// observations, and strategic decisions. Assigns meeting_category_id and routes
// the entity to the linked topic pod immediately on save.
//
// Props:
//   entityId        — UUID of the entity
//   currentCategoryId — current meeting_category_id value (or null)
//   onAssign        — fn(categoryId | null) called after successful save
//   align           — 'left' | 'right' (popover alignment, default 'left')

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMeetingCategories, getTopicPods } from '../lib/api'

export default function EntityCategoryPicker({ entityId, currentCategoryId, onAssign, align = 'left' }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  const { data: allCategories = [] } = useQuery({
    queryKey: ['meeting-categories', null],
    queryFn:  () => getMeetingCategories(null),
  })

  const { data: allPods = [] } = useQuery({
    queryKey: ['topic-pods', 'active'],
    queryFn:  () => getTopicPods('active'),
  })

  // Map category_id → pod name for display
  const categoryPodMap = new Map(
    allPods.filter(p => p.category_id).map(p => [p.category_id, p.name])
  )

  const currentCategory = allCategories.find(c => c.id === currentCategoryId) || null
  const linkedPodName   = currentCategoryId ? categoryPodMap.get(currentCategoryId) : null

  // Click-outside to close
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const q        = query.trim().toLowerCase()
  const filtered = q ? allCategories.filter(c => c.name.toLowerCase().includes(q)) : allCategories
  const projectScoped = filtered.filter(c => c.project_id)
  const global        = filtered.filter(c => !c.project_id)

  function renderGroup(label, items) {
    if (!items.length) return null
    return (
      <div key={label}>
        <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#9b9b97]">{label}</div>
        {items.map(cat => (
          <button
            key={cat.id}
            onMouseDown={e => {
              e.preventDefault()
              onAssign(cat.id)
              setOpen(false)
              setQuery('')
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#f5f4f2] rounded-lg transition-colors"
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
            <span className="text-xs text-[#1a1a18] flex-1">{cat.name}</span>
            {cat.id === currentCategoryId && <span className="text-[10px] text-blue-500">✓</span>}
            {categoryPodMap.has(cat.id) && (
              <span className="text-[9px] text-[#9b9b97]">→ {categoryPodMap.get(cat.id)}</span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative inline-block">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 transition-colors"
        title="Assign to a topic pod via category"
      >
        {currentCategory ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: currentCategory.color + '18',
              color:            currentCategory.color,
              border:           `1px solid ${currentCategory.color}40`,
            }}
          >
            {currentCategory.name}
            {linkedPodName && <span className="opacity-60">→ {linkedPodName}</span>}
            <span
              onMouseDown={e => { e.stopPropagation(); onAssign(null) }}
              className="ml-0.5 hover:opacity-60 cursor-pointer"
            >×</span>
          </span>
        ) : (
          <span className="text-[10px] text-[#9b9b97] hover:text-blue-500 border border-dashed border-[#d5d5d3] px-2 py-0.5 rounded-full hover:border-blue-300 transition-colors">
            + pod category
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className={`absolute z-50 top-full mt-1 w-64 bg-white border border-[#e5e5e3] rounded-xl shadow-lg py-2 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="px-2 pb-1.5">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search categories…"
              className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
            />
          </div>
          <div className="max-h-52 overflow-y-auto px-1">
            {currentCategory && (
              <button
                onMouseDown={e => { e.preventDefault(); onAssign(null); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg mb-1"
              >
                ✕ Remove category
              </button>
            )}
            {projectScoped.length > 0 && renderGroup('This Project', projectScoped)}
            {global.length > 0        && renderGroup('Global', global)}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#9b9b97] text-center">No matches</div>
            )}
          </div>
          <div className="px-3 pt-1.5 border-t border-[#f0f0ee] mt-1">
            <p className="text-[9px] text-[#9b9b97]">Categories with → will route this entry to that pod</p>
          </div>
        </div>
      )}
    </div>
  )
}
