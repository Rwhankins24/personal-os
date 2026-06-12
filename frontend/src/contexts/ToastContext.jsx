import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

// ── Toast icons by type ────────────────────────────────────────
const TYPE_STYLES = {
  success:  { bg: 'bg-[#1a1a18]',     dot: 'bg-green-400' },
  info:     { bg: 'bg-[#1B2A4A]',     dot: 'bg-blue-400'  },
  warning:  { bg: 'bg-amber-700',     dot: 'bg-amber-300'  },
  error:    { bg: 'bg-red-700',       dot: 'bg-red-300'    },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((msg, { icon = '✓', type = 'success', duration = 2800 } = {}) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-3), { id, msg, icon, type }]) // cap at 4 visible
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* ── Toast container ── */}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 left-0 right-0 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4"
          aria-live="polite"
        >
          {toasts.map(t => {
            const styles = TYPE_STYLES[t.type] || TYPE_STYLES.success
            return (
              <div
                key={t.id}
                className={`${styles.bg} text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2.5 max-w-xs`}
                style={{
                  animation: 'toastIn 0.2s ease forwards',
                }}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
                {t.icon && t.icon !== '✓' && <span className="text-base leading-none flex-shrink-0">{t.icon}</span>}
                <span className="leading-snug">{t.msg}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* keyframe injected once */}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
