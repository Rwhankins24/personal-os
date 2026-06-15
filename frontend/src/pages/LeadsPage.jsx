import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  getLeads, getLead, createLead, updateLead, deleteLead,
  uploadLeadFile, deleteLeadFile,
} from '../lib/api'
import { useToast } from '../contexts/ToastContext'

dayjs.extend(relativeTime)

// ── Constants ──────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  hot:    { label: 'Hot',    bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'    },
  active: { label: 'Active', bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500'  },
  cold:   { label: 'Cold',   bg: 'bg-blue-100',   text: 'text-blue-600',   dot: 'bg-blue-400'   },
  dead:   { label: 'Dead',   bg: 'bg-gray-100',   text: 'text-gray-500',   dot: 'bg-gray-400'   },
  won:    { label: 'Won',    bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  lost:   { label: 'Lost',   bg: 'bg-rose-100',   text: 'text-rose-600',   dot: 'bg-rose-500'   },
}

const PRIORITY_CONFIG = {
  high:   { label: 'High',   color: 'text-red-500' },
  medium: { label: 'Med',    color: 'text-yellow-600' },
  low:    { label: 'Low',    color: 'text-gray-400' },
}

const PROJECT_TYPES = [
  'Data Center', 'Advanced Manufacturing', 'Industrial / Distribution',
  'Pharma / Life Sciences', 'Student Housing', 'Mixed-Use', 'Office',
  'Healthcare', 'Retail', 'Other',
]

const PROCUREMENT_TYPES = [
  'CM-at-Risk', 'Design-Build', 'GC / Hard Bid', 'Negotiated', 'Design-Assist', 'Unknown',
]

const STATUS_OPTIONS = ['active', 'hot', 'cold', 'dead', 'won', 'lost']

const EMPTY_FORM = {
  codename: '', client_name: '', project_type: '', status: 'active',
  priority: 'medium', location: '', estimated_value: '', source: '',
  procurement: '', timeline: '', notes: '',
}

// ── Helpers ────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.active
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function PriorityDot({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium
  return <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
}

function formatValue(v) {
  if (!v) return null
  const n = Number(v)
  if (isNaN(n)) return v
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function formatBytes(b) {
  if (!b) return ''
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b > 1e3) return `${(b / 1e3).toFixed(0)} KB`
  return `${b} B`
}

// ── Lead card (list view) ──────────────────────────────────────────────────
function LeadCard({ lead, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white border border-[#e5e5e3] rounded-2xl overflow-hidden">
      {/* Header row */}
      <div
        className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-[#fafaf8] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Left: priority indicator */}
        <div className="flex-shrink-0 pt-0.5">
          <PriorityDot priority={lead.priority} />
        </div>

        {/* Center: main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-[#1a1a18] truncate">{lead.codename}</span>
            <StatusBadge status={lead.status} />
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-[#6b6b67]">
            {lead.client_name && <span className="font-medium text-[#444]">{lead.client_name}</span>}
            {lead.client_name && (lead.project_type || lead.location) && <span>·</span>}
            {lead.project_type && <span>{lead.project_type}</span>}
            {lead.location && <span>· 📍 {lead.location}</span>}
            {lead.estimated_value && <span>· {formatValue(lead.estimated_value)}</span>}
          </div>
          {lead.timeline && (
            <p className="text-xs text-[#9b9b97] mt-0.5">⏱ {lead.timeline}</p>
          )}
        </div>

        {/* Right: meta + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {lead.file_count > 0 && (
            <span className="text-xs text-[#9b9b97]">📎 {lead.file_count}</span>
          )}
          <span className="text-[#9b9b97] text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <LeadDetail leadId={lead.id} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  )
}

// ── Lead detail (expanded inside card) ────────────────────────────────────
function LeadDetail({ leadId, onEdit, onDelete }) {
  const qc    = useToast ? useQueryClient() : null
  const toast = useToast()
  const fileRef = useRef(null)
  const qcInner = useQueryClient()

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn:  () => getLead(leadId),
    staleTime: 60000,
  })

  const uploadMut = useMutation({
    mutationFn: (formData) => uploadLeadFile(leadId, formData),
    onSuccess: () => {
      qcInner.invalidateQueries({ queryKey: ['lead', leadId] })
      qcInner.invalidateQueries({ queryKey: ['leads'] })
      toast('File uploaded — AI will process tonight', { icon: '📎' })
    },
    onError: (e) => toast(e?.response?.data?.error || 'Upload failed', { icon: '✗' }),
  })

  const deleteFileMut = useMutation({
    mutationFn: (fileId) => deleteLeadFile(fileId),
    onSuccess: () => {
      qcInner.invalidateQueries({ queryKey: ['lead', leadId] })
      qcInner.invalidateQueries({ queryKey: ['leads'] })
      toast('File removed', { icon: '✓' })
    },
  })

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    uploadMut.mutate(fd)
    e.target.value = ''
  }

  if (isLoading) {
    return <div className="px-4 py-4 text-xs text-[#9b9b97]">Loading…</div>
  }
  if (!lead) return null

  return (
    <div className="border-t border-[#f0f0ee] px-4 py-4 space-y-4">

      {/* Notes */}
      {lead.notes && (
        <div>
          <p className="text-xs font-semibold text-[#6b6b67] uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}

      {/* AI Summary */}
      {lead.ai_summary && (
        <div className="bg-[#f0f4ff] border border-[#d0d8f0] rounded-xl p-3">
          <p className="text-xs font-semibold text-[#3b5bdb] uppercase tracking-wide mb-1.5">🤖 AI Intelligence</p>
          <p className="text-sm text-[#1a1a18] leading-relaxed whitespace-pre-wrap">{lead.ai_summary}</p>
        </div>
      )}

      {/* Meta details */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {lead.source      && <div><span className="text-[#9b9b97]">Source:</span> <span className="text-[#444]">{lead.source}</span></div>}
        {lead.procurement && <div><span className="text-[#9b9b97]">Procurement:</span> <span className="text-[#444]">{lead.procurement}</span></div>}
        {lead.timeline    && <div><span className="text-[#9b9b97]">Timeline:</span> <span className="text-[#444]">{lead.timeline}</span></div>}
        {lead.estimated_value && <div><span className="text-[#9b9b97]">Est. Value:</span> <span className="text-[#444]">{formatValue(lead.estimated_value)}</span></div>}
        <div><span className="text-[#9b9b97]">Added:</span> <span className="text-[#444]">{dayjs(lead.created_at).fromNow()}</span></div>
      </div>

      {/* Files */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Attachments</p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
            className="text-xs px-2.5 py-1 border border-[#e5e5e3] rounded-lg text-[#6b6b67] hover:border-gray-400 hover:text-[#1a1a18] transition-colors disabled:opacity-50"
          >
            {uploadMut.isPending ? 'Uploading…' : '+ Upload'}
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange}
            accept=".pdf,.docx,.doc,.txt,.html,.png,.jpg,.jpeg" />
        </div>

        {(lead.files || []).length === 0 ? (
          <p className="text-xs text-[#9b9b97] italic">No files yet — upload articles or documents to get AI intelligence</p>
        ) : (
          <div className="space-y-1.5">
            {lead.files.map(f => (
              <div key={f.id} className="flex items-center gap-2 px-3 py-2 bg-[#f8f8f6] rounded-xl border border-[#e5e5e3]">
                <span className="text-sm flex-shrink-0">
                  {f.filename.endsWith('.pdf') ? '📄' : f.filename.match(/\.(docx?|txt)$/i) ? '📝' : '📎'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#1a1a18] truncate">{f.filename}</p>
                  <div className="flex items-center gap-2">
                    {f.file_size && <span className="text-[10px] text-[#9b9b97]">{formatBytes(f.file_size)}</span>}
                    {f.ai_processed
                      ? <span className="text-[10px] text-green-600 font-medium">✓ AI processed</span>
                      : <span className="text-[10px] text-amber-600">⏳ Pending AI</span>
                    }
                  </div>
                </div>
                {f.ai_summary && (
                  <button
                    title={f.ai_summary}
                    className="text-xs text-blue-500 hover:text-blue-700 flex-shrink-0"
                    onClick={() => alert(f.ai_summary)}
                  >
                    📊
                  </button>
                )}
                <button
                  onClick={() => {
                    if (window.confirm(`Remove "${f.filename}"?`)) deleteFileMut.mutate(f.id)
                  }}
                  className="text-xs text-[#9b9b97] hover:text-red-500 flex-shrink-0 transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onEdit(lead)}
          className="text-xs px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete lead "${lead.codename}"? This will remove all attached files.`)) {
              onDelete(lead.id)
            }
          }}
          className="text-xs px-3 py-1.5 border border-[#e5e5e3] text-[#6b6b67] rounded-lg hover:border-red-300 hover:text-red-600 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Add / Edit modal ───────────────────────────────────────────────────────
function LeadModal({ lead, onClose, onSave }) {
  const [form, setForm] = useState(lead
    ? {
        codename:        lead.codename        || '',
        client_name:     lead.client_name     || '',
        project_type:    lead.project_type    || '',
        status:          lead.status          || 'active',
        priority:        lead.priority        || 'medium',
        location:        lead.location        || '',
        estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : '',
        source:          lead.source          || '',
        procurement:     lead.procurement     || '',
        timeline:        lead.timeline        || '',
        notes:           lead.notes           || '',
      }
    : { ...EMPTY_FORM }
  )
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.codename.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
    }
    await onSave(payload)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#e5e5e3] sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-[#1a1a18]">
            {lead ? 'Edit Lead' : 'Add Lead'}
          </h2>
          <button onClick={onClose} className="text-[#6b6b67] hover:text-[#1a1a18] text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">

          {/* Codename + Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Project Codename *</label>
              <input
                autoFocus
                value={form.codename}
                onChange={e => set('codename', e.target.value)}
                placeholder="e.g. Project Atlas"
                required
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value)}
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Client + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Owner / Client</label>
              <input
                value={form.client_name}
                onChange={e => set('client_name', e.target.value)}
                placeholder="e.g. Amazon, Prologis"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Type + Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Project Type</label>
              <select
                value={form.project_type}
                onChange={e => set('project_type', e.target.value)}
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">— Select type —</option>
                {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Location</label>
              <input
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="e.g. Phoenix, AZ"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Est. Value + Procurement */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Est. Value ($)</label>
              <input
                type="number"
                value={form.estimated_value}
                onChange={e => set('estimated_value', e.target.value)}
                placeholder="e.g. 250000000"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Procurement Method</label>
              <select
                value={form.procurement}
                onChange={e => set('procurement', e.target.value)}
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">— Unknown —</option>
                {PROCUREMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Source + Timeline */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Source</label>
              <input
                value={form.source}
                onChange={e => set('source', e.target.value)}
                placeholder="e.g. Trade press, referral"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b67] mb-1">Timeline Signal</label>
              <input
                value={form.timeline}
                onChange={e => set('timeline', e.target.value)}
                placeholder="e.g. 12–18 months out"
                className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-[#6b6b67] mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={4}
              placeholder="What do we know? Who to call? Competitive situation? Strategy notes…"
              className="w-full text-sm border border-[#e5e5e3] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !form.codename.trim()}
              className="flex-1 py-2 bg-[#1a1a18] text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : lead ? 'Save Changes' : 'Add Lead'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#e5e5e3] text-sm text-[#6b6b67] rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const qc    = useQueryClient()
  const toast = useToast()

  const [modal,       setModal]       = useState(null) // null | { mode: 'add'|'edit', lead? }
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,      setSearch]      = useState('')

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn:  getLeads,
    staleTime: 60000,
  })

  const createMut = useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast('Lead added', { icon: '🎯' })
      setModal(null)
    },
    onError: (e) => toast(e?.response?.data?.error || 'Save failed', { icon: '✗' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateLead(id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', updated.id] })
      toast('Lead updated', { icon: '✓' })
      setModal(null)
    },
    onError: (e) => toast(e?.response?.data?.error || 'Save failed', { icon: '✗' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast('Lead deleted', { icon: '🗑' })
    },
  })

  const handleSave = async (payload) => {
    if (modal?.lead) {
      updateMut.mutate({ id: modal.lead.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  // Filter + search
  const filtered = leads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      l.codename?.toLowerCase().includes(q) ||
      l.client_name?.toLowerCase().includes(q) ||
      l.location?.toLowerCase().includes(q) ||
      l.project_type?.toLowerCase().includes(q) ||
      l.notes?.toLowerCase().includes(q)
    )
  })

  // Status counts
  const counts = {}
  for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1
  const hotCount = (counts.hot || 0) + (counts.active || 0)

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">← Dashboard</Link>
              <span className="text-[#e5e5e3]">|</span>
              <h1 className="text-base font-semibold text-[#1a1a18]">Leads</h1>
              <span className="text-xs text-[#6b6b67]">{leads.length} total</span>
              {hotCount > 0 && (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                  🔥 {hotCount} live
                </span>
              )}
            </div>
            <button
              onClick={() => setModal({ mode: 'add' })}
              className="text-xs px-3 py-1.5 bg-[#1a1a18] text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              + Add Lead
            </button>
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1 flex-wrap mb-2">
            {[
              { value: 'all',    label: `All (${leads.length})` },
              { value: 'hot',    label: `🔥 Hot${counts.hot ? ` (${counts.hot})` : ''}` },
              { value: 'active', label: `Active${counts.active ? ` (${counts.active})` : ''}` },
              { value: 'cold',   label: `Cold${counts.cold ? ` (${counts.cold})` : ''}` },
              { value: 'won',    label: `Won${counts.won ? ` (${counts.won})` : ''}` },
              { value: 'lost',   label: `Lost${counts.lost ? ` (${counts.lost})` : ''}` },
              { value: 'dead',   label: `Dead${counts.dead ? ` (${counts.dead})` : ''}` },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all border ${
                  statusFilter === opt.value
                    ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
                    : 'bg-white text-[#6b6b67] border-[#e5e5e3] hover:border-gray-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search codename, client, location, type…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#e5e5e3] rounded-lg bg-white text-[#1a1a18] placeholder-[#6b6b67] focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">×</button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-4 pb-24 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-4xl mb-3">🎯</span>
            <p className="text-sm">
              {search || statusFilter !== 'all'
                ? 'No leads match your filters'
                : 'No leads yet — add one to start tracking'}
            </p>
            {!search && statusFilter === 'all' && (
              <button
                onClick={() => setModal({ mode: 'add' })}
                className="mt-3 text-xs px-4 py-2 bg-[#1a1a18] text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
              >
                + Add your first lead
              </button>
            )}
          </div>
        ) : (
          filtered.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onEdit={(l) => setModal({ mode: 'edit', lead: l })}
              onDelete={(id) => deleteMut.mutate(id)}
            />
          ))
        )}
      </div>

      {/* Modal */}
      {modal && (
        <LeadModal
          lead={modal.lead || null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
