import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { getContacts, getOthersCommitments, updateContact, updateOthersCommitment, createTask } from '../lib/api'
import { useToast } from '../contexts/ToastContext'

const INTERNAL_DOMAINS = new Set([
  'claycorp.com', 'theljc.com', 'realcrg.com', 'concretestrategies.com', 'ventana.vc',
])

function isInternal(email) {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && INTERNAL_DOMAINS.has(domain)
}

function initials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

const TYPE_ICONS = {
  blocking: '🚧',
  to_ryan:  '📬',
  general:  '📋',
}

export default function ContactDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [form,     setForm]     = useState({})
  const toast = useToast()

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn:  getContacts,
  })

  const { data: othersCommitments } = useQuery({
    queryKey: ['others-commitments'],
    queryFn:  () => getOthersCommitments('open'),
  })

  const contact = contacts?.find(c => c.id === id)

  const openItems = (othersCommitments || []).filter(oc => {
    if (oc.contact_id) return oc.contact_id === contact?.id
    // fallback: email match for unlinked items
    if (oc.committed_by_email && contact?.email)
      return oc.committed_by_email.toLowerCase() === contact.email.toLowerCase()
    return false
  })

  const update = useMutation({
    mutationFn: (data) => updateContact(id, data),
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ['contacts'] })
      const prev = qc.getQueryData(['contacts'])
      qc.setQueryData(['contacts'], old =>
        (old || []).map(c => c.id === id ? { ...c, ...data } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['contacts'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const toggleKey = useMutation({
    mutationFn: () => updateContact(id, { is_key_contact: !contact?.is_key_contact }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['contacts'] })
      const prev = qc.getQueryData(['contacts'])
      qc.setQueryData(['contacts'], old =>
        (old || []).map(c => c.id === id ? { ...c, is_key_contact: !c.is_key_contact } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['contacts'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })

  const markItemDone = useMutation({
    mutationFn: (itemId) => updateOthersCommitment(itemId, { status: 'closed' }),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: ['others-commitments'] })
      const prev = qc.getQueryData(['others-commitments'])
      qc.setQueryData(['others-commitments'], old =>
        (old || []).map(c => c.id === itemId ? { ...c, status: 'closed' } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['others-commitments'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['others-commitments'] }),
    onSuccess: () => toast('Item marked done', { icon: '✓' }),
  })

  const promoteItemToTask = useMutation({
    mutationFn: async (item) => {
      await createTask({
        title:      item.title,
        urgency:    item.urgency || 'medium',
        status:     'open',
        source:     'manual',
        project_id: item.project_id || null,
      })
      await updateOthersCommitment(item.id, { status: 'archived' })
      return item.id
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['others-commitments'] })
      const prev = qc.getQueryData(['others-commitments'])
      qc.setQueryData(['others-commitments'], old =>
        (old || []).map(c => c.id === item.id ? { ...c, status: 'archived' } : c)
      )
      return { prev }
    },
    onError: (_, __, ctx) => qc.setQueryData(['others-commitments'], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['others-commitments'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onSuccess: () => toast('Added to My Tasks', { icon: '→' }),
  })

  function openEdit() {
    setForm({
      display_name: contact?.display_name  || '',
      title:        contact?.title        || '',
      company:      contact?.company      || '',
      phone_mobile: contact?.phone_mobile || '',
      phone_work:   contact?.phone_work   || '',
      address:      contact?.address      || '',
    })
    setEditOpen(true)
  }

  if (isLoading) return (
    <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (!contact) return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col items-center justify-center gap-3">
      <p className="text-[#6b6b67]">Contact not found</p>
      <button onClick={() => navigate(-1)} className="text-blue-600 text-sm hover:underline">← Back</button>
    </div>
  )

  const internal = isInternal(contact.email)

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* ── Sticky top bar ─────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
          >
            ← Back
          </button>
          <p className="text-sm font-semibold text-[#1a1a18] truncate flex-1 text-center">
            {contact.name}
          </p>
          <button
            onClick={() => toggleKey.mutate()}
            title={contact.is_key_contact ? 'Remove from key contacts' : 'Mark as key contact'}
            className={`text-xl flex-shrink-0 transition-opacity ${
              contact.is_key_contact ? 'opacity-100' : 'opacity-25 hover:opacity-60'
            }`}
          >
            ⭐
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* Header card */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <div className="flex items-start gap-4">
            {/* Initials circle */}
            <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600 flex-shrink-0">
              {initials(contact.name)}
            </div>

            {/* Name / title / company */}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-[#1a1a18] leading-snug">{contact.name}</h1>
              {contact.title   && <p className="text-sm text-[#6b6b67]">{contact.title}</p>}
              {contact.company && <p className="text-sm text-[#6b6b67]">{contact.company}</p>}
            </div>
          </div>

          {/* Contact lines */}
          <div className="mt-4 space-y-2">
            {contact.phone_mobile && (
              <div className="flex items-center gap-2 text-sm text-[#1a1a18]">
                <span>📱</span>
                <a href={`tel:${contact.phone_mobile}`} className="hover:underline">{contact.phone_mobile}</a>
              </div>
            )}
            {contact.phone_work && (
              <div className="flex items-center gap-2 text-sm text-[#1a1a18]">
                <span>📞</span>
                <a href={`tel:${contact.phone_work}`} className="hover:underline">{contact.phone_work}</a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2 text-sm text-[#1a1a18]">
                <span>✉</span>
                <a href={`mailto:${contact.email}`} className="hover:underline truncate">{contact.email}</a>
              </div>
            )}
            {contact.address && (
              <div className="flex items-center gap-2 text-sm text-[#1a1a18]">
                <span>📍</span>
                <span>{contact.address}</span>
              </div>
            )}
          </div>

          {/* Internal / External badge */}
          <div className="mt-4 flex justify-end">
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              internal
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {internal ? 'Internal' : 'External'}
            </span>
          </div>
        </div>

        {/* Open items card */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-[#1a1a18] mb-3">
            Waiting on {contact.name?.split(' ')[0]}
          </h2>
          {openItems.length === 0 ? (
            <p className="text-sm text-[#6b6b67] italic">No open items.</p>
          ) : (
            <div className="space-y-2">
              {openItems.map(item => {
                const overdue = item.due_date && dayjs(item.due_date).isBefore(dayjs(), 'day')
                const typeIcon = TYPE_ICONS[item.delivery_type] || TYPE_ICONS.general
                return (
                  <div key={item.id} className="flex items-start gap-2.5">
                    <span className="text-base flex-shrink-0 mt-0.5">{typeIcon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1a1a18] leading-snug">{item.title}</p>
                      {item.due_date && (
                        <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500 font-medium' : 'text-[#6b6b67]'}`}>
                          Due {dayjs(item.due_date).format('MMM D, YYYY')}
                        </p>
                      )}
                    </div>
                    {overdue && (
                      <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                        Overdue
                      </span>
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                      <button
                        onClick={() => markItemDone.mutate(item.id)}
                        disabled={markItemDone.isPending}
                        className="w-7 h-7 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[#6b6b67] hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all text-xs"
                        title="Mark done"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => promoteItemToTask.mutate(item)}
                        disabled={promoteItemToTask.isPending}
                        className="h-7 px-2 rounded-full border border-[#e5e5e3] flex items-center justify-center text-[10px] font-medium text-[#6b6b67] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all whitespace-nowrap"
                        title="Add to my tasks"
                      >
                        → Me
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Edit card */}
        <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4">
          <button
            onClick={() => editOpen ? setEditOpen(false) : openEdit()}
            className="w-full flex items-center justify-between text-sm font-semibold text-[#1a1a18]"
          >
            <span>Edit contact</span>
            <span className="text-[#6b6b67]">{editOpen ? '▲' : '▼'}</span>
          </button>

          {editOpen && (
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Display Name</label>
                <input
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Short alias shown in the app"
                />
                <p className="text-xs text-[#9b9b97] mt-1">Short name shown in the app. Original name used for email matching.</p>
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Job title"
                />
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Company</label>
                <input
                  value={form.company}
                  onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Mobile phone</label>
                <input
                  value={form.phone_mobile}
                  onChange={e => setForm(f => ({ ...f, phone_mobile: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Work phone</label>
                <input
                  value={form.phone_work}
                  onChange={e => setForm(f => ({ ...f, phone_work: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
              <div>
                <label className="text-xs text-[#6b6b67] block mb-1">Address</label>
                <input
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Street, City, State"
                />
              </div>
              <button
                onClick={() => update.mutate(form)}
                disabled={update.isPending}
                className="px-4 py-2 bg-[#1a1a18] text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-800 transition-colors"
              >
                {saved ? '✓ Saved' : update.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
