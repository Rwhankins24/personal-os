import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      {!isUser && (
        <div className="w-5 h-5 rounded-full bg-[#1a1a18] text-white flex items-center justify-center text-[9px] font-bold mr-2 flex-shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div
        className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
          isUser
            ? 'bg-[#1a1a18] text-white rounded-tr-sm text-xs'
            : 'bg-white border border-[#e5e5e3] text-[#1a1a18] rounded-tl-sm shadow-sm text-xs'
        }`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {msg.loading ? (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : msg.content}
      </div>
    </div>
  )
}

export default function ChatWidget() {
  const [input,    setInput]    = useState('')
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [open,     setOpen]     = useState(false) // response panel open
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function sendMessage(text) {
    const q = text || input.trim()
    if (!q || loading) return
    setInput('')
    setOpen(true)

    const userMsg    = { role: 'user',      content: q }
    const loadingMsg = { role: 'assistant', content: '…', loading: true }
    setMessages(prev => [...prev, userMsg, loadingMsg])
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const { data } = await api.post('/api/chat', { question: q, history })
      setMessages(prev => [
        ...prev.filter(m => !m.loading),
        { role: 'assistant', content: data.answer }
      ])
    } catch {
      setMessages(prev => [
        ...prev.filter(m => !m.loading),
        { role: 'assistant', content: '⚠ Something went wrong. Try again.' }
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <>
      {/* Response panel — slides up above the bar when there are messages */}
      {open && messages.length > 0 && (
        <div
          className="fixed left-0 right-0 z-40 bg-[#f8f8f6] border-t border-[#e5e5e3] shadow-xl flex flex-col"
          style={{ bottom: '56px', maxHeight: '45vh' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a18] border-b border-[#333]">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs font-medium text-white">AI Response</span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/chat"
                className="text-[10px] text-white/60 hover:text-white/90 underline"
              >
                Full page →
              </Link>
              <button
                onClick={() => { setMessages([]); setOpen(false) }}
                className="text-[10px] text-white/60 hover:text-white/90"
              >
                Clear ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      {/* Persistent bottom bar — always visible, always ready */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e5e5e3] px-3 py-2.5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 10px)' }}
      >
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          {/* Full page button — left side */}
          <Link
            to="/chat"
            className="flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-[#6b6b67] hover:text-[#1a1a18] transition-colors border border-[#e5e5e3] rounded-lg px-2 py-1 hover:border-[#1a1a18]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </Link>

          {/* Input */}
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => messages.length > 0 && setOpen(true)}
            placeholder="Ask anything about your projects, meetings, commitments…"
            className="flex-1 text-sm text-[#1a1a18] placeholder-[#c0c0bc] focus:outline-none bg-transparent"
          />

          {/* Send button */}
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-7 h-7 rounded-full bg-[#1a1a18] text-white flex items-center justify-center disabled:opacity-25 hover:opacity-80 transition-opacity"
          >
            {loading ? (
              <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
