import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'https://personal-os-five-black.vercel.app'
const TRIGGER_SECRET = import.meta.env.VITE_TRIGGER_SECRET || ''

export const getWorkspaces = () =>
  fetch(`${BASE}/api/workspaces`).then(r => r.json())

export const api = axios.create({ baseURL: BASE })

// Auth header for protected routes (pipeline)
const authHeaders = () => ({
  headers: { 'x-trigger-secret': TRIGGER_SECRET }
})

// ── Tasks ─────────────────────────────────────────────────────
export const getTasks       = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/tasks${qs ? '?' + qs : ''}`).then(r => r.json())
}
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
export const getCommitments    = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/commitments${qs ? '?' + qs : ''}`).then(r => r.json())
}
export const createCommitment  = (data) => api.post('/api/commitments', data).then(r => r.data)
export const updateCommitment  = (id, data) => api.patch(`/api/commitments?id=${id}`, data).then(r => r.data)

// ── Others' Commitments ───────────────────────────────────────
export const getOthersCommitments    = (status = 'open', workspaceId = null, workspaceName = null) => {
  const params = {}
  if (status && status !== 'all') params.status = status
  if (workspaceId) params.workspace_id = workspaceId
  if (workspaceName && workspaceName !== 'all') params.workspace = workspaceName
  const qs = new URLSearchParams(params).toString()
  return fetch(`${BASE}/api/others-commitments${qs ? '?' + qs : ''}`).then(r => r.json())
}
export const createOthersCommitment  = (data) => api.post('/api/others-commitments', data).then(r => r.data)
export const updateOthersCommitment  = (id, data) =>
  api.patch(`/api/others-commitments?id=${id}`, data).then(r => r.data)

// ── Projects ──────────────────────────────────────────────────
export const getProjects    = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/projects${qs ? '?' + qs : ''}`).then(r => r.json())
}
export const getProject     = (id) => api.get(`/api/projects?id=${id}`).then(r => r.data)
export const createProject  = (data) => api.post('/api/projects', data).then(r => r.data)
export const updateProject  = (id, data) => api.patch(`/api/projects?id=${id}`, data).then(r => r.data)
export const deleteProject  = (id) => api.delete(`/api/projects?id=${id}`).then(r => r.data)
export const mergeProject   = (winnerId, loserId) =>
  api.patch(`/api/projects?id=${winnerId}&merge_from=${loserId}`).then(r => r.data)
export const getProjectKeywordPreview = (id, keywords) =>
  api.get(`/api/projects/${id}/keyword-preview?keywords=${encodeURIComponent((keywords || []).join(','))}`).then(r => r.data)

// ── Contacts ──────────────────────────────────────────────────
export const getContacts    = () => api.get('/api/contacts').then(r => r.data)
export const getContact     = (id) => api.get(`/api/contacts?id=${id}`).then(r => r.data)
export const createContact  = (data) => api.post('/api/contacts', data).then(r => r.data)
export const updateContact  = (id, data) => api.patch(`/api/contacts?id=${id}`, data).then(r => r.data)
export const deleteContact  = (id) => api.delete(`/api/contacts?id=${id}`).then(r => r.data)

// ── Meeting Notes ─────────────────────────────────────────────
export const getMeetingNotes   = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/meeting-notes${qs ? '?' + qs : ''}`).then(r => r.json())
}
export const getMeetingNote    = (id)       => api.get(`/api/meeting-notes?id=${id}`).then(r => r.data)
export const updateMeetingNote = (id, data) => api.patch(`/api/meeting-notes?id=${id}`, data).then(r => r.data)
export const uploadMeetingFile = (formData) => api.post('/api/upload-meeting', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data)

// ── Captures ──────────────────────────────────────────────────
export const getCaptures    = ()     => api.get('/api/captures').then(r => r.data)
export const createCapture  = (data) => api.post('/api/captures', data).then(r => r.data)

// ── Pending Decisions ─────────────────────────────────────────
export const getPendingDecisions    = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/pending-decisions${qs ? '?' + qs : ''}`).then(r => r.json())
}
export const createPendingDecision  = (data) => api.post('/api/pending-decisions', data).then(r => r.data)
export const updatePendingDecision  = (id, data) =>
  api.patch(`/api/pending-decisions?id=${id}`, data).then(r => r.data)

// ── Unlinked Intelligence ─────────────────────────────────────
export const getUnlinkedIntelligence   = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null)).toString()
  return fetch(`${BASE}/api/unlinked-intelligence${qs ? '?' + qs : ''}`).then(r => r.json())
}
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

// ── Knowledge Doc Extraction ──────────────────────────────────
export const extractKnowledgeDoc  = (formData) =>
  api.post('/api/knowledge?action=extract', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data)
export const extractKnowledgeText = (data) =>
  api.post('/api/knowledge?action=extract-text', data).then(r => r.data)

// ── Topic Intelligence Pods ───────────────────────────────────
export const getTopicPods      = (status = 'active') => api.get(`/api/topic-pods?status=${status}`).then(r => r.data)
export const getTopicPod       = (id) => api.get(`/api/topic-pods/${id}`).then(r => r.data)
export const createTopicPod    = (data) => api.post('/api/topic-pods', data).then(r => r.data)
export const updateTopicPod    = (id, data) => api.patch(`/api/topic-pods?id=${id}`, data).then(r => r.data)
export const deleteTopicPod    = (id) => api.delete(`/api/topic-pods?id=${id}`).then(r => r.data)
export const getPodContent     = (id) => api.get(`/api/topic-pods/${id}/content`).then(r => r.data)
export const addPodText        = (id, data) => api.post(`/api/topic-pods/${id}/content`, data).then(r => r.data)
export const addPodFile        = (id, formData) => api.post(`/api/topic-pods/${id}/content`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).then(r => r.data)
export const deletePodContent  = (podId, contentId) => api.delete(`/api/topic-pods/${podId}/content/${contentId}`).then(r => r.data)

// ── Leads ─────────────────────────────────────────────────────
export const getLeads      = () => api.get('/api/leads').then(r => r.data)
export const getLead       = (id) => api.get(`/api/leads?id=${id}`).then(r => r.data)
export const createLead    = (data) => api.post('/api/leads', data).then(r => r.data)
export const updateLead    = (id, data) => api.patch(`/api/leads?id=${id}`, data).then(r => r.data)
export const deleteLead    = (id) => api.delete(`/api/leads?id=${id}`).then(r => r.data)
export const uploadLeadFile = (leadId, formData) =>
  api.post(`/api/leads?action=upload&id=${leadId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data)
export const deleteLeadFile = (fileId) => api.delete(`/api/leads?action=file&id=${fileId}`).then(r => r.data)
export const synthesizePod     = (id) => api.post(`/api/topic-pods/${id}/synthesize`).then(r => r.data)

// ── Strategic Decisions ───────────────────────────────────────
export const getStrategicDecisions = (params = {}) => api.get('/api/strategic-decisions', { params }).then(r => r.data)
export const createStrategicDecision = (data) => api.post('/api/strategic-decisions', data).then(r => r.data)
export const updateStrategicDecision = (id, data) => api.patch(`/api/strategic-decisions?id=${id}`, data).then(r => r.data)
export const deleteStrategicDecision = (id) => api.delete(`/api/strategic-decisions?id=${id}`).then(r => r.data)

// ── Observations ──────────────────────────────────────────────
export const getObservations   = (params = {}) => api.get('/api/observations', { params }).then(r => r.data)
export const getHistoricalRecall = () => api.get('/api/observations?recall=true').then(r => r.data)
export const createObservation = (data) => api.post('/api/observations', data).then(r => r.data)
export const updateObservation = (id, data) => api.patch(`/api/observations?id=${id}`, data).then(r => r.data)
export const deleteObservation = (id) => api.delete(`/api/observations?id=${id}`).then(r => r.data)

// ── Meeting Categories ────────────────────────────────────────
// List all categories (global + optional project-scoped)
export const getMeetingCategories = (projectId) =>
  api.get(projectId ? `/api/meeting-categories?project_id=${projectId}` : '/api/meeting-categories').then(r => r.data)

// Get categories assigned to a specific meeting (primary + secondaries + info_only flag)
export const getMeetingCategoryAssignments = (meetingId) =>
  api.get(`/api/meeting-categories?meeting_id=${meetingId}`).then(r => r.data)

// Create a new category (projectId = null → global)
export const createMeetingCategory = (data) =>
  api.post('/api/meeting-categories', data).then(r => r.data)

// Update category metadata
export const updateMeetingCategory = (id, data) =>
  api.patch(`/api/meeting-categories?id=${id}`, data).then(r => r.data)

// Delete category
export const deleteMeetingCategory = (id) =>
  api.delete(`/api/meeting-categories?id=${id}`).then(r => r.data)

// Assign primary category to a meeting (sets needs_ai_reprocess)
export const assignPrimaryCategory = (meetingId, categoryId) =>
  api.patch(`/api/meeting-categories?assign=primary&meeting_id=${meetingId}&category_id=${categoryId || ''}`).then(r => r.data)

// Add secondary category to a meeting
export const addSecondaryCategory = (meetingId, categoryId) =>
  api.post('/api/meeting-categories?assign=secondary', { meeting_id: meetingId, category_id: categoryId }).then(r => r.data)

// Remove secondary category from a meeting
export const removeSecondaryCategory = (meetingId, categoryId) =>
  api.delete(`/api/meeting-categories?assign=secondary&meeting_id=${meetingId}&category_id=${categoryId}`).then(r => r.data)

// Toggle information-only flag
export const setInformationOnly = (meetingId, value) =>
  api.patch(`/api/meeting-categories?toggle_info_only=1&meeting_id=${meetingId}`, { information_only: value }).then(r => r.data)

// Merge source into target — all assignments transfer, source is deleted
export const mergeMeetingCategories = (sourceId, targetId) =>
  api.post(`/api/meeting-categories?merge=1`, { source_id: sourceId, target_id: targetId }).then(r => r.data)
