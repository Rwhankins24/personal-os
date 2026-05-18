import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getProjects, getTasks, getCommitments, getContacts } from '../lib/api'

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

function Section({ title, children, count }) {
  return (
    <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[#1a1a18]">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function ProjectCard() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'],    queryFn: getProjects })
  const { data: tasks }               = useQuery({ queryKey: ['tasks'],       queryFn: getTasks })
  const { data: commitments }         = useQuery({ queryKey: ['commitments'], queryFn: getCommitments })
  const { data: contacts }            = useQuery({ queryKey: ['contacts'],    queryFn: getContacts })

  const project = projects?.find(p => p.id === id)

  const projectTasks        = (tasks || []).filter(t => t.project_id === id && t.status !== 'done' && t.status !== 'archived')
  const projectCommitments  = (commitments || []).filter(c => c.project_id === id && c.status === 'open')
  const projectContacts     = (contacts || []).filter(c => c.project_id === id)

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!project) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-gray-500">Project not found</p>
      <button onClick={() => navigate('/')} className="text-blue-600 text-sm hover:underline">← Back</button>
    </div>
  )

  const risks     = project.risk_signals || []
  const decisions = project.decisions_made || []
  const keyFacts  = project.key_facts || []
  const intel     = project.intelligence_notes || {}

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18]"
          >
            ← Back
          </button>
          {project.status && (
            <PillBadge
              label={project.status}
              color={project.status === 'active' ? 'green' : project.status === 'pursuit' ? 'blue' : 'gray'}
            />
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Hero */}
        <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
          <h1 className="text-xl font-bold text-[#1a1a18]">{project.name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-sm text-[#6b6b67]">
            {project.client     && <span>{project.client}</span>}
            {project.location   && <span>· {project.location}</span>}
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
        </div>

        {/* Risk signals */}
        {risks.length > 0 && (
          <Section title="Risk Signals" count={risks.length}>
            <div className="space-y-2">
              {risks.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg">
                  <span className="text-red-500 text-sm mt-0.5">⚠️</span>
                  <p className="text-sm text-[#1a1a18]">{typeof r === 'string' ? r : r.signal || r.description || JSON.stringify(r)}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Decisions made */}
        {decisions.length > 0 && (
          <Section title="Decisions Made" count={decisions.length}>
            <div className="space-y-2">
              {decisions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-green-50 rounded-lg">
                  <span className="text-green-600 text-sm mt-0.5">✓</span>
                  <p className="text-sm text-[#1a1a18]">{typeof d === 'string' ? d : d.decision || d.description || JSON.stringify(d)}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Key facts */}
        {keyFacts.length > 0 && (
          <Section title="Key Facts" count={keyFacts.length}>
            <div className="space-y-1.5">
              {keyFacts.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-blue-500 text-xs mt-0.5">•</span>
                  <p className="text-sm text-[#1a1a18]">{typeof f === 'string' ? f : JSON.stringify(f)}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* AI intelligence notes */}
        {intel && Object.keys(intel).length > 0 && (
          <Section title="AI Intelligence">
            <div className="space-y-3">
              {Object.entries(intel).map(([key, value]) => {
                if (!value || (Array.isArray(value) && value.length === 0)) return null
                return (
                  <div key={key}>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      {key.replace(/_/g, ' ')}
                    </p>
                    {Array.isArray(value) ? (
                      <div className="space-y-1">
                        {value.map((v, i) => (
                          <p key={i} className="text-sm text-[#1a1a18]">
                            • {typeof v === 'string' ? v : JSON.stringify(v)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[#1a1a18] whitespace-pre-wrap">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Open tasks */}
        {projectTasks.length > 0 && (
          <Section title="Open Tasks" count={projectTasks.length}>
            <div className="space-y-2">
              {projectTasks.map(t => (
                <div
                  key={t.id}
                  onClick={() => navigate(`/task/${t.id}`)}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <span className="text-gray-400 text-xs">○</span>
                  <p className="text-sm text-[#1a1a18] flex-1">{t.title}</p>
                  {t.urgency === 'critical' && <PillBadge label="critical" color="red" />}
                  {t.urgency === 'high'     && <PillBadge label="high"     color="orange" />}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Open commitments */}
        {projectCommitments.length > 0 && (
          <Section title="Open Commitments" count={projectCommitments.length}>
            <div className="space-y-2">
              {projectCommitments.map(c => (
                <div key={c.id} className="flex items-start gap-2">
                  <span className="text-orange-400 mt-0.5 text-xs">•</span>
                  <div>
                    <p className="text-sm text-[#1a1a18]">{c.title}</p>
                    {c.made_to && <p className="text-xs text-gray-500">To: {c.made_to}</p>}
                    {c.due_date && <p className="text-xs text-gray-500">Due {dayjs(c.due_date).format('MMM D')}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Contacts */}
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
    </div>
  )
}
