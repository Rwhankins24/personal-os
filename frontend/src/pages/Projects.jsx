import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getProjects, createProject, mergeProject, getWorkspaces,
  getMeetingCategories, createMeetingCategory, updateMeetingCategory,
  deleteMeetingCategory, mergeMeetingCategories,
  getTopicPods, createTopicPod, updateTopicPod, deleteTopicPod,
  getKnowledge, createKnowledge,
} from '../lib/api'
import WorkspaceBar from '../components/WorkspaceBar'
import { useStore } from '../store/useStore'

const CAT_COLORS = [
  '#7F77DD','#1D9E75','#D85A30','#378ADD',
  '#BA7517','#D4537E','#639922','#E24B4A',
  '#5F5E5A','#C9A84C',
]

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
  const { workspace } = useStore()
  const { data: workspaces = [] } = useQuery({ queryKey: ['workspaces'], queryFn: getWorkspaces, staleTime: Infinity })
  const defaultWorkspaceId = workspaces.find(w => w.name === workspace && workspace !== 'all')?.id || null
  const [form, setForm] = useState({
    name: '',
    client: '',
    type: '',
    status: 'active',
    keywords: [],
    description: '',
    workspace_id: defaultWorkspaceId,
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
      workspace_id: form.workspace_id || null,
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

          {workspaces.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Workspace</label>
              <div className="flex gap-2">
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, workspace_id: ws.id }))}
                    className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors"
                    style={
                      form.workspace_id === ws.id
                        ? { backgroundColor: ws.color, borderColor: ws.color, color: 'white' }
                        : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {ws.name}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">Keep (winner)</p>
              <div className="text-sm font-semibold text-[#1a1a18] bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {winner.name}
              </div>
            </div>

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

// ── shared label style ────────────────────────────────────────
const tabLabelCls = 'text-[9px] font-bold uppercase tracking-widest text-[#9b9b97]'

// ── Categories Tab ────────────────────────────────────────────
function CategoriesTab() {
  const qc = useQueryClient()
  const { data: globalCats = [], isLoading } = useQuery({
    queryKey: ['meeting-categories'],
    queryFn: () => getMeetingCategories(),
  })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })

  // ── Project selector ──────────────────────────────────────────
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const selectedProject = projects.find(p => p.id === selectedProjectId) || null

  const { data: projectCats = [], isLoading: projectCatsLoading } = useQuery({
    queryKey: ['meeting-categories', selectedProjectId],
    queryFn:  () => getMeetingCategories(selectedProjectId),
    enabled:  !!selectedProjectId,
  })

  // All categories visible in merge dropdown = global + currently-shown project cats
  const allCatsForMerge = [...globalCats, ...projectCats.filter(pc => !globalCats.find(c => c.id === pc.id))]

  const [editingId,   setEditingId]   = useState(null)
  const [editName,    setEditName]    = useState('')
  const [editColor,   setEditColor]   = useState('#7F77DD')
  const [editSaving,  setEditSaving]  = useState(false)
  const [editError,   setEditError]   = useState(null)
  const [mergeId,     setMergeId]     = useState(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeSaving, setMergeSaving] = useState(false)
  const [mergeError,  setMergeError]  = useState(null)
  const [newMode,    setNewMode]    = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newColor,   setNewColor]   = useState('#7F77DD')
  const [newScope,   setNewScope]   = useState('global') // 'global' | 'project'
  const [newSaving,  setNewSaving]  = useState(false)
  const [newError,   setNewError]   = useState(null)

  const startEdit = (cat) => { setEditingId(cat.id); setEditName(cat.name); setEditColor(cat.color || '#7F77DD'); setEditError(null) }

  const saveEdit = async (id) => {
    if (!editName.trim() || editSaving) return
    setEditSaving(true); setEditError(null)
    try {
      await updateMeetingCategory(id, { name: editName.trim(), color: editColor })
      qc.invalidateQueries({ queryKey: ['meeting-categories'] })
      setEditingId(null)
    } catch (err) {
      setEditError(err?.response?.data?.error || err?.message || 'Failed to save')
    } finally { setEditSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this category? All meeting assignments will be removed.')) return
    try {
      await deleteMeetingCategory(id)
      qc.invalidateQueries({ queryKey: ['meeting-categories'] })
    } catch (err) { alert(err?.response?.data?.error || err?.message || 'Failed to delete') }
  }

  const handleMerge = async () => {
    if (!mergeTarget || mergeSaving) return
    setMergeSaving(true); setMergeError(null)
    try {
      await mergeMeetingCategories(mergeId, mergeTarget)
      qc.invalidateQueries({ queryKey: ['meeting-categories'] })
      setMergeId(null); setMergeTarget('')
    } catch (err) {
      setMergeError(err?.response?.data?.error || err?.message || 'Failed to merge')
    } finally { setMergeSaving(false) }
  }

  const handleCreate = async () => {
    if (!newName.trim() || newSaving) return
    if (newScope === 'project' && !selectedProjectId) {
      setNewError('Select a project above first'); return
    }
    setNewSaving(true); setNewError(null)
    try {
      await createMeetingCategory({
        name:       newName.trim(),
        color:      newColor,
        project_id: newScope === 'project' ? selectedProjectId : null,
      })
      qc.invalidateQueries({ queryKey: ['meeting-categories'] })
      setNewMode(false); setNewName(''); setNewColor('#7F77DD'); setNewScope('global')
    } catch (err) {
      setNewError(err?.response?.data?.error || err?.message || 'Failed to create')
    } finally { setNewSaving(false) }
  }

  // Shared category chip renderer
  const renderCatChip = (cat) => (
    <div key={cat.id} className="group bg-white border border-[#e5e5e3] rounded-xl px-3 py-2 flex items-center gap-2 min-w-0">
      {editingId === cat.id ? (
        <div className="flex flex-col gap-1.5 min-w-[180px]">
          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(cat.id); if (e.key === 'Escape') setEditingId(null) }}
            className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300" />
          <div className="flex flex-wrap gap-1">
            {CAT_COLORS.map(c => (
              <button key={c} onClick={() => setEditColor(c)}
                className="w-4 h-4 rounded-full border-2 transition-all"
                style={{ backgroundColor: c, borderColor: editColor === c ? '#1a1a18' : 'transparent' }} />
            ))}
          </div>
          {editError && <p className="text-[10px] text-red-600">{editError}</p>}
          <div className="flex gap-1">
            <button onClick={() => setEditingId(null)}
              className="flex-1 text-[10px] py-0.5 rounded border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={() => saveEdit(cat.id)} disabled={editSaving}
              className="flex-1 text-[10px] py-0.5 rounded bg-[#1a1a18] text-white disabled:opacity-40">
              {editSaving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || '#64748b' }} />
          <span className="text-xs text-[#1a1a18] font-medium truncate max-w-[140px]">{cat.name}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={() => startEdit(cat)} title="Edit name"
              className="text-[10px] text-[#6b6b67] hover:text-[#1a1a18] px-1">✎</button>
            <button onClick={() => { setMergeId(cat.id); setMergeTarget(''); setMergeError(null) }} title="Merge into another"
              className="text-[10px] text-[#6b6b67] hover:text-[#C9A84C] px-1">⇢</button>
            <button onClick={() => handleDelete(cat.id)} title="Delete"
              className="text-[10px] text-[#6b6b67] hover:text-red-500 px-1">×</button>
          </div>
        </>
      )}
    </div>
  )

  if (isLoading) return <p className="text-xs text-[#9b9b97] py-4 text-center">Loading…</p>

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <p className={tabLabelCls}>{globalCats.length} global{selectedProjectId && projectCats.length ? ` · ${projectCats.length} project-scoped` : ''}</p>
        <button onClick={() => { setNewMode(true); setNewError(null) }}
          className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a18] text-white hover:bg-gray-800 transition-colors">
          + New Category
        </button>
      </div>

      {/* Project selector */}
      <div className="mb-3">
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 w-full max-w-xs">
          <option value="">Show project-scoped categories…</option>
          {projects.filter(p => p.status === 'active' || !p.status).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* New category form */}
      {newMode && (
        <div className="bg-[#f8f8f6] border border-[#e5e5e3] rounded-xl p-3 mb-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New category</p>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Category name…"
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
          <div className="flex flex-wrap gap-1.5 mb-2">
            {CAT_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full border-2 transition-all"
                style={{ backgroundColor: c, borderColor: newColor === c ? '#1a1a18' : 'transparent' }} />
            ))}
          </div>
          {/* Scope buttons — project only available when project is selected */}
          <div className="flex gap-1.5 mb-2">
            <button onClick={() => setNewScope('global')}
              className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${newScope === 'global' ? 'bg-[#1a1a18] text-white border-[#1a1a18]' : 'border-[#e5e5e3] text-[#6b6b67]'}`}>
              Global
            </button>
            <button onClick={() => setNewScope('project')} disabled={!selectedProjectId}
              title={!selectedProjectId ? 'Select a project above first' : undefined}
              className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${newScope === 'project' ? 'bg-[#1B2A4A] text-white border-[#1B2A4A]' : 'border-[#e5e5e3] text-[#6b6b67]'} ${!selectedProjectId ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {selectedProject ? selectedProject.name : 'This project'}
            </button>
          </div>
          {newError && <p className="text-[10px] text-red-600 mb-1">{newError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setNewMode(false); setNewName(''); setNewError(null); setNewScope('global') }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim() || newSaving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#C9A84C] text-white disabled:opacity-40 hover:bg-[#b8943d] transition-colors">
              {newSaving ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Merge panel */}
      {mergeId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-2">
            Merge "{allCatsForMerge.find(c => c.id === mergeId)?.name}" into…
          </p>
          <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)}
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 mb-2 bg-white focus:outline-none">
            <option value="">Pick target category…</option>
            {allCatsForMerge.filter(c => c.id !== mergeId).map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.project_id ? ' (project)' : ''}</option>
            ))}
          </select>
          {mergeError && <p className="text-[10px] text-red-600 mb-1">{mergeError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setMergeId(null); setMergeTarget(''); setMergeError(null) }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={handleMerge} disabled={!mergeTarget || mergeSaving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700 transition-colors">
              {mergeSaving ? '…' : 'Merge & delete source'}
            </button>
          </div>
        </div>
      )}

      {/* Global categories section */}
      <div className="mb-4">
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#9b9b97] mb-2">Global</p>
        <div className="flex flex-wrap gap-2">
          {globalCats.map(cat => renderCatChip(cat))}
        </div>
        {globalCats.length === 0 && <p className="text-xs text-[#9b9b97] py-3 text-center">No global categories yet</p>}
      </div>

      {/* Project-scoped categories section */}
      {selectedProjectId && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#9b9b97] mb-2">
            {selectedProject?.name || 'Project'} — scoped
          </p>
          {projectCatsLoading
            ? <p className="text-xs text-[#9b9b97] py-2">Loading…</p>
            : (
              <div className="flex flex-wrap gap-2">
                {projectCats.map(cat => renderCatChip(cat))}
                {projectCats.length === 0 && (
                  <p className="text-xs text-[#9b9b97] py-3">No project-scoped categories for this project yet — create one above with "This project" scope.</p>
                )}
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}

// ── Topic Pods Tab ────────────────────────────────────────────
function PodRow({ pod, editingId, editName, editError, editSaving, onStartEdit, onEditName, onSaveEdit, onCancelEdit, onDelete }) {
  const isEditing = editingId === pod.id
  return (
    <div className="bg-white border border-[#e5e5e3] rounded-xl px-3 py-2.5">
      {isEditing ? (
        <div className="flex flex-col gap-1.5">
          <input autoFocus value={editName} onChange={e => onEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(pod.id); if (e.key === 'Escape') onCancelEdit() }}
            className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300" />
          {editError && <p className="text-[10px] text-red-600">{editError}</p>}
          <div className="flex gap-1">
            <button onClick={onCancelEdit}
              className="flex-1 text-[10px] py-0.5 rounded border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={() => onSaveEdit(pod.id)} disabled={editSaving}
              className="flex-1 text-[10px] py-0.5 rounded bg-[#1a1a18] text-white disabled:opacity-40">
              {editSaving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-medium text-[#1a1a18] truncate">{pod.name}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                pod.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-[#6b6b67]'
              }`}>{pod.status || 'active'}</span>
            </div>
            {pod.description && <p className="text-[11px] text-[#6b6b67] leading-relaxed">{pod.description}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onStartEdit(pod)}
              className="text-[10px] text-[#6b6b67] hover:text-[#1a1a18] px-1.5 py-1 rounded hover:bg-[#f5f4f2]">✎</button>
            <button onClick={() => onDelete(pod.id)}
              className="text-[10px] text-[#6b6b67] hover:text-red-500 px-1.5 py-1 rounded hover:bg-red-50">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

function TopicPodsTab() {
  const qc = useQueryClient()
  const { data: pods = [], isLoading } = useQuery({
    queryKey: ['topic-pods', 'all'],
    queryFn: () => getTopicPods('all'),
  })
  const [editingId,  setEditingId]  = useState(null)
  const [editName,   setEditName]   = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError,  setEditError]  = useState(null)
  const [newMode,    setNewMode]    = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newDesc,    setNewDesc]    = useState('')
  const [newSaving,  setNewSaving]  = useState(false)
  const [newError,   setNewError]   = useState(null)

  const saveEdit = async (id) => {
    if (!editName.trim() || editSaving) return
    setEditSaving(true); setEditError(null)
    try {
      await updateTopicPod(id, { name: editName.trim() })
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
      setEditingId(null)
    } catch (err) {
      setEditError(err?.response?.data?.error || err?.message || 'Failed to save')
    } finally { setEditSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this pod? This cannot be undone.')) return
    try {
      await deleteTopicPod(id)
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
    } catch (err) { alert(err?.response?.data?.error || err?.message || 'Failed to delete') }
  }

  const handleCreate = async () => {
    if (!newName.trim() || newSaving) return
    setNewSaving(true); setNewError(null)
    try {
      await createTopicPod({ name: newName.trim(), description: newDesc.trim() || null, status: 'active' })
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
      setNewMode(false); setNewName(''); setNewDesc('')
    } catch (err) {
      setNewError(err?.response?.data?.error || err?.message || 'Failed to create')
    } finally { setNewSaving(false) }
  }

  if (isLoading) return <p className="text-xs text-[#9b9b97] py-4 text-center">Loading…</p>

  const activePods   = pods.filter(p => p.status !== 'archived')
  const archivedPods = pods.filter(p => p.status === 'archived')

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={tabLabelCls}>{pods.length} pods</p>
        <button onClick={() => { setNewMode(true); setNewError(null) }}
          className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a18] text-white hover:bg-gray-800 transition-colors">
          + New Pod
        </button>
      </div>

      {newMode && (
        <div className="bg-[#f8f8f6] border border-[#e5e5e3] rounded-xl p-3 mb-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New pod</p>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Pod name…"
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)…"
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
          {newError && <p className="text-[10px] text-red-600 mb-1">{newError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setNewMode(false); setNewName(''); setNewDesc(''); setNewError(null) }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim() || newSaving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#C9A84C] text-white disabled:opacity-40 hover:bg-[#b8943d] transition-colors">
              {newSaving ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {activePods.map(pod => (
          <PodRow key={pod.id} pod={pod} editingId={editingId} editName={editName} editError={editError}
            editSaving={editSaving}
            onStartEdit={p => { setEditingId(p.id); setEditName(p.name); setEditError(null) }}
            onEditName={setEditName} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} onDelete={handleDelete} />
        ))}
        {archivedPods.length > 0 && (
          <>
            <p className={`${tabLabelCls} mt-4 mb-2`}>Archived</p>
            {archivedPods.map(pod => (
              <PodRow key={pod.id} pod={pod} editingId={editingId} editName={editName} editError={editError}
                editSaving={editSaving}
                onStartEdit={p => { setEditingId(p.id); setEditName(p.name); setEditError(null) }}
                onEditName={setEditName} onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)} onDelete={handleDelete} />
            ))}
          </>
        )}
      </div>
      {pods.length === 0 && <p className="text-xs text-[#9b9b97] py-6 text-center">No pods yet</p>}
    </div>
  )
}

// ── Knowledge Tab ─────────────────────────────────────────────
function KnowledgeTab() {
  const qc = useQueryClient()
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['knowledge', 'active'],
    queryFn: () => getKnowledge('active'),
  })
  const [newMode,   setNewMode]   = useState(false)
  const [newTopic,  setNewTopic]  = useState('')
  const [newSaving, setNewSaving] = useState(false)
  const [newError,  setNewError]  = useState(null)

  const handleCreate = async () => {
    if (!newTopic.trim() || newSaving) return
    setNewSaving(true); setNewError(null)
    try {
      await createKnowledge({ topic: newTopic.trim(), status: 'active' })
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      setNewMode(false); setNewTopic('')
    } catch (err) {
      setNewError(err?.response?.data?.error || err?.message || 'Failed to create')
    } finally { setNewSaving(false) }
  }

  if (isLoading) return <p className="text-xs text-[#9b9b97] py-4 text-center">Loading…</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={tabLabelCls}>{entries.length} entries</p>
        <button onClick={() => { setNewMode(true); setNewError(null) }}
          className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a18] text-white hover:bg-gray-800 transition-colors">
          + New Entry
        </button>
      </div>

      {newMode && (
        <div className="bg-[#f8f8f6] border border-[#e5e5e3] rounded-xl p-3 mb-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New knowledge entry</p>
          <input autoFocus value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Topic / title…"
            className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
          {newError && <p className="text-[10px] text-red-600 mb-1">{newError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setNewMode(false); setNewTopic(''); setNewError(null) }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67]">Cancel</button>
            <button onClick={handleCreate} disabled={!newTopic.trim() || newSaving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#C9A84C] text-white disabled:opacity-40 hover:bg-[#b8943d] transition-colors">
              {newSaving ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(entry => (
          <div key={entry.id} className="bg-white border border-[#e5e5e3] rounded-xl px-3 py-2.5">
            <p className="text-sm font-medium text-[#1a1a18]">{entry.topic || entry.title || 'Untitled'}</p>
            {entry.content && (
              <p className="text-[11px] text-[#6b6b67] mt-0.5 leading-relaxed">
                {entry.content.slice(0, 80)}{entry.content.length > 80 ? '…' : ''}
              </p>
            )}
          </div>
        ))}
      </div>
      {entries.length === 0 && <p className="text-xs text-[#9b9b97] py-6 text-center">No knowledge entries yet</p>}
    </div>
  )
}

// ── Projects page ─────────────────────────────────────────────
const STATUS_FILTERS = ['all', 'active', 'pursuit', 'on_hold', 'completed']
const PAGE_TABS = ['Projects', 'Categories', 'Topic Pods', 'Knowledge']

export default function Projects() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [mergeWinner, setMergeWinner] = useState(null)
  const [activeTab, setActiveTab] = useState('Projects')

  const { workspace } = useStore()

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', workspace],
    queryFn: () => getProjects(workspace !== 'all' ? { workspace } : {}),
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
          <div className="flex items-center gap-2">
            <WorkspaceBar compact />
            {activeTab === 'Projects' && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28]"
              >
                <span className="text-lg leading-none">+</span> New Project
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">

        {/* Top-level tabs */}
        <div className="flex gap-1 bg-white border border-[#e5e5e3] rounded-xl p-1">
          {PAGE_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-[#1a1a18] text-white'
                  : 'text-[#6b6b67] hover:text-[#1a1a18] hover:bg-[#f5f4f2]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Projects tab ─────────────────────────────────── */}
        {activeTab === 'Projects' && (
          <>
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

            {filtered.length > 0 && (
              <p className="text-xs text-gray-400 text-right">
                {filtered.length} project{filtered.length !== 1 ? 's' : ''}
                {filter !== 'all' || search ? ` (filtered from ${projects.length})` : ''}
              </p>
            )}
          </>
        )}

        {/* ── Categories tab ───────────────────────────────── */}
        {activeTab === 'Categories' && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <CategoriesTab />
          </div>
        )}

        {/* ── Topic Pods tab ───────────────────────────────── */}
        {activeTab === 'Topic Pods' && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <TopicPodsTab />
          </div>
        )}

        {/* ── Knowledge tab ────────────────────────────────── */}
        {activeTab === 'Knowledge' && (
          <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
            <KnowledgeTab />
          </div>
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
