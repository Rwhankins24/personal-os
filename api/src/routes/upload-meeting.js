// personal-os — Meeting Upload route
// POST /api/upload-meeting — accepts multipart/form-data with a file + optional metadata
// Accepts: PDF, DOCX, TXT
// Auto-detects: transcript (long, speaker-labeled) vs summary (short, structured)
// Routes: transcript → extractIntelligenceFromTranscript | summary → store directly

const { createClient } = require('@supabase/supabase-js')
const multer  = require('multer')
const pdf     = require('pdf-parse')
const mammoth = require('mammoth')
require('dotenv').config()

const { extractIntelligenceFromTranscript, parsePlaudSummary } = require('../services/ai')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Store uploads in memory (we process and discard — no disk needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
    const ext = (file.originalname || '').toLowerCase()
    if (allowed.includes(file.mimetype) || ext.endsWith('.txt') || ext.endsWith('.pdf') || ext.endsWith('.docx')) {
      cb(null, true)
    } else {
      cb(new Error('Unsupported file type — upload PDF, DOCX, or TXT'))
    }
  }
}).single('file')

// ── Text extraction ────────────────────────────────────────────────────

async function extractText(buffer, mimetype, filename) {
  const ext = (filename || '').toLowerCase()
  if (mimetype === 'application/pdf' || ext.endsWith('.pdf')) {
    const result = await pdf(buffer)
    return result.text
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  // Plain text
  return buffer.toString('utf-8')
}

// ── Type detection ─────────────────────────────────────────────────────
// Returns 'transcript' or 'summary'

const SPEAKER_PATTERNS = [
  /^[A-Z][a-zA-Z\s]{1,30}:\s/m,          // "Ryan Hankins: ..." speaker label
  /^\s*>>\s*[A-Z]/m,                       // ">> Speaker said"
  /\[\d{1,2}:\d{2}(:\d{2})?\]/,           // [00:00] timestamps
  /\d{2}:\d{2}:\d{2}\s+[A-Z]/,            // 00:00:00 Speaker
  /^SPEAKER_\d+:/m,                        // "SPEAKER_1:"
]

function detectType(text) {
  const wordCount = text.trim().split(/\s+/).length

  // Short text is always a summary/intelligence doc
  if (wordCount < 500) return 'summary'

  // Check for transcript signals
  const hasSpeakerLabels = SPEAKER_PATTERNS.some(p => p.test(text))
  const lines = text.split('\n').filter(l => l.trim())
  const speakerLineCount = lines.filter(l => /^[A-Z][a-zA-Z\s]{1,30}:\s/.test(l.trim())).length
  const speakerRatio = speakerLineCount / lines.length

  if (hasSpeakerLabels && speakerRatio > 0.05) return 'transcript'
  if (wordCount > 3000 && speakerRatio > 0.03) return 'transcript'
  if (wordCount > 5000) return 'transcript' // Very long = likely transcript regardless

  return 'summary'
}

// ── Main handler ───────────────────────────────────────────────────────

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
      const { buffer, mimetype, originalname } = req.file

      // Optional metadata from form fields
      const title       = req.body.title       || originalname.replace(/\.[^.]+$/, '')
      const meetingDate = req.body.meeting_date || new Date().toISOString().split('T')[0]
      const projectId   = req.body.project_id  || null
      const source      = req.body.source      || 'manual'

      // 1. Extract raw text
      const rawText = await extractText(buffer, mimetype, originalname)
      if (!rawText || rawText.trim().length < 50) {
        return res.status(422).json({ error: 'Could not extract readable text from file' })
      }

      // 2. Detect type
      const fileType = req.body.type || detectType(rawText)

      // 3. Insert initial record
      const insertPayload = {
        title,
        meeting_date: meetingDate,
        source,
        project_id: projectId || null,
        raw_transcript: rawText,
        intelligence_extracted: false,
      }

      const { data: record, error: insertErr } = await supabase
        .from('meeting_notes')
        .insert(insertPayload)
        .select()
        .single()

      if (insertErr) throw insertErr

      // 4. Attempt calendar matching
      try {
        const STOP_WORDS = new Set(['the','a','an','and','or','of','in','at','for','with','to','on','is','this','call','meeting','sync','standup'])
        const tokenize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
        const titleScore = (a, b) => {
          const ta = new Set(tokenize(a)), tb = new Set(tokenize(b))
          if (!ta.size || !tb.size) return 0
          let overlap = 0; for (const t of ta) if (tb.has(t)) overlap++
          return overlap / Math.min(ta.size, tb.size)
        }
        const ref = new Date(meetingDate)
        const windowStart = new Date(ref.getTime() - 48 * 60 * 60 * 1000).toISOString()
        const windowEnd   = new Date(ref.getTime() + 48 * 60 * 60 * 1000).toISOString()
        const { data: candidates } = await supabase.from('events').select('id, title')
          .gte('start_time', windowStart).lte('start_time', windowEnd)
        if (candidates?.length) {
          let best = null, bestScore = 0
          for (const evt of candidates) {
            const score = titleScore(title, evt.title)
            if (score > bestScore) { bestScore = score; best = evt }
          }
          if (best && bestScore >= 0.25) {
            await supabase.from('meeting_notes').update({ event_id: best.id }).eq('id', record.id)
            record.event_id = best.id
          }
        }
      } catch { /* non-fatal */ }

      // 5. Run AI extraction asynchronously (don't block the upload response)
      // We return immediately and let extraction run in background
      res.json({
        success: true,
        id: record.id,
        title,
        detected_type: fileType,
        meeting_date: meetingDate,
        word_count: rawText.trim().split(/\s+/).length,
        message: `Uploaded as ${fileType}. AI extraction running in background.`
      })

      // 6. Background extraction
      setImmediate(async () => {
        try {
          let summary = null
          let intelligence = null

          if (fileType === 'transcript') {
            // Full extraction pipeline
            intelligence = await extractIntelligenceFromTranscript(rawText, {
              title,
              meeting_date: meetingDate,
              project_id: projectId,
            })
            summary = intelligence?.summary || null
          } else {
            // Summary/intelligence doc — lighter parse
            intelligence = await parsePlaudSummary(rawText)
            summary = rawText.slice(0, 4000) // keep original text as summary
          }

          const updatePayload = {
            intelligence_extracted: true,
            extracted_intelligence: intelligence,
          }
          if (summary) updatePayload.summary = summary
          if (intelligence?.participants?.length) updatePayload.participants = intelligence.participants
          if (intelligence?.action_items?.length)  updatePayload.action_items = intelligence.action_items

          await supabase.from('meeting_notes').update(updatePayload).eq('id', record.id)
        } catch (bgErr) {
          console.error(`[upload-meeting] Background extraction failed for ${record.id}:`, bgErr.message)
        }
      })

    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })
}
