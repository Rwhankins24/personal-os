import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'https://personal-os-five-black.vercel.app'
const TRIGGER_SECRET = import.meta.env.VITE_TRIGGER_SECRET || ''

export const api = axios.create({ baseURL: BASE })

// Auth header for protected routes (pipeline)
const authHeaders = () => ({
  headers: { 'x-trigger-secret': TRIGGER_SECRET }
})

// ── Tasks ─────────────────────────────────────────────────────
export const getTasks       = () => api.get('/api/tasks').then(r => r.data)
export const getTask        = (id) => api.get(`/api/tasks?id=${id}`).then(r => r.data)
export const createTask     = (data) => api.post('/api/tasks', data).then(r => r.data)
export const updateTask     = (id, data) => api.patch(`/api/tasks?id=${id}`, data).then(r => r.data)
export const deleteTask     = (id) => api.delete(`/api/tasks?id=${id}`)

// ── Events ────────────────────────────────────────────────────
export const getEvents      = () => api.get('/api/events').then(r => r.data)
export const updateEvent    = (id, data) => api.patch(`/api/events?id=${id}`, data).then(r => r.data)

// ── Emails ────────────────────────────────────────────────────
export const getEmails      = () => api.get('/api/emails').then(r => r.data)
export const updateEmail    = (id, data) => api.patch(`/api/emails?id=${id}`, data).then(r => r.data)

// ── My Commitments ────────────────────────────────────────────
export const getCommitments    = () => api.get('/api/commitments').then(r => r.data)
export const createCommitment  = (data) => api.post('/api/commitments', data).then(r => r.data)
export const updateCommitment  = (id, data) => api.patch(`/api/commitments?id=${id}`, data).then(r => r.data)

// ── Others' Commitments ───────────────────────────────────────
export const getOthersCommitments    = (status = 'open') =>
  api.get(`/api/others-commitments?status=${status}`).then(r => r.data)
export const createOthersCommitment  = (data) => api.post('/api/others-commitments', data).then(r => r.data)
export const updateOthersCommitment  = (id, data) =>
  api.patch(`/api/others-commitments?id=${id}`, data).then(r => r.data)

// ── Projects ──────────────────────────────────────────────────
export const getProjects    = () => api.get('/api/projects').then(r => r.data)
export const getProject     = (id) => api.get(`/api/projects?id=${id}`).then(r => r.data)
export const createProject  = (data) => api.post('/api/projects', data).then(r => r.data)
export const updateProject  = (id, data) => api.patch(`/api/projects?id=${id}`, data).then(r => r.data)
export const deleteProject  = (id) => api.delete(`/api/projects?id=${id}`).then(r => r.data)
export const getProjectKeywordPreview = (id, keywords) =>
  api.get(`/api/projects/${id}/keyword-preview?keywords=${encodeURIComponent((keywords || []).join(','))}`).then(r => r.data)

// ── Contacts ──────────────────────────────────────────────────
export const getContacts    = () => api.get('/api/contacts').then(r => r.data)
export const getContact     = (id) => api.get(`/api/contacts?id=${id}`).then(r => r.data)
export const updateContact  = (id, data) => api.patch(`/api/contacts?id=${id}`, data).then(r => r.data)
export const deleteContact  = (id) => api.delete(`/api/contacts?id=${id}`).then(r => r.data)

// ── Meeting Notes ─────────────────────────────────────────────
export const getMeetingNotes   = ()         => api.get('/api/meeting-notes').then(r => r.data)
export const getMeetingNote    = (id)       => api.get(`/api/meeting-notes?id=${id}`).then(r => r.data)
export const updateMeetingNote = (id, data) => api.patch(`/api/meeting-notes?id=${id}`, data).then(r => r.data)

// ── Captures ──────────────────────────────────────────────────
export const getCaptures    = ()     => api.get('/api/captures').then(r => r.data)
export const createCapture  = (data) => api.post('/api/captures', data).then(r => r.data)

// ── Pending Decisions ─────────────────────────────────────────
export const getPendingDecisions    = () =>
  api.get('/api/pending-decisions').then(r => r.data)
export const createPendingDecision  = (data) => api.post('/api/pending-decisions', data).then(r => r.data)
export const updatePendingDecision  = (id, data) =>
  api.patch(`/api/pending-decisions?id=${id}`, data).then(r => r.data)

// ── Unlinked Intelligence ─────────────────────────────────────
export const getUnlinkedIntelligence   = () =>
  api.get('/api/unlinked-intelligence').then(r => r.data)
export const updateUnlinkedIntelligence = (id, data) =>
  api.patch(`/api/unlinked-intelligence?id=${id}`, data).then(r => r.data)

// ── AI Questions ──────────────────────────────────────────────
export const getAIQuestions   = () =>
  api.get('/api/ai-questions').then(r => r.data)
export const updateAIQuestion = (id, data) =>
  api.patch(`/api/ai-questions?id=${id}`, data).then(r => r.data)
export const answerAIQuestion = (id, answer) =>
  api.patch(`/api/ai-questions?id=${id}`, { answer_tap: answer }).then(r => r.data)

// ── AI Query (ask Claude) ─────────────────────────────────────
export const askAI = (question, opts = {}) =>
  api.post('/api/ai/query', { question, ...opts }).then(r => r.data)

// ── Pipeline Status ───────────────────────────────────────────
export const getPipelineStatus = () =>
  api.get('/api/pipeline/status', authHeaders()).then(r => r.data)

// ── Knowledge Base ────────────────────────────────────────────
export const getKnowledge    = (status = 'active') => api.get(`/api/knowledge?status=${status}`).then(r => r.data)
export const createKnowledge = (data) => api.post('/api/knowledge', data).then(r => r.data)
export const updateKnowledge = (id, data) => api.patch(`/api/knowledge?id=${id}`, data).then(r => r.data)
export const deleteKnowledge = (id) => api.delete(`/api/knowledge?id=${id}`).then(r => r.data)

export const generatePreMeetingBrief = (event_id) =>
  api.post('/api/jobs/pre-meeting-brief', { event_id }).then(r => r.data)
