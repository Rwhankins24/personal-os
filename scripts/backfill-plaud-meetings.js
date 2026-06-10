#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// backfill-plaud-meetings.js
//
// One-time backfill: reads all plaud-*.json files from Supabase storage
// and upserts each meeting into the meeting_notes table so the chat
// has full historical context.
//
// Run: node ~/personal-os/scripts/backfill-plaud-meetings.js
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https')

const SUPABASE_URL  = 'https://dvevqwhphrcboyjpvnlz.supabase.co'
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4'
const VERCEL_URL    = 'https://personal-os-five-black.vercel.app'
const TRIGGER_SECRET = '0557601ac4f4c8f0d42923bba2fb083b'

// ── Simple HTTP helper ────────────────────────────────────────────────────────
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url)
    const reqOpts = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    }
    const req = https.request(reqOpts, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
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

function supabaseHeaders(extra = {}) {
  return {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey':        SERVICE_KEY,
    'Content-Type':  'application/json',
    ...extra,
  }
}

// ── List all files in daily-reports bucket ────────────────────────────────────
async function listStorageFiles() {
  // First: list ALL files so we can see what's there
  const allRes = await request(
    `${SUPABASE_URL}/storage/v1/object/list/daily-reports`,
    { method: 'POST', headers: supabaseHeaders() },
    JSON.stringify({ limit: 500, offset: 0, sortBy: { column: 'name', order: 'asc' } })
  )
  if (allRes.status !== 200) throw new Error(`List failed [${allRes.status}]: ${JSON.stringify(allRes.body)}`)

  const allFiles = allRes.body || []
  console.log(`\n  All files in daily-reports bucket (${allFiles.length} total):`)
  allFiles.slice(0, 20).forEach(f => console.log(`    ${f.name}`))
  if (allFiles.length > 20) console.log(`    ... and ${allFiles.length - 20} more`)

  // Filter to plaud files — also catch 'plaud_' prefix variant
  const plaudFiles = allFiles.filter(f =>
    f.name && (f.name.startsWith('plaud-') || f.name.startsWith('plaud_')) && f.name.endsWith('.json')
  )
  console.log(`\n  Plaud files found: ${plaudFiles.length}`)
  return plaudFiles
}

// ── Download a single file from storage ──────────────────────────────────────
async function downloadFile(filename) {
  const res = await request(
    `${SUPABASE_URL}/storage/v1/object/daily-reports/${filename}`,
    { method: 'GET', headers: supabaseHeaders() }
  )
  if (res.status !== 200) throw new Error(`Download failed [${res.status}]: ${filename}`)
  return res.body
}

// ── Upsert a single meeting into meeting_notes via the API ────────────────────
async function upsertMeeting(meeting) {
  const payload = {
    title:                 meeting.title || 'Untitled',
    meeting_date:          meeting.date  || null,
    source:                'plaud',
    summary:               meeting.summary || meeting.email_body_raw || '',
    action_items: [
      ...(meeting.ryan_action_items         || []),
      ...(meeting.others_action_items       || []),
      ...(meeting.unattributed_action_items || []),
    ],
    participants:          meeting.participants       || [],
    raw_transcript:        meeting.transcript_text   || '',
    external_id:           meeting.gmail_message_id  || meeting.id || null,
    has_transcript:        meeting.has_transcript    || false,
    transcript_word_count: meeting.transcript_word_count || 0,
  }

  const res = await request(
    `${VERCEL_URL}/api/meeting-notes`,
    {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-trigger-secret': TRIGGER_SECRET,
      },
    },
    payload
  )

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Upsert failed [${res.status}]: ${JSON.stringify(res.body).slice(0, 120)}`)
  }
  return res.body
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PERSONAL OS — PLAUD MEETING BACKFILL')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 1. List all plaud files
  console.log('\nListing plaud files in storage...')
  const files = await listStorageFiles()
  console.log(`  Found ${files.length} plaud-*.json files`)

  if (!files.length) {
    console.log('  Nothing to backfill.')
    return
  }

  let totalMeetings = 0
  let totalUpserted = 0
  let totalSkipped  = 0
  let totalErrors   = 0

  // 2. Process each file
  for (const file of files) {
    console.log(`\nProcessing: ${file.name}`)
    let report
    try {
      report = await downloadFile(file.name)
    } catch (err) {
      console.log(`  ✗ Download error: ${err.message}`)
      totalErrors++
      continue
    }

    const meetings = report.meetings || []
    if (!meetings.length) {
      console.log(`  — No meetings in this file`)
      continue
    }

    console.log(`  ${meetings.length} meeting(s) found`)
    totalMeetings += meetings.length

    for (const meeting of meetings) {
      try {
        // Skip if no external_id and no title — nothing to key on
        if (!meeting.gmail_message_id && !meeting.id && !meeting.title) {
          console.log(`    ⚠ Skipping meeting with no ID or title`)
          totalSkipped++
          continue
        }

        await upsertMeeting(meeting)
        const transcript = meeting.has_transcript
          ? ` [${meeting.transcript_word_count || 0}w transcript]`
          : ' [summary only]'
        console.log(`    ✓ ${meeting.title || 'Untitled'} (${meeting.date || 'no date'})${transcript}`)
        totalUpserted++

        // Small delay to avoid hammering the API
        await new Promise(r => setTimeout(r, 150))
      } catch (err) {
        console.log(`    ✗ ${meeting.title || 'unknown'}: ${err.message}`)
        totalErrors++
      }
    }
  }

  // 3. Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  BACKFILL COMPLETE')
  console.log(`  Files processed: ${files.length}`)
  console.log(`  Meetings found:  ${totalMeetings}`)
  console.log(`  Upserted:        ${totalUpserted}`)
  console.log(`  Skipped:         ${totalSkipped}`)
  console.log(`  Errors:          ${totalErrors}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\nThe chat now has full historical Plaud meeting context.')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
