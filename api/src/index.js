require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const express = require('express')
const cors    = require('cors')

const app  = express()
const PORT = process.env.PORT || 3000

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── API Routes ────────────────────────────────────────────────
app.use('/api/tasks',         require('./routes/tasks'))
app.use('/api/events',        require('./routes/events'))
app.use('/api/emails',        require('./routes/emails'))
app.use('/api/commitments',   require('./routes/commitments'))
app.use('/api/projects',      require('./routes/projects'))
app.use('/api/contacts',      require('./routes/contacts'))
app.use('/api/captures',      require('./routes/captures'))
app.use('/api/meeting-notes', require('./routes/meeting_notes'))

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
})

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`, err.stack)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  })
})

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  personal-os API running on http://localhost:${PORT}`)
  console.log(`    Health ........... GET /health`)
  console.log(`    Tasks ............ /api/tasks`)
  console.log(`    Events ........... /api/events`)
  console.log(`    Emails ........... /api/emails`)
  console.log(`    Commitments ...... /api/commitments`)
  console.log(`    Projects ......... /api/projects`)
  console.log(`    Contacts ......... /api/contacts`)
  console.log(`    Captures ......... /api/captures`)
  console.log(`    Meeting Notes .... /api/meeting-notes`)
})

module.exports = app
