'use strict'
// Backfill: semantic dedup for others_commitments
// Run AFTER session17-others-dedup-migration.sql is applied in Supabase
//
// What it does:
//   1. Loads all open others_commitments
//   2. Groups by committed_by_name (same person only)
//   3. Jaccard pre-filter to find near-match pairs (score >= 0.55)
//   4. Calls Haiku for AI confirmation on top 60 pairs
//   5. 75%+ confidence → auto-archives the loser (winner survives)
//   6. 65–74% confidence → flags loser with potential_duplicate_of (human review)
//
// Run: node scripts/backfill-others-dedup.js
// Env: requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const path = require('path')
const apiDir = path.join(__dirname, '../api')

// Resolve all packages from api/node_modules
require(path.join(apiDir, 'node_modules/dotenv')).config({ path: path.join(apiDir, '.env') })
const { createClient } = require(path.join(apiDir, 'node_modules/@supabase/supabase-js'))
const Anthropic = require(path.join(apiDir, 'node_modules/@anthropic-ai/sdk'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const haiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Token helpers ────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','this',
  'that','these','those','it','its','we','you','your','he','she','they',
  'their','our','my','me','him','her','us','them','get','got','make','made',
  'need','needs','send','call','follow','up','check','review','update',
])

function tokenize(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  )
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union = new Set([...setA, ...setB]).size
  return intersection / union
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('Loading open others_commitments...')

  const { data: items, error } = await supabase
    .from('others_commitments')
    .select('id, title, context, committed_by_name, committed_by_email, source_type, source_label, created_at, potential_duplicate_of, duplicate_reviewed, known_not_duplicate_with')
    .eq('status', 'open')
    .is('potential_duplicate_of', null)   // skip already-flagged
    .order('created_at', { ascending: true })

  if (error) { console.error('Load error:', error.message); process.exit(1) }

  console.log(`Loaded ${items.length} items`)

  // Group by person name (same person only — cross-person duplicates are intentional)
  const byPerson = new Map()
  for (const item of items) {
    const key = (item.committed_by_name || item.committed_by_email || 'unknown').toLowerCase().trim()
    if (!byPerson.has(key)) byPerson.set(key, [])
    byPerson.get(key).push(item)
  }

  console.log(`Grouped into ${byPerson.size} people`)

  // Pre-compute tokens
  const tokenMap = new Map(items.map(i => [i.id, tokenize(i.title)]))

  // Find near-match pairs (Jaccard >= 0.55 within same person)
  const nearMatches = []
  for (const [, group] of byPerson) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        // Skip if already reviewed
        if (a.duplicate_reviewed || b.duplicate_reviewed) continue
        const aExcludes = a.known_not_duplicate_with || []
        const bExcludes = b.known_not_duplicate_with || []
        if (aExcludes.includes(b.id) || bExcludes.includes(a.id)) continue
        // Skip if both are manual entries
        if (a.source_type === 'manual' && b.source_type === 'manual') continue
        const score = jaccard(tokenMap.get(a.id), tokenMap.get(b.id))
        if (score >= 0.30) {
          nearMatches.push({ a, b, score })
        }
      }
    }
  }

  // Sort by score descending — review highest-confidence pairs first
  nearMatches.sort((x, y) => y.score - x.score)

  console.log(`Found ${nearMatches.length} near-match pairs (Jaccard >= 0.55)`)
  console.log(`Processing top ${Math.min(nearMatches.length, 120)} pairs...`)

  // ── AI confirmation ──────────────────────────────────────────────
  let autoMerged = 0
  let flagged    = 0
  let skipped    = 0
  const archived = new Set()

  for (const { a, b, score } of nearMatches.slice(0, 120)) {
    if (archived.has(a.id) || archived.has(b.id)) continue

    const prompt = `Two commitments from Ryan's personal OS — both assigned to the same person:

Person: ${a.committed_by_name || 'unknown'}

Commitment A: "${a.title}"
  Context: ${a.context || 'none'}
  Source: ${a.source_label || a.source_type || 'unknown'}
  Created: ${a.created_at?.split('T')[0]}

Commitment B: "${b.title}"
  Context: ${b.context || 'none'}
  Source: ${b.source_label || b.source_type || 'unknown'}
  Created: ${b.created_at?.split('T')[0]}

Are these the same underlying commitment (just phrased differently or captured from different meetings), or genuinely distinct items that both need to be tracked?

If they ARE the same: identify which is the "winner" to keep (A or B) — prefer the more complete/specific phrasing.

Respond ONLY with valid JSON:
{
  "is_duplicate": true,
  "confidence": 82,
  "winner": "A",
  "best_title": "The clearest, most complete phrasing",
  "reason": "one sentence why they are the same"
}

"confidence" is an integer 0-100 for how certain you are.`

    try {
      const msg = await haiku.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }]
      })

      const raw = (msg.content[0]?.text || '').trim()
      let verdict
      try {
        const m = raw.match(/\{[\s\S]*\}/)
        verdict = JSON.parse(m ? m[0] : raw)
      } catch { skipped++; continue }

      if (!verdict?.is_duplicate) { skipped++; continue }

      const confidence = typeof verdict.confidence === 'number' ? verdict.confidence : 0

      if (confidence < 65) { skipped++; continue }

      // Determine winner / loser
      const winner = verdict.winner === 'B' ? b : a
      const loser  = verdict.winner === 'B' ? a : b
      const bestTitle = verdict.best_title || winner.title

      if (confidence >= 75) {
        // Auto-archive loser, update winner title if better
        await supabase
          .from('others_commitments')
          .update({ status: 'archived', potential_duplicate_of: winner.id, duplicate_confidence: confidence })
          .eq('id', loser.id)

        if (bestTitle && bestTitle !== winner.title) {
          await supabase
            .from('others_commitments')
            .update({ title: bestTitle })
            .eq('id', winner.id)
        }

        archived.add(loser.id)
        autoMerged++
        console.log(`  ✓ Auto-merged (${confidence}%): "${loser.title}" → "${winner.title}"`)
      } else {
        // 65-74%: flag for human review — loser stays open, gets potential_duplicate_of set
        await supabase
          .from('others_commitments')
          .update({ potential_duplicate_of: winner.id, duplicate_confidence: confidence })
          .eq('id', loser.id)

        flagged++
        console.log(`  ⚑ Flagged (${confidence}%): "${loser.title}" → "${winner.title}"`)
      }
    } catch (err) {
      console.error(`  Error on pair: ${err.message}`)
      skipped++
    }

    // Brief pause to avoid API rate limiting
    await new Promise(r => setTimeout(r, 150))
  }

  console.log('\n── Summary ──')
  console.log(`  Auto-merged (75%+): ${autoMerged}`)
  console.log(`  Flagged for review (65–74%): ${flagged}`)
  console.log(`  Skipped (low confidence / error): ${skipped}`)
  console.log(`  Remaining near-match pairs not processed: ${Math.max(0, nearMatches.length - 120)}`)

  if (nearMatches.length > 60) {
    console.log('\n  Run again to process next batch (already-flagged items are skipped automatically).')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
