// MeetingUpload — drag-drop or file-picker upload for meeting transcripts and summaries
// Placed on the Dashboard; uploads to /api/upload-meeting and shows result

import { useState, useRef } from 'react'
import { uploadMeetingFile } from '../lib/api'

const ACCEPTED = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

export default function MeetingUpload({ onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)   // { title, detected_type, word_count, id }
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().split('T')[0])
  const fileRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    setError(null)
    setResult(null)
    setUploading(true)

    try {
      const fd = new FormData()
      fd.append('file', file)
      if (title) fd.append('title', title)
      if (meetingDate) fd.append('meeting_date', meetingDate)

      const res = await uploadMeetingFile(fd)
      setResult(res)
      setTitle('')
      setMeetingDate(new Date().toISOString().split('T')[0])
      onUploaded?.()
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  if (!expanded && !result) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-white border border-dashed border-[#d0d0cc] rounded-2xl text-sm text-[#9b9b97] hover:border-[#C9A84C] hover:text-[#1a1a18] transition-all group"
      >
        <span className="text-base group-hover:text-[#C9A84C] transition-colors">⬆</span>
        Upload meeting transcript or summary
      </button>
    )
  }

  if (result) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-2xl">
        <span className="text-green-500 text-lg">✓</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1a1a18] truncate">{result.title}</p>
          <p className="text-xs text-[#6b6b67]">
            {result.detected_type === 'transcript' ? 'Transcript' : 'Summary'} · {result.word_count?.toLocaleString()} words · AI extraction running
          </p>
        </div>
        <button
          onClick={() => { setResult(null); setExpanded(false) }}
          className="text-xs text-[#6b6b67] hover:text-[#1a1a18] flex-shrink-0"
        >
          Upload another
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#e5e5e3] rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-[#6b6b67]">Upload Meeting</p>
        <button onClick={() => setExpanded(false)} className="text-[#9b9b97] hover:text-[#1a1a18] text-sm">✕</button>
      </div>

      {/* Optional metadata */}
      <div className="grid grid-cols-2 gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#C9A84C] placeholder-[#9b9b97]"
        />
        <input
          type="date"
          value={meetingDate}
          onChange={e => setMeetingDate(e.target.value)}
          className="text-xs border border-[#e5e5e3] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#C9A84C] text-[#1a1a18]"
        />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl px-4 py-6 cursor-pointer transition-all ${
          dragging
            ? 'border-[#C9A84C] bg-amber-50/50'
            : 'border-[#d0d0cc] hover:border-[#C9A84C] hover:bg-gray-50/50'
        }`}
      >
        {uploading ? (
          <>
            <div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-[#6b6b67]">Uploading & detecting type…</p>
          </>
        ) : (
          <>
            <span className="text-2xl text-[#d0d0cc]">⬆</span>
            <p className="text-sm font-medium text-[#1a1a18]">Drop file or click to browse</p>
            <p className="text-xs text-[#9b9b97]">PDF, DOCX, or TXT · Auto-detects transcript vs summary</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          onChange={onFileChange}
          className="hidden"
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <p className="text-[10px] text-[#9b9b97]">
        Transcripts (raw audio→text) run full AI extraction · Summaries store directly + light parse
      </p>
    </div>
  )
}
