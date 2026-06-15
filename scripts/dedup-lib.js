'use strict'
// Shared library for semantic dedup backfill scripts
// Used by: backfill-tasks-dedup.js, backfill-commitments-dedup.js, backfill-decisions-dedup.js

// ── Thresholds ────────────────────────────────────────────────────────────────
const AUTO_ARCHIVE_THRESHOLD = 93
const FLAG_THRESHOLD         = 85
const MIN_TITLE_LEN          = 10
const WINDOW_SIZE            = 40
const WINDOW_STEP            = 20

// ── Project/client buckets ────────────────────────────────────────────────────
// Items are windowed within their own bucket only.
// This prevents cross-project contamination (e.g., Gotion items never compared to Sofidel items).
// Order matters: first match wins. More specific patterns should come first.
const PROJECT_BUCKETS = [
  {
    key: 'pacific_fusion',
    terms: [
      'pacific fusion', 'pf coordination', 'pf workshop', 'pf team',
      'kone crane', 'kone 300', 'kone proposal', 'kone cranes',
      'ds3', 'albuquerque', 'new mexico', 'mesa del sol',
      'stantec', 'thornton tomasetti', 'jensen hughes',
      'wgi', 'geopier', 'echo ', 'conor cranes',
    ]
  },
  { key: 'gotion',   terms: ['gotion'] },
  { key: 'sofidel',  terms: ['sofidel'] },
  { key: 'boeing',   terms: ['boeing'] },
  { key: 'stack',    terms: ['stack infrastructure'] },
  { key: 'csi',      terms: ['concrete strategies', 'csi team', 'csi capacity'] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProjectBucket(item) {
  const text = (
    (item.title        || '') + ' ' +
    (item.context      || '') + ' ' +
    (item.source_label || '')
  ).toLowerCase()
  for (const { key, terms } of PROJECT_BUCKETS) {
    if (terms.some(t => text.includes(t))) return key
  }
  return 'general'
}

function isValidTitle(title) {
  if (!title || title === 'undefined' || title === 'null') return false
  if (title.trim().length < MIN_TITLE_LEN) return false
  return true
}

// ── Core window loop ──────────────────────────────────────────────────────────
//
// Options:
//   clusterItems  — array of items in this cluster
//   clusterName   — string label (for logging)
//   supabase      — Supabase client
//   haiku         — Anthropic client
//   archived      — Set of IDs already archived this run (mutated in place)
//   stats         — { autoMerged, flagged, totalWindows } (mutated in place)
//   tableName     — e.g. 'tasks'
//   promptContext — one-line description of what these items are (for Haiku prompt)
//   buildListLine — fn(item, index) → string line for the numbered list
//   onAutoMerge   — optional async fn(winner, loser, confidence, supabase)
//                   called BEFORE the supabase archive update (used by tasks to copy metadata)

async function runDedupWindows({
  clusterItems,
  clusterName,
  supabase,
  haiku,
  archived,
  stats,
  tableName,
  promptContext,
  buildListLine,
  onAutoMerge,
}) {
  // Sort alphabetically within cluster — clusters items with similar phrasing near each other
  const sorted = [...clusterItems].sort((a, b) => (a.title || '').localeCompare(b.title || ''))

  let windows = 0
  for (let start = 0; start < sorted.length; start += WINDOW_STEP) {
    const window = sorted.slice(start, start + WINDOW_SIZE)
    if (window.length < 2) continue
    windows++

    const list = window.map((item, i) => buildListLine(item, i)).join('\n')

    const prompt = `You are reviewing a list of ${promptContext} extracted from construction project meeting recordings. Many were captured from different meetings but describe the same underlying item.

Identify any pairs that are duplicates — meaning they describe the same underlying item, even if worded differently.

${list}

Respond ONLY with a JSON array. Each element is a duplicate pair:
[
  {
    "keep": 3,
    "archive": 7,
    "confidence": 85,
    "reason": "one sentence"
  }
]

Rules:
- "keep" and "archive" are the NUMBER from the list above (1-${window.length})
- confidence is 0-100 (how certain the two items are the same item)
- Only include pairs with confidence >= ${FLAG_THRESHOLD}
- "keep" should be the more specific/complete phrasing
- If no duplicates found, return []
- Return ONLY the JSON array, nothing else`

    try {
      const msg = await haiku.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })

      const raw = (msg.content[0]?.text || '').trim()
      let pairs = []
      try {
        const match = raw.match(/\[[\s\S]*\]/)
        pairs = JSON.parse(match ? match[0] : raw)
        if (!Array.isArray(pairs)) pairs = []
      } catch {
        process.stdout.write('.')
        continue
      }

      for (const pair of pairs) {
        const { keep, archive, confidence } = pair
        if (typeof keep !== 'number' || typeof archive !== 'number') continue
        if (typeof confidence !== 'number') continue

        const winner = window[keep - 1]
        const loser  = window[archive - 1]
        if (!winner || !loser) continue

        // Guard: skip mangled/undefined titles
        if (!isValidTitle(winner.title) || !isValidTitle(loser.title)) {
          console.log(`\n  ⚠ Skipped (${confidence}%): invalid title — "${loser.title}" → "${winner.title}"`)
          continue
        }

        if (archived.has(loser.id) || archived.has(winner.id)) continue

        if (confidence >= AUTO_ARCHIVE_THRESHOLD) {
          // Optional pre-archive callback (e.g. copy metadata from loser to winner)
          if (typeof onAutoMerge === 'function') {
            await onAutoMerge(winner, loser, confidence, supabase)
          }

          // Auto-archive: high enough confidence, no review needed
          const { error: archiveErr } = await supabase
            .from(tableName)
            .update({ status: 'archived', potential_duplicate_of: winner.id, duplicate_confidence: confidence })
            .eq('id', loser.id)

          if (!archiveErr) {
            archived.add(loser.id)
            stats.autoMerged++
            console.log(`\n  ✓ Auto-merged (${confidence}%): "${loser.title}" → "${winner.title}"`)
          }
        } else {
          // Flag for review: confident enough to surface, not confident enough to auto-merge
          const { error: flagErr } = await supabase
            .from(tableName)
            .update({ potential_duplicate_of: winner.id, duplicate_confidence: confidence })
            .eq('id', loser.id)

          if (!flagErr) {
            stats.flagged++
            console.log(`\n  ⚑ Flagged for review (${confidence}%): "${loser.title}" → "${winner.title}"`)
          }
        }
      }

      if (pairs.length === 0) process.stdout.write('.')

    } catch (err) {
      console.log(`\n  Window error in cluster [${clusterName}]: ${err.message}`)
    }

    await new Promise(r => setTimeout(r, 100))
  }

  return windows
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  AUTO_ARCHIVE_THRESHOLD,
  FLAG_THRESHOLD,
  MIN_TITLE_LEN,
  WINDOW_SIZE,
  WINDOW_STEP,
  PROJECT_BUCKETS,
  getProjectBucket,
  isValidTitle,
  runDedupWindows,
}
