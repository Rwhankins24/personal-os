// SyncButton — floating action button to manually trigger the email report processor.
// Calls POST /api/jobs/process-email-report with x-trigger-secret header.
// States: idle → syncing → success | error → (auto-reset to idle after 3s)

import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'https://personal-os-five-black.vercel.app'
const TRIGGER_SECRET = import.meta.env.VITE_TRIGGER_SECRET || ''

export default function SyncButton() {
  const [status, setStatus]   = useState('idle')   // idle | syncing | success | error
  const [lastSync, setLastSync] = useState(null)
  const [detail, setDetail]   = useState(null)

  const triggerSync = async () => {
    if (status === 'syncing') return
    setStatus('syncing')
    setDetail(null)

    try {
      const res = await fetch(`${API_BASE}/api/jobs/process-email-report`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-trigger-secret':  TRIGGER_SECRET,
        },
        body: JSON.stringify({})
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setStatus('success')
        setLastSync(new Date().toLocaleTimeString())
        setDetail(`${data.summary?.total_pushed ?? '?'} records pushed`)
        setTimeout(() => setStatus('idle'), 3000)
      } else {
        setStatus('error')
        setDetail(data.error || `HTTP ${res.status}`)
        setTimeout(() => setStatus('idle'), 4000)
      }
    } catch (err) {
      setStatus('error')
      setDetail(err.message)
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const bgColor = {
    idle:    'bg-blue-600 hover:bg-blue-700',
    syncing: 'bg-blue-400 cursor-not-allowed',
    success: 'bg-green-500 hover:bg-green-600',
    error:   'bg-red-500 hover:bg-red-600',
  }[status]

  const tooltip = status === 'success' && lastSync
    ? `Last sync: ${lastSync}${detail ? ' · ' + detail : ''}`
    : status === 'error' && detail
    ? `Error: ${detail}`
    : lastSync
    ? `Last sync: ${lastSync}`
    : 'Sync email report now'

  return (
    <div className="fixed bottom-6 right-6 flex flex-col items-end gap-1">
      {/* Detail toast */}
      {detail && (status === 'success' || status === 'error') && (
        <div className={`
          text-xs text-white px-3 py-1 rounded-full shadow-md
          ${status === 'success' ? 'bg-green-500' : 'bg-red-500'}
        `}>
          {detail}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={triggerSync}
        disabled={status === 'syncing'}
        title={tooltip}
        className={`
          w-14 h-14 rounded-full
          flex items-center justify-center
          shadow-lg transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
          ${bgColor}
        `}
      >
        {status === 'idle' && (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}

        {status === 'syncing' && (
          <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 22 6.373 22 12h-4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}

        {status === 'success' && (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}

        {status === 'error' && (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </button>
    </div>
  )
}
