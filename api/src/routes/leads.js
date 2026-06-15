'use strict'
// personal-os — Leads route
// GET    /api/leads            → list all leads (with file counts)
// GET    /api/leads?id=...     → single lead with files
// POST   /api/leads            → create lead
// PATCH  /api/leads?id=...     → update lead
// DELETE /api/leads?id=...     → delete lead (cascades files + storage)
//
// POST   /api/leads?action=upload&id=... → upload file to Supabase Storage + create lead_files row
// DELETE /api/leads?action=file&id=...   → delete a specific lead_file + its storage object

const { createClient } = require('@supabase/supabase-js')
const multer           = require('multer')
const pdf              = require('pdf-parse')
const mammoth          = require('mammoth')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BUCKET = 'lead-files'

// Multer: parse multipart in memory, 25MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file')

// Wrap multer in a promise so we can await it
function parseMultipart(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, err => (err ? reject(err) : resolve()))
  })
}

// ── Text extraction from uploaded file ───────────────────────────────────────
async function extractText(buffer, filename) {
  const ext = (filename || '').toLowerCase()
  try {
    if (ext.endsWith('.pdf')) {
      const result = await pdf(buffer)
      return result.text
    }
    if (ext.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }
    // txt / html / everything else — just read as UTF-8
    return buffer.toString('utf-8')
  } catch {
    return buffer.toString('utf-8').slice(0, 50000)
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const { id, action } = req.query

    // ── FILE UPLOAD: POST /api/leads?action=upload&id=<lead_id> ──────────────
    if (req.method === 'POST' && action === 'upload' && id) {
      await parseMultipart(req, res)
      const file = req.file
      if (!file) return res.status(400).json({ error: 'No file provided' })

      const ext          = (file.originalname || 'file').split('.').pop()
      const storagePath  = `${id}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        })
      if (uploadError) throw uploadError

      // Insert lead_files row
      const { data: fileRow, error: insertError } = await supabase
        .from('lead_files')
        .insert({
          lead_id:      id,
          filename:     file.originalname,
          storage_path: storagePath,
          file_size:    file.size,
          mime_type:    file.mimetype,
          ai_processed: false,
        })
        .select()
        .single()
      if (insertError) throw insertError

      return res.status(201).json(fileRow)
    }

    // ── DELETE FILE: DELETE /api/leads?action=file&id=<file_id> ──────────────
    if (req.method === 'DELETE' && action === 'file' && id) {
      // Fetch the file row first to get storage_path
      const { data: fileRow } = await supabase
        .from('lead_files').select('storage_path').eq('id', id).single()
      if (fileRow?.storage_path) {
        await supabase.storage.from(BUCKET).remove([fileRow.storage_path])
      }
      const { error } = await supabase.from('lead_files').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    // ── GET SINGLE LEAD: GET /api/leads?id=... ────────────────────────────────
    if (req.method === 'GET' && id) {
      const { data: lead, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error

      const { data: files } = await supabase
        .from('lead_files')
        .select('id, filename, file_size, mime_type, ai_processed, ai_summary, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })

      return res.json({ ...lead, files: files || [] })
    }

    // ── GET ALL LEADS: GET /api/leads ─────────────────────────────────────────
    if (req.method === 'GET') {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error

      // Attach file counts
      const { data: fileCounts } = await supabase
        .from('lead_files')
        .select('lead_id')
      const countMap = {}
      for (const f of (fileCounts || [])) {
        countMap[f.lead_id] = (countMap[f.lead_id] || 0) + 1
      }
      const withCounts = (leads || []).map(l => ({ ...l, file_count: countMap[l.id] || 0 }))

      return res.json(withCounts)
    }

    // ── CREATE LEAD: POST /api/leads ──────────────────────────────────────────
    if (req.method === 'POST') {
      const { data, error } = await supabase
        .from('leads')
        .insert(req.body)
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    // ── UPDATE LEAD: PATCH /api/leads?id=... ──────────────────────────────────
    if (req.method === 'PATCH' && id) {
      const { data, error } = await supabase
        .from('leads')
        .update(req.body)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.json(data)
    }

    // ── DELETE LEAD: DELETE /api/leads?id=... ─────────────────────────────────
    if (req.method === 'DELETE' && id) {
      // First, remove all storage objects for this lead
      const { data: files } = await supabase
        .from('lead_files').select('storage_path').eq('lead_id', id)
      if (files?.length) {
        await supabase.storage.from(BUCKET).remove(files.map(f => f.storage_path))
      }
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[leads]', err)
    return res.status(500).json({ error: err.message })
  }
}
