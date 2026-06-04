/**
 * personal-os :: Local Cleanup Script
 * Prunes stale data from Supabase to keep the database tidy.
 * Run from repo root: node api/scripts/cleanup-local.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const summary = {}

// ── helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ── step 1: archive old done emails ──────────────────────────────────────────

async function archiveOldDoneEmails() {
  try {
    const { data, error } = await supabase
      .from('emails')
      .update({ archived: true })
      .eq('status', 'done')
      .lt('created_at', daysAgo(28))
      .select('id')

    if (error) throw error

    const count = data ? data.length : 0
    summary['archive_done_emails'] = count
    console.log(`[1] Archived ${count} old done email(s).`)
  } catch (err) {
    // Silently skip if the archived column doesn't exist yet
    if (err.message && err.message.includes('column')) {
      console.log('[1] Skipped archive_done_emails — column may not exist:', err.message)
      summary['archive_done_emails'] = 'skipped'
    } else {
      console.error('[1] Error archiving done emails:', err.message)
      summary['archive_done_emails'] = 'error'
    }
  }
}

// ── step 2: delete old intelligence notes ────────────────────────────────────

async function deleteOldIntelligenceNotes() {
  try {
    const { data, error } = await supabase
      .from('intelligence_notes')
      .delete()
      .lt('created_at', daysAgo(90))
      .select('id')

    if (error) throw error

    const count = data ? data.length : 0
    summary['delete_intelligence_notes'] = count
    console.log(`[2] Deleted ${count} old intelligence note(s).`)
  } catch (err) {
    console.error('[2] Error deleting intelligence notes:', err.message)
    summary['delete_intelligence_notes'] = 'error'
  }
}

// ── step 3: delete stale open pending decisions ───────────────────────────────

async function deleteStaleOpenPendingDecisions() {
  try {
    const { data, error } = await supabase
      .from('pending_decisions')
      .delete()
      .lt('created_at', daysAgo(60))
      .eq('status', 'open')
      .select('id')

    if (error) throw error

    const count = data ? data.length : 0
    summary['delete_pending_decisions'] = count
    console.log(`[3] Deleted ${count} stale open pending decision(s).`)
  } catch (err) {
    console.error('[3] Error deleting pending decisions:', err.message)
    summary['delete_pending_decisions'] = 'error'
  }
}

// ── step 4: delete answered AI questions ─────────────────────────────────────

async function deleteAnsweredAiQuestions() {
  try {
    const { data, error } = await supabase
      .from('ai_questions')
      .delete()
      .lt('created_at', daysAgo(30))
      .eq('answered', true)
      .select('id')

    if (error) throw error

    const count = data ? data.length : 0
    summary['delete_ai_questions'] = count
    console.log(`[4] Deleted ${count} answered AI question(s).`)
  } catch (err) {
    console.error('[4] Error deleting AI questions:', err.message)
    summary['delete_ai_questions'] = 'error'
  }
}

// ── step 5: trim Supabase storage (daily-reports bucket) ─────────────────────

async function trimDailyReportsStorage() {
  try {
    const listUrl = `${process.env.SUPABASE_URL}/storage/v1/object/list/daily-reports`
    const headers = {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    }

    const listRes = await fetch(listUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefix: '', limit: 1000, offset: 0 }),
    })

    if (!listRes.ok) {
      throw new Error(`Storage list failed: ${listRes.status} ${await listRes.text()}`)
    }

    const objects = await listRes.json()
    const cutoff = new Date(daysAgo(30))

    const stale = (objects || []).filter((obj) => {
      const updated = new Date(obj.updated_at || obj.created_at)
      return updated < cutoff
    })

    let deleted = 0
    for (const obj of stale) {
      try {
        const delRes = await fetch(
          `${process.env.SUPABASE_URL}/storage/v1/object/daily-reports/${obj.name}`,
          { method: 'DELETE', headers }
        )
        if (delRes.ok) {
          deleted++
        } else {
          console.warn(`[5]   Could not delete ${obj.name}: ${delRes.status}`)
        }
      } catch (delErr) {
        console.warn(`[5]   Error deleting ${obj.name}:`, delErr.message)
      }
    }

    summary['trim_storage_daily_reports'] = deleted
    console.log(`[5] Deleted ${deleted} of ${stale.length} stale storage object(s).`)
  } catch (err) {
    console.error('[5] Error trimming storage:', err.message)
    summary['trim_storage_daily_reports'] = 'error'
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== personal-os cleanup ===')
  console.log(`Started: ${new Date().toISOString()}\n`)

  await archiveOldDoneEmails()
  await deleteOldIntelligenceNotes()
  await deleteStaleOpenPendingDecisions()
  await deleteAnsweredAiQuestions()
  await trimDailyReportsStorage()

  console.log('\n=== Summary ===')
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key}: ${value}`)
  }
  console.log(`\nFinished: ${new Date().toISOString()}`)
}

main().catch((err) => {
  console.error('Fatal error in cleanup script:', err)
  process.exit(1)
})
