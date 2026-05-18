// personal-os — consolidated API router
// Single serverless function handling all routes (stays under Vercel Hobby 12-function limit)

const tasks               = require('./routes/tasks')
const events              = require('./routes/events')
const emails              = require('./routes/emails')
const commitments         = require('./routes/commitments')
const projects            = require('./routes/projects')
const contacts            = require('./routes/contacts')
const captures            = require('./routes/captures')
const meetingNotes        = require('./routes/meeting_notes')
const webhooks            = require('./routes/webhooks')
const pipeline            = require('./routes/pipeline')
const aiQuery             = require('./routes/ai-query')
const pendingDecisions    = require('./routes/pending-decisions')
const unlinkedIntelligence = require('./routes/unlinked-intelligence')
const suggestedProjects   = require('./routes/suggested-projects')
const aiQuestions         = require('./routes/ai-questions')
const othersCommitments   = require('./routes/others-commitments')
const health              = require('./health')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trigger-secret'
}

function matchRoute(path, prefix) {
  return path === prefix || path.startsWith(prefix + '?') || path.startsWith(prefix + '/')
}

module.exports = async (req, res) => {
  // Apply CORS headers to every response
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v))

  if (req.method === 'OPTIONS') return res.status(200).end()

  const path = req.url.split('?')[0]

  if (path === '/api/health')                    return health(req, res)
  if (matchRoute(path, '/api/tasks'))            return tasks(req, res)
  if (matchRoute(path, '/api/events'))           return events(req, res)
  if (matchRoute(path, '/api/emails'))           return emails(req, res)
  if (matchRoute(path, '/api/commitments'))      return commitments(req, res)
  if (matchRoute(path, '/api/projects'))         return projects(req, res)
  if (matchRoute(path, '/api/contacts'))         return contacts(req, res)
  if (matchRoute(path, '/api/captures'))         return captures(req, res)
  if (matchRoute(path, '/api/meeting-notes'))    return meetingNotes(req, res)
  if (matchRoute(path, '/api/webhooks'))         return webhooks(req, res)
  if (matchRoute(path, '/api/pipeline'))              return pipeline(req, res)
  if (path === '/api/ai/query')                       return aiQuery(req, res)
  if (matchRoute(path, '/api/pending-decisions'))     return pendingDecisions(req, res)
  if (matchRoute(path, '/api/unlinked-intelligence')) return unlinkedIntelligence(req, res)
  if (matchRoute(path, '/api/suggested-projects'))    return suggestedProjects(req, res)
  if (matchRoute(path, '/api/ai-questions'))          return aiQuestions(req, res)
  if (matchRoute(path, '/api/others-commitments'))    return othersCommitments(req, res)

  return res.status(404).json({ error: 'Not found', path })
}
