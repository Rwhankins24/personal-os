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

const path    = require('path')
const API_DIR = path.join(__dirname, '../api')

// Resolve all modules from api/node_modules since that's where they're installed
require(path.join(API_DIR, 'node_modules/dotenv')).config({ path: path.join(API_DIR, '.env') })

const { createClient } = require(path.join(API_DIR, 'node_modules/@supabase/supabase-js'))
const aiService        = require(path.join(API_DIR, 'src/services/ai'))

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
    .or('full_transcript.not.is.null,raw_transcript.not.is.null')
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

      const transcriptLen = (meeting.full_transcript || meeting.raw_transcript || '').length
      console.log(`  Processing: ${label} [transcript: ${transcriptLen} chars]`)
      // Ensure full_transcript is populated for the ai service
      if (!meeting.full_transcript && meeting.raw_transcript) {
        meeting.full_transcript = meeting.raw_transcript
      }
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

      // Save comprehensive narrative summary from meeting_outcome
      const narrativeSummary = intel.meeting_outcome?.summary
      if (narrativeSummary && !meeting.summary) {
        meetingUpdate.summary = narrativeSummary
      }
      if (narrativeSummary && (!meeting.short_summary || meeting.short_summary.length < 100)) {
        meetingUpdate.short_summary = narrativeSummary.slice(0, 300)
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
        ...(intel.ryan_action_items     || []),
        ...(intel.action_items_for_ryan || []),
      ]
      let ryanTaskCount = 0
      for (const item of ryanTasks) {
        const taskText = item.task_text || item.task || (typeof item === 'string' ? item : null)
        if (!taskText) continue
        try {
          const { data: existing } = await supabase
            .from('tasks').select('id').eq('title', taskText).eq('status', 'open').maybeSingle()
          if (!existing) {
            await supabase.from('tasks').insert({
              title:           taskText,
              context:         `From meeting: ${meeting.title || 'Meeting'}`,
              status:          'open',
              source:          meeting.source || 'plaud',
              source_type:     meeting.source === 'plaud' ? 'ai_plaud' : 'ai_otter',
              source_label:    meeting.title || 'Meeting',
              source_date:     meeting.start_time?.split('T')[0] || today,
              project_id:      projectId || null,
              meeting_note_id: meeting.id,
              ai_enriched:     true,
            })
            ryanTaskCount++
          }
        } catch (_) {}
      }

      // Extract action items assigned to others (not just commitments made to Ryan)
      // Covers: "John needs to get drawings updated", "Sarah will send the contract" etc.
      const othersItems = [
        ...(intel.others_action_items       || []),
        ...(intel.verbal_commitments_others || []),
      ]
      let othersCount = 0
      for (const item of othersItems) {
        const title = item.title || item.task_text || item.task
        const name  = item.assigned_to_name || item.committed_by_name
        if (!title || !name || name === 'Ryan' || name === 'Ryan Hankins') continue
        if ((item.attribution_confidence || 'medium') === 'low') continue
        try {
          // Look up contact by name
          const nameParts = name.trim().split(/\s+/)
          const { data: contact } = nameParts.length > 1
            ? await supabase.from('contacts').select('id, name, email')
                .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
            : { data: null }

          const { data: existing } = await supabase
            .from('others_commitments').select('id')
            .ilike('title', title.slice(0, 60))
            .eq('status', 'pending').maybeSingle()

          if (!existing) {
            await supabase.from('others_commitments').insert({
              title:           title,
              person_name:     name,
              person_email:    item.assigned_to_email || item.committed_by_email || contact?.email || null,
              contact_id:      contact?.id || null,
              due_date:        item.due_date || null,
              urgency:         item.urgency || 'medium',
              status:          'pending',
              source:          meeting.source || 'plaud',
              source_label:    meeting.title || 'Meeting',
              source_date:     meeting.start_time?.split('T')[0] || today,
              project_id:      projectId || null,
              meeting_note_id: meeting.id,
              context:         `Assigned in meeting: ${meeting.title || 'Meeting'}`,
              ai_extracted:    true,
            })
            othersCount++
          }
        } catch (_) {}
      }

      console.log(`    ✓ Done — ${ryanTaskCount} Ryan task(s), ${othersCount} others item(s)${projectId ? ', project updated' : ''}`)
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
