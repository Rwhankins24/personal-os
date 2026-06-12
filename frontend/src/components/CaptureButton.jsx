import { useState } from 'react'
import CaptureModal from './CaptureModal'

export default function CaptureButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating + button — sits above chat bar, respects iOS safe area inset */}
      <button
        onClick={() => setOpen(true)}
        className="fixed left-1/2 -translate-x-1/2 z-40 h-11 px-5 rounded-full bg-[#1a1a18] text-white shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)' }}
        aria-label="Quick capture"
      >
        <span className="text-lg font-light leading-none">+</span>
        <span className="text-sm font-medium">Capture</span>
      </button>

      {open && <CaptureModal onClose={() => setOpen(false)} />}
    </>
  )
}
