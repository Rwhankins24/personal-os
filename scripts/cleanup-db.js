#!/usr/bin/env node
// personal-os — Database cleanup
// Removes test data, seeded demo data, and duplicate threads
// Run: node ~/personal-os/scripts/cleanup-db.js

const path = require('path')
const fs   = require('fs')
const { createClient } = require(path.join(process.env.HOME, 'personal-os', 'api', 'node_modules', '@supabase', 'supabase-js'))

// ── Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(process.env.HOME, 'personal-os', 'api', '.env')
const env = {}
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  line = line.trim()
  if (!line || line.startsWith('#') || !line.includes('=')) return
  const [k, ...rest] = line.split('=')
  env[k.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
})

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PERSONAL OS — DATABASE CLEANUP')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // ── 1. Delete test email ───────────────────────────────────────────────
  const { data: d1, error: e1, count: c1 } = await supabase
    .from('emails')
    .delete({ count: 'exact' })
    .eq('from_address', 'test@test.com')
  if (e1) console.error('  ERROR (test email):', e1.message)
  else console.log(`  emails — test@test.com:          ${c1 ?? '?'} deleted`)

  // ── 2. Delete seeded demo emails ───────────────────────────────────────
  const demoAddresses = [
    'j.miller@fireproofing.com',
    'schen@southbankdev.com',
    'mpowell@ljcarch.com'
  ]
  const { data: d2, error: e2, count: c2 } = await supabase
    .from('emails')
    .delete({ count: 'exact' })
    .in('from_address', demoAddresses)
  if (e2) console.error('  ERROR (demo emails):', e2.message)
  else console.log(`  emails — seeded demo addresses:  ${c2 ?? '?'} deleted`)

  // ── 3. Deduplicate email threads ───────────────────────────────────────
  // Fetch all emails, find duplicate thread_subject+from_address combos,
  // keep the newest created_at, delete the rest.
  const { data: allEmails, error: e3a } = await supabase
    .from('emails')
    .select('id, thread_subject, from_address, created_at')
    .order('created_at', { ascending: false })

  if (e3a) {
    console.error('  ERROR (fetch for dedup):', e3a.message)
  } else {
    const seen = new Map()
    const toDelete = []
    for (const row of allEmails) {
      const key = `${row.thread_subject}||${row.from_address}`
      if (seen.has(key)) {
        toDelete.push(row.id)
      } else {
        seen.set(key, row.id)
      }
    }
    if (toDelete.length === 0) {
      console.log(`  emails — duplicate threads:      0 deleted (no duplicates found)`)
    } else {
      const { error: e3b, count: c3 } = await supabase
        .from('emails')
        .delete({ count: 'exact' })
        .in('id', toDelete)
      if (e3b) console.error('  ERROR (dedup delete):', e3b.message)
      else console.log(`  emails — duplicate threads:      ${c3 ?? toDelete.length} deleted`)
    }
  }

  // ── 4. Delete seeded demo events ───────────────────────────────────────
  const demoEventIds = [
    'evt_southbank_001',
    'evt_precon_001',
    'evt_ob_001',
    'evt_cfo_001',
    'webhook_test_001'
  ]
  const { error: e4, count: c4 } = await supabase
    .from('events')
    .delete({ count: 'exact' })
    .in('external_id', demoEventIds)
  if (e4) console.error('  ERROR (demo events):', e4.message)
  else console.log(`  events — seeded demo events:     ${c4 ?? '?'} deleted`)

  // ── 5. Delete seeded demo tasks ────────────────────────────────────────
  // Find Southbank Tower project id first
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('name', 'Southbank Tower')
    .maybeSingle()

  const demoTaskLabels = [
    'Subcontractor coordination call May 13',
    'Pursuit strategy session May 12',
    'PM forwarded updated matrix',
    'BD weekly May 13'
  ]

  if (!project) {
    console.log(`  tasks — seeded demo tasks:       0 deleted (Southbank Tower project not found)`)
  } else {
    const { error: e5, count: c5 } = await supabase
      .from('tasks')
      .delete({ count: 'exact' })
      .in('source_label', demoTaskLabels)
      .eq('project_id', project.id)
    if (e5) console.error('  ERROR (demo tasks):', e5.message)
    else console.log(`  tasks — seeded demo tasks:       ${c5 ?? '?'} deleted`)
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Done.')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

run().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
