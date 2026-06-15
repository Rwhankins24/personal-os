'use strict'
// Backfill: semantic dedup for commitments (Ryan's own commitments — promises HE made to others)
// Items are pre-clustered by project/client before windowing — prevents cross-project false positives
// Run: node scripts/backfill-commitments-dedup.js
// Re-runnable: already-flagged/archived items are skipped automatically

const path = require('path')
const apiDir = path.join(__dirname, '../api')

require(path.join(apiDir, 'node_modules/dotenv')).config({ path: path.join(apiDir, '.env') })
const { createClient } = require(path.join(apiDir, 'node_modules/@supabase/supabase-js'))
const Anthropic = require(path.join(apiDir, 'node_modules/@anthropic-ai/sdk'))

const {
  AUTO_ARCHIVE_THRESHOLD,
  FLAG_THRESHOLD,
  getProjectBucket,
  runDedupWindows,
} = require('./dedup-lib')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const haiku    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function main() {
  console.log('Loading open commitments...')

  const { data: items, error } = await supabase
    .from('commitments')
    .select('id, title, made_to, urgency, due_date, source_type, project_id, created_at, potential_duplicate_of')
    .eq('status', 'open')
    .is('potential_duplicate_of', null)
    .order('title', { ascending: true })

  if (error) { console.error('Load error:', error.message); process.exit(1) }

  const pool = items || []
  console.log(`Pool: ${pool.length} unflagged open items`)

  // Pre-cluster by project/client (uses title + context + source_label)
  const clusters = {}
  for (const item of pool) {
    const bucket = getProjectBucket(item)
    if (!clusters[bucket]) clusters[bucket] = []
    clusters[bucket].push(item)
  }

  const bucketSummary = Object.entries(clusters)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(', ')
  console.log(`Clusters: ${bucketSummary}`)
  console.log(`Thresholds: auto-archive ≥${AUTO_ARCHIVE_THRESHOLD}%, flag for review ${FLAG_THRESHOLD}–${AUTO_ARCHIVE_THRESHOLD - 1}%, discard <${FLAG_THRESHOLD}%\n`)

  const archived = new Set()
  const stats = { autoMerged: 0, flagged: 0, totalWindows: 0 }

  for (const [clusterName, clusterItems] of Object.entries(clusters)) {
    if (clusterItems.length < 2) continue
    console.log(`\n── Cluster: ${clusterName} (${clusterItems.length} items) ──`)

    const w = await runDedupWindows({
      clusterItems,
      clusterName,
      supabase,
      haiku,
      archived,
      stats,
      tableName: 'commitments',
      promptContext: "Ryan's own verbal commitments — promises he made to others",
      buildListLine: (item, i) =>
        `${i + 1}. "${item.title}"${item.made_to ? ' — to ' + item.made_to : ''}${item.urgency ? ' | urgency: ' + item.urgency : ''}`,
    })

    stats.totalWindows += w
  }

  console.log('\n\n── Summary ──')
  console.log(`  Windows processed: ${stats.totalWindows}`)
  console.log(`  Auto-merged (≥${AUTO_ARCHIVE_THRESHOLD}%): ${stats.autoMerged}`)
  console.log(`  Flagged for review (${FLAG_THRESHOLD}–${AUTO_ARCHIVE_THRESHOLD - 1}%): ${stats.flagged}`)
  console.log(`  Re-run to catch any remaining pairs.`)
}

main().catch(err => { console.error(err); process.exit(1) })
