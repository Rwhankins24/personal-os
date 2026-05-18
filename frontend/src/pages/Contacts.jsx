import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getContacts, getOthersCommitments } from '../lib/api'

dayjs.extend(relativeTime)

const WARMTH_STYLES = {
  hot:    { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700',       label: 'Hot',    order: 0 },
  warm:   { dot: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700', label: 'Warm',   order: 1 },
  normal: { dot: 'bg-green-400',  badge: 'bg-green-100 text-green-700',   label: 'Normal', order: 2 },
  cool:   { dot: 'bg-blue-400',   badge: 'bg-blue-100 text-blue-700',     label: 'Cool',   order: 3 },
  cold:   { dot: 'bg-gray-300',   badge: 'bg-gray-100 text-gray-500',     label: 'Cold',   order: 4 },
}

function lastContactColor(dateStr) {
  if (!dateStr) return 'text-gray-400'
  const days = dayjs().diff(dayjs(dateStr), 'day')
  if (days < 7)  return 'text-green-600 font-medium'
  if (days <= 30) return 'text-amber-600'
  return 'text-red-500'
}

function lastContactLabel(dateStr) {
  if (!dateStr) return 'Never'
  const days = dayjs().diff(dayjs(dateStr), 'day')
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)}w ago`
  return dayjs(dateStr).format('MMM D')
}

const SORT_OPTIONS = [
  { value: 'recent',     label: 'Most recent contact' },
  { value: 'warmth',     label: 'Relationship warmth' },
  { value: 'open_items', label: 'Most open items' },
  { value: 'going_cold', label: 'Going cold' },
]

export default function Contacts() {
  const navigate = useNavigate()
  const [search,       setSearch]       = useState('')
  const [warmthFilter, setWarmthFilter] = useState('all')
  const [sort,         setSort]         = useState('recent')

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    staleTime: 1000 * 60 * 5,
  })

  // Fetch open others_commitments for open items count
  const { data: othersCommitments } = useQuery({
    queryKey: ['others-commitments', 'open'],
    queryFn: () => getOthersCommitments('open'),
    staleTime: 1000 * 60 * 5,
  })

  // Build open-item count map: email → count
  const openItemsByEmail = useMemo(() => {
    const map = {}
    for (const c of (othersCommitments || [])) {
      if (c.committed_by_email) {
        map[c.committed_by_email] = (map[c.committed_by_email] || 0) + 1
      }
    }
    return map
  }, [othersCommitments])

  // Filter
  const filtered = useMemo(() => {
    return (contacts || []).filter(c => {
      if (warmthFilter !== 'all' && c.relationship_warmth !== warmthFilter) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        c.name?.toLowerCase().includes(q)    ||
        c.company?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)   ||
        c.title?.toLowerCase().includes(q)
      )
    })
  }, [contacts, warmthFilter, search])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort === 'warmth') {
        const wa = WARMTH_STYLES[a.relationship_warmth]?.order ?? 5
        const wb = WARMTH_STYLES[b.relationship_warmth]?.order ?? 5
        if (wa !== wb) return wa - wb
        // tiebreak: most recent
        if (a.last_contact_date && b.last_contact_date)
          return new Date(b.last_contact_date) - new Date(a.last_contact_date)
        if (a.last_contact_date) return -1
        if (b.last_contact_date) return 1
        return (a.name || '').localeCompare(b.name || '')
      }

      if (sort === 'open_items') {
        const ia = openItemsByEmail[a.email] || 0
        const ib = openItemsByEmail[b.email] || 0
        if (ia !== ib) return ib - ia
        return (a.name || '').localeCompare(b.name || '')
      }

      if (sort === 'going_cold') {
        // Longest since contact first — nulls go last
        if (!a.last_contact_date && !b.last_contact_date) return (a.name || '').localeCompare(b.name || '')
        if (!a.last_contact_date) return 1
        if (!b.last_contact_date) return -1
        return new Date(a.last_contact_date) - new Date(b.last_contact_date)
      }

      // Default: most recent contact
      if (a.last_contact_date && b.last_contact_date)
        return new Date(b.last_contact_date) - new Date(a.last_contact_date)
      if (a.last_contact_date) return -1
      if (b.last_contact_date) return 1
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [filtered, sort, openItemsByEmail])

  const warmthCounts = useMemo(() => {
    return (contacts || []).reduce((acc, c) => {
      const w = c.relationship_warmth || 'cold'
      acc[w] = (acc[w] || 0) + 1
      return acc
    }, {})
  }, [contacts])

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">← Dashboard</Link>
              <span className="text-[#e5e5e3]">|</span>
              <h1 className="text-base font-semibold text-[#1a1a18]">Contacts</h1>
              {contacts && (
                <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">
                  {sorted.length}{sorted.length !== contacts.length ? ` of ${contacts.length}` : ''}
                </span>
              )}
            </div>

            {/* Sort dropdown */}
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="text-xs border border-[#e5e5e3] rounded-lg px-2 py-1.5 bg-white text-[#6b6b67] focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Search + warmth filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, company, email..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#e5e5e3] rounded-lg bg-white text-[#1a1a18] placeholder-[#6b6b67] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >×</button>
              )}
            </div>

            {/* Warmth filter pills */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setWarmthFilter('all')}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                  warmthFilter === 'all' ? 'bg-[#1a1a18] text-white' : 'text-[#6b6b67] hover:bg-gray-100'
                }`}
              >
                All
              </button>
              {['hot', 'warm', 'normal', 'cool', 'cold'].map(w => {
                const s = WARMTH_STYLES[w]
                if (!s) return null
                return (
                  <button
                    key={w}
                    onClick={() => setWarmthFilter(warmthFilter === w ? 'all' : w)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                      warmthFilter === w ? s.badge + ' ring-1 ring-inset ring-current' : 'text-[#6b6b67] hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    {s.label}
                    {warmthCounts[w] ? <span className="opacity-70">({warmthCounts[w]})</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-3xl mb-2">👥</span>
            <p className="text-sm">
              {search ? `No contacts matching "${search}"` : 'No contacts yet'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white border border-[#e5e5e3] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e3] bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Title</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Company</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Last Contact</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Open</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Warmth</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c, i) => {
                    const ws       = WARMTH_STYLES[c.relationship_warmth]
                    const openCnt  = openItemsByEmail[c.email] || 0
                    const initials = (c.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/contact/${c.id}`)}
                        className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                          i < sorted.length - 1 ? 'border-b border-[#f0f0ee]' : ''
                        }`}
                      >
                        {/* Name + avatar */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-[#1a1a18] flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                              {initials}
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-[#1a1a18] truncate">{c.name || '—'}</span>
                              {c.job_change_detected && (
                                <span title="Possible job change detected" className="text-amber-500 flex-shrink-0">⚠️</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Title */}
                        <td className="px-4 py-3">
                          {c.title
                            ? <span className="text-[#1a1a18]">{c.title}</span>
                            : <span className="text-gray-300 text-xs">—</span>
                          }
                        </td>

                        {/* Company */}
                        <td className="px-4 py-3 text-[#6b6b67]">
                          {c.company || <span className="text-gray-300 text-xs">—</span>}
                        </td>

                        {/* Last contact — colored */}
                        <td className={`px-4 py-3 text-sm ${lastContactColor(c.last_contact_date)}`}>
                          <span title={c.last_contact_date ? dayjs(c.last_contact_date).format('MMMM D, YYYY') : ''}>
                            {lastContactLabel(c.last_contact_date)}
                          </span>
                        </td>

                        {/* Open items count */}
                        <td className="px-4 py-3 text-center">
                          {openCnt > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">
                              {openCnt}
                            </span>
                          ) : (
                            <span className="text-gray-200 text-xs">—</span>
                          )}
                        </td>

                        {/* Warmth badge */}
                        <td className="px-4 py-3">
                          {ws ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ws.badge}`}>
                              {ws.label}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden space-y-2">
              {sorted.map(c => {
                const ws      = WARMTH_STYLES[c.relationship_warmth]
                const openCnt = openItemsByEmail[c.email] || 0
                const initials = (c.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/contact/${c.id}`)}
                    className="bg-white border border-[#e5e5e3] rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 transition-colors flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#1a1a18] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-[#1a1a18] truncate">{c.name}</p>
                        {c.job_change_detected && (
                          <span title="Possible job change detected" className="flex-shrink-0 text-sm">⚠️</span>
                        )}
                        {ws && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${ws.badge}`}>
                            {ws.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6b6b67] truncate">
                        {[c.company, c.title].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1">
                      <p className={`text-xs ${lastContactColor(c.last_contact_date)}`}>
                        {lastContactLabel(c.last_contact_date)}
                      </p>
                      {openCnt > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">
                          {openCnt}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
