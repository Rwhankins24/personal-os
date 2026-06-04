import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

const SUGGESTIONS = [
  { label: 'Meeting recall',    text: 'What did Courtney say about secondary containment last week?' },
  { label: 'Commitment check',  text: 'What have I committed to Pacific Fusion this week?' },
  { label: 'Risk pulse',        text: "What are the biggest open risks across my projects right now?" },
  { label: 'Waiting on',        text: 'Who am I waiting on that I haven\'t heard back from?' },
  { label: 'Contact brief',     text: 'Brief me on Nick Rivera before my call' },
  { label: 'Action items',      text: 'What are the most overdue things I need to close this week?' },
  { label: 'Project status',    text: 'Where does Pacific Fusion stand right now?' },
  { label: 'Deal intel',        text: 'What\'s the history on the Gotion payment issue?' },
]

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[#1a1a18] text-white flex items-center justify-center text-[10px] font-bold mr-3 flex-shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div
        className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-[#1a1a18] text-white rounded-tr-sm'
            : 'bg-white border border-[#e5e5e3] text-[#1a1a18] rounded-tl-sm shadow-sm'
        }`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {msg.loading ? (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : msg.content}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 text-[#6b6b67] flex items-center justify-center text-[10px] font-bold ml-3 flex-shrink-0 mt-0.5">
          R
        </div>
      )}
    </div>
  )
}

export default function ChatPage() {
  const [input,    setInput]    = useState('')
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function sendMessage(text) {
    const q = text || input.trim()
    if (!q || loading) return
    setInput('')

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
  }

  const hasMessages = messages.length > 0

  return (
    <div className="min-h-screen bg-[#f8f8f6] flex flex-col">

      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e5e5e3] px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-[#6b6b67] hover:text-[#1a1a18]">← Dashboard</Link>
            <span className="text-[#e5e5e3]">|</span>
            <h1 className="text-sm font-semibold text-[#1a1a18]">Ask anything</h1>
            <div className="w-2 h-2 rounded-full bg-green-400" title="Connected to your data" />
          </div>
          {hasMessages && (
            <button
              onClick={() => setMessages([])}
              className="text-xs text-[#9b9b97] hover:text-[#1a1a18] transition-colors"
            >
              Clear conversation
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">

          {!hasMessages ? (
            /* Empty state — suggestions */
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
              <div className="w-14 h-14 rounded-2xl bg-[#1a1a18] flex items-center justify-center mb-4 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-[#1a1a18] mb-1">What do you need to know?</h2>
              <p className="text-sm text-[#9b9b97] mb-8 text-center max-w-sm">
                Ask about meetings, commitments, contacts, risks, or anything across your projects.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.text)}
                    className="text-left px-4 py-3 bg-white border border-[#e5e5e3] rounded-xl hover:border-[#1a1a18] hover:shadow-sm transition-all group"
                  >
                    <p className="text-xs font-semibold text-[#9b9b97] uppercase tracking-wide mb-0.5 group-hover:text-[#6b6b67]">
                      {s.label}
                    </p>
                    <p className="text-sm text-[#1a1a18]">{s.text}</p>
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
      </div>

      {/* Input — fixed to bottom */}
      <div className="sticky bottom-0 bg-[#f8f8f6] border-t border-[#e5e5e3] px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-white border border-[#e5e5e3] rounded-2xl px-4 py-3 shadow-sm focus-within:ring-1 focus-within:ring-[#1a1a18] focus-within:border-[#1a1a18]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about meetings, commitments, contacts, risks…"
              rows={1}
              className="flex-1 text-sm text-[#1a1a18] placeholder-[#c0c0bc] resize-none focus:outline-none bg-transparent leading-relaxed"
              style={{ maxHeight: '120px' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-xl bg-[#1a1a18] text-white flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[10px] text-[#c0c0bc] text-center mt-2">
            Searches your emails, meetings, tasks, contacts, and commitments · Enter to send
          </p>
        </div>
      </div>
    </div>
  )
}
