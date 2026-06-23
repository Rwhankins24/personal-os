import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  getStrategicDecisions, createStrategicDecision,
  updateStrategicDecision, deleteStrategicDecision,
  getObservations, createObservation, deleteObservation,
} from '../lib/api'
import { useToast } from '../contexts/ToastContext'

dayjs.extend(relativeTime)

// ── Constants ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: 'project_strategy', label: 'Project Strategy' },
  { value: 'career',           label: 'Career' },
  { value: 'contract',         label: 'Contract / Deal' },
  { value: 'investment',       label: 'Investment' },
  { value: 'personal',         label: 'Personal' },
  { value: 'other',            label: 'Other' },
]

const CAT_COLORS = {
  project_strategy: 'bg-blue-100 text-blue-700',
  career:           'bg-purple-100 text-purple-700',
  contract:         'bg-amber-100 text-amber-700',
  investment:       'bg-green-100 text-green-700',
  personal:         'bg-rose-100 text-rose-700',
  other:            'bg-gray-100 text-gray-600',
}

const EMPTY_DECISION = {
  decision: '', why: '', assumptions: [''], expected_outcome: '',
  category: 'project_strategy', decided_on: dayjs().format('YYYY-MM-DD'), project_id: null,
}

const EMPTY_REVIEW = {
  actual_outcome: '', outcome_correct: null, lesson: '',
}

// ── Sub-components ────────────────────────────────────────────────────────
function CategoryBadge({ category }) {
  const cfg = CATEGORIES.find(c => c.value === category) || CATEGORIES[5]
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAT_COLORS[category] || CAT_COLORS.other}`}>
      {cfg.label}
    </span>
  )
}

function StatusDot({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${status === 'reviewed' ? 'text-green-600' : 'text-amber-600'}`}>
      <span className={`w-2 h-2 rounded-full ${status === 'reviewed' ? 'bg-green-500' : 'bg-amber-400'}`} />
      {status === 'reviewed' ? 'Reviewed' : 'Open'}
    </span>
  )
}

// ── Log Decision Modal ────────────────────────────────────────────────────
function LogDecisionModal({ onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_DECISION)
  const [saving, setSaving] = useState(false)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const setAssumption = (i, val) => {
    const a = [...form.assumptions]
    a[i] = val
    setForm(f => ({ ...f, assumptions: a }))
  }
  const addAssumption = () => setForm(f => ({ ...f, assumptions: [...f.assumptions, ''] }))
  const removeAssumption = (i) => setForm(f => ({
    ...f, assumptions: f.assumptions.filter((_, j) => j !== i)
  }))

  const handleSave = async () => {
    if (!form.decision.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      assumptions: form.assumptions.filter(a => a.trim()),
    }
    await onSave(payload)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Log a Decision</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Decision */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Decision *</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="What did you decide? (concise)"
              value={form.decision}
              onChange={e => set('decision', e.target.value)}
            />
          </div>

          {/* Category + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Category</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.category}
                onChange={e => set('category', e.target.value)}
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.decided_on}
                onChange={e => set('decided_on', e.target.value)}
              />
            </div>
          </div>

          {/* Why */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Why</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Rationale at time of decision"
              value={form.why}
              onChange={e => set('why', e.target.value)}
            />
          </div>

          {/* Assumptions */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Assumptions</label>
            <div className="space-y-2">
              {form.assumptions.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`Assumption ${i + 1}`}
                    value={a}
                    onChange={e => setAssumption(i, e.target.value)}
                  />
                  {form.assumptions.length > 1 && (
                    <button onClick={() => removeAssumption(i)} className="text-gray-300 hover:text-red-400 text-lg leading-none px-1">×</button>
                  )}
                </div>
              ))}
              <button
                onClick={addAssumption}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add assumption
              </button>
            </div>
          </div>

          {/* Expected outcome */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expected Outcome</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="What do you expect to happen?"
              value={form.expected_outcome}
              onChange={e => set('expected_outcome', e.target.value)}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !form.decision.trim()}
            className="px-5 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Log Decision'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Review Modal ──────────────────────────────────────────────────────────
function ReviewModal({ decision, onClose, onSave }) {
  const [form, setForm] = useState({
    actual_outcome: decision.actual_outcome || '',
    outcome_correct: decision.outcome_correct ?? null,
    lesson: decision.lesson || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    await onSave(decision.id, form)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Review Decision</h2>
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{decision.decision}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Original context */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 space-y-2 text-sm">
          {decision.why && (
            <div><span className="font-medium text-gray-600">Why: </span><span className="text-gray-700">{decision.why}</span></div>
          )}
          {decision.expected_outcome && (
            <div><span className="font-medium text-gray-600">Expected: </span><span className="text-gray-700">{decision.expected_outcome}</span></div>
          )}
          {decision.assumptions?.length > 0 && (
            <div>
              <span className="font-medium text-gray-600">Assumptions: </span>
              <ul className="mt-1 space-y-0.5 pl-3">
                {decision.assumptions.map((a, i) => (
                  <li key={i} className="text-gray-700 list-disc ml-2">{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Was the bet right? */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Was the core bet correct?</label>
            <div className="flex gap-3">
              {[{ val: true, label: '✓ Yes', cls: 'border-green-400 bg-green-50 text-green-700' },
                { val: false, label: '✗ No', cls: 'border-red-400 bg-red-50 text-red-700' },
                { val: null, label: '~ Partial', cls: 'border-amber-400 bg-amber-50 text-amber-700' }
              ].map(({ val, label, cls }) => (
                <button
                  key={String(val)}
                  onClick={() => set('outcome_correct', val)}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    form.outcome_correct === val ? cls : 'border-gray-200 text-gray-400 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Actual outcome */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What actually happened</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Actual outcome…"
              value={form.actual_outcome}
              onChange={e => set('actual_outcome', e.target.value)}
            />
          </div>

          {/* Lesson */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Lesson to carry forward</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="What should you do differently or repeat next time?"
              value={form.lesson}
              onChange={e => set('lesson', e.target.value)}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Decision Card ─────────────────────────────────────────────────────────
function DecisionCard({ d, onReview, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`bg-white rounded-xl border ${d.status === 'reviewed' ? 'border-gray-200' : 'border-amber-200'} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <CategoryBadge category={d.category} />
              <StatusDot status={d.status} />
              <span className="text-xs text-gray-400">{dayjs(d.decided_on).format('MMM D, YYYY')}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{d.decision}</p>
            {d.why && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.why}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {d.status === 'open' && (
              <button
                onClick={() => onReview(d)}
                className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700"
              >
                Review
              </button>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-gray-400 hover:text-gray-600 text-xs px-2"
            >
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
            {d.assumptions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Assumptions</p>
                <ul className="space-y-1 pl-3">
                  {d.assumptions.map((a, i) => (
                    <li key={i} className="text-gray-600 list-disc ml-2 text-xs">{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {d.expected_outcome && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Expected Outcome</p>
                <p className="text-gray-600 text-xs">{d.expected_outcome}</p>
              </div>
            )}
            {d.status === 'reviewed' && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Retrospective · {dayjs(d.reviewed_on).format('MMM D, YYYY')}</p>
                {d.outcome_correct !== null && (
                  <p className={`text-xs font-medium ${d.outcome_correct === true ? 'text-green-600' : d.outcome_correct === false ? 'text-red-600' : 'text-amber-600'}`}>
                    {d.outcome_correct === true ? '✓ Bet was correct' : d.outcome_correct === false ? '✗ Bet was wrong' : '~ Partial'}
                  </p>
                )}
                {d.actual_outcome && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-0.5">What happened</p>
                    <p className="text-xs text-gray-700">{d.actual_outcome}</p>
                  </div>
                )}
                {d.lesson && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-0.5">Lesson</p>
                    <p className="text-xs text-gray-700 font-medium">{d.lesson}</p>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => onDelete(d.id)} className="text-xs text-gray-400 hover:text-red-500">Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Observations Panel ────────────────────────────────────────────────────
function ObservationsPanel() {
  const qc = useQueryClient()
  const { addToast } = useToast()
  const [newObs, setNewObs] = useState('')
  const [adding, setAdding] = useState(false)

  const { data: obs = [] } = useQuery({
    queryKey: ['observations'],
    queryFn: () => getObservations({ limit: 50 }),
  })

  const addMut = useMutation({
    mutationFn: (data) => createObservation(data),
    onSuccess: () => { qc.invalidateQueries(['observations']); setNewObs(''); setAdding(false) },
    onError: () => addToast('Failed to save observation', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteObservation,
    onSuccess: () => qc.invalidateQueries(['observations']),
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Observations</h2>
          <p className="text-xs text-gray-400 mt-0.5">Nightly extractions + manual entries</p>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700"
        >
          + Add
        </button>
      </div>

      {adding && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="What did you observe or learn?"
            value={newObs}
            onChange={e => setNewObs(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500">Cancel</button>
            <button
              onClick={() => addMut.mutate({ content: newObs, source_type: 'manual' })}
              disabled={!newObs.trim()}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
        {obs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400 text-center">No observations yet. The nightly job will start adding them automatically.</p>
        ) : (
          obs.map(o => (
            <div key={o.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 leading-snug">{o.content}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    o.source_type === 'manual' ? 'bg-purple-50 text-purple-600' :
                    o.source_type === 'ai_nightly' ? 'bg-blue-50 text-blue-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>{o.source_type === 'ai_nightly' ? 'AI' : o.source_type}</span>
                  <span className="text-xs text-gray-400">{dayjs(o.created_at).fromNow()}</span>
                  {o.projects?.name && <span className="text-xs text-gray-400">{o.projects.name}</span>}
                </div>
              </div>
              <button
                onClick={() => deleteMut.mutate(o.id)}
                className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm shrink-0"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function StrategicDecisionsPage() {
  const qc = useQueryClient()
  const { addToast } = useToast()
  const [showLog, setShowLog] = useState(false)
  const [reviewing, setReviewing] = useState(null)
  const [filter, setFilter] = useState('all')  // all | open | reviewed
  const [catFilter, setCatFilter] = useState('all')

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['strategic-decisions', filter, catFilter],
    queryFn: () => getStrategicDecisions({ status: filter, category: catFilter }),
  })

  const createMut = useMutation({
    mutationFn: createStrategicDecision,
    onSuccess: () => { qc.invalidateQueries(['strategic-decisions']); setShowLog(false); addToast('Decision logged', 'success') },
    onError: () => addToast('Failed to save', 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateStrategicDecision(id, data),
    onSuccess: () => { qc.invalidateQueries(['strategic-decisions']); setReviewing(null); addToast('Review saved', 'success') },
    onError: () => addToast('Failed to save review', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteStrategicDecision,
    onSuccess: () => { qc.invalidateQueries(['strategic-decisions']); addToast('Deleted', 'success') },
  })

  const open = decisions.filter(d => d.status === 'open').length
  const reviewed = decisions.filter(d => d.status === 'reviewed').length
  const correct = decisions.filter(d => d.outcome_correct === true).length
  const total = decisions.filter(d => d.status === 'reviewed').length

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Decision Journal</h1>
          <p className="text-sm text-gray-500 mt-1">Log decisions with assumptions. Review outcomes. Build judgment over time.</p>
        </div>
        <button
          onClick={() => setShowLog(true)}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 shrink-0"
        >
          + Log Decision
        </button>
      </div>

      {/* Stats */}
      {decisions.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{open}</p>
            <p className="text-xs text-gray-500 mt-1">Awaiting Review</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
            <p className="text-2xl font-bold text-green-600">{reviewed}</p>
            <p className="text-xs text-gray-500 mt-1">Reviewed</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {total > 0 ? `${Math.round((correct / total) * 100)}%` : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Bets Correct</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Decisions list */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {['all', 'open', 'reviewed'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium capitalize transition-all ${
                  filter === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
            <span className="text-gray-300">|</span>
            {['all', ...CATEGORIES.map(c => c.value)].map(c => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium capitalize transition-all ${
                  catFilter === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c === 'all' ? 'All categories' : CATEGORIES.find(x => x.value === c)?.label || c}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : decisions.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <p className="text-gray-500 text-sm">No decisions logged yet.</p>
              <p className="text-gray-400 text-xs mt-1">Every significant decision deserves a record.</p>
              <button
                onClick={() => setShowLog(true)}
                className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700"
              >
                Log your first decision
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {decisions.map(d => (
                <DecisionCard
                  key={d.id}
                  d={d}
                  onReview={setReviewing}
                  onDelete={(id) => deleteMut.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Observations panel */}
        <div>
          <ObservationsPanel />
        </div>
      </div>

      {/* Modals */}
      {showLog && (
        <LogDecisionModal
          onClose={() => setShowLog(false)}
          onSave={(data) => createMut.mutate(data)}
        />
      )}
      {reviewing && (
        <ReviewModal
          decision={reviewing}
          onClose={() => setReviewing(null)}
          onSave={(id, data) => updateMut.mutate({ id, data })}
        />
      )}
    </div>
  )
}
