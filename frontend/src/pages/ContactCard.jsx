import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getContact, getEmails, getCommitments, getProjects } from '../lib/api'
import { marked } from 'marked'

dayjs.extend(relativeTime)

function PillBadge({ label, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-600',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
    hot:    'bg-red-100 text-red-700',
    warm:   'bg-orange-100 text-orange-700',
    cool:   'bg-blue-100 text-blue-700',
    cold:   'bg-gray-100 text-gray-500',
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

export default function ContactCard() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => getContact(id),
  })
  const { data: emails }      = useQuery({ queryKey: ['emails'],      queryFn: getEmails })
  const { data: commitments } = useQuery({ queryKey: ['commitments'], queryFn: getCommitments })
  const { data: projects }    = useQuery({ queryKey: ['projects'],    queryFn: getProjects })

  // Emails involving this contact (by name match)
  const contactEmails = contact
    ? (emails || []).filter(e =>
        (e.from_name && e.from_name.includes(contact.name?.split(' ')[0] || '')) ||
        (e.from_address && contact.email && e.from_address === contact.email)
      ).slice(0, 5)
    : []

  // My commitments to this contact
  const toThem = contact
    ? (commitments || []).filter(c =>
        c.status === 'open' &&
        c.made_to &&
        c.made_to.toLowerCase().includes((contact.name || '').toLowerCase())
      )
    : []

  const linkedProject = contact?.project_id
    ? projects?.find(p => p.id === contact.project_id)
    : null

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!contact) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-gray-500">Contact not found</p>
      <button onClick={() => navigate('/')} className="text-blue-600 text-sm hover:underline">← Back</button>
    </div>
  )

  const warmthColor = contact.relationship_warmth || 'cool'

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
          {contact.relationship_warmth && (
            <PillBadge label={contact.relationship_warmth} color={warmthColor} />
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Hero */}
        <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#1a1a18] flex items-center justify-center text-xl font-bold text-white flex-shrink-0">
              {(contact.name || '?')[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1a1a18]">{contact.name}</h1>
              <p className="text-sm text-[#6b6b67]">
                {[contact.title, contact.company].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <span>✉️</span> {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-[#6b6b67]">
                <span>📞</span> {contact.phone}
              </a>
            )}
            {contact.last_contact_date && (
              <p className="text-xs text-gray-400">
                Last contact: {dayjs(contact.last_contact_date).format('MMMM D, YYYY')} ({dayjs(contact.last_contact_date).fromNow()})
              </p>
            )}
          </div>

          {linkedProject && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Project</p>
              <button
                onClick={() => navigate(`/project/${linkedProject.id}`)}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                {linkedProject.name} →
              </button>
            </div>
          )}
        </div>

        {/* AI Profile */}
        {contact.ai_profile && (
          <Section title="AI Relationship Profile">
            {contact.ai_profile_date && (
              <p className="text-xs text-gray-400 mb-2">
                Generated {dayjs(contact.ai_profile_date).fromNow()}
              </p>
            )}
            <div
              className="prose prose-sm max-w-none text-[#1a1a18]"
              dangerouslySetInnerHTML={{ __html: marked.parse(contact.ai_profile, { breaks: true, gfm: true }) }}
            />
          </Section>
        )}

        {/* Open commitments to this person */}
        {toThem.length > 0 && (
          <Section title="My Open Commitments" count={toThem.length}>
            <div className="space-y-2">
              {toThem.map(c => (
                <div key={c.id} className="flex items-start gap-2 p-2 bg-orange-50 rounded-lg">
                  <span className="text-orange-500 mt-0.5 text-xs">→</span>
                  <div>
                    <p className="text-sm text-[#1a1a18]">{c.title}</p>
                    {c.due_date && (
                      <p className={`text-xs mt-0.5 ${dayjs(c.due_date).isBefore(dayjs()) ? 'text-red-500' : 'text-gray-500'}`}>
                        Due {dayjs(c.due_date).format('MMM D, YYYY')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Recent emails */}
        {contactEmails.length > 0 && (
          <Section title="Recent Emails" count={contactEmails.length}>
            <div className="space-y-2">
              {contactEmails.map(e => (
                <div key={e.id} className="border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                  <p className="text-sm font-medium text-[#1a1a18] truncate">
                    {e.thread_subject || e.subject}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {e.status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        e.status === 'needs_reply' ? 'bg-red-100 text-red-600' :
                        e.status === 'waiting_on'  ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {e.status.replace('_', ' ')}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {dayjs(e.received_at).format('MMM D')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Notes */}
        {contact.notes && (
          <Section title="Notes">
            <p className="text-sm text-[#1a1a18] whitespace-pre-wrap">{contact.notes}</p>
          </Section>
        )}

        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((tag, i) => (
              <PillBadge key={i} label={tag} color="gray" />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
