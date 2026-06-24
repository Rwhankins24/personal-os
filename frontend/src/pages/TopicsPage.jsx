import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTopicPods, createTopicPod, updateTopicPod, deleteTopicPod,
  getPodContent, addPodText, addPodFile, deletePodContent, synthesizePod,
  getMeetingCategories,
} from '../lib/api'

// ── Relative time helper ───────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (d > 1)  return `${d}d ago`
  if (d === 1) return 'yesterday'
  if (h >= 1)  return `${h}h ago`
  if (m >= 1)  return `${m}m ago`
  return 'just now'
}

const CONTENT_TYPE_META = {
  paste:        { label: 'Note',     color: 'bg-blue-100 text-blue-700',   icon: '📝' },
  upload:       { label: 'Document', color: 'bg-purple-100 text-purple-700', icon: '📄' },
  research:     { label: 'Research', color: 'bg-green-100 text-green-700', icon: '🔍' },
  meeting_link: { label: 'Meeting',  color: 'bg-amber-100 text-amber-700', icon: '🎙️' },
}

// ── New Pod Modal ──────────────────────────────────────────────
function NewPodModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', description: '', research_directive: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form); onClose() } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1a1a18]">New Topic Pod</h2>
            <p className="text-xs text-[#6b6b67] mt-0.5">A living research container that grows over time</p>
          </div>
          <button onClick={onClose} className="text-[#6b6b67] text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Topic Name *</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Fusion Energy, Data Center Cooling, Client X"
              required
              autoFocus
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="What is this topic and why are you tracking it?"
              rows={2}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">
              Research Directive <span className="text-[#aaa] font-normal">(nightly job will search for this)</span>
            </label>
            <textarea
              value={form.research_directive}
              onChange={e => set('research_directive', e.target.value)}
              placeholder="e.g. 'latest developments in fusion energy, key companies, DOE funding, construction implications'"
              rows={2}
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
            <p className="text-xs text-[#aaa] mt-1">
              The nightly job will search the web using this directive and add findings to the pod automatically.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving || !form.name.trim()}
              className="flex-1 py-2.5 bg-[#1a1a18] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-gray-800">
              {saving ? 'Creating…' : 'Create Pod'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm text-[#6b6b67] border border-[#e5e5e3] rounded-xl">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Add Content Sheet ──────────────────────────────────────────
function AddContentSheet({ podId, podName, onClose, onAdded }) {
  const [tab,      setTab]      = useState('paste') // 'paste' | 'upload'
  const [text,     setText]     = useState('')
  const [title,    setTitle]    = useState('')
  const [adding,   setAdding]   = useState(false)
  const [error,    setError]    = useState(null)
  const fileRef = useRef(null)

  const handlePaste = async () => {
    if (!text.trim()) return
    setAdding(true); setError(null)
    try {
      await addPodText(podId, { text, title: title.trim() || null, content_type: 'paste' })
      onAdded()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setAdding(false)
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAdding(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (title.trim()) fd.append('title', title.trim())
      await addPodFile(podId, fd)
      onAdded()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl p-5 shadow-xl" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1a1a18]">Add to "{podName}"</h2>
            <p className="text-xs text-[#6b6b67] mt-0.5">Paste text or upload a document</p>
          </div>
          <button onClick={onClose} className="text-[#6b6b67] text-xl">×</button>
        </div>

        {/* Tab toggle */}
        <div className="flex gap-1 mb-4 bg-[#f3f3f1] rounded-lg p-1">
          {['paste', 'upload'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${tab === t ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b67]'}`}>
              {t === 'paste' ? '📋 Paste Text' : '📎 Upload File'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Title <span className="text-[#aaa] font-normal">(optional)</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. 'DOE Fusion Report Q2 2026' or 'Client call notes'"
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {tab === 'paste' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-[#6b6b67] mb-1">Text *</label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Paste an article, notes, a quote, anything relevant to this topic…"
                  rows={7}
                  autoFocus
                  className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 text-[#1a1a18] focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={handlePaste} disabled={adding || !text.trim()}
                className="w-full py-2.5 bg-[#1a1a18] text-white text-sm font-medium rounded-xl disabled:opacity-40 hover:bg-gray-800">
                {adding ? 'Processing…' : 'Extract & Add'}
              </button>
            </>
          ) : (
            <>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={handleFile} />
              <button onClick={() => fileRef.current?.click()} disabled={adding}
                className="w-full py-4 border-2 border-dashed border-[#e5e5e3] rounded-xl text-sm text-[#6b6b67] hover:border-gray-400 hover:text-[#1a1a18] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                {adding ? (
                  <><span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" /> Extracting…</>
                ) : (
                  <>📎 Choose PDF, DOCX, or TXT</>
                )}
              </button>
              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pod Detail View ────────────────────────────────────────────
function PodDetail({ pod, onBack, onUpdated }) {
  const qc      = useQueryClient()
  const [view,  setView]    = useState('synthesis') // 'synthesis' | 'feed'
  const [addOpen, setAddOpen] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [categoryQuery, setCategoryQuery] = useState('')
  const catPickerRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (catPickerRef.current && !catPickerRef.current.contains(e.target)) {
        setCategoryPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const { data: contents = [], isLoading: loadingContent, refetch: refetchContent } = useQuery({
    queryKey: ['pod-content', pod.id],
    queryFn:  () => getPodContent(pod.id),
    staleTime: 1000 * 30,
  })

  // All categories for the link picker
  const { data: allCategories = [] } = useQuery({
    queryKey: ['meeting-categories', null],
    queryFn:  () => getMeetingCategories(null),
  })

  const linkedCategory = allCategories.find(c => c.id === pod.category_id) || null

  const updatePodMut = useMutation({
    mutationFn: (updates) => updateTopicPod(pod.id, updates),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
      onUpdated()
    },
  })

  const filteredCategories = categoryQuery.trim()
    ? allCategories.filter(c => c.name.toLowerCase().includes(categoryQuery.toLowerCase()))
    : allCategories

  const deleteMut = useMutation({
    mutationFn: (contentId) => deletePodContent(pod.id, contentId),
    onSuccess:  () => { refetchContent(); qc.invalidateQueries({ queryKey: ['topic-pods'] }) },
  })

  const handleSynthesize = async () => {
    setSynthesizing(true)
    try {
      await synthesizePod(pod.id)
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
      onUpdated()
    } finally {
      setSynthesizing(false)
    }
  }

  const sections = pod.synthesis_bullets || []

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0f1923] px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <button onClick={onBack} className="text-xs text-[#C9A84C] mb-2 hover:text-amber-300 transition-colors">← All Topics</button>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-white leading-tight">{pod.name}</h1>
              {pod.description && <p className="text-xs text-[#8899aa] mt-1 leading-relaxed">{pod.description}</p>}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-xs text-[#8899aa]">{pod.content_count || contents.length} items</span>
                {pod.last_synthesized_at && (
                  <span className="text-xs text-[#8899aa]">Synthesized {timeAgo(pod.last_synthesized_at)}</span>
                )}
                {pod.last_researched_at && (
                  <span className="text-xs text-green-400">🔍 Researched {timeAgo(pod.last_researched_at)}</span>
                )}

                {/* Category link — auto-routing indicator */}
                <div className="relative" ref={catPickerRef}>
                  <button
                    onClick={() => setCategoryPickerOpen(v => !v)}
                    className="flex items-center gap-1 text-xs transition-colors"
                    title="Link this pod to a category — meetings with this category will auto-route here"
                  >
                    {linkedCategory ? (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ backgroundColor: linkedCategory.color + '28', color: linkedCategory.color, border: `1px solid ${linkedCategory.color}50` }}
                      >
                        ⟲ {linkedCategory.name}
                      </span>
                    ) : (
                      <span className="text-[#8899aa] hover:text-[#C9A84C] text-[10px]">+ link category</span>
                    )}
                  </button>

                  {categoryPickerOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-white border border-[#e5e5e3] rounded-xl shadow-lg py-2">
                      <div className="px-2 pb-1.5">
                        <input
                          autoFocus
                          value={categoryQuery}
                          onChange={e => setCategoryQuery(e.target.value)}
                          placeholder="Search categories…"
                          className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto px-1">
                        {linkedCategory && (
                          <button
                            onMouseDown={e => { e.preventDefault(); updatePodMut.mutate({ category_id: null }); setCategoryPickerOpen(false) }}
                            className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg"
                          >
                            ✕ Remove link
                          </button>
                        )}
                        {filteredCategories.map(cat => (
                          <button
                            key={cat.id}
                            onMouseDown={e => {
                              e.preventDefault()
                              updatePodMut.mutate({ category_id: cat.id })
                              setCategoryPickerOpen(false)
                              setCategoryQuery('')
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#f5f4f2] rounded-lg"
                          >
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                            <span className="text-xs text-[#1a1a18]">{cat.name}</span>
                            {cat.id === pod.category_id && <span className="ml-auto text-[10px] text-blue-500">✓</span>}
                          </button>
                        ))}
                        {filteredCategories.length === 0 && (
                          <div className="px-3 py-2 text-xs text-[#9b9b97]">No matches</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => setAddOpen(true)}
              className="flex-shrink-0 px-3 py-1.5 bg-[#C9A84C] text-[#0f1923] text-xs font-bold rounded-lg hover:bg-amber-400 transition-colors"
            >
              + Add
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-4">
            {[['synthesis', '✦ Synthesis'], ['feed', `📂 Feed (${contents.length})`]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${view === v ? 'bg-white/10 text-white' : 'text-[#8899aa] hover:text-white'}`}>
                {label}
              </button>
            ))}
            <button
              onClick={handleSynthesize}
              disabled={synthesizing || contents.length === 0}
              className="ml-auto px-3 py-1.5 text-xs text-[#C9A84C] hover:text-amber-300 disabled:opacity-40 transition-colors"
            >
              {synthesizing ? '↻ Regenerating…' : '↻ Regenerate'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 pb-36">
        {/* SYNTHESIS VIEW */}
        {view === 'synthesis' && (
          <div className="space-y-4">
            {!pod.synthesis && !pod.synthesis_bullets ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="text-4xl mb-3">✦</span>
                <p className="text-sm font-medium text-[#1a1a18] mb-1">No synthesis yet</p>
                <p className="text-xs text-[#6b6b67] mb-4 max-w-xs">
                  {contents.length === 0
                    ? 'Add some content to this pod first — paste text, upload a doc, or wait for the nightly research run.'
                    : 'Content is ready. Tap "Regenerate" to generate your first synthesis.'}
                </p>
                {contents.length > 0 && (
                  <button onClick={handleSynthesize} disabled={synthesizing}
                    className="px-4 py-2 bg-[#1a1a18] text-white text-sm rounded-xl disabled:opacity-40">
                    {synthesizing ? 'Generating…' : 'Generate Synthesis'}
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Narrative summary */}
                {pod.synthesis && (
                  <div className="bg-[#0f1923] rounded-2xl p-5">
                    <p className="text-xs text-[#C9A84C] uppercase tracking-widest mb-3 font-medium">Overview</p>
                    <p className="text-sm text-[#e8eef8] leading-relaxed whitespace-pre-wrap">{pod.synthesis}</p>
                  </div>
                )}

                {/* Structured sections */}
                {sections.map((section, i) => (
                  <div key={i} className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-[#1a1a18] uppercase tracking-wide mb-3">{section.title}</p>
                    <ul className="space-y-2">
                      {(section.bullets || []).map((bullet, j) => (
                        <li key={j} className="flex items-start gap-2">
                          <span className="text-[#C9A84C] mt-0.5 flex-shrink-0">•</span>
                          <span className="text-sm text-[#1a1a18] leading-snug">{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* FEED VIEW */}
        {view === 'feed' && (
          <div className="space-y-3">
            {loadingContent ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              </div>
            ) : contents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <span className="text-3xl mb-2">📭</span>
                <p className="text-sm">Nothing here yet — add content to get started</p>
              </div>
            ) : (
              contents.map(item => {
                const meta   = CONTENT_TYPE_META[item.content_type] || CONTENT_TYPE_META.paste
                const points = item.extracted_points || []
                return (
                  <div key={item.id} className="bg-white border border-[#e5e5e3] rounded-2xl p-4 group">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <span className="text-base">{meta.icon}</span>
                        <span className="text-sm font-medium text-[#1a1a18]">
                          {item.title || item.source_label || item.content_type}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-[#aaa]">{timeAgo(item.created_at)}</span>
                        <button
                          onClick={() => deleteMut.mutate(item.id)}
                          className="text-xs text-[#aaa] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {points.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {points.map((p, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className={`text-xs mt-0.5 flex-shrink-0 ${
                              p.significance === 'high'   ? 'text-red-500' :
                              p.significance === 'medium' ? 'text-amber-500' :
                              'text-gray-400'
                            }`}>●</span>
                            <span className="text-sm text-[#1a1a18] leading-snug">{p.point}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Add content sheet */}
      {addOpen && (
        <AddContentSheet
          podId={pod.id}
          podName={pod.name}
          onClose={() => setAddOpen(false)}
          onAdded={() => { refetchContent(); qc.invalidateQueries({ queryKey: ['topic-pods'] }); onUpdated() }}
        />
      )}
    </div>
  )
}

// ── Pod list card ──────────────────────────────────────────────
function PodCard({ pod, onClick, onDelete }) {
  const sections = pod.synthesis_bullets || []

  return (
    <div
      className="bg-white border border-[#e5e5e3] rounded-2xl p-4 cursor-pointer hover:border-gray-300 transition-colors group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[#1a1a18]">{pod.name}</span>
          {pod.description && (
            <p className="text-xs text-[#6b6b67] mt-0.5 line-clamp-1">{pod.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button onClick={() => onDelete(pod.id)} className="text-xs text-[#aaa] hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50">Delete</button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span className="text-xs text-[#6b6b67]">{pod.content_count || 0} items</span>
        {pod.last_synthesized_at && (
          <span className="text-xs text-[#6b6b67]">✦ {timeAgo(pod.last_synthesized_at)}</span>
        )}
        {pod.last_researched_at && (
          <span className="text-xs text-green-600">🔍 {timeAgo(pod.last_researched_at)}</span>
        )}
        {pod.research_directive && (
          <span className="text-xs text-blue-500">↺ Nightly research on</span>
        )}
      </div>

      {/* Synthesis preview */}
      {pod.synthesis ? (
        <p className="text-xs text-[#6b6b67] leading-relaxed line-clamp-2">{pod.synthesis}</p>
      ) : (
        <p className="text-xs text-[#aaa] italic">No synthesis yet — add content to get started</p>
      )}

      {/* Section chips */}
      {sections.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-2">
          {sections.slice(0, 4).map((s, i) => (
            <span key={i} className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">{s.title}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────
export default function TopicsPage() {
  const qc = useQueryClient()
  const [newModal,    setNewModal]    = useState(false)
  const [activePod,   setActivePod]   = useState(null)

  const { data: pods = [], isLoading, refetch } = useQuery({
    queryKey: ['topic-pods'],
    queryFn:  () => getTopicPods('active'),
    staleTime: 1000 * 60,
  })

  const createMut = useMutation({
    mutationFn: createTopicPod,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['topic-pods'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteTopicPod,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['topic-pods'] }),
  })

  // If a pod is open, show detail view
  if (activePod) {
    // Get the fresh pod data from the list
    const freshPod = pods.find(p => p.id === activePod.id) || activePod
    return (
      <PodDetail
        pod={freshPod}
        onBack={() => setActivePod(null)}
        onUpdated={() => refetch()}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">← Dashboard</Link>
            <span className="text-[#e5e5e3]">|</span>
            <h1 className="text-base font-semibold text-[#1a1a18]">Topic Intelligence</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-[#6b6b67]">{pods.length} {pods.length === 1 ? 'pod' : 'pods'}</span>
            </div>
          </div>
          <button
            onClick={() => setNewModal(true)}
            className="text-xs px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            + New Topic
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-4 pb-36">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : pods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-5xl mb-4">✦</span>
            <h2 className="text-base font-semibold text-[#1a1a18] mb-2">No topic pods yet</h2>
            <p className="text-sm text-[#6b6b67] max-w-xs mb-6 leading-relaxed">
              Create a pod for anything you want to track over time — fusion energy, a technology, a client, a market.
              Feed it with articles, docs, and notes. It builds a living synthesis.
            </p>
            <button onClick={() => setNewModal(true)}
              className="px-5 py-2.5 bg-[#1a1a18] text-white text-sm font-medium rounded-xl hover:bg-gray-800">
              Create your first pod
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {pods.map(pod => (
              <PodCard
                key={pod.id}
                pod={pod}
                onClick={() => setActivePod(pod)}
                onDelete={(id) => {
                  if (window.confirm('Delete this topic pod and all its content?')) deleteMut.mutate(id)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {newModal && (
        <NewPodModal
          onClose={() => setNewModal(false)}
          onSave={(data) => createMut.mutateAsync(data)}
        />
      )}
    </div>
  )
}
