import { useState } from 'react'
import CaptureModal from './CaptureModal'

export default function CaptureButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating + button — bottom center, between chat (left) and sync (right) */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 h-11 px-5 rounded-full bg-[#1a1a18] text-white shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
        aria-label="Quick capture"
      >
        <span className="text-lg font-light leading-none">+</span>
        <span className="text-sm font-medium">Capture</span>
      </button>

      {open && <CaptureModal onClose={() => setOpen(false)} />}
    </>
  )
}
