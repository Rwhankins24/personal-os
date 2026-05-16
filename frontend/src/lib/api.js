import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'https://personal-os-five-black.vercel.app'

export const api = axios.create({ baseURL: BASE })

export const getTasks       = () => api.get('/api/tasks').then(r => r.data)
export const createTask     = (data) => api.post('/api/tasks', data).then(r => r.data)
export const updateTask     = (id, data) => api.patch(`/api/tasks?id=${id}`, data).then(r => r.data)
export const deleteTask     = (id) => api.delete(`/api/tasks?id=${id}`)

export const getEvents      = () => api.get('/api/events').then(r => r.data)

export const getEmails      = () => api.get('/api/emails').then(r => r.data)
export const updateEmail    = (id, data) => api.patch(`/api/emails?id=${id}`, data).then(r => r.data)

export const getCommitments   = () => api.get('/api/commitments').then(r => r.data)
export const updateCommitment = (id, data) => api.patch(`/api/commitments?id=${id}`, data).then(r => r.data)

export const getProjects    = () => api.get('/api/projects').then(r => r.data)
export const getContacts    = () => api.get('/api/contacts').then(r => r.data)
export const getMeetingNotes = () => api.get('/api/meeting-notes').then(r => r.data)
export const getCaptures    = ()     => api.get('/api/captures').then(r => r.data)
export const createCapture  = (data) => api.post('/api/captures', data).then(r => r.data)
