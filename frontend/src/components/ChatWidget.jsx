import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

const SUGGESTIONS = [
  'What did Courtney say in our last meeting?',
  'What am I waiting on this week?',
  'What have I committed to Pacific Fusion?',
  'What are my biggest open risks?',
  'Brief me on Nick Rivera',
]

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-[#1a1a18] text-white flex items-center justify-center text-[10px] font-bold mr-2 flex-shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-[#1a1a18] text-white rounded-tr-sm'
            : 'bg-white border border-[#e5e5e3] text-[#1a1a18] rounded-tl-sm'
        }`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {msg.content}
      </div>
    </div>
  )
}

export default function ChatWidget() {
  const [open,     setOpen]     = useState(false)
  const [input,    setInput]    = useState('')
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function sendMessage(text) {
    const q = text || input.trim()
    if (!q || loading) return
    setInput('')

    const userMsg   = { role: 'user',      content: q }
    const loadingMsg = { role: 'assistant', content: '…', loading: true }
    setMessages(prev => [...prev, userMsg, loadingMsg])
    setLoading(true)

    try {
      // Convert to history format for API (exclude loading indicator)
      const history = messages.map(m => ({ role: m.role, content: m.content }))

      const { data } = await api.post('/api/chat', { question: q, history })
      setMessages(prev => [
        ...prev.filter(m => !m.loading),
        { role: 'assistant', content: data.answer }
      ])
    } catch (err) {
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
  }

  return (
    <>
      {/* Floating button — fixed bottom-right, never overlaps content */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open
            ? 'bg-[#1a1a18] text-white rotate-45'
            : 'bg-[#1a1a18] text-white hover:scale-105'
        }`}
        aria-label="Open chat"
      >
        {open ? (
          <span className="text-xl font-light leading-none">+</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel — sits above the button, doesn't overlap page content */}
      {open && (
        <div
          className="fixed bottom-22 right-6 z-50 w-[360px] max-w-[calc(100vw-3rem)] bg-[#f8f8f6] border border-[#e5e5e3] rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ height: '480px', bottom: '5.5rem' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a18] rounded-t-2xl">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm font-semibold text-white">Ask anything</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/chat"
                onClick={() => setOpen(false)}
                className="text-[10px] text-white/60 hover:text-white/90 underline"
              >
                Full page →
              </Link>
              <button
                onClick={() => setMessages([])}
                className="text-[10px] text-white/60 hover:text-white/90"
                title="Clear conversation"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col justify-end pb-2">
                <p className="text-xs text-[#9b9b97] text-center mb-4">
                  Your data. Your questions. Instant answers.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      className="w-full text-left text-xs px-3 py-2 bg-white border border-[#e5e5e3] rounded-xl text-[#6b6b67] hover:border-[#1a1a18] hover:text-[#1a1a18] transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <MessageBubble key={i} msg={m} />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-[#e5e5e3] bg-[#f8f8f6]">
            <div className="flex items-end gap-2 bg-white border border-[#e5e5e3] rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-[#1a1a18]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about meetings, commitments, contacts…"
                rows={1}
                className="flex-1 text-sm text-[#1a1a18] placeholder-[#c0c0bc] resize-none focus:outline-none bg-transparent leading-relaxed"
                style={{ maxHeight: '80px' }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-[#1a1a18] text-white flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
              >
                {loading ? (
                  <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-[#c0c0bc] text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  )
}
