import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import {
  getMeetingNotes, updateMeetingNote, getProjects, createProject,
  getTasks, updateTask, createTask,
  getOthersCommitments, updateOthersCommitment, createOthersCommitment,
  getMeetingCategories, getMeetingCategoryAssignments,
  assignPrimaryCategory, addSecondaryCategory, removeSecondaryCategory,
  createMeetingCategory, setInformationOnly,
  getTopicPods, createTopicPod,
  getKnowledge, createKnowledge,
  getObservations, createObservation,
  getWorkspaces,
} from '../lib/api'
import WorkspaceBar from '../components/WorkspaceBar'
import MeetingSummary from '../components/MeetingSummary'
import { useStore } from '../store/useStore'

dayjs.extend(duration)

const SOURCE_LABEL = {
  plaud:  { icon: '🎙', label: 'Plaud' },
  otter:  { icon: '🎙', label: 'Otter' },
  manual: { icon: '📝', label: 'Manual' },
}

const CAT_COLORS = [
  '#7F77DD','#1D9E75','#D85A30','#378ADD',
  '#BA7517','#D4537E','#639922','#E24B4A',
  '#5F5E5A','#C9A84C',
]

function formatDuration(mins) {
  if (!mins || mins <= 0) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function getMeetingDuration(meeting) {
  if (meeting.duration_minutes) return formatDuration(meeting.duration_minutes)
  if (meeting.start_time && meeting.end_time) {
    const mins = dayjs(meeting.end_time).diff(dayjs(meeting.start_time), 'minute')
    return formatDuration(mins)
  }
  return null
}

// ── Generic searchable picker popover ────────────────────────────────────────
function PickerPopover({ open, onClose, trigger, children, align = 'right', width = 'w-60' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, onClose])

  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div
          className={`absolute top-full mt-1 z-50 ${width} bg-white border border-[#e5e5e3] rounded-xl shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ maxHeight: 300, display: 'flex', flexDirection: 'column' }}
          onMouseDown={e => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ── New category inline form (module-level to prevent remount) ────────────────
function NewCatForm({
  newCatName, setNewCatName,
  newCatHint, setNewCatHint,
  newCatColor, setNewCatColor,
  newCatScope, setNewCatScope,
  newCatSaving,
  onCancel, onSave,
  error,
}) {
  return (
    <div className="px-2 py-2 border-t border-[#f0f0ee]">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New category</p>
      <input
        autoFocus
        value={newCatName}
        onChange={e => setNewCatName(e.target.value)}
        placeholder="Category name…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      <input
        value={newCatHint}
        onChange={e => setNewCatHint(e.target.value)}
        placeholder="AI focus hint (optional)…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      <div className="flex flex-wrap gap-1 mb-1.5">
        {CAT_COLORS.map(c => (
          <button
            key={c}
            onMouseDown={e => { e.preventDefault(); setNewCatColor(c) }}
            className="w-4 h-4 rounded-full border-2 transition-all"
            style={{ backgroundColor: c, borderColor: newCatColor === c ? '#1a1a18' : 'transparent' }}
          />
        ))}
      </div>
      <div className="flex gap-1 mb-2">
        {['global','project'].map(s => (
          <button
            key={s}
            onMouseDown={e => { e.preventDefault(); setNewCatScope(s) }}
            className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${newCatScope === s ? 'bg-[#1a1a18] text-white border-[#1a1a18]' : 'border-[#e5e5e3] text-[#6b6b67]'}`}
          >
            {s === 'global' ? 'Global' : 'This project'}
          </button>
        ))}
      </div>
      {error && <p className="text-[10px] text-red-600 mb-1">{error}</p>}
      <div className="flex gap-1">
        <button
          onMouseDown={e => { e.preventDefault(); onCancel() }}
          className="flex-1 text-[10px] py-1 rounded-md border border-[#e5e5e3] text-[#6b6b67]"
        >Cancel</button>
        <button
          onMouseDown={e => { e.preventDefault(); onSave() }}
          disabled={!newCatName.trim() || newCatSaving}
          className="flex-1 text-[10px] py-1 rounded-md bg-[#1a1a18] text-white disabled:opacity-40"
        >{newCatSaving ? '…' : 'Create'}</button>
      </div>
    </div>
  )
}

// ── New pod inline form (module-level to prevent remount) ─────────────────────
function NewPodForm({
  newPodName, setNewPodName,
  newPodDesc, setNewPodDesc,
  newPodSaving,
  onCancel, onSave,
  error,
}) {
  return (
    <div className="px-2 py-2 border-t border-[#f0f0ee]">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New pod</p>
      <input
        autoFocus
        value={newPodName}
        onChange={e => setNewPodName(e.target.value)}
        placeholder="Pod name…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      <input
        value={newPodDesc}
        onChange={e => setNewPodDesc(e.target.value)}
        placeholder="Description (optional)…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      {error && <p className="text-[10px] text-red-600 mb-1">{error}</p>}
      <div className="flex gap-1">
        <button
          onMouseDown={e => { e.preventDefault(); onCancel() }}
          className="flex-1 text-[10px] py-1 rounded-md border border-[#e5e5e3] text-[#6b6b67]"
        >Cancel</button>
        <button
          onMouseDown={e => { e.preventDefault(); onSave() }}
          disabled={!newPodName.trim() || newPodSaving}
          className="flex-1 text-[10px] py-1 rounded-md bg-[#1a1a18] text-white disabled:opacity-40"
        >{newPodSaving ? '…' : 'Create'}</button>
      </div>
    </div>
  )
}

// ── New knowledge inline form (module-level) ───────────────────────────────────
function NewKnowForm({ newKnowTopic, setNewKnowTopic, newKnowSaving, onCancel, onSave, error }) {
  return (
    <div className="px-2 py-2 border-t border-[#f0f0ee]">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New knowledge entry</p>
      <input
        autoFocus
        value={newKnowTopic}
        onChange={e => setNewKnowTopic(e.target.value)}
        placeholder="Topic / title…"
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      {error && <p className="text-[10px] text-red-600 mb-1">{error}</p>}
      <div className="flex gap-1">
        <button
          onMouseDown={e => { e.preventDefault(); onCancel() }}
          className="flex-1 text-[10px] py-1 rounded-md border border-[#e5e5e3] text-[#6b6b67]"
        >Cancel</button>
        <button
          onMouseDown={e => { e.preventDefault(); onSave() }}
          disabled={!newKnowTopic.trim() || newKnowSaving}
          className="flex-1 text-[10px] py-1 rounded-md bg-[#1a1a18] text-white disabled:opacity-40"
        >{newKnowSaving ? '…' : 'Create'}</button>
      </div>
    </div>
  )
}

// ── New observation/journal inline form (module-level) ─────────────────────────
function NewObsForm({ newObsContent, setNewObsContent, newObsSaving, onCancel, onSave, error }) {
  return (
    <div className="px-2 py-2 border-t border-[#f0f0ee]">
      <p className="text-[9px] font-bold uppercase tracking-widest text-[#C9A84C] mb-2">New journal entry</p>
      <textarea
        autoFocus
        value={newObsContent}
        onChange={e => setNewObsContent(e.target.value)}
        placeholder="Journal note…"
        rows={3}
        className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none"
      />
      {error && <p className="text-[10px] text-red-600 mb-1">{error}</p>}
      <div className="flex gap-1">
        <button
          onMouseDown={e => { e.preventDefault(); onCancel() }}
          className="flex-1 text-[10px] py-1 rounded-md border border-[#e5e5e3] text-[#6b6b67]"
        >Cancel</button>
        <button
          onMouseDown={e => { e.preventDefault(); onSave() }}
          disabled={!newObsContent.trim() || newObsSaving}
          className="flex-1 text-[10px] py-1 rounded-md bg-[#1a1a18] text-white disabled:opacity-40"
        >{newObsSaving ? '…' : 'Create'}</button>
      </div>
    </div>
  )
}

// ── Metadata panel (right column of expanded row) ─────────────────────────────
function MeetingMetadataPanel({ meeting, projects, allCategories, allPods, allObservations, allKnowledge, onUpdate, onOpenCreateProject }) {
  const qc = useQueryClient()

  // ── Open state per picker ────────────────────────────────────
  const [projectOpen,   setProjectOpen]   = useState(false)
  const [primaryOpen,   setPrimaryOpen]   = useState(false)
  const [secondaryOpen, setSecondaryOpen] = useState(false)
  const [podOpen,       setPodOpen]       = useState(false)
  const [obsOpen,       setObsOpen]       = useState(false)
  const [knowOpen,      setKnowOpen]      = useState(false)

  // ── Search queries ────────────────────────────────────────────
  const [projectQ,   setProjectQ]   = useState('')
  const [primaryQ,   setPrimaryQ]   = useState('')
  const [secondaryQ, setSecondaryQ] = useState('')
  const [podQ,       setPodQ]       = useState('')
  const [obsQ,       setObsQ]       = useState('')
  const [knowQ,      setKnowQ]      = useState('')

  // ── New category inline form ──────────────────────────────────
  const [newCatFor,    setNewCatFor]    = useState(null) // 'primary' | 'secondary'
  const [newCatName,   setNewCatName]   = useState('')
  const [newCatColor,  setNewCatColor]  = useState('#7F77DD')
  const [newCatScope,  setNewCatScope]  = useState('global')
  const [newCatHint,   setNewCatHint]   = useState('')
  const [newCatSaving, setNewCatSaving] = useState(false)
  const [newCatError,  setNewCatError]  = useState(null)

  // ── New pod inline form ───────────────────────────────────────
  const [newPodMode,   setNewPodMode]   = useState(false)
  const [newPodName,   setNewPodName]   = useState('')
  const [newPodDesc,   setNewPodDesc]   = useState('')
  const [newPodSaving, setNewPodSaving] = useState(false)
  const [newPodError,  setNewPodError]  = useState(null)

  // ── New knowledge inline form ─────────────────────────────────
  const [newKnowMode,   setNewKnowMode]   = useState(false)
  const [newKnowTopic,  setNewKnowTopic]  = useState('')
  const [newKnowSaving, setNewKnowSaving] = useState(false)
  const [newKnowError,  setNewKnowError]  = useState(null)

  // ── New observation inline form ───────────────────────────────
  const [newObsMode,    setNewObsMode]    = useState(false)
  const [newObsContent, setNewObsContent] = useState('')
  const [newObsSaving,  setNewObsSaving]  = useState(false)
  const [newObsError,   setNewObsError]   = useState(null)

  // ── Secondary categories for this meeting ─────────────────────
  const { data: catAssignments, refetch: refetchCats } = useQuery({
    queryKey: ['meeting-cat-assignments', meeting.id],
    queryFn:  () => getMeetingCategoryAssignments(meeting.id),
  })
  const secondaryCats = catAssignments?.secondaries || []

  // ── Derived linked entities ───────────────────────────────────
  const currentProject   = projects.find(p => p.id === meeting.project_id) || null
  const currentPrimary   = allCategories.find(c => c.id === meeting.primary_category_id) || null
  const currentPod       = allPods.find(p => p.id === meeting.linked_pod_id) || null
  const currentObs       = allObservations.find(o => o.id === meeting.linked_observation_id) || null
  const currentKnowledge = allKnowledge.find(k => k.id === meeting.linked_knowledge_id) || null

  // ── Filtered lists ────────────────────────────────────────────
  const filteredProjects  = projects.filter(p => !projectQ || p.name.toLowerCase().includes(projectQ.toLowerCase()))
  const filteredPrimary   = allCategories.filter(c => !primaryQ   || c.name.toLowerCase().includes(primaryQ.toLowerCase()))
  const filteredSecondary = allCategories.filter(c =>
    (!secondaryQ || c.name.toLowerCase().includes(secondaryQ.toLowerCase())) &&
    !secondaryCats.find(s => s.id === c.id) &&
    c.id !== meeting.primary_category_id
  )
  const filteredPods = allPods.filter(p => !podQ || p.name.toLowerCase().includes(podQ.toLowerCase()))
  const filteredObs  = allObservations.filter(o =>
    !obsQ || o.content?.toLowerCase().includes(obsQ.toLowerCase())
  )
  const filteredKnow = allKnowledge.filter(k =>
    !knowQ || k.topic?.toLowerCase().includes(knowQ.toLowerCase())
  )

  // ── Mutations ─────────────────────────────────────────────────
  const saveMut = useCallback(async (updates) => {
    const data = await updateMeetingNote(meeting.id, updates)
    onUpdate(meeting.id, { ...updates, ...data })
  }, [meeting.id, onUpdate])

  const handleAssignProject = async (projectId) => {
    setProjectOpen(false); setProjectQ('')
    await saveMut({ project_id: projectId || null })
  }

  const handleAssignPrimary = async (catId) => {
    setPrimaryOpen(false); setPrimaryQ('')
    await assignPrimaryCategory(meeting.id, catId)
    onUpdate(meeting.id, { primary_category_id: catId })
    qc.invalidateQueries({ queryKey: ['meeting-cat-assignments', meeting.id] })
  }

  const handleClearPrimary = async () => {
    await assignPrimaryCategory(meeting.id, null)
    onUpdate(meeting.id, { primary_category_id: null })
    qc.invalidateQueries({ queryKey: ['meeting-cat-assignments', meeting.id] })
  }

  const handleAddSecondary = async (catId) => {
    setSecondaryOpen(false); setSecondaryQ('')
    await addSecondaryCategory(meeting.id, catId)
    refetchCats()
  }

  const handleRemoveSecondary = async (catId) => {
    await removeSecondaryCategory(meeting.id, catId)
    refetchCats()
  }

  const handleLinkPod  = async (podId) => { setPodOpen(false); setPodQ(''); await saveMut({ linked_pod_id: podId }) }
  const handleLinkObs  = async (obsId) => { setObsOpen(false); setObsQ(''); await saveMut({ linked_observation_id: obsId }) }
  const handleLinkKnow = async (knowId) => { setKnowOpen(false); setKnowQ(''); await saveMut({ linked_knowledge_id: knowId }) }

  // ── Create new category ───────────────────────────────────────
  const handleCreateCategory = async () => {
    if (!newCatName.trim() || newCatSaving) return
    setNewCatSaving(true); setNewCatError(null)
    try {
      const cat = await createMeetingCategory({
        name:             newCatName.trim(),
        color:            newCatColor,
        extraction_hint:  newCatHint.trim() || null,
        project_id:       newCatScope === 'project' ? (meeting.project_id || null) : null,
      })
      qc.invalidateQueries({ queryKey: ['meeting-categories'] })
      if (newCatFor === 'primary') {
        await assignPrimaryCategory(meeting.id, cat.id)
        onUpdate(meeting.id, { primary_category_id: cat.id })
        setPrimaryOpen(false)
      } else {
        await addSecondaryCategory(meeting.id, cat.id)
        refetchCats()
        setSecondaryOpen(false)
      }
      setNewCatFor(null); setNewCatName(''); setNewCatHint(''); setNewCatColor('#7F77DD'); setNewCatScope('global')
    } catch (err) {
      setNewCatError(err?.response?.data?.error || err?.message || 'Failed to create category')
    } finally {
      setNewCatSaving(false)
    }
  }

  // ── Create new pod ────────────────────────────────────────────
  const handleCreatePod = async () => {
    if (!newPodName.trim() || newPodSaving) return
    setNewPodSaving(true); setNewPodError(null)
    try {
      const pod = await createTopicPod({ name: newPodName.trim(), description: newPodDesc.trim(), status: 'active' })
      qc.invalidateQueries({ queryKey: ['topic-pods'] })
      await saveMut({ linked_pod_id: pod.id })
      setPodOpen(false); setNewPodMode(false); setNewPodName(''); setNewPodDesc('')
    } catch (err) {
      setNewPodError(err?.response?.data?.error || err?.message || 'Failed to create pod')
    } finally {
      setNewPodSaving(false)
    }
  }

  // ── Create new knowledge entry ────────────────────────────────
  const handleCreateKnowledge = async () => {
    if (!newKnowTopic.trim() || newKnowSaving) return
    setNewKnowSaving(true); setNewKnowError(null)
    try {
      const entry = await createKnowledge({ topic: newKnowTopic.trim(), status: 'active' })
      qc.invalidateQueries({ queryKey: ['knowledge', 'active'] })
      await saveMut({ linked_knowledge_id: entry.id })
      setKnowOpen(false); setNewKnowMode(false); setNewKnowTopic('')
    } catch (err) {
      setNewKnowError(err?.response?.data?.error || err?.message || 'Failed to create knowledge entry')
    } finally {
      setNewKnowSaving(false)
    }
  }

  // ── Create new observation/journal entry ──────────────────────
  const handleCreateObservation = async () => {
    if (!newObsContent.trim() || newObsSaving) return
    setNewObsSaving(true); setNewObsError(null)
    try {
      const obs = await createObservation({ content: newObsContent.trim() })
      qc.invalidateQueries({ queryKey: ['observations'] })
      await saveMut({ linked_observation_id: obs.id })
      setObsOpen(false); setNewObsMode(false); setNewObsContent('')
    } catch (err) {
      setNewObsError(err?.response?.data?.error || err?.message || 'Failed to create journal entry')
    } finally {
      setNewObsSaving(false)
    }
  }

  // ── Workspace ─────────────────────────────────────────────────
  const { data: workspaces = [] } = useQuery({ queryKey: ['workspaces'], queryFn: getWorkspaces, staleTime: Infinity })

  // ── Shared picker styles ──────────────────────────────────────
  const btnBase  = 'w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-[#1a1a18] hover:bg-[#f5f4f2] rounded-lg transition-colors'
  const labelCls = 'text-[9px] font-bold uppercase tracking-widest text-[#9b9b97] mb-1'

  return (
    <div className="w-52 flex-shrink-0 border-l border-[#f0f0ee] px-3 py-3 bg-[#fafaf8] space-y-3">

      {/* ── Workspace ───────────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Workspace</p>
        <div className="flex gap-1 flex-wrap mt-1">
          {workspaces.map(ws => (
            <button
              key={ws.id}
              onClick={async () => {
                await updateMeetingNote(meeting.id, { workspace_id: ws.id })
                onUpdate(meeting.id, { workspace_id: ws.id })
              }}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                meeting.workspace_id === ws.id
                  ? 'text-white border-transparent'
                  : 'text-[#6b6b67] border-[#d5d5d3] hover:border-[#9b9b97]'
              }`}
              style={meeting.workspace_id === ws.id ? { backgroundColor: ws.color, borderColor: ws.color } : {}}
            >
              {ws.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Project ─────────────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Project</p>
        <PickerPopover
          open={projectOpen}
          onClose={() => { setProjectOpen(false); setProjectQ('') }}
          align="right"
          trigger={
            <button
              onClick={() => setProjectOpen(v => !v)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                currentProject ? 'bg-blue-50 text-blue-800 border-blue-200' : 'border-dashed border-[#d0d0cc] text-[#9b9b97] hover:border-amber-400 hover:text-amber-700'
              }`}
            >
              <span className="flex-1 truncate text-left">{currentProject ? currentProject.name : '+ project'}</span>
              {currentProject && (
                <span
                  onMouseDown={e => { e.stopPropagation(); handleAssignProject(null) }}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-red-500 text-blue-400"
                >×</span>
              )}
            </button>
          }
        >
          <div className="px-2 pt-2 pb-1">
            <input autoFocus value={projectQ} onChange={e => setProjectQ(e.target.value)}
              placeholder="Search projects…"
              className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
            />
          </div>
          <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 160 }}>
            {filteredProjects.map(p => (
              <button key={p.id} onMouseDown={e => { e.preventDefault(); handleAssignProject(p.id) }}
                className={btnBase + (p.id === meeting.project_id ? ' font-medium' : '')}
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === meeting.project_id && <span className="text-blue-500 text-[10px]">✓</span>}
              </button>
            ))}
            {filteredProjects.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No matches</div>}
          </div>
          <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
            <button
              onMouseDown={e => { e.preventDefault(); setProjectOpen(false); onOpenCreateProject(meeting.id) }}
              className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
            >+ create new project</button>
          </div>
        </PickerPopover>
      </div>

      {/* ── Primary category ─────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Primary category</p>
        <PickerPopover
          open={primaryOpen}
          onClose={() => { setPrimaryOpen(false); setPrimaryQ(''); if (!newCatFor) setNewCatFor(null) }}
          align="right"
          trigger={
            <button
              onClick={() => { setPrimaryOpen(v => !v); setNewCatFor(null) }}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                currentPrimary ? 'border-transparent' : 'border-dashed border-[#d0d0cc] text-[#9b9b97] hover:border-[#7F77DD] hover:text-[#7F77DD]'
              }`}
              style={currentPrimary ? { backgroundColor: currentPrimary.color + '18', color: currentPrimary.color, borderColor: currentPrimary.color + '40' } : {}}
            >
              {currentPrimary && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: currentPrimary.color }} />}
              <span className="flex-1 truncate text-left">{currentPrimary ? currentPrimary.name : '+ primary category'}</span>
              {currentPrimary && (
                <span
                  onMouseDown={e => { e.stopPropagation(); handleClearPrimary() }}
                  onClick={e => e.stopPropagation()}
                  className="hover:opacity-60"
                >×</span>
              )}
            </button>
          }
        >
          {newCatFor === 'primary' ? (
            <NewCatForm
              newCatName={newCatName} setNewCatName={setNewCatName}
              newCatHint={newCatHint} setNewCatHint={setNewCatHint}
              newCatColor={newCatColor} setNewCatColor={setNewCatColor}
              newCatScope={newCatScope} setNewCatScope={setNewCatScope}
              newCatSaving={newCatSaving}
              onCancel={() => { setNewCatFor(null); setNewCatName(''); setNewCatHint(''); setNewCatError(null) }}
              onSave={handleCreateCategory}
              error={newCatError}
            />
          ) : (
            <>
              <div className="px-2 pt-2 pb-1">
                <input autoFocus value={primaryQ} onChange={e => setPrimaryQ(e.target.value)}
                  placeholder="Search categories…"
                  className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                />
              </div>
              <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 160 }}>
                {filteredPrimary.map(c => (
                  <button key={c.id} onMouseDown={e => { e.preventDefault(); handleAssignPrimary(c.id) }}
                    className={btnBase}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.id === meeting.primary_category_id && <span className="text-[10px]" style={{ color: c.color }}>✓</span>}
                  </button>
                ))}
                {filteredPrimary.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No matches</div>}
              </div>
              <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
                <button
                  onMouseDown={e => { e.preventDefault(); setNewCatFor('primary'); setNewCatName(''); setNewCatHint('') }}
                  className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
                >+ create new category</button>
              </div>
            </>
          )}
        </PickerPopover>
      </div>

      {/* ── Secondary categories ─────────────────────────────────── */}
      <div>
        <p className={labelCls}>Secondary</p>
        {secondaryCats.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {secondaryCats.map(c => (
              <span
                key={c.id}
                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: c.color + '18', color: c.color, border: `1px solid ${c.color}40` }}
              >
                {c.name}
                <button
                  onClick={() => handleRemoveSecondary(c.id)}
                  className="ml-0.5 hover:opacity-60"
                >×</button>
              </span>
            ))}
          </div>
        )}
        <PickerPopover
          open={secondaryOpen}
          onClose={() => { setSecondaryOpen(false); setSecondaryQ('') }}
          align="right"
          trigger={
            <button
              onClick={() => { setSecondaryOpen(v => !v); setNewCatFor(null) }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs border border-dashed border-[#d0d0cc] rounded-lg text-[#9b9b97] hover:border-[#7F77DD] hover:text-[#7F77DD] transition-colors"
            >
              + add secondary
            </button>
          }
        >
          {newCatFor === 'secondary' ? (
            <NewCatForm
              newCatName={newCatName} setNewCatName={setNewCatName}
              newCatHint={newCatHint} setNewCatHint={setNewCatHint}
              newCatColor={newCatColor} setNewCatColor={setNewCatColor}
              newCatScope={newCatScope} setNewCatScope={setNewCatScope}
              newCatSaving={newCatSaving}
              onCancel={() => { setNewCatFor(null); setNewCatName(''); setNewCatHint(''); setNewCatError(null) }}
              onSave={handleCreateCategory}
              error={newCatError}
            />
          ) : (
            <>
              <div className="px-2 pt-2 pb-1">
                <input autoFocus value={secondaryQ} onChange={e => setSecondaryQ(e.target.value)}
                  placeholder="Search categories…"
                  className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                />
              </div>
              <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 160 }}>
                {filteredSecondary.map(c => (
                  <button key={c.id} onMouseDown={e => { e.preventDefault(); handleAddSecondary(c.id) }}
                    className={btnBase}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                  </button>
                ))}
                {filteredSecondary.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No matches</div>}
              </div>
              <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
                <button
                  onMouseDown={e => { e.preventDefault(); setNewCatFor('secondary'); setNewCatName(''); setNewCatHint('') }}
                  className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
                >+ create new category</button>
              </div>
            </>
          )}
        </PickerPopover>
      </div>

      <div className="border-t border-[#e5e5e3] pt-1" />

      {/* ── Topic pod ────────────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Topic pod</p>
        <PickerPopover
          open={podOpen}
          onClose={() => { setPodOpen(false); setPodQ(''); setNewPodMode(false); setNewPodName(''); setNewPodDesc('') }}
          align="right"
          trigger={
            <button
              onClick={() => { setPodOpen(v => !v); setNewPodMode(false) }}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                currentPod ? 'bg-amber-50 text-amber-800 border-amber-200' : 'border-dashed border-[#d0d0cc] text-[#9b9b97] hover:border-amber-400 hover:text-amber-700'
              }`}
            >
              {currentPod && <span className="text-amber-500">⟲</span>}
              <span className="flex-1 truncate text-left">{currentPod ? currentPod.name : '+ link pod'}</span>
              {currentPod && (
                <span
                  onMouseDown={e => { e.stopPropagation(); handleLinkPod(null) }}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-red-500 text-amber-400"
                >×</span>
              )}
            </button>
          }
        >
          {newPodMode ? (
            <NewPodForm
              newPodName={newPodName} setNewPodName={setNewPodName}
              newPodDesc={newPodDesc} setNewPodDesc={setNewPodDesc}
              newPodSaving={newPodSaving}
              onCancel={() => { setNewPodMode(false); setNewPodName(''); setNewPodDesc(''); setNewPodError(null) }}
              onSave={handleCreatePod}
              error={newPodError}
            />
          ) : (
            <>
              <div className="px-2 pt-2 pb-1">
                <input autoFocus value={podQ} onChange={e => setPodQ(e.target.value)}
                  placeholder="Search pods…"
                  className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                />
              </div>
              <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 140 }}>
                {currentPod && (
                  <button onMouseDown={e => { e.preventDefault(); handleLinkPod(null) }}
                    className="w-full text-left px-2 py-1.5 text-[10px] text-red-500 hover:bg-red-50 rounded-lg mb-1"
                  >✕ Remove link</button>
                )}
                {filteredPods.map(p => (
                  <button key={p.id} onMouseDown={e => { e.preventDefault(); handleLinkPod(p.id) }}
                    className={btnBase}
                  >
                    <span className="text-amber-500">⟲</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.id === meeting.linked_pod_id && <span className="text-[10px] text-amber-500">✓</span>}
                  </button>
                ))}
                {filteredPods.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No pods yet</div>}
              </div>
              <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
                <button
                  onMouseDown={e => { e.preventDefault(); setNewPodMode(true) }}
                  className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
                >+ create new pod</button>
              </div>
            </>
          )}
        </PickerPopover>
      </div>

      {/* ── Journal ──────────────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Journal</p>
        <PickerPopover
          open={obsOpen}
          onClose={() => { setObsOpen(false); setObsQ(''); setNewObsMode(false); setNewObsContent('') }}
          align="right"
          trigger={
            <button
              onClick={() => setObsOpen(v => !v)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                currentObs ? 'bg-purple-50 text-purple-800 border-purple-200' : 'border-dashed border-[#d0d0cc] text-[#9b9b97] hover:border-purple-400 hover:text-purple-700'
              }`}
            >
              <span className="flex-1 truncate text-left">
                {currentObs ? (currentObs.content || '').slice(0, 40) + (currentObs.content?.length > 40 ? '…' : '') : '+ link observation'}
              </span>
              {currentObs && (
                <span
                  onMouseDown={e => { e.stopPropagation(); handleLinkObs(null) }}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-red-500 text-purple-400"
                >×</span>
              )}
            </button>
          }
        >
          {newObsMode ? (
            <NewObsForm
              newObsContent={newObsContent} setNewObsContent={setNewObsContent}
              newObsSaving={newObsSaving}
              onCancel={() => { setNewObsMode(false); setNewObsContent(''); setNewObsError(null) }}
              onSave={handleCreateObservation}
              error={newObsError}
            />
          ) : (
            <>
              <div className="px-2 pt-2 pb-1">
                <input autoFocus value={obsQ} onChange={e => setObsQ(e.target.value)}
                  placeholder="Search observations…"
                  className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                />
              </div>
              <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 140 }}>
                {currentObs && (
                  <button onMouseDown={e => { e.preventDefault(); handleLinkObs(null) }}
                    className="w-full text-left px-2 py-1.5 text-[10px] text-red-500 hover:bg-red-50 rounded-lg mb-1"
                  >✕ Remove link</button>
                )}
                {filteredObs.map(o => (
                  <button key={o.id} onMouseDown={e => { e.preventDefault(); handleLinkObs(o.id) }}
                    className={btnBase}
                  >
                    <span className="flex-1 truncate text-left">{(o.content || '').slice(0, 55)}</span>
                    {o.id === meeting.linked_observation_id && <span className="text-[10px] text-purple-500">✓</span>}
                  </button>
                ))}
                {filteredObs.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No observations</div>}
              </div>
              <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
                <button
                  onMouseDown={e => { e.preventDefault(); setNewObsMode(true) }}
                  className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
                >+ create new journal entry</button>
              </div>
            </>
          )}
        </PickerPopover>
      </div>

      {/* ── Knowledge ────────────────────────────────────────────── */}
      <div>
        <p className={labelCls}>Knowledge entry</p>
        <PickerPopover
          open={knowOpen}
          onClose={() => { setKnowOpen(false); setKnowQ(''); setNewKnowMode(false); setNewKnowTopic('') }}
          align="right"
          trigger={
            <button
              onClick={() => setKnowOpen(v => !v)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                currentKnowledge ? 'bg-green-50 text-green-800 border-green-200' : 'border-dashed border-[#d0d0cc] text-[#9b9b97] hover:border-green-400 hover:text-green-700'
              }`}
            >
              <span className="flex-1 truncate text-left">
                {currentKnowledge ? currentKnowledge.topic : '+ link knowledge'}
              </span>
              {currentKnowledge && (
                <span
                  onMouseDown={e => { e.stopPropagation(); handleLinkKnow(null) }}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-red-500 text-green-400"
                >×</span>
              )}
            </button>
          }
        >
          {newKnowMode ? (
            <NewKnowForm
              newKnowTopic={newKnowTopic} setNewKnowTopic={setNewKnowTopic}
              newKnowSaving={newKnowSaving}
              onCancel={() => { setNewKnowMode(false); setNewKnowTopic(''); setNewKnowError(null) }}
              onSave={handleCreateKnowledge}
              error={newKnowError}
            />
          ) : (
            <>
              <div className="px-2 pt-2 pb-1">
                <input autoFocus value={knowQ} onChange={e => setKnowQ(e.target.value)}
                  placeholder="Search knowledge…"
                  className="w-full text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-[#fafaf8]"
                />
              </div>
              <div className="overflow-y-auto px-1 pb-1" style={{ maxHeight: 140 }}>
                {currentKnowledge && (
                  <button onMouseDown={e => { e.preventDefault(); handleLinkKnow(null) }}
                    className="w-full text-left px-2 py-1.5 text-[10px] text-red-500 hover:bg-red-50 rounded-lg mb-1"
                  >✕ Remove link</button>
                )}
                {filteredKnow.map(k => (
                  <button key={k.id} onMouseDown={e => { e.preventDefault(); handleLinkKnow(k.id) }}
                    className={btnBase}
                  >
                    <span className="flex-1 truncate text-left">{k.topic}</span>
                    {k.id === meeting.linked_knowledge_id && <span className="text-[10px] text-green-500">✓</span>}
                  </button>
                ))}
                {filteredKnow.length === 0 && <div className="px-2 py-2 text-[10px] text-[#9b9b97]">No entries</div>}
              </div>
              <div className="px-2 py-1.5 border-t border-[#f0f0ee]">
                <button
                  onMouseDown={e => { e.preventDefault(); setNewKnowMode(true) }}
                  className="w-full text-left text-[10px] text-[#C9A84C] hover:underline py-0.5"
                >+ create new knowledge entry</button>
              </div>
            </>
          )}
        </PickerPopover>
      </div>

      {/* ── Info only toggle ─────────────────────────────────── */}
      <div className="border-t border-[#e5e5e3] pt-3">
        <div className="flex items-center justify-between">
          <p className={labelCls}>Info only</p>
          <button
            onClick={async () => {
              const next = !meeting.information_only
              await setInformationOnly(meeting.id, next)
              onUpdate(meeting.id, { information_only: next })
            }}
            className={`relative w-8 h-4 rounded-full transition-colors ${meeting.information_only ? 'bg-amber-400' : 'bg-[#d0d0cc]'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${meeting.information_only ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
        {meeting.information_only && (
          <p className="text-[9px] text-amber-600 mt-1">AI skips action &amp; task extraction</p>
        )}
      </div>

    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MeetingsPage() {
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const [search,          setSearch]          = useState('')
  const [filter,          setFilter]          = useState('all')
  const [categoryFilter,  setCategoryFilter]  = useState('')
  const [selected,        setSelected]        = useState(new Set())
  const [bulkProject,     setBulkProject]     = useState('')
  const [bulkSaving,      setBulkSaving]      = useState(false)
  const [expandedId,      setExpandedId]      = useState(null)

  // Create project modal
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newProjectName,    setNewProjectName]    = useState('')
  const [createForMeeting,  setCreateForMeeting]  = useState(null)
  const [creating,          setCreating]          = useState(false)

  // ── Workspace context ─────────────────────────────────────────
  const { workspace } = useStore()

  // ── Queries ───────────────────────────────────────────────────
  const { data: meetings      = [], isLoading } = useQuery({
    queryKey: ['meeting-notes', workspace],
    queryFn:  () => getMeetingNotes(workspace !== 'all' ? { workspace } : {}),
  })
  const { data: projects      = [] }            = useQuery({ queryKey: ['projects'],                 queryFn: getProjects })
  const { data: allTasks      = [] }            = useQuery({ queryKey: ['tasks'],                    queryFn: getTasks })
  const { data: allOthers     = [] }            = useQuery({ queryKey: ['others-commitments-all'],   queryFn: () => getOthersCommitments('all') })
  const { data: allCategories = [] }            = useQuery({ queryKey: ['meeting-categories'],       queryFn: () => getMeetingCategories() })
  const { data: allPods       = [] }            = useQuery({ queryKey: ['topic-pods', 'active'],     queryFn: () => getTopicPods('active') })
  const { data: allKnowledge  = [] }            = useQuery({ queryKey: ['knowledge', 'active'],      queryFn: () => getKnowledge('active') })
  const { data: allObservations = [] }          = useQuery({ queryKey: ['observations'],             queryFn: () => getObservations({ limit: 200 }) })

  const activeProjects = projects.filter(p => p.status === 'active' || !p.status)

  // ── Cache update helper ───────────────────────────────────────
  const handleMeetingUpdate = useCallback((meetingId, updates) => {
    qc.setQueryData(['meeting-notes', workspace], old =>
      (old || []).map(m => m.id === meetingId ? { ...m, ...updates } : m)
    )
  }, [qc, workspace])

  // ── Bulk select ───────────────────────────────────────────────
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const selectAll = () => setSelected(new Set(filtered.map(m => m.id)))
  const clearAll  = () => setSelected(new Set())

  // ── Task/others inline reconciliation ────────────────────────
  const markTaskDone  = async (id) => {
    await updateTask(id, { status: 'done' })
    qc.setQueryData(['tasks'], old => (old || []).map(t => t.id === id ? { ...t, status: 'done' } : t))
  }
  const markOtherDone = async (id) => {
    await updateOthersCommitment(id, { status: 'closed' })
    qc.setQueryData(['others-commitments-all'], old => (old || []).map(c => c.id === id ? { ...c, status: 'closed' } : c))
  }
  const pushTaskDone  = async (meetingId, title) => {
    const t = await createTask({ title, status: 'done', source_type: 'meeting', meeting_note_id: meetingId })
    qc.setQueryData(['tasks'], old => [...(old || []), t])
  }
  const pushOtherDone = async (meetingId, title, person) => {
    const c = await createOthersCommitment({ title, committed_by_name: person, status: 'closed', source_type: 'meeting', meeting_note_id: meetingId })
    qc.setQueryData(['others-commitments-all'], old => [...(old || []), c])
  }

  // ── Bulk assign ───────────────────────────────────────────────
  const bulkAssign = async () => {
    if (!bulkProject || selected.size === 0) return
    setBulkSaving(true)
    try {
      await Promise.all([...selected].map(id => updateMeetingNote(id, { project_id: bulkProject })))
      qc.setQueryData(['meeting-notes', workspaceId], old =>
        (old || []).map(m => selected.has(m.id) ? { ...m, project_id: bulkProject } : m)
      )
      setSelected(new Set()); setBulkProject('')
    } finally { setBulkSaving(false) }
  }

  // ── Create project modal ──────────────────────────────────────
  const openCreateProject = useCallback((meetingId) => {
    setCreateForMeeting(meetingId); setNewProjectName(''); setShowCreateProject(true)
  }, [])

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    try {
      const proj = await createProject({ name: newProjectName.trim(), status: 'active' })
      await qc.invalidateQueries(['projects'])
      if (createForMeeting) {
        await updateMeetingNote(createForMeeting, { project_id: proj.id })
        handleMeetingUpdate(createForMeeting, { project_id: proj.id })
      }
      setShowCreateProject(false); setCreateForMeeting(null)
    } finally { setCreating(false) }
  }

  // ── Filtering ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...meetings]
    if (filter === 'unlinked')    list = list.filter(m => !m.project_id)
    if (filter === 'linked')      list = list.filter(m =>  m.project_id)
    if (filter === 'uncategorized') list = list.filter(m => !m.primary_category_id)
    if (filter === 'info_only')   list = list.filter(m =>  m.information_only)
    if (categoryFilter) list = list.filter(m => m.primary_category_id === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.summary || '').toLowerCase().includes(q) ||
        (m.participants || []).some(p => p.toLowerCase().includes(q))
      )
    }
    return list.sort((a, b) => {
      const da = a.meeting_date || a.start_time || ''
      const db = b.meeting_date || b.start_time || ''
      return db.localeCompare(da)
    })
  }, [meetings, filter, categoryFilter, search])

  const unlinkedCount      = meetings.filter(m => !m.project_id).length
  const uncategorizedCount = meetings.filter(m => !m.primary_category_id).length
  const infoOnlyCount      = meetings.filter(m =>  m.information_only).length

  const categoryCounts = useMemo(() => {
    const counts = {}
    meetings.forEach(m => { if (m.primary_category_id) counts[m.primary_category_id] = (counts[m.primary_category_id] || 0) + 1 })
    return counts
  }, [meetings])

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f8f6] pb-32">

      {/* ── Create Project Modal ───────────────────────────────────── */}
      {showCreateProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={e => { if (e.target === e.currentTarget) setShowCreateProject(false) }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#1a1a18] mb-4">Create new project</h3>
            <input
              autoFocus value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
              placeholder="Project name…"
              className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2.5 mb-4 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCreateProject(false)}
                className="flex-1 py-2.5 text-sm rounded-xl border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleCreateProject} disabled={!newProjectName.trim() || creating}
                className="flex-1 py-2.5 text-sm rounded-xl bg-[#1a1a18] text-white font-medium disabled:opacity-40">
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/')} className="text-[#6b6b67] hover:text-[#1a1a18] transition-colors">←</button>
              <h1 className="text-lg font-semibold text-[#1a1a18]">Meetings</h1>
              <WorkspaceBar compact />
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 ? (
                <>
                  <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">All</button>
                  <button onClick={clearAll}  className="text-xs text-[#6b6b67] hover:underline">Clear</button>
                </>
              ) : (
                <button onClick={selectAll} className="text-xs text-[#6b6b67] hover:text-[#1a1a18]">Select all</button>
              )}
              <span className="text-xs text-[#9b9b97]">{filtered.length} of {meetings.length}</span>
            </div>
          </div>

          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search meetings, participants…"
            className="w-full text-sm border border-[#e5e5e3] rounded-xl px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-[#f8f8f6]"
          />

          <div className="flex gap-1 flex-wrap">
            {[
              { key: 'all',           label: `All (${meetings.length})` },
              { key: 'unlinked',      label: `No project (${unlinkedCount})`,       warn: unlinkedCount > 0 },
              { key: 'uncategorized', label: `No category (${uncategorizedCount})`, warn: uncategorizedCount > 0 },
              { key: 'linked',        label: `Linked (${meetings.length - unlinkedCount})` },
              { key: 'info_only',     label: `Info Only (${infoOnlyCount})`,        show: infoOnlyCount > 0 },
            ].filter(t => t.show !== false).map(t => (
              <button key={t.key}
                onClick={() => { setFilter(t.key); setCategoryFilter('') }}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  filter === t.key ? 'bg-[#1a1a18] text-white' :
                  t.warn ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                  'bg-gray-100 text-[#6b6b67] hover:bg-gray-200'
                }`}
              >{t.label}</button>
            ))}
          </div>

          {allCategories.filter(c => categoryCounts[c.id]).length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {categoryFilter && (
                <button onClick={() => setCategoryFilter('')}
                  className="text-xs px-2.5 py-1 rounded-full border border-[#e5e5e3] text-[#6b6b67] hover:border-gray-400">
                  × clear
                </button>
              )}
              {allCategories.filter(c => categoryCounts[c.id]).map(cat => (
                <button key={cat.id}
                  onClick={() => { setCategoryFilter(categoryFilter === cat.id ? '' : cat.id); setFilter('all') }}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                  style={{
                    backgroundColor: categoryFilter === cat.id ? cat.color : cat.color + '15',
                    color:           categoryFilter === cat.id ? '#fff' : cat.color,
                    border:          `1px solid ${cat.color}40`,
                  }}
                >
                  {cat.name} <span className="opacity-70">({categoryCounts[cat.id]})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[#6b6b67] text-center py-10">No meetings found</p>
        )}

        {filtered.map(meeting => {
          const date          = meeting.meeting_date || meeting.start_time
          const project       = activeProjects.find(p => p.id === meeting.project_id)
          const primaryCat    = allCategories.find(c => c.id === meeting.primary_category_id)
          const linkedPod     = allPods.find(p => p.id === meeting.linked_pod_id)
          const dur           = getMeetingDuration(meeting)
          const isSelected    = selected.has(meeting.id)
          const isExpanded    = expandedId === meeting.id
          const hasTranscript = !!(meeting.full_transcript || meeting.raw_transcript)

          const meetingTasks  = allTasks.filter(t => t.meeting_note_id === meeting.id)
          const meetingOthers = allOthers.filter(c => c.meeting_note_id === meeting.id)
          const intel         = meeting.extracted_intelligence || {}
          const exTasks       = intel.ryan_action_items || []
          const exOthers      = [...(intel.verbal_commitments_others || []), ...(intel.others_action_items || [])]
          const decisions     = intel.decisions_made || intel.decisions || []
          const risks         = intel.risk_signals   || []
          const showDbTasks   = meetingTasks.length  > 0
          const showDbOthers  = meetingOthers.length > 0

          return (
            <div key={meeting.id}
              className={`bg-white border rounded-2xl transition-colors ${
                isSelected ? 'border-blue-300 bg-blue-50/30' :
                isExpanded ? 'border-[#C9A84C]/50 shadow-sm' : 'border-[#e5e5e3]'
              }`}
            >
              {/* ── Collapsed header row ─────────────────────────── */}
              <div
                className="p-4 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : meeting.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={e => { e.stopPropagation(); toggleSelect(meeting.id) }}
                    className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-500 border-blue-500' : 'border-[#d0d0cc] hover:border-blue-400'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a1a18] leading-snug">
                      {meeting.title || 'Untitled Meeting'}
                    </p>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {date && <span className="text-xs text-[#6b6b67] font-medium">{dayjs(date).format('MMM D')}</span>}
                      {dur  && <span className="text-xs text-[#9b9b97]">· {dur}</span>}
                      {(meeting.participants || []).length > 0 && (
                        <span className="text-xs text-[#9b9b97]">· {meeting.participants.length} attendee{meeting.participants.length !== 1 ? 's' : ''}</span>
                      )}
                      {meeting.intelligence_extracted && (
                        <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium">analyzed</span>
                      )}
                      {hasTranscript && !meeting.intelligence_extracted && (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">transcript</span>
                      )}
                      {meeting.information_only && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">📖 info only</span>
                      )}
                    </div>

                    {/* Tag badges row */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {project ? (
                        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">{project.name}</span>
                      ) : (
                        <span className="text-[10px] text-[#9b9b97] border border-dashed border-[#d0d0cc] px-2 py-0.5 rounded-full">+ project</span>
                      )}
                      {primaryCat ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: primaryCat.color + '18', color: primaryCat.color, border: `1px solid ${primaryCat.color}40` }}>
                          ● {primaryCat.name}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#9b9b97] border border-dashed border-[#d0d0cc] px-2 py-0.5 rounded-full">+ category</span>
                      )}
                      {linkedPod && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">⟲ {linkedPod.name}</span>
                      )}
                    </div>

                    {/* Collapsed summary hint */}
                    {!isExpanded && (meeting.summary || meeting.short_summary) && (
                      <p className="text-xs text-[#6b6b67] mt-2 leading-relaxed line-clamp-1">
                        {(meeting.summary || meeting.short_summary || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\n+/g, ' ').trim()}
                      </p>
                    )}
                  </div>

                  <span className={`text-[#9b9b97] text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                </div>
              </div>

              {/* ── Expanded tray ─────────────────────────────────── */}
              {isExpanded && (
                <div className="border-t border-[#f0f0ee] flex">

                  {/* Left: meeting content */}
                  <div className="flex-1 min-w-0 px-4 pt-4 pb-5 space-y-4">

                    {/* Summary — formatted (handles bullets, headings, bold) */}
                    {(meeting.short_summary || meeting.summary) && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">Summary</p>
                        <MeetingSummary text={meeting.short_summary || meeting.summary} compact={true} />
                      </div>
                    )}

                    {/* Attendees — readable sentence */}
                    {(meeting.participants || []).length > 0 && (() => {
                      const att = meeting.participants
                      const sentence = att.length === 1
                        ? att[0]
                        : att.length === 2
                          ? `${att[0]} and ${att[1]}`
                          : `${att.slice(0, -1).join(', ')}, and ${att[att.length - 1]}`
                      return (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">Attendees</p>
                          <p className="text-xs text-[#4a4a48] leading-relaxed">{sentence}</p>
                        </div>
                      )
                    })()}

                    {/* My action items — checkable */}
                    {(showDbTasks ? meetingTasks : exTasks).length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">My Actions</p>
                        <div className="space-y-1.5">
                          {showDbTasks ? meetingTasks.map(t => (
                            <div key={t.id} className="flex items-start gap-2.5">
                              <button onClick={() => markTaskDone(t.id)} disabled={t.status === 'done'}
                                className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-[#d0d0cc] hover:border-green-500'}`}>
                                {t.status === 'done' && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </button>
                              <span className={`text-sm leading-snug ${t.status === 'done' ? 'line-through text-[#9b9b97]' : 'text-[#1a1a18]'}`}>
                                {t.title}
                                {t.due_date && <span className="text-xs text-[#9b9b97] ml-1.5">due {dayjs(t.due_date).format('MMM D')}</span>}
                              </span>
                            </div>
                          )) : exTasks.slice(0, 4).map((t, i) => {
                            const title = typeof t === 'string' ? t : (t.title || t.description || JSON.stringify(t))
                            return (
                              <div key={i} className="flex items-start gap-2.5">
                                <button onClick={() => pushTaskDone(meeting.id, title)}
                                  className="flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 border-[#d0d0cc] hover:border-green-500 flex items-center justify-center transition-colors" />
                                <span className="text-sm text-[#1a1a18] leading-snug">{title}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Compact key intel — others, decisions, risks combined */}
                    {(() => {
                      const items = []
                      ;(showDbOthers ? meetingOthers : exOthers).slice(0, 3).forEach(c => {
                        const title  = typeof c === 'string' ? c : (c.title || c.description || '')
                        const person = typeof c === 'object' ? (c.committed_by_name || c.person || c.committed_by || '') : ''
                        if (title) items.push({ tag: 'Others', cls: 'bg-green-50 text-green-800', text: person ? `${person}: ${title}` : title, done: c.status === 'closed', id: c.id, isDb: showDbOthers })
                      })
                      decisions.slice(0, 3).forEach(d => {
                        const text = typeof d === 'string' ? d : (d.decision || d.title || d.description || '')
                        if (text) items.push({ tag: 'Decision', cls: 'bg-purple-50 text-purple-800', text })
                      })
                      risks.slice(0, 3).forEach(r => {
                        const text = typeof r === 'string' ? r : (r.description || r.risk || r.title || '')
                        if (text) items.push({ tag: 'Risk', cls: 'bg-red-50 text-red-800', text })
                      })
                      if (!items.length) return null
                      return (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">Key Intel</p>
                          <div className="space-y-1.5">
                            {items.slice(0, 5).map((item, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap ${item.cls}`}>{item.tag}</span>
                                <span className={`leading-snug ${item.done ? 'line-through text-[#9b9b97]' : 'text-[#1a1a18]'}`}>
                                  {item.isDb && !item.done ? (
                                    <button onClick={() => markOtherDone(item.id)} className="mr-1.5 flex-shrink-0 w-3.5 h-3.5 rounded border border-[#d0d0cc] hover:border-green-500 inline-flex items-center justify-center" />
                                  ) : null}
                                  {item.text}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#f0f0ee]">
                      <span className="text-xs text-[#9b9b97]">
                        {meetingTasks.filter(t => t.status === 'done').length}/{meetingTasks.length || exTasks.length} actions done
                      </span>
                      <button onClick={() => navigate(`/meeting/${meeting.id}`)}
                        className="text-xs text-[#1B2A4A] font-medium hover:underline">
                        View full detail →
                      </button>
                    </div>
                  </div>

                  {/* Right: metadata pickers */}
                  <MeetingMetadataPanel
                    meeting={meeting}
                    projects={activeProjects}
                    allCategories={allCategories}
                    allPods={allPods}
                    allObservations={allObservations}
                    allKnowledge={allKnowledge}
                    onUpdate={handleMeetingUpdate}
                    onOpenCreateProject={openCreateProject}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Bulk Assign Bar ───────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex justify-center px-4 pb-20">
          <div className="bg-[#1a1a18] text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 w-full max-w-lg">
            <span className="text-sm font-medium whitespace-nowrap">{selected.size} selected</span>
            <select
              value={bulkProject}
              onChange={e => {
                if (e.target.value === '__new__') { setCreateForMeeting(null); setNewProjectName(''); setShowCreateProject(true); return }
                setBulkProject(e.target.value)
              }}
              className="flex-1 text-sm bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-white/40 min-w-0"
            >
              <option value="" className="text-black bg-white">Select project…</option>
              {activeProjects.map(p => <option key={p.id} value={p.id} className="text-black bg-white">{p.name}</option>)}
              <option value="__new__" className="text-black bg-white">＋ Create new project…</option>
            </select>
            <button onClick={bulkAssign} disabled={!bulkProject || bulkSaving}
              className="text-sm font-semibold bg-white text-[#1a1a18] px-4 py-2 rounded-xl disabled:opacity-40 whitespace-nowrap hover:bg-gray-100 transition-colors">
              {bulkSaving ? 'Saving…' : 'Assign'}
            </button>
            <button onClick={clearAll} className="text-white/60 hover:text-white text-lg leading-none px-1">✕</button>
          </div>
        </div>
      )}
    </div>
  )
}
