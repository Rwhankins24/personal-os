'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// backfill-meeting-tasks.js
//
// Targeted re-pass over already-extracted meetings to populate:
//   - tasks (ryan_action_items)
//   - commitments (verbal_commitments_ryan)
//   - others_commitments (others_action_items + verbal_commitments_others)
//   - pending_decisions
//
// Does NOT re-touch meeting summaries or project JSONB arrays — already done.
// Skips meetings that already have tasks linked via meeting_note_id.
// Safe to re-run — deduplicates on title match before inserting.
//
// Run from repo root:
//   cd ~/personal-os/api && node ../scripts/backfill-meeting-tasks.js
// ─────────────────────────────────────────────────────────────────────────────

const path    = require('path')
const API_DIR = path.join(__dirname, '../api')

require(path.join(API_DIR, 'node_modules/dotenv')).config({ path: path.join(API_DIR, '.env') })

const { createClient } = require(path.join(API_DIR, 'node_modules/@supabase/supabase-js'))
const aiService        = require(path.join(API_DIR, 'src/services/ai'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })

async function main() {
  console.log('=== Backfill: Meeting Tasks, Commitments & Decisions ===')
  console.log(`Date: ${today}\n`)

  // 1. All intelligence-extracted meetings that have a transcript
  const { data: meetings, error } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('intelligence_extracted', true)
    .not('full_transcript', 'is', null)
    .order('start_time', { ascending: false })

  if (error) { console.error('DB error:', error.message); process.exit(1) }

  // Also grab meetings with raw_transcript
  const { data: rawMeetings } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('intelligence_extracted', true)
    .is('full_transcript', null)
    .not('raw_transcript', 'is', null)
    .order('start_time', { ascending: false })

  const allMeetings = [
    ...(meetings || []),
    ...(rawMeetings || []).filter(m => !meetings?.find(mm => mm.id === m.id))
  ]

  if (!allMeetings.length) {
    console.log('No extracted meetings found with transcripts.')
    process.exit(0)
  }
  console.log(`Found ${allMeetings.length} extracted meetings with transcripts\n`)

  // 2. Check which already have tasks
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('meeting_note_id')
    .not('meeting_note_id', 'is', null)

  const meetingsWithTasks = new Set((existingTasks || []).map(t => t.meeting_note_id))
  console.log(`${meetingsWithTasks.size} meetings already have tasks linked\n`)

  let processed = 0
  let skipped   = 0
  let failed    = 0

  const totals = { tasks: 0, commitments: 0, others: 0, pending: 0 }

  for (const meeting of allMeetings) {
    const label = `"${meeting.title || 'Untitled'}" (${meeting.start_time?.split('T')[0] || 'no date'})`

    // Skip if already has tasks
    if (meetingsWithTasks.has(meeting.id)) {
      console.log(`  → Skip (already has tasks): ${label}`)
      skipped++
      continue
    }

    // Ensure transcript field is populated
    if (!meeting.full_transcript && meeting.raw_transcript) {
      meeting.full_transcript = meeting.raw_transcript
    }
    const transcript = meeting.full_transcript || ''
    if (transcript.trim().length < 100) {
      console.log(`  — Skip (transcript too short): ${label}`)
      skipped++
      continue
    }

    console.log(`  Processing: ${label} [${transcript.length} chars]`)

    try {
      // Pull related emails for context
      const keywords = ((meeting.title || '') + ' ' + (meeting.short_summary || ''))
        .toLowerCase().split(' ').filter(w => w.length > 4).slice(0, 5)
      const { data: relatedEmails } = await supabase
        .from('emails')
        .select('thread_subject, from_name, ai_summary, body_preview, received_at')
        .or(keywords.length ? keywords.map(k => `thread_subject.ilike.%${k}%`).join(',') : 'id.is.null')
        .limit(5)

      const intel = await aiService.extractIntelligenceFromTranscript(
        meeting,
        meeting.participants || [],
        relatedEmails || []
      )

      if (!intel) {
        console.log(`    ✗ Extraction returned null`)
        failed++
        continue
      }

      // ── Ryan's action items → tasks ─────────────────────────────────────
      const ryanItems = [
        ...(intel.ryan_action_items     || []),
        ...(intel.action_items_for_ryan || []),
      ]
      let taskCount = 0
      for (const item of ryanItems) {
        const title = item.title || item.task_text || item.task || (typeof item === 'string' ? item : null)
        if (!title) continue
        if ((item.attribution_confidence || 'medium') === 'low') continue
        try {
          const { data: existing } = await supabase
            .from('tasks').select('id')
            .ilike('title', title.slice(0, 80))
            .eq('status', 'open')
            .maybeSingle()
          if (!existing) {
            await supabase.from('tasks').insert({
              title:           title,
              context:         item.attribution_basis || `From meeting: ${meeting.title || 'Meeting'}`,
              urgency:         item.urgency || 'medium',
              due_date:        item.due_date || null,
              status:          'open',
              type:            'action',
              source_type:     'ai_otter',
              source_label:    meeting.title || 'Meeting',
              source_date:     meeting.start_time?.split('T')[0] || today,
              project_id:      meeting.project_id || null,
              meeting_note_id: meeting.id,
              ai_enriched:     true,
            })
            taskCount++
            totals.tasks++
          }
        } catch (e) { console.warn(`      task insert error: ${e.message}`) }
      }

      // ── Ryan's verbal commitments → commitments ──────────────────────────
      let commitCount = 0
      for (const c of (intel.verbal_commitments_ryan || [])) {
        const title = c.title
        if (!title) continue
        try {
          const { data: existing } = await supabase
            .from('commitments').select('id')
            .ilike('title', title.slice(0, 80))
            .eq('status', 'open')
            .maybeSingle()
          if (!existing) {
            await supabase.from('commitments').insert({
              title:           title,
              made_to:         c.made_to || null,
              urgency:         c.urgency || 'medium',
              due_date:        c.due_date || null,
              status:          'open',
              source_type:     'ai_otter',
              commitment_type: c.commitment_type || 'hard',
              implicit:        false,
              made_on:         meeting.start_time?.split('T')[0] || today,
              project_id:      meeting.project_id || null,
            })
            commitCount++
            totals.commitments++
          }
        } catch (e) { console.warn(`      commitment insert error: ${e.message}`) }
      }

      // ── Others' action items → others_commitments ────────────────────────
      const othersItems = [
        ...(intel.others_action_items       || []),
        ...(intel.verbal_commitments_others || []),
      ]
      let othersCount = 0
      for (const item of othersItems) {
        const title = item.title || item.task_text
        const name  = item.assigned_to_name || item.committed_by_name
        if (!title || !name) continue
        if (name === 'Ryan' || name === 'Ryan Hankins') continue
        if ((item.attribution_confidence || 'medium') === 'low') continue
        try {
          const nameParts = name.trim().split(/\s+/)
          const { data: contact } = nameParts.length > 1
            ? await supabase.from('contacts').select('id, name, email')
                .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
            : { data: null }

          const { data: existing } = await supabase
            .from('others_commitments').select('id')
            .ilike('title', title.slice(0, 60))
            .eq('status', 'open')
            .maybeSingle()

          if (!existing) {
            await supabase.from('others_commitments').insert({
              title:              title,
              committed_by_name:  name,
              committed_by_email: item.assigned_to_email || item.committed_by_email || contact?.email || null,
              contact_id:      contact?.id || null,
              due_date:        item.due_date || null,
              urgency:         item.urgency || 'medium',
              status:          'open',
              source_label:    meeting.title || 'Meeting',
              source_date:     meeting.start_time?.split('T')[0] || today,
              project_id:      meeting.project_id || null,
              meeting_note_id: meeting.id,
              context:         `From meeting: ${meeting.title || 'Meeting'}`,
              ai_extracted:    true,
            })
            othersCount++
            totals.others++
          }
        } catch (e) { console.warn(`      others insert error: ${e.message}`) }
      }

      // ── Pending decisions ────────────────────────────────────────────────
      let pendingCount = 0
      for (const p of (intel.pending_decisions || [])) {
        const title = p.decision || p.title
        if (!title) continue
        try {
          const { data: existing } = await supabase
            .from('pending_decisions').select('id')
            .ilike('title', title.slice(0, 80))
            .eq('status', 'open')
            .maybeSingle()
          if (!existing) {
            await supabase.from('pending_decisions').insert({
              title:       title,
              context:     p.blocking || p.decision || null,
              blocking:    p.blocking || null,
              due_date:    p.due_date || null,
              urgency:     p.urgency || 'medium',
              project_id:  meeting.project_id,
              source_type: 'ai_otter',
              source_id:   meeting.id,
              status:      'open',
            })
            pendingCount++
            totals.pending++
          }
        } catch (e) { console.warn(`      pending_decision insert error: ${e.message}`) }
      }

      console.log(`    ✓ Tasks: ${taskCount} | Commitments: ${commitCount} | Others: ${othersCount} | Pending decisions: ${pendingCount}`)
      processed++

    } catch (err) {
      console.log(`    ✗ Error: ${err.message}`)
      failed++
    }
  }

  console.log(`\n=== Complete ===`)
  console.log(`  Processed:  ${processed}`)
  console.log(`  Skipped:    ${skipped}`)
  console.log(`  Failed:     ${failed}`)
  console.log(`\nRecords created:`)
  console.log(`  Tasks:              ${totals.tasks}`)
  console.log(`  Commitments:        ${totals.commitments}`)
  console.log(`  Others' items:      ${totals.others}`)
  console.log(`  Pending decisions:  ${totals.pending}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
