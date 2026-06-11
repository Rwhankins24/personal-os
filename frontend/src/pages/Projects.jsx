import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProjects, createProject, mergeProject } from '../lib/api'

// ── Tag Input ─────────────────────────────────────────────────
function TagInput({ tags, onChange, placeholder = 'Add keyword…' }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  function addTag(val) {
    const trimmed = val.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  function removeTag(tag) {
    onChange(tags.filter(t => t !== tag))
  }

  return (
    <div
      className="min-h-[38px] flex flex-wrap gap-1.5 items-center px-2 py-1.5 border border-gray-200 rounded-lg bg-white cursor-text focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); removeTag(tag) }}
            className="text-blue-400 hover:text-blue-700 leading-none"
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addTag(input) }}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-[#1a1a18] placeholder-gray-400"
      />
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────
const STATUS_COLORS = {
  active:    'bg-green-100 text-green-700',
  pursuit:   'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-500',
  on_hold:   'bg-yellow-100 text-yellow-700',
  lost:      'bg-red-100 text-red-600',
}

function StatusBadge({ status }) {
  if (!status) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-500'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── New project modal ─────────────────────────────────────────
function NewProjectModal({ onClose }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '',
    client: '',
    type: '',
    status: 'active',
    keywords: [],
    description: '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${data.id}`)
    },
    onError: (err) => setError(err.message || 'Failed to create project'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Project name is required'); return }
    mutation.mutate({
      name: form.name.trim(),
      client: form.client.trim() || null,
      type: form.type || null,
      status: form.status,
      keywords: form.keywords,
      description: form.description.trim() || null,
    })
  }

  // Close on Escape
  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[#1a1a18]">New Project</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Project Name <span className="text-red-500">*</span></label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g., Amazon PHX Fulfillment Center"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client / Owner</label>
            <input
              value={form.client}
              onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
              placeholder="e.g., Amazon"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
              >
                <option value="">— Select —</option>
                <option value="industrial">Industrial</option>
                <option value="data_center">Data Center</option>
                <option value="student_housing">Student Housing</option>
                <option value="commercial">Commercial</option>
                <option value="mixed_use">Mixed Use</option>
                <option value="healthcare">Healthcare</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
              >
                <option value="active">Active</option>
                <option value="pursuit">Pursuit</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="lost">Lost</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keywords</label>
            <TagInput
              tags={form.keywords}
              onChange={kw => setForm(f => ({ ...f, keywords: kw }))}
              placeholder="Add keywords for intelligence matching…"
            />
            <p className="text-xs text-gray-400 mt-1">These drive AI email + meeting matching. Use project name, client name, location, etc.</p>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-4 py-2 text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="text-sm px-4 py-2 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-50"
            >
              {mutation.isPending ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Merge project modal ───────────────────────────────────────
function MergeProjectModal({ winner, allProjects, onClose }) {
  const qc = useQueryClient()
  const [loserId, setLoserId] = useState('')
  const [merging, setMerging] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const candidates = allProjects.filter(p => p.id !== winner.id && p.status !== 'archived')

  const handleMerge = async () => {
    if (!loserId) return
    setMerging(true)
    setError('')
    try {
      await mergeProject(winner.id, loserId)
      await qc.invalidateQueries({ queryKey: ['projects'] })
      setDone(true)
    } catch (e) {
      setError(e.message || 'Merge failed')
      setMerging(false)
    }
  }

  const loser = allProjects.find(p => p.id === loserId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[#1a1a18]">Merge Projects</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <div className="text-3xl">✅</div>
            <p className="text-sm font-semibold text-[#1a1a18]">Merge complete</p>
            <p className="text-xs text-gray-500">
              All tasks, emails, meetings, contacts, and intelligence from <strong>{loser?.name}</strong> have been moved to <strong>{winner.name}</strong>.
            </p>
            <button
              onClick={onClose}
              className="mt-2 text-sm px-4 py-2 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28]"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Winner */}
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">Keep (winner)</p>
              <div className="text-sm font-semibold text-[#1a1a18] bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {winner.name}
              </div>
            </div>

            {/* Loser picker */}
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">Merge into it (will be archived)</p>
              <select
                value={loserId}
                onChange={e => setLoserId(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
              >
                <option value="">Select project to absorb…</option>
                {candidates.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.status !== 'active' ? ` (${p.status})` : ''}</option>
                ))}
              </select>
            </div>

            {loserId && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                All tasks, emails, meetings, contacts, and intelligence from <strong>{loser?.name}</strong> will be re-assigned to <strong>{winner.name}</strong>. <strong>{loser?.name}</strong> will be archived.
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!loserId || merging}
                className="text-sm px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {merging ? 'Merging…' : 'Merge →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Projects page ─────────────────────────────────────────────
const STATUS_FILTERS = ['all', 'active', 'pursuit', 'on_hold', 'completed']

export default function Projects() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [mergeWinner, setMergeWinner] = useState(null) // project to merge INTO

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    refetchInterval: 300000,
  })

  const filtered = projects.filter(p => {
    const matchStatus = filter === 'all' || p.status === filter
    const q = search.toLowerCase().trim()
    const matchSearch = !q ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.client || '').toLowerCase().includes(q) ||
      (p.type || '').toLowerCase().includes(q) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    return matchStatus && matchSearch
  })

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-xs text-[#6b6b67] hover:text-[#1a1a18] px-2 py-1 rounded-lg hover:bg-gray-100"
            >
              ← Dashboard
            </Link>
            <span className="font-bold text-[#1a1a18] text-base tracking-tight">Projects</span>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28]"
          >
            <span className="text-lg leading-none">+</span> New Project
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects, clients, keywords…"
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          />
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  filter === s
                    ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
                    : 'bg-white text-[#6b6b67] border-gray-200 hover:border-gray-400'
                }`}
              >
                {s === 'on_hold' ? 'On Hold' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Project list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">
              {search || filter !== 'all' ? 'No projects match your filter.' : 'No projects yet.'}
            </p>
            {!search && filter === 'all' && (
              <button
                onClick={() => setShowModal(true)}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                Create your first project →
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-[#e5e5e3] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Project</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden sm:table-cell">Type</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden md:table-cell">Keywords</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden lg:table-cell">Risks</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-2.5 hidden lg:table-cell">Decisions</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const risks     = (p.risk_signals || []).filter(r => !r.checked_off)
                  const decisions = (p.decisions_made || [])
                  const keywords  = (p.keywords || [])
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className={`cursor-pointer hover:bg-blue-50 transition-colors ${i < filtered.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#1a1a18] leading-snug">{p.name}</p>
                        {p.client && <p className="text-xs text-gray-500 mt-0.5">{p.client}</p>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {p.type ? (
                          <span className="text-xs text-gray-500 capitalize">{p.type.replace('_', ' ')}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {keywords.slice(0, 3).map(k => (
                            <span key={k} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                              {k}
                            </span>
                          ))}
                          {keywords.length > 3 && (
                            <span className="text-xs text-gray-400">+{keywords.length - 3}</span>
                          )}
                          {keywords.length === 0 && <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {risks.length > 0 ? (
                          <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full">{risks.length}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {decisions.length > 0 ? (
                          <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full">{decisions.length}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); setMergeWinner(p) }}
                          className="text-[10px] text-gray-400 hover:text-amber-600 hover:bg-amber-50 px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                          title="Merge another project into this one"
                        >
                          Merge ↗
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {filtered.length > 0 && (
          <p className="text-xs text-gray-400 text-right">
            {filtered.length} project{filtered.length !== 1 ? 's' : ''}
            {filter !== 'all' || search ? ` (filtered from ${projects.length})` : ''}
          </p>
        )}
      </div>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} />}
      {mergeWinner && (
        <MergeProjectModal
          winner={mergeWinner}
          allProjects={projects}
          onClose={() => setMergeWinner(null)}
        />
      )}
    </div>
  )
}
