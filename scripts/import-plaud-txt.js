#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// import-plaud-txt.js
//
// Imports all .txt Plaud/Otter transcripts from a local folder into meeting_notes.
//
// Run: node ~/personal-os/scripts/import-plaud-txt.js ~/path/to/recordings
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')

const SUPABASE_URL    = 'https://dvevqwhphrcboyjpvnlz.supabase.co'
const SERVICE_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4'
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY
const VERCEL_URL      = 'https://personal-os-five-black.vercel.app'
const TRIGGER_SECRET  = '0557601ac4f4c8f0d42923bba2fb083b'

const folder = process.argv[2]
if (!folder) {
  console.error('Usage: node import-plaud-txt.js <folder-path>')
  process.exit(1)
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

// ── Extract date from filename ───────────────────────────────────────────────
// Handles: "2026-05-15 title.txt", "2026-05-15.txt", "title 2026-05-15.txt"
// Also handles: "May 15, 2026 title.txt"
function extractDateFromFilename(filename) {
  const base = path.basename(filename, '.txt')

  // ISO date: 2026-05-15
  const isoMatch = base.match(/(\d{4}[-_]\d{2}[-_]\d{2})/)
  if (isoMatch) return isoMatch[1].replace(/_/g, '-')

  // Date with time: 2026-05-15 14:30 or 2026-05-15_14-30
  // (already caught by ISO match above)

  return null
}

// ── Extract title from filename (strip date + clean up) ──────────────────────
function extractTitleFromFilename(filename) {
  const base = path.basename(filename, '.txt')
  // Remove ISO date pattern
  const withoutDate = base
    .replace(/\d{4}[-_]\d{2}[-_]\d{2}/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return withoutDate || null
}

// ── Count words in transcript ─────────────────────────────────────────────────
function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length
}

// ── Extract participants from transcript ──────────────────────────────────────
// Parses speaker labels like "Ryan Hankins  00:00" or "Speaker 1  00:55"
function extractParticipants(content) {
  const speakerPattern = /^([A-Za-z][A-Za-z\s]+?)\s{2,}\d+:\d+/gm
  const seen = new Set()
  let match
  while ((match = speakerPattern.exec(content)) !== null) {
    const name = match[1].trim()
    if (name && name !== 'Unknown Speaker' && !name.startsWith('Speaker ')) {
      seen.add(name)
    }
  }
  return [...seen]
}

// ── Clean transcript: strip Otter footer, normalize whitespace ─────────────────
function cleanTranscript(content) {
  return content
    .replace(/Transcribed by https?:\/\/otter\.ai\s*$/im, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

// ── Generate title via Claude Haiku (when filename has no title) ───────────────
async function generateTitle(transcript, date) {
  if (!ANTHROPIC_KEY) return `Meeting ${date || 'unknown date'}`

  const snippet = transcript.slice(0, 1500)
  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages: [{
      role:    'user',
      content: `Based on this meeting transcript excerpt, generate a concise, descriptive title (max 10 words). Focus on the main topic discussed. Return only the title, nothing else.\n\n${snippet}`
    }]
  })

  try {
    const res = await request(
      'https://api.anthropic.com/v1/messages',
      {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        }
      },
      body
    )
    return res.body?.content?.[0]?.text?.trim() || `Meeting ${date || 'unknown'}`
  } catch {
    return `Meeting ${date || 'unknown'}`
  }
}

// ── Upsert meeting via API ─────────────────────────────────────────────────────
async function upsertMeeting(payload) {
  const res = await request(
    `${VERCEL_URL}/api/meeting-notes`,
    {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-trigger-secret': TRIGGER_SECRET,
      }
    },
    payload
  )
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`[${res.status}] ${JSON.stringify(res.body).slice(0, 150)}`)
  }
  return res.body
}

// ── Build mp3→date map from folder ────────────────────────────────────────────
// Plaud .mp3 files have dates in their names; .txt files may not.
// Strategy:
//   1. Same base name (strip extension) → direct match
//   2. Same sort position (mp3s and txts are in same order) → positional match
//   3. File modification time proximity (within 60 min) → time match
//   4. No match → fall back to txt filename or content
function buildDateMap(dir) {
  const mp3Files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp3') && !f.startsWith('.'))
    .sort()

  console.log(`\nFound ${mp3Files.length} .mp3 files for date matching`)

  // Map: base name → { date, time, filename }
  const mp3Map = {}
  const mp3List = []

  for (const mp3 of mp3Files) {
    const base = path.basename(mp3, '.mp3')
    const date = extractDateFromFilename(mp3)
    const stat = fs.statSync(path.join(dir, mp3))

    // Also extract time component if present (e.g. 14-30-00 or 14:30:00)
    const timeMatch = base.match(/(\d{1,2})[-:](\d{2})[-:]?(\d{2})?/)
    const timeMs = timeMatch
      ? new Date(`${date || '2026-01-01'}T${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}:00`).getTime()
      : stat.mtimeMs

    mp3List.push({ filename: mp3, base, date, timeMs, mtimeMs: stat.mtimeMs })
    if (base) mp3Map[base] = { date, timeMs }
  }

  return { mp3Map, mp3List }
}

// ── Find best date match for a .txt file ──────────────────────────────────────
function findDateForTxt(txtFile, mp3Map, mp3List, txtIndex, totalTxt) {
  const base    = path.basename(txtFile, '.txt')
  const stat    = fs.statSync(txtFile)
  const txtMtime = stat.mtimeMs

  // 1. Direct base name match
  if (mp3Map[base]) return { date: mp3Map[base].date, method: 'name-match' }

  // 2. Partial name match (mp3 base contains txt base or vice versa)
  for (const mp3 of mp3List) {
    if (mp3.base.includes(base) || base.includes(mp3.base)) {
      return { date: mp3.date, method: 'partial-name' }
    }
  }

  // 3. Positional match (same index in sorted order — works when naming is consistent)
  if (mp3List.length === totalTxt && mp3List[txtIndex]) {
    return { date: mp3List[txtIndex].date, method: 'positional' }
  }

  // 4. File modification time proximity (within 4 hours)
  const FOUR_HOURS = 4 * 60 * 60 * 1000
  let closest = null, closestDiff = Infinity
  for (const mp3 of mp3List) {
    const diff = Math.abs(txtMtime - mp3.mtimeMs)
    if (diff < FOUR_HOURS && diff < closestDiff) {
      closestDiff = diff
      closest = mp3
    }
  }
  if (closest) return { date: closest.date, method: `mtime-proximity (${Math.round(closestDiff/60000)}min)` }

  // 5. No match — try extracting from txt filename itself
  const txtDate = extractDateFromFilename(txtFile)
  if (txtDate) return { date: txtDate, method: 'txt-filename' }

  return { date: null, method: 'none' }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const resolvedFolder = folder.replace(/^~/, process.env.HOME)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PERSONAL OS — PLAUD TXT IMPORT')
  console.log(`  Folder: ${resolvedFolder}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  if (!fs.existsSync(resolvedFolder)) {
    console.error(`Folder not found: ${resolvedFolder}`)
    process.exit(1)
  }

  // Find all files
  function findFiles(dir, ext) {
    const results = []
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) results.push(...findFiles(full, ext))
      else if (item.endsWith(ext) && !item.startsWith('.')) results.push(full)
    }
    return results.sort()
  }

  const txtFiles = findFiles(resolvedFolder, '.txt')
  const { mp3Map, mp3List } = buildDateMap(resolvedFolder)

  console.log(`Found ${txtFiles.length} .txt files`)

  if (!txtFiles.length) {
    console.log('No .txt files found. Check the folder path.')
    return
  }

  // Preview
  console.log('\nSample .txt files:')
  txtFiles.slice(0, 5).forEach(f => console.log(`  ${path.basename(f)}`))
  if (txtFiles.length > 5) console.log(`  ... and ${txtFiles.length - 5} more`)
  console.log()

  // Show date matching preview
  console.log('Date matching preview (first 5):')
  for (let i = 0; i < Math.min(5, txtFiles.length); i++) {
    const { date, method } = findDateForTxt(txtFiles[i], mp3Map, mp3List, i, txtFiles.length)
    console.log(`  ${path.basename(txtFiles[i])} → ${date || 'unknown'} (${method})`)
  }
  console.log()

  let inserted = 0, updated = 0, skipped = 0, errors = 0

  for (let i = 0; i < txtFiles.length; i++) {
    const file     = txtFiles[i]
    const filename = path.basename(file)
    try {
      const raw     = fs.readFileSync(file, 'utf8')
      const content = cleanTranscript(raw)

      if (content.length < 50) {
        console.log(`  ⚠ Skipping (too short): ${filename}`)
        skipped++
        continue
      }

      const { date, method } = findDateForTxt(file, mp3Map, mp3List, i, txtFiles.length)
      const filenameTitle    = extractTitleFromFilename(filename)
      const participants = extractParticipants(content)
      const words        = wordCount(content)

      // Determine title: use filename title if meaningful, otherwise generate from content
      let title = filenameTitle && filenameTitle.length > 3
        ? filenameTitle
        : await generateTitle(content, date)

      // Build a simple summary from first speaker turn
      const firstTurnMatch = content.match(/\d+:\d+\n([^\n]+(?:\n(?!\S).[^\n]*)*)/)
      const summary = firstTurnMatch
        ? firstTurnMatch[1].slice(0, 500).trim()
        : content.slice(0, 500)

      // Unique ID: use date + first 40 chars of content hash
      const contentHash = Buffer.from(content.slice(0, 200)).toString('base64').slice(0, 20)
      const otterId     = `plaud_txt_${date || 'unknown'}_${contentHash}`

      const payload = {
        otter_id:              otterId,
        external_id:           otterId,
        title,
        meeting_date:          date || null,
        source:                'plaud',
        short_summary:         summary,
        summary,
        raw_transcript:        content,
        full_transcript:       content,
        action_items_raw:      [],
        participants,
        has_transcript:        true,
        transcript_word_count: words,
      }

      const result = await upsertMeeting(payload)
      const isNew = result?.created_at === result?.updated_at

      console.log(`  ✓ ${title} (${date || 'no date'} via ${method}) [${words}w] — ${participants.slice(0,3).join(', ')}`)
      if (isNew) inserted++; else updated++

    } catch (err) {
      console.log(`  ✗ ${filename}: ${err.message}`)
      errors++
    }

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 100))
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  IMPORT COMPLETE')
  console.log(`  Files found:   ${txtFiles.length}`)
  console.log(`  Inserted:      ${inserted}`)
  console.log(`  Updated:       ${updated}`)
  console.log(`  Skipped:       ${skipped}`)
  console.log(`  Errors:        ${errors}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
