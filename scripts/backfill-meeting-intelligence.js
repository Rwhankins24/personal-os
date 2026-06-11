'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// backfill-meeting-intelligence.js
//
// One-time backfill: runs AI intelligence extraction on all Plaud/Otter
// meetings that have a full transcript but haven't been processed yet
// (intelligence_extracted = false).
//
// Run from the api/ directory:
//   cd ~/personal-os/api && node ../scripts/backfill-meeting-intelligence.js
//
// Progress is saved per-meeting — safe to interrupt and re-run.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../api/.env') })

const { createClient } = require('@supabase/supabase-js')
const aiService        = require('../api/src/services/ai')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })

// ── Find project by keywords (same logic as nightly job) ─────────────────────
async function findProjectByKeywords(text) {
  if (!text) return null
  try {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, keywords')
      .eq('status', 'active')

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    let bestMatch = null
    let bestScore = 0

    for (const project of (projects || [])) {
      const projectWords = [
        ...(project.name || '').toLowerCase().split(/\s+/),
        ...(project.keywords || [])
      ]
      const score = words.filter(w => projectWords.some(p => p.includes(w) || w.includes(p))).length
      if (score > bestScore) { bestScore = score; bestMatch = project }
    }

    return bestScore >= 2 ? bestMatch?.id : null
  } catch { return null }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Backfill: Meeting Intelligence Extraction ===')
  console.log(`Date: ${today}`)

  // Fetch ALL unprocessed meetings with transcripts — no limit
  const { data: meetings, error } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('intelligence_extracted', false)
    .not('full_transcript', 'is', null)
    .order('start_time', { ascending: false })

  if (error) { console.error('DB error:', error.message); process.exit(1) }
  if (!meetings?.length) { console.log('✓ No meetings to process — all up to date.'); process.exit(0) }

  console.log(`Found ${meetings.length} meetings to process\n`)

  let processed = 0
  let skipped   = 0
  let failed    = 0

  for (const meeting of meetings) {
    const label = `"${meeting.title || 'Untitled'}" (${meeting.start_time?.split('T')[0] || 'no date'})`
    try {
      // Skip all-hands / company-wide meetings (too noisy for intelligence)
      const isAllHands = /all.?hands|town.?hall|company.?wide|all.?staff/i.test(meeting.title || '')
      if (isAllHands) {
        console.log(`  — Skipped (all-hands): ${label}`)
        await supabase.from('meeting_notes').update({ intelligence_extracted: true }).eq('id', meeting.id)
        skipped++
        continue
      }

      const attendeeRoster = meeting.participants || []

      // Pull related emails for context
      const keywords = ((meeting.title || '') + ' ' + (meeting.short_summary || ''))
        .toLowerCase().split(' ').filter(w => w.length > 4).slice(0, 5)

      const { data: relatedEmails } = await supabase
        .from('emails')
        .select('thread_subject, from_name, ai_summary, body_preview, received_at')
        .or(keywords.length ? keywords.map(k => `thread_subject.ilike.%${k}%`).join(',') : 'id.is.null')
        .limit(5)

      console.log(`  Processing: ${label}`)
      const intel = await aiService.extractIntelligenceFromTranscript(
        meeting,
        attendeeRoster,
        relatedEmails || []
      )

      if (!intel) {
        // Mark done even if no intel — prevents infinite retry
        await supabase.from('meeting_notes').update({ intelligence_extracted: true }).eq('id', meeting.id)
        console.log(`    ✓ No intelligence extracted (transcript may be too short)`)
        skipped++
        continue
      }

      // Find linked project
      const projectId = await findProjectByKeywords(
        (meeting.title || '') + ' ' + (meeting.short_summary || '')
      )

      // Build update for meeting_notes
      const meetingUpdate = {
        intelligence_extracted: true,
        continuity_context: intel.continuity_context || null,
      }

      // Set a better summary if AI produced one and we don't have one yet
      if (intel.executive_summary && !meeting.summary) {
        meetingUpdate.summary = intel.executive_summary
      }
      if (intel.executive_summary && (!meeting.short_summary || meeting.short_summary.length < 50)) {
        meetingUpdate.short_summary = intel.executive_summary.slice(0, 200)
      }

      await supabase.from('meeting_notes').update(meetingUpdate).eq('id', meeting.id)

      // Push intelligence signals to linked project
      if (projectId) {
        const { data: project } = await supabase
          .from('projects')
          .select('intelligence_notes, decisions_made, risk_signals, key_facts')
          .eq('id', projectId)
          .single()

        if (project) {
          const meetingSource = meeting.source || 'plaud'
          const newNotes = [
            ...(intel.technical_facts    || []).map(f => ({ ...f, type: 'technical', source: meeting.title, source_type: meetingSource, date: today })),
            ...(intel.financial_signals  || []).map(f => ({ ...f, type: 'financial', source: meeting.title, source_type: meetingSource, date: today })),
            ...(intel.schedule_signals   || []).map(s => ({ ...s, type: 'schedule',  source: meeting.title, source_type: meetingSource, date: today })),
            ...(intel.scope_signals      || []).map(s => ({ ...s, type: 'scope',     source: meeting.title, source_type: meetingSource, date: today })),
          ]

          await supabase.from('projects').update({
            intelligence_notes: [...(project.intelligence_notes || []), ...newNotes].slice(-50),
            decisions_made:     [...(project.decisions_made    || []), ...(intel.decisions_made || [])].slice(-30),
            risk_signals:       [...(project.risk_signals      || []), ...(intel.risk_signals   || [])].slice(-30),
            key_facts:          [...(project.key_facts         || []), ...(intel.key_facts       || [])].slice(-30),
          }).eq('id', projectId)

          console.log(`    ✓ Linked to project — ${newNotes.length} signals added`)
        }
      }

      // Extract tasks assigned to Ryan
      const ryanTasks = [
        ...(intel.ryan_action_items    || []),
        ...(intel.action_items_for_ryan || []),
      ]
      for (const item of ryanTasks) {
        const taskText = item.task_text || item.task || (typeof item === 'string' ? item : null)
        if (!taskText) continue
        try {
          const { data: existing } = await supabase
            .from('tasks').select('id').eq('title', taskText).eq('status', 'open').maybeSingle()
          if (!existing) {
            await supabase.from('tasks').insert({
              title:        taskText,
              context:      `From meeting: ${meeting.title || 'Meeting'}`,
              status:       'open',
              source:       meeting.source || 'plaud',
              source_type:  meeting.source === 'plaud' ? 'ai_plaud' : 'ai_otter',
              source_label: meeting.title || 'Meeting',
              source_date:  meeting.start_time?.split('T')[0] || today,
              project_id:   projectId || null,
              ai_enriched:  true,
            })
          }
        } catch (_) {}
      }

      const taskCount = ryanTasks.length
      console.log(`    ✓ Done — ${taskCount} task(s) extracted${projectId ? ', project updated' : ''}`)
      processed++

    } catch (err) {
      console.log(`    ✗ Error processing ${label}: ${err.message}`)
      failed++
      // Don't mark intelligence_extracted — will retry on next run
    }
  }

  console.log(`\n=== Complete ===`)
  console.log(`  Processed: ${processed}`)
  console.log(`  Skipped:   ${skipped}`)
  console.log(`  Failed:    ${failed}`)
  console.log(`  Total:     ${meetings.length}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
