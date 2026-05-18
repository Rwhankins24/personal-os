import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getContacts } from '../lib/api'

dayjs.extend(relativeTime)

const WARMTH_STYLES = {
  hot:  { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700',       label: 'Hot'  },
  warm: { dot: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700', label: 'Warm' },
  cool: { dot: 'bg-blue-400',   badge: 'bg-blue-100 text-blue-700',     label: 'Cool' },
  cold: { dot: 'bg-gray-300',   badge: 'bg-gray-100 text-gray-500',     label: 'Cold' },
}

const WARMTH_ORDER = { hot: 0, warm: 1, cool: 2, cold: 3, null: 4, undefined: 4 }

export default function Contacts() {
  const navigate   = useNavigate()
  const [search, setSearch]         = useState('')
  const [warmthFilter, setWarmthFilter] = useState('all')

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    staleTime: 1000 * 60 * 5,
  })

  // Filter + sort
  const filtered = (contacts || [])
    .filter(c => {
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
    .sort((a, b) => {
      // Warmth first, then most-recent contact, then alphabetical
      const wa = WARMTH_ORDER[a.relationship_warmth] ?? 4
      const wb = WARMTH_ORDER[b.relationship_warmth] ?? 4
      if (wa !== wb) return wa - wb
      if (a.last_contact_date && b.last_contact_date)
        return new Date(b.last_contact_date) - new Date(a.last_contact_date)
      if (a.last_contact_date) return -1
      if (b.last_contact_date) return 1
      return (a.name || '').localeCompare(b.name || '')
    })

  const warmthCounts = (contacts || []).reduce((acc, c) => {
    const w = c.relationship_warmth || 'cold'
    acc[w] = (acc[w] || 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-[#f8f8f6]">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#f8f8f6]/95 backdrop-blur border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="text-sm text-[#6b6b67] hover:text-[#1a1a18]"
              >
                ← Dashboard
              </Link>
              <span className="text-[#e5e5e3]">|</span>
              <h1 className="text-base font-semibold text-[#1a1a18]">Contacts</h1>
              {contacts && (
                <span className="text-xs bg-gray-100 text-[#6b6b67] px-2 py-0.5 rounded-full">
                  {filtered.length}{filtered.length !== contacts.length ? ` of ${contacts.length}` : ''}
                </span>
              )}
            </div>
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
                >
                  ×
                </button>
              )}
            </div>

            {/* Warmth filter pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWarmthFilter('all')}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                  warmthFilter === 'all' ? 'bg-[#1a1a18] text-white' : 'text-[#6b6b67] hover:bg-gray-100'
                }`}
              >
                All
              </button>
              {['hot', 'warm', 'cool', 'cold'].map(w => {
                const s = WARMTH_STYLES[w]
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
        ) : filtered.length === 0 ? (
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
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Company / Title</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Last Contact</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6b67] uppercase tracking-wide">Warmth</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => {
                    const ws = WARMTH_STYLES[c.relationship_warmth]
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/contact/${c.id}`)}
                        className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                          i < filtered.length - 1 ? 'border-b border-[#f0f0ee]' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-[#1a1a18] flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                              {(c.name || '?')[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-[#1a1a18]">{c.name || '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#6b6b67]">
                          <div>
                            {c.company && <span className="font-medium text-[#1a1a18]">{c.company}</span>}
                            {c.company && c.title && <span className="text-[#6b6b67]"> · </span>}
                            {c.title && <span>{c.title}</span>}
                            {!c.company && !c.title && '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#6b6b67]">
                          {c.last_contact_date ? (
                            <span title={dayjs(c.last_contact_date).format('MMMM D, YYYY')}>
                              {dayjs(c.last_contact_date).fromNow()}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
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
              {filtered.map(c => {
                const ws = WARMTH_STYLES[c.relationship_warmth]
                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/contact/${c.id}`)}
                    className="bg-white border border-[#e5e5e3] rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 transition-colors flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#1a1a18] flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {(c.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-[#1a1a18] truncate">{c.name}</p>
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
                    <div className="text-right flex-shrink-0">
                      {c.last_contact_date ? (
                        <p className="text-xs text-gray-400">{dayjs(c.last_contact_date).fromNow()}</p>
                      ) : null}
                      <span className="text-gray-300 text-sm">›</span>
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
