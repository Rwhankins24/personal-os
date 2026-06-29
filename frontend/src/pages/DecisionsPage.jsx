import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getPendingDecisions, updatePendingDecision } from '../lib/api'

const URGENCY_DOT = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
}

const STATUS_COLORS = {
  open:      'text-blue-600 bg-blue-50',
  decided:   'text-green-700 bg-green-50',
  dismissed: 'text-gray-400 bg-gray-100',
}

function PillToggle({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-3 py-1 rounded-full font-medium transition-all border ${
            value === opt.value
              ? 'bg-[#1a1a18] text-white border-[#1a1a18]'
              : 'bg-white text-[#6b6b67] border-[#e5e5e3] hover:border-gray-400'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function DecisionsPage() {
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('open')
  const [deciding, setDeciding] = useState(null)
  const [outcome, setOutcome]   = useState('')

  // Pull ALL decisions (not just open) so history is visible
  const { data, isLoading } = useQuery({
    queryKey: ['pending-decisions-all'],
    queryFn: () =>
      fetch(`${import.meta.env.VITE_API_URL || ''}/api/pending-decisions?status=all`, {
        headers: { 'Content-Type': 'application/json' }
      }).then(r => r.json()),
    refetchInterval: 300000,
  })

  const decide = useMutation({
    mutationFn: ({ id, outcome }) => updatePendingDecision(id, { status: 'decided', outcome }),
    onSuccess: () => {
      setDeciding(null)
      setOutcome('')
      qc.invalidateQueries({ queryKey: ['pending-decisions-all'] })
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
    },
  })

  const dismiss = useMutation({
    mutationFn: (id) => updatePendingDecision(id, { status: 'dismissed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions-all'] })
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
    },
  })

  const reopen = useMutation({
    mutationFn: (id) => updatePendingDecision(id, { status: 'open', outcome: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions-all'] })
      qc.invalidateQueries({ queryKey: ['pending-decisions'] })
    },
  })

  const all   = data || []
  const open  = all.filter(d => d.status === 'open' || !d.status)
  const done  = all.filter(d => d.status === 'decided' || d.status === 'dismissed')

  const shown = statusFilter === 'open' ? open : statusFilter === 'decided' ? all.filter(d => d.status === 'decided') : done

  const statusOptions = [
    { value: 'open',   label: `Open (${open.length})` },
    { value: 'decided', label: `Decided (${all.filter(d => d.status === 'decided').length})` },
    { value: 'done',   label: `All closed (${done.length})` },
  ]

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <h1 className="text-sm font-semibold text-[#1a1a18] flex-1">Pending Decisions</h1>
          <span className="text-xs text-[#6b6b67] flex-shrink-0">{open.length} open</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-36 space-y-3">
        {/* Status filter */}
        <PillToggle options={statusOptions} value={statusFilter} onChange={setStatusFilter} />

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-[#6b6b67] text-center py-8">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {statusFilter === 'open' ? 'No open decisions 🎉' : 'No decisions here'}
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map(d => (
              <div
                key={d.id}
                className="bg-white border border-[#e5e5e3] rounded-2xl p-4 space-y-2"
              >
                {/* Header row */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a1a18] leading-snug">{d.question}</p>
                    {d.context && (
                      <p className="text-xs text-[#6b6b67] mt-1 leading-relaxed">{d.context}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {d.urgency && (
                      <div className={`w-2.5 h-2.5 rounded-full ${URGENCY_DOT[d.urgency] || 'bg-gray-300'}`} title={d.urgency} />
                    )}
                    {d.status && (
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[d.status] || STATUS_COLORS.open}`}>
                        {d.status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Meta: project, created date */}
                <div className="flex items-center gap-2 flex-wrap">
                  {d.projects?.name && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                      {d.projects.name}
                    </span>
                  )}
                  {d.created_at && (
                    <span className="text-xs text-[#9b9b97]">
                      {dayjs(d.created_at).format('MMM D, YYYY')}
                    </span>
                  )}
                  {(d.source_label || d.source) && (
                    <span className="text-xs text-[#9b9b97]">
                      {d.source_type === 'ai_email' ? '📧 ' : d.source_type?.includes('plaud') ? '🎙 ' : '↳ '}
                      {d.source_label || d.source}
                    </span>
                  )}
                </div>

                {/* Outcome (if decided) */}
                {d.outcome && (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-2.5">
                    <p className="text-xs text-[#6b6b67] mb-0.5 font-medium">Decision recorded:</p>
                    <p className="text-sm text-green-800">{d.outcome}</p>
                  </div>
                )}

                {/* Inline decide form */}
                {deciding === d.id ? (
                  <div className="flex gap-2 pt-1">
                    <input
                      value={outcome}
                      onChange={e => setOutcome(e.target.value)}
                      placeholder="What was decided..."
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && outcome.trim()) decide.mutate({ id: d.id, outcome })
                        if (e.key === 'Escape') { setDeciding(null); setOutcome('') }
                      }}
                    />
                    <button
                      onClick={() => decide.mutate({ id: d.id, outcome })}
                      disabled={!outcome.trim()}
                      className="text-sm bg-green-600 text-white px-3 py-2 rounded-lg disabled:opacity-40 hover:bg-green-700 flex-shrink-0"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setDeciding(null); setOutcome('') }}
                      className="text-sm text-gray-400 hover:text-gray-600 px-2"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 pt-0.5">
                    {(d.status === 'open' || !d.status) && (
                      <>
                        <button
                          onClick={() => { setDeciding(d.id); setOutcome('') }}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Record decision →
                        </button>
                        <button
                          onClick={() => dismiss.mutate(d.id)}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    {(d.status === 'decided' || d.status === 'dismissed') && (
                      <button
                        onClick={() => reopen.mutate(d.id)}
                        className="text-xs text-gray-400 hover:text-blue-600"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
