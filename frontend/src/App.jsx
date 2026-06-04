import React, { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard       from './pages/Dashboard'
import TaskDetail      from './pages/TaskDetail'
import Projects        from './pages/Projects'
import ProjectCard     from './pages/ProjectCard'
import ContactCard     from './pages/ContactCard'
import Contacts        from './pages/Contacts'
import TasksPage       from './pages/TasksPage'
import EmailsPage      from './pages/EmailsPage'
import OthersPage      from './pages/OthersPage'
import CommitmentsPage from './pages/CommitmentsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
})

// ─── PASSWORD GATE ──────────────────────────────────────────────────────────
// Change PASSWORD here after deployment.
// Later: move to VITE_APP_PASSWORD env var so no code change needed.
const PASSWORD    = import.meta.env.VITE_APP_PASSWORD || 'changeme'
const SESSION_KEY = 'personal_os_auth'

function PasswordGate({ children }) {
  const [authenticated, setAuthenticated] = useState(() => {
    return sessionStorage.getItem(SESSION_KEY) === 'true'
  })
  const [input, setInput]   = useState('')
  const [error, setError]   = useState(false)
  const [shake, setShake]   = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (input === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, 'true')
      setAuthenticated(true)
    } else {
      setError(true)
      setShake(true)
      setInput('')
      setTimeout(() => setShake(false), 600)
    }
  }

  if (authenticated) return children

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm ${shake ? 'animate-shake' : ''}`}>

        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🧠</div>
          <h1 className="text-xl font-semibold text-gray-900">Personal OS</h1>
          <p className="text-sm text-gray-500 mt-1">Ryan Hankins</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={input}
            onChange={e => {
              setInput(e.target.value)
              setError(false)
            }}
            placeholder="Password"
            autoFocus
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-200'
            }`}
          />

          {error && (
            <p className="text-red-500 text-xs mt-2 text-center">Incorrect password</p>
          )}

          <button
            type="submit"
            className="w-full mt-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── APP ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <PasswordGate>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/"               element={<Dashboard />} />
            <Route path="/contacts"       element={<Contacts />} />
            <Route path="/contact/:id"    element={<ContactCard />} />
            <Route path="/contacts/:id"   element={<ContactCard />} />
            <Route path="/task/:id"       element={<TaskDetail />} />
            <Route path="/projects"       element={<Projects />} />
            <Route path="/projects/:id"   element={<ProjectCard />} />
            <Route path="/project/:id"       element={<ProjectCard />} />
            <Route path="/tasks"            element={<TasksPage />} />
            <Route path="/emails"           element={<EmailsPage />} />
            <Route path="/others"           element={<OthersPage />} />
            <Route path="/commitments-list" element={<CommitmentsPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </PasswordGate>
  )
}
