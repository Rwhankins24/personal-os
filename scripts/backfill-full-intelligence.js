'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// backfill-full-intelligence.js
//
// Comprehensive intelligence backfill — writes EVERYTHING extractIntelligenceFromTranscript
// returns into every applicable table and JSONB column.
//
// Writes per meeting:
//   tasks                     (ryan_action_items)
//   commitments               (verbal_commitments_ryan)
//   others_commitments        (others_action_items + verbal_commitments_others)
//   pending_decisions         (all, regardless of project match)
//   decisions                 (decisions_made → decisions table)
//   projects.intelligence_notes JSONB  (technical + financial + schedule + scope signals)
//   projects.risk_signals JSONB
//   projects.key_facts JSONB
//   projects.decisions_made JSONB
//   meeting_notes.summary     (if not already set)
//   speaker_attributions      (table, if it exists)
//
// Uses meeting.project_id AS-IS — no keyword matching needed because
// Ryan manually assigns meetings to projects in the frontend.
//
// Safe to re-run — deduplicates every write on title/content before inserting.
// Does NOT skip meetings that already have tasks — this is a full re-pass.
// Project JSONB arrays are APPENDED (not replaced) and capped at 50/30.
//
// Run from repo root:
//   cd ~/personal-os && node scripts/backfill-full-intelligence.js
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

// ── Totals tracker ────────────────────────────────────────────────────────────
const totals = {
  tasks: 0, commitments: 0, others: 0, pending_decisions: 0,
  decisions_logged: 0, intel_notes: 0, risk_signals: 0, key_facts: 0,
  summaries_written: 0, intel_cached: 0, reconciled: 0, speaker_attributions: 0,
  processed: 0, skipped: 0, failed: 0,
}

// ── Cache raw intel on meeting_notes row ──────────────────────────────────────
// Always runs — ensures signals survive even when project_id is assigned later.
// Column: meeting_notes.extracted_intelligence JSONB (added in session11 migration)
async function cacheIntelOnMeeting(intel, meetingId) {
  try {
    await supabase
      .from('meeting_notes')
      .update({ extracted_intelligence: intel })
      .eq('id', meetingId)
    totals.intel_cached++
  } catch (e) { console.warn(`      cache write error: ${e.message}`) }
}

// ── Write project JSONB signals ───────────────────────────────────────────────
// Called when project_id is known — either at extraction time or during reconciliation.
async function writeProjectSignals(intel, projectId, meetingTitle) {
  if (!projectId || !intel) return

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('intelligence_notes, decisions_made, risk_signals, key_facts')
      .eq('id', projectId)
      .single()

    if (!project) return

    // Build intelligence_notes entries — spread original object, add metadata tags
    // Matches exact pattern from nightly-ai-local.js lines 2904-2916
    const newNotes = [
      ...(intel.technical_facts || []).map(f => ({
        ...f, type: 'technical', source: meetingTitle, source_type: 'meeting', date: today
      })),
      ...(intel.financial_signals || []).map(f => ({
        ...f, type: 'financial', source: meetingTitle, source_type: 'meeting', date: today
      })),
      ...(intel.schedule_signals || []).map(s => ({
        ...s, type: 'schedule', source: meetingTitle, source_type: 'meeting', date: today
      })),
      ...(intel.scope_signals || []).map(s => ({
        ...s, type: 'scope', source: meetingTitle, source_type: 'meeting', date: today
      })),
    ]

    const newRiskSignals = (intel.risk_signals || []).map(r => ({
      ...r, source: meetingTitle, source_type: 'meeting', date: today
    }))

    const newKeyFacts = (intel.key_facts || []).map(f => ({
      ...f, source: meetingTitle, source_type: 'meeting', date: today
    }))

    const newDecisionsMade = (intel.decisions_made || []).map(d => ({
      ...d, source: meetingTitle, source_type: 'meeting', date: today
    }))

    await supabase
      .from('projects')
      .update({
        intelligence_notes: [
          ...(project.intelligence_notes || []),
          ...newNotes
        ].slice(-50),
        risk_signals: [
          ...(project.risk_signals || []),
          ...newRiskSignals
        ].slice(-30),
        key_facts: [
          ...(project.key_facts || []),
          ...newKeyFacts
        ].slice(-30),
        decisions_made: [
          ...(project.decisions_made || []),
          ...newDecisionsMade
        ],
      })
      .eq('id', projectId)

    totals.intel_notes  += newNotes.length
    totals.risk_signals += newRiskSignals.length
    totals.key_facts    += newKeyFacts.length

    return {
      intel: newNotes.length,
      risks: newRiskSignals.length,
      facts: newKeyFacts.length,
      decisions: newDecisionsMade.length,
    }
  } catch (err) {
    console.warn(`    ⚠ Project JSONB write error: ${err.message}`)
    return null
  }
}

// ── Write decisions_made → decisions table ────────────────────────────────────
// Always writes — project_id is nullable. Don't gate on project assignment.
async function writeDecisionsTable(intel, projectId, meetingId) {
  let count = 0
  for (const d of (intel.decisions_made || [])) {
    if (!d.decision) continue
    try {
      const { data: existing } = await supabase
        .from('decisions')
        .select('id')
        .eq('title', d.decision)
        .eq('source_id', meetingId)
        .maybeSingle()

      if (!existing) {
        await supabase.from('decisions').insert({
          title:            d.decision,
          what_was_decided: d.decision,
          who_was_present:  (d.all_parties || []).join(', ') || d.decided_by || null,
          decided_on:       today,
          project_id:       projectId || null,
          source_type:      'ai_otter',
          source_id:        meetingId,
          status:           'made',
        })
        count++
        totals.decisions_logged++
      }
    } catch (e) { console.warn(`      decisions insert error: ${e.message}`) }
  }
  return count
}

// ── Write speaker attributions ────────────────────────────────────────────────
// Always writes — Ryan resolves/confirms in the frontend after the fact.
// extractIntelligenceFromTranscript returns:
//   [{speaker_label, likely_person, confidence, basis}]
// speaker_attributions table schema (session 7):
//   meeting_id, speaker_label, attributed_to_name, confidence, attribution_basis,
//   attributed_to_email, attributed_to_contact_id, confirmed_by_ryan
async function writeSpeakerAttributions(intel, meetingId) {
  let count = 0
  for (const s of (intel.speaker_attributions || [])) {
    if (!s.speaker_label || !s.likely_person) continue
    try {
      const { data: existing } = await supabase
        .from('speaker_attributions')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('speaker_label', s.speaker_label)
        .maybeSingle()

      if (!existing) {
        // Try to resolve contact by name for linking
        const nameParts = (s.likely_person || '').trim().split(/\s+/)
        const { data: contact } = nameParts.length > 1
          ? await supabase.from('contacts').select('id, email')
              .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
          : { data: null }

        await supabase.from('speaker_attributions').insert({
          meeting_id:             meetingId,
          speaker_label:          s.speaker_label,
          attributed_to_name:     s.likely_person,
          attributed_to_email:    contact?.email || null,
          attributed_to_contact_id: contact?.id || null,
          confidence:             s.confidence || 'medium',
          attribution_basis:      s.basis ? [s.basis] : [],
          confirmed_by_ryan:      false,
        })
        count++
        totals.speaker_attributions = (totals.speaker_attributions || 0) + 1
      }
    } catch (e) { console.warn(`      speaker attribution error: ${e.message}`) }
  }
  return count
}

// ── Write tasks ───────────────────────────────────────────────────────────────
async function writeTasks(intel, meeting) {
  const ryanItems = [
    ...(intel.ryan_action_items     || []),
    ...(intel.action_items_for_ryan || []),
  ]
  let count = 0
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
        count++
        totals.tasks++
      }
    } catch (e) { console.warn(`      task insert error: ${e.message}`) }
  }
  return count
}

// ── Write commitments (Ryan's) ────────────────────────────────────────────────
async function writeCommitments(intel, meeting) {
  let count = 0
  for (const c of (intel.verbal_commitments_ryan || [])) {
    if (!c.title) continue
    try {
      const { data: existing } = await supabase
        .from('commitments').select('id')
        .ilike('title', c.title.slice(0, 80))
        .eq('status', 'open')
        .maybeSingle()
      if (!existing) {
        await supabase.from('commitments').insert({
          title:           c.title,
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
        count++
        totals.commitments++
      }
    } catch (e) { console.warn(`      commitment insert error: ${e.message}`) }
  }
  return count
}

// ── Write others' commitments ─────────────────────────────────────────────────
async function writeOthersCommitments(intel, meeting) {
  const items = [
    ...(intel.others_action_items       || []),
    ...(intel.verbal_commitments_others || []),
  ]
  let count = 0
  for (const item of items) {
    const title = item.title || item.task_text
    const name  = item.committed_by_name || item.assigned_to_name
    if (!title || !name) continue
    if (name === 'Ryan' || name === 'Ryan Hankins') continue
    if ((item.attribution_confidence || 'medium') === 'low') continue
    try {
      const nameParts = name.trim().split(/\s+/)
      const { data: contact } = nameParts.length > 1
        ? await supabase.from('contacts').select('id, email')
            .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
        : { data: null }

      const { data: existing } = await supabase
        .from('others_commitments').select('id')
        .ilike('title', title.slice(0, 60))
        .in('status', ['open', 'pending'])
        .maybeSingle()

      if (!existing) {
        await supabase.from('others_commitments').insert({
          title:              title,
          committed_by_name:  name,
          committed_by_email: item.committed_by_email || item.assigned_to_email || contact?.email || null,
          contact_id:         contact?.id || null,
          due_date:           item.due_date || null,
          urgency:            item.urgency || 'medium',
          status:             'open',
          source:             'meeting',
          source_type:        'ai_otter',
          source_id:          meeting.id,
          source_label:       meeting.title || 'Meeting',
          source_date:        meeting.start_time?.split('T')[0] || today,
          project_id:         meeting.project_id || null,
          meeting_note_id:    meeting.id,
          context:            `From meeting: ${meeting.title || 'Meeting'}`,
        })
        count++
        totals.others++
      }
    } catch (e) { console.warn(`      others insert error: ${e.message}`) }
  }
  return count
}

// ── Write pending decisions ───────────────────────────────────────────────────
async function writePendingDecisions(intel, meeting) {
  let count = 0
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
          context:     p.context || p.decision || title,
          blocking:    p.blocking || false,
          due_date:    p.due_date || null,
          urgency:     p.urgency || 'medium',
          project_id:  meeting.project_id || null,
          source_type: 'ai_otter',
          source_id:   meeting.id,
          status:      'open',
        })
        count++
        totals.pending_decisions++
      }
    } catch (e) { console.warn(`      pending_decision insert error: ${e.message}`) }
  }
  return count
}

// ── Write meeting summary back to meeting_notes ───────────────────────────────
// Matches nightly-ai-local.js lines 3224-3228 exactly:
//   summary      = full text, written if column is currently null
//   short_summary = truncated 300 chars, written if null or too short (<100)
async function writeMeetingSummary(intel, meeting) {
  const newSummary = intel.meeting_outcome?.summary
  if (!newSummary) return false

  const update = {}
  if (!meeting.summary) {
    update.summary = newSummary
  }
  if (!meeting.short_summary || meeting.short_summary.length < 100) {
    update.short_summary = newSummary  // full text — no truncation
  }
  if (Object.keys(update).length === 0) return false

  try {
    await supabase
      .from('meeting_notes')
      .update(update)
      .eq('id', meeting.id)
    totals.summaries_written++
    return true
  } catch (e) { console.warn(`      summary write error: ${e.message}`) }
  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Full Intelligence Backfill ===')
  console.log(`Date: ${today}`)
  console.log('Writes: tasks · commitments · others · decisions · project JSONB · summaries\n')

  // Load all meetings with transcripts
  const { data: fullTranscripts, error } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('intelligence_extracted', true)
    .not('full_transcript', 'is', null)
    .order('start_time', { ascending: false })

  if (error) { console.error('DB error:', error.message); process.exit(1) }

  const { data: rawTranscripts } = await supabase
    .from('meeting_notes')
    .select('*')
    .eq('intelligence_extracted', true)
    .is('full_transcript', null)
    .not('raw_transcript', 'is', null)
    .order('start_time', { ascending: false })

  const allMeetings = [
    ...(fullTranscripts || []),
    ...(rawTranscripts || []).filter(m => !(fullTranscripts || []).find(mm => mm.id === m.id))
  ]

  console.log(`Found ${allMeetings.length} extracted meetings with transcripts`)
  const withProject = allMeetings.filter(m => m.project_id).length
  console.log(`${withProject} have project_id assigned · ${allMeetings.length - withProject} unassigned\n`)

  for (const meeting of allMeetings) {
    if (!meeting.full_transcript && meeting.raw_transcript) {
      meeting.full_transcript = meeting.raw_transcript
    }
    const transcript = meeting.full_transcript || ''
    if (transcript.trim().length < 100) {
      totals.skipped++
      continue
    }

    const label    = `"${meeting.title || 'Untitled'}" (${meeting.start_time?.split('T')[0] || 'no date'})`
    const projTag  = meeting.project_id ? '✓ project' : 'NO PROJECT'
    console.log(`  Processing: ${label} [${transcript.length} chars] [${projTag}]`)

    try {
      // Pull related emails for extraction context
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
        totals.failed++
        continue
      }

      // Always cache raw intel on meeting_notes — survives project assignment later
      await cacheIntelOnMeeting(intel, meeting.id)

      // Write everything in parallel — always, regardless of project assignment
      const [taskCount, commitCount, othersCount, pendingCount, decisionCount, speakerCount] = await Promise.all([
        writeTasks(intel, meeting),
        writeCommitments(intel, meeting),
        writeOthersCommitments(intel, meeting),
        writePendingDecisions(intel, meeting),
        writeDecisionsTable(intel, meeting.project_id, meeting.id),
        writeSpeakerAttributions(intel, meeting.id),
      ])

      // Project JSONB — sequential (reads then writes project row)
      let projSignals = null
      if (meeting.project_id) {
        projSignals = await writeProjectSignals(intel, meeting.project_id, meeting.title)
      }

      // Summary — write both summary + short_summary per nightly job pattern
      const wroteSum = await writeMeetingSummary(intel, meeting)

      // Build output line
      const parts = [
        `Ryan: ${taskCount} tasks`,
        `Commits: ${commitCount}`,
        `Others: ${othersCount}`,
        `Decisions: ${decisionCount} made, ${pendingCount} pending`,
        `Speakers: ${speakerCount}`,
        `Risks: ${(intel.risk_signals || []).length}`,
        `Tech: ${(intel.technical_facts || []).length}`,
        `Financial: ${(intel.financial_signals || []).length}`,
        `Schedule: ${(intel.schedule_signals || []).length}`,
        `Scope: ${(intel.scope_signals || []).length}`,
        `Facts: ${(intel.key_facts || []).length}`,
      ]
      if (projSignals) {
        parts.push(`→ Project JSONB: +${projSignals.intel} intel, +${projSignals.risks} risks, +${projSignals.facts} facts`)
      }
      if (wroteSum) parts.push('summary ✓')

      console.log(`    ✓ ${parts.join(' | ')}`)
      totals.processed++

    } catch (err) {
      console.log(`    ✗ Error: ${err.message}`)
      totals.failed++
    }
  }

  // ── Reconciliation pass ───────────────────────────────────────────────────────
  // Find meetings that now have a project_id but were processed without one
  // (i.e., project was assigned after extraction). Push cached intel to project.
  console.log('\nReconciliation pass — meetings with project assigned after extraction...')
  const { data: reconcileTargets } = await supabase
    .from('meeting_notes')
    .select('id, title, project_id, start_time, extracted_intelligence')
    .not('project_id', 'is', null)
    .not('extracted_intelligence', 'is', null)

  // Filter to ones not already processed in this run (no project_id at time of loop)
  const alreadyProcessedWithProject = new Set(
    allMeetings.filter(m => m.project_id).map(m => m.id)
  )
  const toReconcile = (reconcileTargets || []).filter(
    m => !alreadyProcessedWithProject.has(m.id)
  )

  console.log(`  Found ${toReconcile.length} meetings to reconcile`)
  for (const m of toReconcile) {
    try {
      const projSignals = await writeProjectSignals(m.extracted_intelligence, m.project_id, m.title)
      await writeDecisionsTable(m.extracted_intelligence, m.project_id, m.id)
      if (projSignals) {
        console.log(`  ✓ Reconciled: "${m.title}" → +${projSignals.intel} intel, +${projSignals.risks} risks, +${projSignals.facts} facts`)
        totals.reconciled++
      }
    } catch (e) { console.warn(`  ⚠ Reconcile error for ${m.title}: ${e.message}`) }
  }

  // ── Rebuild project_context for all projects that received new intelligence ──
  console.log('\nRebuilding project_context for matched projects...')
  const matchedProjectIds = [...new Set(allMeetings.filter(m => m.project_id).map(m => m.project_id))]
  let contextRebuilt = 0
  for (const projectId of matchedProjectIds) {
    try {
      await aiService.buildProjectContext(projectId)
      contextRebuilt++
    } catch (e) { console.warn(`  ⚠ buildProjectContext failed for ${projectId}: ${e.message}`) }
  }
  console.log(`✓ Rebuilt context for ${contextRebuilt} projects\n`)

  console.log('═══════════════════════════════════════')
  console.log('FULL INTELLIGENCE BACKFILL COMPLETE')
  console.log('═══════════════════════════════════════')
  console.log(`Meetings processed:  ${totals.processed}`)
  console.log(`Meetings skipped:    ${totals.skipped}`)
  console.log(`Meetings failed:     ${totals.failed}`)
  console.log(`Intel cached:        ${totals.intel_cached}`)
  console.log(`Reconciled:          ${totals.reconciled}`)
  console.log(`Tasks created:       ${totals.tasks}`)
  console.log(`Commitments created: ${totals.commitments}`)
  console.log(`Others created:      ${totals.others}`)
  console.log(`Pending decisions:   ${totals.pending_decisions}`)
  console.log(`Decisions logged:    ${totals.decisions_logged}`)
  console.log(`Intel notes added:   ${totals.intel_notes}`)
  console.log(`Risk signals added:  ${totals.risk_signals}`)
  console.log(`Key facts added:     ${totals.key_facts}`)
  console.log(`Summaries written:   ${totals.summaries_written}`)
  console.log(`Speaker attrs:       ${totals.speaker_attributions}`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
