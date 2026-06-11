import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getKnowledge, createKnowledge, updateKnowledge, deleteKnowledge } from '../lib/api'

// ── Category config ────────────────────────────────────────────
const CATEGORIES = [
  { value: 'domain_knowledge', label: 'Domain',        color: 'bg-blue-100 text-blue-700' },
  { value: 'project_lesson',   label: 'Project Lesson', color: 'bg-green-100 text-green-700' },
  { value: 'client_intel',     label: 'Client Intel',   color: 'bg-purple-100 text-purple-700' },
  { value: 'process',          label: 'Process',        color: 'bg-gray-100 text-gray-600' },
  { value: 'relationship',     label: 'Relationship',   color: 'bg-orange-100 text-orange-700' },
  { value: 'decision',         label: 'Decision',       color: 'bg-amber-100 text-amber-700' },
  { value: 'other',            label: 'Other',          color: 'bg-slate-100 text-slate-600' },
]

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]))

function CategoryBadge({ category }) {
  const cfg = CATEGORY_MAP[category]
  if (!cfg) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

// ── Add/Edit Modal ─────────────────────────────────────────────
function KnowledgeModal({ entry, onClose, onSave }) {
  const [form, setForm] = useState({
    topic:      entry?.topic      || '',
    category:   entry?.category   || 'domain_knowledge',
    context:    entry?.context    || '',
    resolution: entry?.resolution || '',
    applies_to: (entry?.applies_to || []).join(', '),
    status:     entry?.status     || 'active',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.topic.trim()) return
    setSaving(true)
    try {
      const payload = {
        topic:      form.topic.trim(),
        category:   form.category,
        context:    form.context.trim() || null,
        resolution: form.resolution.trim() || null,
        applies_to: form.applies_to
          .split(',')
          .map(t => t.trim())
          .filter(Boolean),
        status:     form.status,
      }
      await onSave(payload)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-t-2xl p-5 pb-8 shadow-xl"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#1a1a18]">
            {entry ? 'Edit Entry' : 'Add Knowledge Entry'}
          </h2>
          <button onClick={onClose} className="text-[#6b6b67] hover:text-[#1a1a18] text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Topic */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Topic *</label>
            <input
              value={form.topic}
              onChange={e => set('topic', e.target.value)}
              placeholder="Short title for this knowledge entry"
              required
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Category</label>
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Context */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Context</label>
            <textarea
              value={form.context}
              onChange={e => set('context', e.target.value)}
              placeholder="Background — what was the situation or issue?"
              rows={3}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Resolution / Learning</label>
            <textarea
              value={form.resolution}
              onChange={e => set('resolution', e.target.value)}
              placeholder="How it was resolved, what was learned"
              rows={3}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          {/* Applies To */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Applies To</label>
            <input
              value={form.applies_to}
              onChange={e => set('applies_to', e.target.value)}
              placeholder="Project names, contacts, tags — comma separated"
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="active">Active</option>
              <option value="proposed">Proposed</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !form.topic.trim()}
              className="flex-1 py-2.5 bg-[#1a1a18] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-gray-800 transition-colors"
            >
              {saving ? 'Saving…' : entry ? 'Save Changes' : 'Add Entry'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-[#6b6b67] hover:text-[#1a1a18] border border-[#e5e5e3] rounded-xl"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Entry Card ─────────────────────────────────────────────────
function EntryCard({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [showFull, setShowFull] = useState(false)

  const previewLen = 180

  return (
    <div
      className="bg-white border border-[#e5e5e3] rounded-2xl p-4 group cursor-pointer hover:border-gray-300 transition-colors"
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 flex-wrap flex-1 min-w-0">
          <span className="text-sm font-semibold text-[#1a1a18]">{entry.topic}</span>
          <CategoryBadge category={entry.category} />
        </div>
        {/* Edit/delete — visible on hover */}
        <div
          className="flex items-center gap-1 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => onEdit(entry)}
            className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100"
            title="Edit"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="text-xs text-[#6b6b67] hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
            title="Delete"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Applies-to tags */}
      {(entry.applies_to || []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {entry.applies_to.map((tag, i) => (
            <span key={i} className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Context */}
      {entry.context && (
        <div className="mb-2">
          <p className="text-xs font-medium text-[#6b6b67] uppercase tracking-wide mb-0.5">Context</p>
          <p className="text-sm text-[#1a1a18] leading-snug">
            {expanded || entry.context.length <= previewLen
              ? entry.context
              : `${entry.context.slice(0, previewLen)}…`}
          </p>
        </div>
      )}

      {/* Resolution */}
      {entry.resolution && (
        <div>
          <p className="text-xs font-medium text-[#6b6b67] uppercase tracking-wide mb-0.5">Resolution</p>
          <p className="text-sm text-[#1a1a18] leading-snug">
            {expanded || entry.resolution.length <= previewLen
              ? entry.resolution
              : `${entry.resolution.slice(0, previewLen)}…`}
          </p>
        </div>
      )}

      {/* Expand hint */}
      {!expanded && ((entry.context?.length > previewLen) || (entry.resolution?.length > previewLen)) && (
        <p className="text-xs text-blue-500 mt-1.5">Tap to expand</p>
      )}
      {expanded && (
        <p className="text-xs text-[#6b6b67] mt-1.5">Tap to collapse</p>
      )}
    </div>
  )
}

// ── Proposed entry row ─────────────────────────────────────────
function ProposedRow({ entry, onApprove, onEditApprove, onSkip }) {
  return (
    <div className="bg-white border border-amber-200 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[#1a1a18]">{entry.topic}</span>
          <CategoryBadge category={entry.category} />
        </div>
      </div>

      {entry.context && (
        <p className="text-xs text-[#6b6b67] line-clamp-2 mb-1">{entry.context}</p>
      )}
      {entry.resolution && (
        <p className="text-xs text-[#1a1a18] line-clamp-2 mb-2">{entry.resolution}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onApprove(entry)}
          className="text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onEditApprove(entry)}
          className="text-xs px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200 transition-colors"
        >
          Edit &amp; Approve
        </button>
        <button
          onClick={() => onSkip(entry.id)}
          className="text-xs px-2.5 py-1 text-[#6b6b67] hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────
export default function KnowledgePage() {
  const qc = useQueryClient()

  const [search,      setSearch]      = useState('')
  const [catFilter,   setCatFilter]   = useState('all')
  const [modal,       setModal]       = useState(null) // null | { mode: 'add' | 'edit', entry?: {} }
  const [editEntry,   setEditEntry]   = useState(null)

  const { data: active = [],   isLoading } = useQuery({
    queryKey: ['knowledge'],
    queryFn:  () => getKnowledge('active'),
    staleTime: 1000 * 60 * 2,
  })

  const { data: proposed = [] } = useQuery({
    queryKey: ['knowledge-proposed'],
    queryFn:  () => getKnowledge('proposed'),
    staleTime: 1000 * 60 * 2,
  })

  // ── Mutations ────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createKnowledge,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-proposed'] })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateKnowledge(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-proposed'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteKnowledge,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })

  // ── Handlers ─────────────────────────────────────────────────
  const handleAdd = () => setModal({ mode: 'add' })

  const handleEdit = (entry) => {
    setEditEntry(entry)
    setModal({ mode: 'edit', entry })
  }

  const handleDelete = (id) => {
    if (window.confirm('Delete this knowledge entry?')) {
      deleteMut.mutate(id)
    }
  }

  const handleSave = async (payload) => {
    if (modal?.mode === 'edit' && editEntry) {
      await updateMut.mutateAsync({ id: editEntry.id, data: payload })
    } else {
      await createMut.mutateAsync({ ...payload, proposed_by: 'manual' })
    }
  }

  const handleApprove = (entry) => {
    updateMut.mutate({ id: entry.id, data: { status: 'active' } })
  }

  const handleEditApprove = (entry) => {
    setEditEntry({ ...entry, status: 'active' })
    setModal({ mode: 'edit', entry: { ...entry, status: 'active' } })
  }

  const handleSkip = (id) => {
    updateMut.mutate({ id, data: { status: 'archived' } })
  }

  // ── Filtered entries ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return active.filter(e => {
      if (catFilter !== 'all' && e.category !== catFilter) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        e.topic?.toLowerCase().includes(q) ||
        e.context?.toLowerCase().includes(q) ||
        e.resolution?.toLowerCase().includes(q) ||
        (e.applies_to || []).some(t => t.toLowerCase().includes(q))
      )
    })
  }, [active, catFilter, search])

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-4xl mx-auto">

          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">← Dashboard</Link>
              <span className="text-[#e5e5e3]">|</span>
              <h1 className="text-base font-semibold text-[#1a1a18]">Knowledge Base</h1>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-[#6b6b67]">{active.length} {active.length === 1 ? 'entry' : 'entries'}</span>
              </div>
            </div>
            <button
              onClick={handleAdd}
              className="text-xs px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              + Add
            </button>
          </div>

          {/* Category filter pills */}
          <div className="flex items-center gap-1 flex-wrap mb-2">
            <button
              onClick={() => setCatFilter('all')}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                catFilter === 'all' ? 'bg-[#1a1a18] text-white' : 'text-[#6b6b67] hover:bg-gray-100'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCatFilter(catFilter === c.value ? 'all' : c.value)}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                  catFilter === c.value
                    ? `${c.color} ring-1 ring-inset ring-current`
                    : 'text-[#6b6b67] hover:bg-gray-100'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search topic, context, resolution, tags..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#e5e5e3] rounded-lg bg-white text-[#1a1a18] placeholder-[#6b6b67] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >×</button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">

        {/* Section A — Review Queue */}
        {proposed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl mb-3">
              <span className="text-sm">⚡</span>
              <p className="text-sm font-medium text-amber-800">
                {proposed.length} {proposed.length === 1 ? 'entry' : 'entries'} to review from last night's AI job
              </p>
            </div>
            <div className="space-y-2">
              {proposed.map(entry => (
                <ProposedRow
                  key={entry.id}
                  entry={entry}
                  onApprove={handleApprove}
                  onEditApprove={handleEditApprove}
                  onSkip={handleSkip}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section B — Active Knowledge */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-3xl mb-2">🧠</span>
            <p className="text-sm">
              {search || catFilter !== 'all'
                ? 'No entries match your filters'
                : 'No knowledge entries yet — add one to get started'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {modal && (
        <KnowledgeModal
          entry={modal.entry || null}
          onClose={() => { setModal(null); setEditEntry(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
