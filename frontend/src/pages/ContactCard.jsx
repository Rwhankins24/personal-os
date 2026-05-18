import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getContact, getContacts, getEmails, getCommitments, getProjects, updateContact, deleteContact } from '../lib/api'
import { marked } from 'marked'

dayjs.extend(relativeTime)

// ── Shared UI ──────────────────────────────────────────────────
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

function FieldInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
      />
    </div>
  )
}

function FieldTextarea({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        rows={rows}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white resize-none"
      />
    </div>
  )
}

// ── Merge Modal ────────────────────────────────────────────────
function MergeModal({ contact, allContacts, onClose, onMerged }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(null)
  const [merging, setMerging]   = useState(false)
  const [error, setError]       = useState(null)

  const firstName = (contact.name || '').trim().split(/\s+/)[0].toLowerCase()
  const lastName  = (contact.name || '').trim().split(/\s+/).slice(-1)[0].toLowerCase()
  const candidates = (allContacts || []).filter(c => {
    if (c.id === contact.id) return false
    const cn = (c.name || '').toLowerCase()
    return (firstName.length > 1 && cn.includes(firstName)) ||
           (lastName.length > 1  && cn.includes(lastName))
  })

  async function doMerge() {
    if (!selected) return
    setMerging(true)
    setError(null)
    try {
      const mergedUpdates = {}
      if (!selected.secondary_email && contact.email !== selected.email) {
        mergedUpdates.secondary_email = contact.email
      }
      const fillIfEmpty = ['title', 'company', 'phone_mobile', 'phone_office',
                           'phone_mobile_2', 'phone_office_2', 'linkedin', 'address',
                           'notes', 'last_contact_date']
      for (const f of fillIfEmpty) {
        if (!selected[f] && contact[f]) mergedUpdates[f] = contact[f]
      }
      await updateContact(selected.id, mergedUpdates)
      await deleteContact(contact.id)
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contact', selected.id] })
      onMerged(selected.id)
    } catch (err) {
      setError(err.message || 'Merge failed')
      setMerging(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#e5e5e3]">
          <h2 className="text-base font-semibold text-[#1a1a18]">Merge Contact</h2>
          <p className="text-xs text-[#6b6b67] mt-0.5">
            Select which record to keep. The other will be deleted and its data absorbed.
          </p>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No similar contacts found.</p>
          ) : (
            candidates.map(c => (
              <div
                key={c.id}
                onClick={() => setSelected(selected?.id === c.id ? null : c)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  selected?.id === c.id
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-[#e5e5e3] hover:border-blue-200 hover:bg-gray-50'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-[#1a1a18] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {(c.name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a18]">{c.name}</p>
                  <p className="text-xs text-[#6b6b67] truncate">
                    {[c.title, c.company].filter(Boolean).join(' · ') || c.email || '—'}
                  </p>
                  {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                </div>
                {selected?.id === c.id && <span className="text-blue-500 text-sm flex-shrink-0">✓</span>}
              </div>
            ))
          )}
        </div>
        {error && <p className="px-5 text-xs text-red-500">{error}</p>}
        <div className="px-5 py-4 border-t border-[#e5e5e3] flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={doMerge}
            disabled={!selected || merging}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700"
          >
            {merging ? 'Merging…' : `Merge into ${selected?.name || '…'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete Confirmation ────────────────────────────────────────
function DeleteConfirm({ contactName, onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-[#1a1a18] mb-2">Delete contact?</h2>
        <p className="text-sm text-[#6b6b67] mb-5">
          <span className="font-medium text-[#1a1a18]">{contactName}</span> and all associated
          data will be permanently removed. This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 text-sm px-4 py-2 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 text-sm px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-40"
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function ContactCard() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  // UI state
  const [editing, setEditing]       = useState(false)
  const [showMerge, setShowMerge]   = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [form, setForm]             = useState({})

  // Data
  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => getContact(id),
  })
  const { data: allContacts } = useQuery({ queryKey: ['contacts'],    queryFn: getContacts })
  const { data: emails }      = useQuery({ queryKey: ['emails'],      queryFn: getEmails })
  const { data: commitments } = useQuery({ queryKey: ['commitments'], queryFn: getCommitments })
  const { data: projects }    = useQuery({ queryKey: ['projects'],    queryFn: getProjects })

  // Save mutation
  const save = useMutation({
    mutationFn: (updates) => updateContact(id, updates),
    onSuccess: (updated) => {
      qc.setQueryData(['contact', id], old => ({ ...old, ...updated }))
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setEditing(false)
    },
  })

  // Inline job-change actions (no edit mode required)
  const acceptCompany = useMutation({
    mutationFn: () => updateContact(id, {
      company: contact.company_pending,
      company_pending: null,
      job_change_detected: false,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(['contact', id], old => ({ ...old, ...updated }))
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const keepCompany = useMutation({
    mutationFn: () => updateContact(id, {
      company_pending: null,
      job_change_detected: false,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(['contact', id], old => ({ ...old, ...updated }))
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      navigate('/contacts')
    },
  })

  // Derived
  const contactEmails = contact
    ? (emails || []).filter(e =>
        (e.from_name && e.from_name.includes(contact.name?.split(' ')[0] || '')) ||
        (e.from_address && contact.email && e.from_address === contact.email)
      ).slice(0, 5)
    : []

  const toThem = contact
    ? (commitments || []).filter(c =>
        c.status === 'open' &&
        c.made_to?.toLowerCase().includes((contact.name || '').toLowerCase())
      )
    : []

  const linkedProject = contact?.project_id
    ? projects?.find(p => p.id === contact.project_id)
    : null

  function startEdit() {
    setForm({
      name:                 contact.name                 || '',
      title:                contact.title                || '',
      company:              contact.company              || '',
      phone_mobile:         contact.phone_mobile         || '',
      phone_mobile_2:       contact.phone_mobile_2       || '',
      phone_office:         contact.phone_office         || '',
      phone_office_2:       contact.phone_office_2       || '',
      linkedin:             contact.linkedin             || '',
      address:              contact.address              || '',
      notes:                contact.notes                || '',
      relationship_warmth:  contact.relationship_warmth  || '',
    })
    setEditing(true)
  }

  function cancelEdit() {
    setForm({})
    setEditing(false)
  }

  // ── Loading / not found ──────────────────────────────────────
  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!contact) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-gray-500">Contact not found</p>
      <button onClick={() => navigate('/contacts')} className="text-blue-600 text-sm hover:underline">← Contacts</button>
    </div>
  )

  const warmthColor = contact.relationship_warmth || 'cool'

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Modals */}
      {showMerge && (
        <MergeModal
          contact={contact}
          allContacts={allContacts}
          onClose={() => setShowMerge(false)}
          onMerged={(targetId) => navigate(`/contact/${targetId}`)}
        />
      )}
      {showDelete && (
        <DeleteConfirm
          contactName={contact.name}
          onConfirm={() => remove.mutate()}
          onCancel={() => setShowDelete(false)}
          isPending={remove.isPending}
        />
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/contacts')} className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">
            ← Contacts
          </button>
          <div className="flex items-center gap-2">
            {!editing && (
              <button
                onClick={() => setShowMerge(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50 transition-colors"
              >
                Merge
              </button>
            )}
            {editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => save.mutate(form)}
                  disabled={save.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a18] text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#e5e5e3] text-[#6b6b67] hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Hero card */}
        <div className="bg-white border border-[#e5e5e3] rounded-xl p-4">
          {editing ? (
            // ── Edit mode ──────────────────────────────────────
            <div className="space-y-3">
              <FieldInput label="Name"    value={form.name}    onChange={v => setForm(f => ({ ...f, name: v }))} />
              <FieldInput label="Title"   value={form.title}   onChange={v => setForm(f => ({ ...f, title: v }))} />

              {/* Company + pending banner */}
              {contact.company_pending && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-amber-800 mb-1.5">
                    ⚠️ AI detected possible job change → <span className="font-bold">{contact.company_pending}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => acceptCompany.mutate()}
                      disabled={acceptCompany.isPending}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-40"
                    >
                      Accept new company
                    </button>
                    <button
                      type="button"
                      onClick={() => keepCompany.mutate()}
                      disabled={keepCompany.isPending}
                      className="text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                    >
                      Keep current
                    </button>
                  </div>
                </div>
              )}

              <FieldInput label="Company" value={form.company} onChange={v => setForm(f => ({ ...f, company: v }))} />

              <div className="grid grid-cols-2 gap-3">
                <FieldInput label="Mobile"   value={form.phone_mobile}   onChange={v => setForm(f => ({ ...f, phone_mobile: v }))}   placeholder="+1 555 000 0000" />
                <FieldInput label="Mobile 2" value={form.phone_mobile_2} onChange={v => setForm(f => ({ ...f, phone_mobile_2: v }))} placeholder="+1 555 000 0000" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldInput label="Office Phone"   value={form.phone_office}   onChange={v => setForm(f => ({ ...f, phone_office: v }))}   placeholder="+1 555 000 0000" />
                <FieldInput label="Office Phone 2" value={form.phone_office_2} onChange={v => setForm(f => ({ ...f, phone_office_2: v }))} placeholder="+1 555 000 0000" />
              </div>

              <FieldInput label="LinkedIn URL" value={form.linkedin} onChange={v => setForm(f => ({ ...f, linkedin: v }))} type="url" placeholder="https://linkedin.com/in/…" />
              <FieldTextarea label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} rows={2} placeholder="Office address" />
              <FieldTextarea label="Notes"   value={form.notes}   onChange={v => setForm(f => ({ ...f, notes: v }))}   rows={3} />

              <div>
                <label className="text-xs text-gray-500 block mb-1">Relationship</label>
                <select
                  value={form.relationship_warmth}
                  onChange={e => setForm(f => ({ ...f, relationship_warmth: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">— select —</option>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="normal">Normal</option>
                  <option value="cool">Cool</option>
                  <option value="cold">Cold</option>
                </select>
              </div>

              {save.isError && (
                <p className="text-xs text-red-500">Save failed: {save.error?.message}</p>
              )}
            </div>
          ) : (
            // ── View mode ──────────────────────────────────────
            <>
              {/* Job change pending banner (view mode) */}
              {contact.company_pending && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-amber-800 mb-1.5">
                    ⚠️ AI detected possible job change → <span className="font-bold">{contact.company_pending}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => acceptCompany.mutate()}
                      disabled={acceptCompany.isPending}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-40"
                    >
                      Accept new company
                    </button>
                    <button
                      type="button"
                      onClick={() => keepCompany.mutate()}
                      disabled={keepCompany.isPending}
                      className="text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                    >
                      Keep current
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-[#1a1a18] flex items-center justify-center text-xl font-bold text-white flex-shrink-0">
                  {(contact.name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-[#1a1a18]">{contact.name}</h1>
                    {contact.relationship_warmth && (
                      <PillBadge label={contact.relationship_warmth} color={warmthColor} />
                    )}
                    {contact.enriched && (
                      <span title="Profile enriched from email signatures" className="text-xs text-gray-400">✦ enriched</span>
                    )}
                  </div>
                  {contact.title && (
                    <p className="text-sm font-medium text-[#1a1a18] mt-0.5">{contact.title}</p>
                  )}
                  {contact.company && (
                    <p className="text-sm text-[#6b6b67]">{contact.company}</p>
                  )}
                  {contact.previous_title && (
                    <p className="text-xs text-gray-400 mt-0.5">Prev: {contact.previous_title}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <span>✉️</span> {contact.email}
                  </a>
                )}
                {contact.secondary_email && (
                  <a href={`mailto:${contact.secondary_email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline opacity-70">
                    <span>✉️</span> {contact.secondary_email}
                  </a>
                )}
                {contact.phone_mobile && (
                  <a href={`tel:${contact.phone_mobile}`} className="flex items-center gap-2 text-sm text-[#1a1a18] hover:text-blue-600">
                    <span>📱</span> {contact.phone_mobile}
                    {contact.phone_mobile_2 && <span className="text-[#6b6b67]"> · {contact.phone_mobile_2}</span>}
                  </a>
                )}
                {contact.phone_office && (
                  <a href={`tel:${contact.phone_office}`} className="flex items-center gap-2 text-sm text-[#1a1a18] hover:text-blue-600">
                    <span>📞</span> {contact.phone_office}
                    {contact.phone_office_2 && <span className="text-[#6b6b67]"> · {contact.phone_office_2}</span>}
                  </a>
                )}
                {contact.phone && !contact.phone_mobile && !contact.phone_office && (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-[#6b6b67] hover:text-blue-600">
                    <span>📞</span> {contact.phone}
                  </a>
                )}
                {contact.linkedin && (
                  <a
                    href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <span>🔗</span> LinkedIn
                  </a>
                )}
                {contact.address && (
                  <p className="flex items-start gap-2 text-sm text-[#6b6b67]">
                    <span className="flex-shrink-0">📍</span>
                    <span>{contact.address}</span>
                  </p>
                )}
                {contact.last_contact_date && (
                  <p className="text-xs text-gray-400 pt-1">
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
            </>
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
            {/* Enriched_at indicator */}
            <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
              {contact.enriched_at
                ? `Last enriched by AI: ${dayjs(contact.enriched_at).format('MMMM D, YYYY')}`
                : 'Not yet AI enriched'}
            </p>
          </Section>
        )}

        {/* Enriched_at — shown even without AI profile */}
        {!contact.ai_profile && (
          <div className="bg-white border border-[#e5e5e3] rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400">
              {contact.enriched_at
                ? `Last enriched by AI: ${dayjs(contact.enriched_at).format('MMMM D, YYYY')}`
                : 'Not yet AI enriched'}
            </p>
          </div>
        )}

        {/* My open commitments to this person */}
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
        {contact.notes && !editing && (
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

        {/* Danger zone */}
        <div className="bg-white border border-red-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Danger Zone</p>
          <button
            onClick={() => setShowDelete(true)}
            className="text-sm text-red-600 hover:text-red-700 hover:underline"
          >
            Delete this contact
          </button>
          <p className="text-xs text-gray-400 mt-1">
            Permanently removes this contact and all associated data.
          </p>
        </div>

      </div>
    </div>
  )
}
