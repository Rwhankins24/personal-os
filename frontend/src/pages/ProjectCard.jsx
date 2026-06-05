import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  getProject, updateProject, getProjectKeywordPreview,
  getTasks, updateTask,
  getCommitments, updateCommitment,
  getContacts,
  getPendingDecisions, updatePendingDecision,
} from '../lib/api'

// ── Design helpers ────────────────────────────────────────────
function PillBadge({ label, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-600',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[color] || colors.gray}`}>
      {label}
    </span>
  )
}

function Section({ title, children, count, action }) {
  return (
    <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a18]">{title}</h2>
          {count !== undefined && count > 0 && (
            <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── Tag Input ─────────────────────────────────────────────────
function TagInput({ tags, onChange, placeholder = 'Add keyword…', disabled = false }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  function addTag(val) {
    const trimmed = val.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed])
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

  return (
    <div
      className={`min-h-[38px] flex flex-wrap gap-1.5 items-center px-2 py-1.5 border rounded-lg ${
        disabled ? 'bg-gray-50 border-gray-200 cursor-default' : 'bg-white border-gray-200 cursor-text focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200'
      }`}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onChange(tags.filter(t => t !== tag)) }}
              className="text-blue-400 hover:text-blue-700 leading-none"
            >×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) addTag(input) }}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] text-sm outline-none bg-transparent text-[#1a1a18] placeholder-gray-400"
        />
      )}
    </div>
  )
}

// ── Normalize intelligence notes ───────────────────────────────
// Handles both array format (new AI job) and object {category: [...]} (legacy)
function normalizeIntelligenceNotes(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') {
    const items = []
    for (const [category, vals] of Object.entries(raw)) {
      if (Array.isArray(vals)) {
        vals.forEach(v => items.push(typeof v === 'string' ? { category, text: v } : { category, ...v }))
      }
    }
    return items
  }
  return []
}

// ── Status colors ──────────────────────────────────────────────
const STATUS_COLORS = {
  active:    'green',
  pursuit:   'blue',
  completed: 'gray',
  on_hold:   'yellow',
  lost:      'red',
}

// ── Main component ─────────────────────────────────────────────
export default function ProjectCard() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  // Data queries
  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
    enabled: !!id,
  })
  const { data: allTasks }       = useQuery({ queryKey: ['tasks'],       queryFn: getTasks })
  const { data: allCommitments } = useQuery({ queryKey: ['commitments'], queryFn: getCommitments })
  const { data: allContacts }    = useQuery({ queryKey: ['contacts'],    queryFn: getContacts })
  const { data: allDecisions }   = useQuery({ queryKey: ['pending-decisions'], queryFn: getPendingDecisions })

  // Edit mode state
  const [editing, setEditing]     = useState(false)
  const [editForm, setEditForm]   = useState(null)

  // Keywords section
  const [editingKw, setEditingKw]           = useState(false)
  const [kwDraft, setKwDraft]               = useState([])
  const [kwPreview, setKwPreview]           = useState(null)
  const [kwPreviewLoading, setKwPreviewLoading] = useState(false)
  const previewTimer = useRef(null)

  // Record decision modal
  const [recordDecision, setRecordDecision] = useState(null) // pending-decision object
  const [decisionText, setDecisionText]     = useState('')

  // ── Mutations ──────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (data) => updateProject(id, data),
    onSuccess: (updated) => {
      qc.setQueryData(['project', id], updated)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const taskDoneMutation = useMutation({
    mutationFn: ({ taskId }) => updateTask(taskId, { status: 'done' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const decisionMutation = useMutation({
    mutationFn: ({ decId, text }) => updatePendingDecision(decId, {
      status: 'decided',
      decision_made: text,
      decided_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
      setRecordDecision(null)
      setDecisionText('')
    },
  })

  // ── Derived data ───────────────────────────────────────────
  const projectTasks       = (allTasks || []).filter(t => t.project_id === id && t.status !== 'done' && t.status !== 'complete' && t.status !== 'archived')
  const projectCommitments = (allCommitments || []).filter(c => c.project_id === id && c.status === 'open')
  const projectContacts    = (allContacts || []).filter(c => c.project_id === id)
  const pendingDecisions   = (allDecisions || []).filter(d => d.project_id === id && d.status !== 'decided' && d.status !== 'archived')

  // ── Edit mode helpers ──────────────────────────────────────
  function startEdit() {
    setEditForm({
      name:        project?.name || '',
      client:      project?.client || '',
      type:        project?.type || '',
      status:      project?.status || 'active',
      location:    project?.location || '',
      description: project?.description || '',
      delivery_method: project?.delivery_method || '',
      contract_type:   project?.contract_type || '',
      contract_value:  project?.contract_value || '',
    })
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditForm(null)
  }

  async function saveEdit() {
    await saveMutation.mutateAsync(editForm)
    setEditing(false)
    setEditForm(null)
  }

  // ── Keyword edit helpers ───────────────────────────────────
  function startKeywordEdit() {
    setKwDraft(project?.keywords || [])
    setKwPreview(null)
    setEditingKw(true)
  }

  function cancelKeywordEdit() {
    setEditingKw(false)
    setKwDraft([])
    setKwPreview(null)
    clearTimeout(previewTimer.current)
  }

  async function saveKeywords() {
    await saveMutation.mutateAsync({ keywords: kwDraft })
    cancelKeywordEdit()
  }

  // Debounced keyword preview
  useEffect(() => {
    if (!editingKw || kwDraft.length === 0) { setKwPreview(null); return }
    clearTimeout(previewTimer.current)
    setKwPreviewLoading(true)
    previewTimer.current = setTimeout(async () => {
      try {
        const result = await getProjectKeywordPreview(id, kwDraft)
        setKwPreview(result)
      } catch (_) {
        setKwPreview(null)
      } finally {
        setKwPreviewLoading(false)
      }
    }, 1000)
    return () => clearTimeout(previewTimer.current)
  }, [kwDraft, editingKw, id])

  // ── Risk signal checkoff ───────────────────────────────────
  function toggleRisk(index) {
    const risks = [...(project?.risk_signals || [])]
    const item  = typeof risks[index] === 'string'
      ? { signal: risks[index], checked_off: true }
      : { ...risks[index], checked_off: !risks[index].checked_off }
    risks[index] = item
    saveMutation.mutate({ risk_signals: risks })
    qc.setQueryData(['project', id], prev => ({ ...prev, risk_signals: risks }))
  }

  // ── Loading / not found ────────────────────────────────────
  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!project) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-gray-500">Project not found</p>
      <button onClick={() => navigate('/projects')} className="text-blue-600 text-sm hover:underline">← Projects</button>
    </div>
  )

  const risks     = project.risk_signals      || []
  const decisions = project.decisions_made    || []
  const keyFacts  = project.key_facts         || []
  const intelNotes = normalizeIntelligenceNotes(project.intelligence_notes)
  const keywords  = project.keywords          || []

  const openRisks   = risks.filter(r => typeof r === 'string' || !r.checked_off)
  const closedRisks = risks.filter(r => typeof r !== 'string' && r.checked_off)

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18]"
          >
            ← Projects
          </button>
          <div className="flex items-center gap-2">
            {project.status && (
              <PillBadge label={project.status.replace('_',' ')} color={STATUS_COLORS[project.status] || 'gray'} />
            )}
            {!editing && (
              <button
                onClick={startEdit}
                className="text-xs px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg hover:border-gray-400 hover:text-[#1a1a18]"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ── Hero / Edit mode ─────────────────────────────── */}
        <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Project Name</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Client</label>
                  <input
                    value={editForm.client}
                    onChange={e => setEditForm(f => ({ ...f, client: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Location</label>
                  <input
                    value={editForm.location}
                    onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Type</label>
                  <select
                    value={editForm.type}
                    onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="">— None —</option>
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
                  <label className="text-xs text-gray-500 mb-1 block">Status</label>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Contract Value</label>
                  <input
                    value={editForm.contract_value}
                    onChange={e => setEditForm(f => ({ ...f, contract_value: e.target.value }))}
                    placeholder="e.g. $45M"
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Delivery Method</label>
                  <input
                    value={editForm.delivery_method}
                    onChange={e => setEditForm(f => ({ ...f, delivery_method: e.target.value }))}
                    placeholder="e.g. Design-Build"
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Contract Type</label>
                <input
                  value={editForm.contract_type}
                  onChange={e => setEditForm(f => ({ ...f, contract_type: e.target.value }))}
                  placeholder="e.g. GMP, Lump Sum"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={cancelEdit} className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saveMutation.isPending}
                  className="text-sm px-4 py-1.5 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#1a1a18]">{project.name}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-sm text-[#6b6b67]">
                {project.client   && <span>{project.client}</span>}
                {project.location && <span>· {project.location}</span>}
                {project.current_phase && <PillBadge label={project.current_phase} color="blue" />}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {project.contract_value && (
                  <div>
                    <p className="text-xs text-gray-500">Contract Value</p>
                    <p className="text-sm font-semibold text-[#1a1a18]">{project.contract_value}</p>
                  </div>
                )}
                {project.construction_start && (
                  <div>
                    <p className="text-xs text-gray-500">Start</p>
                    <p className="text-sm font-semibold text-[#1a1a18]">{dayjs(project.construction_start).format('MMM YYYY')}</p>
                  </div>
                )}
                {project.substantial_completion && (
                  <div>
                    <p className="text-xs text-gray-500">Completion</p>
                    <p className="text-sm font-semibold text-[#1a1a18]">{dayjs(project.substantial_completion).format('MMM YYYY')}</p>
                  </div>
                )}
                {project.delivery_method && (
                  <div>
                    <p className="text-xs text-gray-500">Delivery</p>
                    <p className="text-sm font-semibold text-[#1a1a18]">{project.delivery_method}</p>
                  </div>
                )}
                {project.contract_type && (
                  <div>
                    <p className="text-xs text-gray-500">Contract</p>
                    <p className="text-sm font-semibold text-[#1a1a18]">{project.contract_type}</p>
                  </div>
                )}
              </div>
              {project.description && (
                <p className="text-sm text-[#6b6b67] mt-3 leading-relaxed">{project.description}</p>
              )}
            </>
          )}
        </div>

        {/* ── Keywords ─────────────────────────────────────── */}
        <Section
          title="Intelligence Keywords"
          action={
            editingKw ? null : (
              <button
                onClick={startKeywordEdit}
                className="text-xs px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg hover:border-gray-400 hover:text-[#1a1a18]"
              >
                Edit Keywords
              </button>
            )
          }
        >
          {editingKw ? (
            <div className="space-y-3">
              <TagInput
                tags={kwDraft}
                onChange={setKwDraft}
                placeholder="Add keywords (Enter or comma to add)…"
              />
              {kwDraft.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {kwPreviewLoading ? (
                    <span className="text-gray-400">Checking coverage…</span>
                  ) : kwPreview ? (
                    <>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded">
                        {kwPreview.email_count} emails
                      </span>
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded">
                        {kwPreview.meeting_count} meetings
                      </span>
                      <span className="text-gray-400">match these keywords</span>
                    </>
                  ) : null}
                </div>
              )}
              <p className="text-xs text-gray-400">These keywords drive AI intelligence matching — emails and meetings containing these terms get linked to this project each night.</p>
              <div className="flex justify-end gap-2">
                <button onClick={cancelKeywordEdit} className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={saveKeywords}
                  disabled={saveMutation.isPending}
                  className="text-sm px-4 py-1.5 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Keywords'}
                </button>
              </div>
            </div>
          ) : keywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {keywords.map(k => (
                <span key={k} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">{k}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No keywords set — AI won't link emails or meetings to this project.</p>
          )}
        </Section>

        {/* ── Risk signals ─────────────────────────────────── */}
        {risks.length > 0 && (
          <Section title="Risk Signals" count={openRisks.length}>
            <div className="space-y-2">
              {risks.map((r, i) => {
                const text = typeof r === 'string' ? r : r.signal || r.description || JSON.stringify(r)
                const isChecked = typeof r !== 'string' && r.checked_off
                return (
                  <div
                    key={i}
                    onClick={() => toggleRisk(i)}
                    className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-all ${
                      isChecked ? 'bg-gray-50 opacity-50' : 'bg-red-50 hover:bg-red-100'
                    }`}
                  >
                    <span className={`text-sm mt-0.5 flex-shrink-0 ${isChecked ? 'text-green-500' : 'text-red-500'}`}>
                      {isChecked ? '✓' : '⚠️'}
                    </span>
                    <p className={`text-sm text-[#1a1a18] ${isChecked ? 'line-through text-gray-400' : ''}`}>{text}</p>
                  </div>
                )
              })}
            </div>
            {closedRisks.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">{closedRisks.length} risk{closedRisks.length !== 1 ? 's' : ''} checked off</p>
            )}
          </Section>
        )}

        {/* ── Pending decisions ─────────────────────────────── */}
        {pendingDecisions.length > 0 && (
          <Section title="Pending Decisions" count={pendingDecisions.length}>
            <div className="space-y-2">
              {pendingDecisions.map(d => (
                <div key={d.id} className="flex items-start justify-between gap-2 p-2 bg-yellow-50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#1a1a18]">{d.title || d.description}</p>
                    {d.due_date && (
                      <p className="text-xs text-gray-500 mt-0.5">Due {dayjs(d.due_date).format('MMM D')}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setRecordDecision(d); setDecisionText('') }}
                    className="text-xs flex-shrink-0 px-2.5 py-1 bg-yellow-200 text-yellow-800 rounded-lg hover:bg-yellow-300"
                  >
                    Record
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Decisions made ───────────────────────────────── */}
        {decisions.length > 0 && (
          <Section title="Decisions Made" count={decisions.length}>
            <div className="space-y-2">
              {decisions.map((d, i) => {
                const text    = typeof d === 'string' ? d : d.decision || d.description || JSON.stringify(d)
                const by      = typeof d === 'object' ? d.decided_by : null
                const dateStr = typeof d === 'object' ? d.decided_at || d.date : null
                return (
                  <div key={i} className="flex items-start gap-2 p-2 bg-green-50 rounded-lg">
                    <span className="text-green-600 text-sm mt-0.5 flex-shrink-0">✓</span>
                    <div>
                      <p className="text-sm text-[#1a1a18]">{text}</p>
                      {(by || dateStr) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {by && `${by}`}{by && dateStr && ' · '}{dateStr && dayjs(dateStr).format('MMM D, YYYY')}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Key facts ────────────────────────────────────── */}
        {keyFacts.length > 0 && (
          <Section title="Key Facts" count={keyFacts.length}>
            <div className="space-y-1.5">
              {keyFacts.map((f, i) => {
                const text     = typeof f === 'string' ? f : f.fact || f.text || JSON.stringify(f)
                const category = typeof f === 'object' ? f.category : null
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-blue-500 text-xs mt-0.5 flex-shrink-0">•</span>
                    <p className="text-sm text-[#1a1a18] flex-1">{text}</p>
                    {category && <PillBadge label={category} color="blue" />}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── AI Intelligence notes ─────────────────────────── */}
        {intelNotes.length > 0 && (
          <Section title="AI Intelligence" count={intelNotes.length}>
            <div className="space-y-2">
              {intelNotes.slice().reverse().map((note, i) => {
                const text     = typeof note === 'string' ? note : note.text || note.note || note.summary || JSON.stringify(note)
                const category = typeof note === 'object' ? note.category : null
                const date     = typeof note === 'object' ? note.date || note.created_at : null
                return (
                  <div key={i} className="p-2 border border-gray-100 rounded-lg">
                    {category && (
                      <span className="text-xs text-gray-400 uppercase tracking-wide mb-1 block">
                        {category.replace(/_/g, ' ')}
                      </span>
                    )}
                    <p className="text-sm text-[#1a1a18]">{text}</p>
                    {date && <p className="text-xs text-gray-400 mt-1">{dayjs(date).format('MMM D, YYYY')}</p>}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Open tasks ────────────────────────────────────── */}
        {projectTasks.length > 0 && (
          <Section title="Open Tasks" count={projectTasks.length}>
            <div className="space-y-1">
              {projectTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group">
                  <button
                    onClick={() => taskDoneMutation.mutate({ taskId: t.id })}
                    className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-green-500 flex-shrink-0 group-hover:border-green-400"
                  />
                  <p
                    className="text-sm text-[#1a1a18] flex-1 cursor-pointer hover:text-blue-600"
                    onClick={() => navigate(`/task/${t.id}`)}
                  >
                    {t.title}
                  </p>
                  {t.urgency === 'critical' && <PillBadge label="critical" color="red" />}
                  {t.urgency === 'high'     && <PillBadge label="high"     color="orange" />}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Open commitments ──────────────────────────────── */}
        {projectCommitments.length > 0 && (
          <Section title="Open Commitments" count={projectCommitments.length}>
            <div className="space-y-2">
              {projectCommitments.map(c => (
                <div key={c.id} className="flex items-start gap-2">
                  <span className="text-orange-400 mt-0.5 text-xs flex-shrink-0">•</span>
                  <div>
                    <p className="text-sm text-[#1a1a18]">{c.title}</p>
                    {c.made_to  && <p className="text-xs text-gray-500">To: {c.made_to}</p>}
                    {c.due_date && <p className="text-xs text-gray-500">Due {dayjs(c.due_date).format('MMM D')}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Contacts ─────────────────────────────────────── */}
        {projectContacts.length > 0 && (
          <Section title="Team & Contacts" count={projectContacts.length}>
            <div className="grid grid-cols-2 gap-2">
              {projectContacts.map(c => (
                <div
                  key={c.id}
                  onClick={() => navigate(`/contact/${c.id}`)}
                  className="flex items-center gap-2 p-2 border border-gray-100 rounded-lg hover:border-blue-200 cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-[#1a1a18] flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#1a1a18] truncate">{c.name}</p>
                    <p className="text-xs text-gray-500 truncate">{c.title || c.company || ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

      </div>

      {/* ── Record decision modal ─────────────────────────── */}
      {recordDecision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-[#1a1a18]">Record Decision</h3>
              <p className="text-xs text-gray-500 mt-0.5">{recordDecision.title || recordDecision.description}</p>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                autoFocus
                value={decisionText}
                onChange={e => setDecisionText(e.target.value)}
                placeholder="What was decided?"
                rows={3}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setRecordDecision(null); setDecisionText('') }}
                  className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => decisionMutation.mutate({ decId: recordDecision.id, text: decisionText })}
                  disabled={!decisionText.trim() || decisionMutation.isPending}
                  className="text-sm px-4 py-1.5 bg-[#1a1a18] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-50"
                >
                  {decisionMutation.isPending ? 'Saving…' : 'Save Decision'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
