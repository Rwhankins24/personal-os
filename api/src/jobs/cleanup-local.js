#!/usr/bin/env node
// personal-os — Cleanup Job (twice-weekly via GitHub Actions)
// Runs Tuesday + Friday nights. Prunes stale data to keep DB lean.

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const log = (msg, data) => {
  const ts = new Date().toISOString()
  if (data !== undefined) console.log(`[${ts}] ${msg}`, JSON.stringify(data, null, 2))
  else                    console.log(`[${ts}] ${msg}`)
}

const summary = {
  emails_archived:       0,
  tasks_archived:        0,
  captures_pruned:       0,
  pipeline_runs_pruned:  0,
  ai_context_pruned:     0,
  intel_dismissed:       0,
  errors:                []
}

// ── Step 1: Archive emails older than 60 days that are done/archived ─────────
async function archiveOldEmails() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 60)

  const { data, error } = await supabase
    .from('emails')
    .update({ status: 'archived' })
    .in('status', ['done', 'archived'])
    .lt('received_at', cutoff.toISOString())
    .select('id')

  if (error) {
    summary.errors.push({ step: 'archive_emails', error: error.message })
    log('⚠️  archive_emails error:', error.message)
  } else {
    summary.emails_archived = data?.length ?? 0
    log(`✓ Archived ${summary.emails_archived} old emails`)
  }
}

// ── Step 2: Archive completed tasks older than 30 days ───────────────────────
async function archiveOldTasks() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'archived' })
    .eq('status', 'done')
    .lt('updated_at', cutoff.toISOString())
    .select('id')

  if (error) {
    summary.errors.push({ step: 'archive_tasks', error: error.message })
    log('⚠️  archive_tasks error:', error.message)
  } else {
    summary.tasks_archived = data?.length ?? 0
    log(`✓ Archived ${summary.tasks_archived} old completed tasks`)
  }
}

// ── Step 3: Prune captures older than 14 days (ephemeral notes) ──────────────
async function pruneOldCaptures() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)

  // Only delete raw captures that have been processed (type = 'text' or 'url')
  // Keep daily_brief and voice captures longer
  const { data, error } = await supabase
    .from('captures')
    .delete()
    .in('type', ['text', 'url'])
    .lt('created_at', cutoff.toISOString())
    .select('id')

  if (error) {
    summary.errors.push({ step: 'prune_captures', error: error.message })
    log('⚠️  prune_captures error:', error.message)
  } else {
    summary.captures_pruned = data?.length ?? 0
    log(`✓ Pruned ${summary.captures_pruned} old captures`)
  }
}

// ── Step 4: Prune pipeline_runs older than 30 days ───────────────────────────
async function prunePipelineRuns() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { data, error } = await supabase
    .from('pipeline_runs')
    .delete()
    .lt('run_date', cutoff.toISOString().split('T')[0])
    .select('id')

  if (error) {
    summary.errors.push({ step: 'prune_pipeline_runs', error: error.message })
    log('⚠️  prune_pipeline_runs error:', error.message)
  } else {
    summary.pipeline_runs_pruned = data?.length ?? 0
    log(`✓ Pruned ${summary.pipeline_runs_pruned} old pipeline runs`)
  }
}

// ── Step 5: Prune stale ai_context entries (keep only 3 most recent per type/subject) ──
async function pruneAIContext() {
  // Get all distinct context_type + subject_id combinations
  const { data: groups, error: gErr } = await supabase
    .from('ai_context')
    .select('context_type, subject_id')
    .order('context_type')

  if (gErr) {
    summary.errors.push({ step: 'prune_ai_context_fetch', error: gErr.message })
    return
  }

  // Unique groups
  const seen = new Set()
  const uniqueGroups = []
  for (const row of (groups || [])) {
    const key = `${row.context_type}::${row.subject_id}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueGroups.push({ context_type: row.context_type, subject_id: row.subject_id })
    }
  }

  let totalPruned = 0
  for (const group of uniqueGroups) {
    // Get all IDs for this group ordered by created_at desc
    const { data: entries, error } = await supabase
      .from('ai_context')
      .select('id')
      .eq('context_type', group.context_type)
      .eq('subject_id', group.subject_id)
      .order('created_at', { ascending: false })

    if (error || !entries || entries.length <= 3) continue

    // Delete all but the 3 most recent
    const toDelete = entries.slice(3).map(e => e.id)
    const { data: deleted } = await supabase
      .from('ai_context')
      .delete()
      .in('id', toDelete)
      .select('id')

    totalPruned += deleted?.length ?? 0
  }

  summary.ai_context_pruned = totalPruned
  log(`✓ Pruned ${totalPruned} stale ai_context entries`)
}

// ── Step 6: Auto-dismiss unlinked intelligence older than 7 days ─────────────
async function dismissOldIntel() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)

  const { data, error } = await supabase
    .from('unlinked_intelligence')
    .update({ status: 'dismissed' })
    .eq('status', 'unreviewed')
    .lt('created_at', cutoff.toISOString())
    .select('id')

  if (error) {
    summary.errors.push({ step: 'dismiss_old_intel', error: error.message })
    log('⚠️  dismiss_old_intel error:', error.message)
  } else {
    summary.intel_dismissed = data?.length ?? 0
    log(`✓ Dismissed ${summary.intel_dismissed} stale unlinked intelligence items`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('=== Cleanup Job Starting ===')
  const start = Date.now()

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    log('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
    process.exit(1)
  }

  await archiveOldEmails()
  await archiveOldTasks()
  await pruneOldCaptures()
  await prunePipelineRuns()
  await pruneAIContext()
  await dismissOldIntel()

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  log(`=== Cleanup Complete in ${elapsed}s ===`, summary)

  if (summary.errors.length > 0) {
    log(`⚠️  ${summary.errors.length} errors encountered — review above`)
    process.exit(1)
  } else {
    process.exit(0)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
