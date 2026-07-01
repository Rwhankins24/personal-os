'use strict'
// personal-os — Nightly AI Job (standalone Node.js script)
// Runs in GitHub Actions or locally
// Uses process.env — NOT req/res
// process.exit(0) on success, process.exit(1) on fatal failure

// ── REQUIRED SCHEMA MIGRATIONS ──────────────────────────────────────────────
// Run these ALTER TABLE statements in Supabase SQL editor before deploying:
//
//   ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS event_id uuid;
//   ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS event_title text;
//   ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS continuity_context text;
//   ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS recurring_series_key text;
//   ALTER TABLE events ADD COLUMN IF NOT EXISTS meeting_note_id uuid;
//   ALTER TABLE events ADD COLUMN IF NOT EXISTS has_recording boolean DEFAULT false;
//   ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_context text;
//   ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_context_updated_at timestamptz;
//
// ────────────────────────────────────────────────────────────────────────────

const path = require('path')
require('dotenv').config({
  path: path.join(__dirname, '../../.env')
})

const https = require('https')
const { createClient } = require('@supabase/supabase-js')
const Anthropic = require('@anthropic-ai/sdk')
const aiService = require('../services/ai')

// ── Shared Anthropic client factory ──────────────────────────────────────────
// The SDK ships with agentkeepalive (keepAlive: true, timeout: 5 min) in
// _shims/node-runtime.js. On GitHub Actions, the NAT gateway closes idle TCP
// sockets after ~60–90 seconds — well before agentkeepalive's 5-min pool
// timeout. When the SDK tries to reuse a NAT-closed socket, node-fetch gets
// "Premature close" as the server-side RST arrives mid-response.
//
// Fix: override with keepAlive: false so every Anthropic call opens a fresh
// TCP connection. Slightly slower (TLS handshake per call) but eliminates all
// stale-socket NAT issues. This is the standard fix for Lambda/Actions/GCP.
const _freshConnectionAgent = new https.Agent({ keepAlive: false })

function makeAnthropic() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    httpAgent: _freshConnectionAgent,
    timeout: 120000,   // 2 min per request
    maxRetries: 3
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// mapPlaudBlocksToIntel — bridges new Plaud block schema → existing intel schema
//
// The nightly job's DB routing logic expects intel fields like ryan_action_items,
// verbal_commitments_ryan, decisions_made, etc. This function translates the
// pre-parsed PEOPLE_AND_ACTIONS and DECISIONS_AND_RISKS blocks into that schema,
// so all downstream routing code runs unchanged.
// ─────────────────────────────────────────────────────────────────────────────
function mapPlaudBlocksToIntel(peopleAndActions, decisionsAndRisks) {
  const actions      = (peopleAndActions?.actions           || [])
  const commitments  = (peopleAndActions?.commitments       || [])
  const relSignals   = (peopleAndActions?.relationship_signals || [])
  const decisions    = (decisionsAndRisks?.decisions        || [])
  const pending      = (decisionsAndRisks?.pending          || [])
  const risks        = (decisionsAndRisks?.risks            || [])
  const facts        = (decisionsAndRisks?.facts            || [])
  const costFlags    = (decisionsAndRisks?.cost_flags       || [])
  const scheduleFlags= (decisionsAndRisks?.schedule_flags   || [])
  const leadSignals  = (decisionsAndRisks?.lead_signals     || [])

  const ryanNames = ['ryan', 'ryan hankins']
  const isRyan = (name) => ryanNames.includes((name || '').toLowerCase().trim())

  return {
    ryan_action_items: actions
      .filter(a => a.ryan_owns === true)
      .map(a => ({
        title:                  a.task,
        urgency:                a.urgency || 'medium',
        due_date:               a.due    || null,
        attribution_confidence: 'high',
        attribution_basis:      'Plaud PEOPLE_AND_ACTIONS block'
      })),

    others_action_items: actions
      .filter(a => !a.ryan_owns)
      .map(a => ({
        task_text:              a.task,
        assigned_to_name:       a.owner || null,
        assigned_to_email:      null,
        urgency:                a.urgency || 'medium',
        due_date:               a.due    || null,
        attribution_confidence: 'high',
        attribution_basis:      'Plaud PEOPLE_AND_ACTIONS block'
      })),

    verbal_commitments_ryan: commitments
      .filter(c => isRyan(c.made_by))
      .map(c => ({
        title:           c.deliverable || c.commitment,
        made_to:         c.made_to    || null,
        urgency:         'medium',
        due_date:        c.due        || null,
        commitment_type: 'hard',
        attribution_confidence: 'high'
      })),

    verbal_commitments_others: commitments
      .filter(c => !isRyan(c.made_by))
      .map(c => ({
        title:               c.deliverable || c.commitment,
        committed_by_name:   c.made_by     || 'Unknown',
        committed_by_email:  null,
        urgency:             'medium',
        due_date:            c.due         || null,
        attribution_confidence: 'high'
      })),

    decisions_made: decisions.map(d => ({
      decision:   d.decision,
      all_parties: d.parties_agreed || [],
      implications: d.implication   || null,
      attribution_confidence: 'high'
    })),

    pending_decisions: pending.map(p => ({
      decision: p.question  || p.pending,
      blocking: !!(p.blocker),
      due_date: p.trigger_date || null,
      urgency:  'high',
      context:  [p.impact_if_unresolved, p.blocker].filter(Boolean).join(' | ') || null,
      decision_maker: p.decision_maker || null
    })),

    risk_signals: risks.map(r => ({
      signal:   r.risk,
      severity: r.severity === 'critical' ? 'high' : (r.severity || 'medium'),
      type:     'scope',
      evidence: r.why_it_exists || null,
      involves_key_contact:   false,
      involves_active_project: true
    })),

    technical_facts: facts.map(f => ({
      fact:                   f.fact,
      stated_by:              f.source_person || null,
      attribution_confidence: f.confidence === 'confirmed' ? 'high' : 'medium',
      attribution_basis:      'Plaud DECISIONS_AND_RISKS block'
    })),

    financial_signals: costFlags.map(c => ({
      amount:  c.amount    || null,
      context: c.flag      || c.cost_flag,
      stated_by: 'Meeting',
      attribution_confidence: 'medium'
    })),

    schedule_signals: scheduleFlags.map(s => ({
      date_or_deadline: s.date || null,
      context:          (s.flag || s.schedule_flag) + (s.impact ? ` — ${s.impact}` : ''),
      stated_by:        'Meeting',
      hard_deadline:    true,
      attribution_confidence: 'medium'
    })),

    key_facts: facts.map(f => ({
      fact:     f.fact,
      category: 'technical',
      stated_by: f.source_person || null
    })),

    scope_signals: [],        // not produced by Plaud blocks — keep empty for compat
    lead_signals:  leadSignals,
    relationship_signals: relSignals,

    meeting_outcome: {
      summary:          '',   // populated from meeting.summary by caller
      resolved_items:   decisions.map(d => d.decision),
      unresolved_items: pending.map(p => p.question || p.pending),
      next_steps:       actions.filter(a => a.ryan_owns).map(a => a.task),
      overall_sentiment: 'productive'
    },

    speaker_attributions: (peopleAndActions?.participants || []).map(p => ({
      speaker_label: p.name,
      likely_person: p.name,
      confidence:    'high',
      basis:         'Plaud PEOPLE_AND_ACTIONS block'
    }))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// parseOldPlaudSections — zero-AI parser for old-format Plaud reports
//
// Old Plaud reports are pre-structured with numbered section headers and
// markdown tables. Instead of re-running AI on content that is already
// organized, we parse section headers as callwords and extract table rows
// directly into the intel schema.
//
// Section detection: flexible regex handles "3. Action Items",
//   "**3. Action Items**", "### 3. Action Items", emoji-prefixed headers, etc.
// Table parsing: standard markdown table format (|col|col| with --- separator)
// Returns null if extraction yields no useful data → caller falls back to Haiku
// ─────────────────────────────────────────────────────────────────────────────
function parseOldPlaudSections(meeting) {
  // Source priority:
  // 1. email_body_raw — the formatted Plaud email body with **bold** headers and |table| rows
  // 2. short_summary / summary — plain-text attachments (no tables; limited extraction)
  // email_body_raw is preferred because it has the structured markdown tables; the txt
  // attachments have the same content but stripped of all formatting.
  const summaryText = (
    (meeting.email_body_raw || '').trim().length > 200
      ? meeting.email_body_raw
      : (meeting.short_summary || meeting.summary || '')
  ).trim()

  if (!summaryText || summaryText.length < 200) return null

  // ── Helpers ──────────────────────────────────────────────────────────────

  // Split text into named sections using numbered headers.
  // Supports: "3. Action Items", "**3. Action Items**", "### 3. Action Items",
  //           "3️⃣ Action Items", emoji variants, etc.
  function extractSections(text) {
    const sections = {}
    // Match: optional #/*/emoji + digit(s) + dot + section name + newline
    const headerRe = /(?:^|\n)(?:[*#\s📋📝🔑⚠️🗓️🎤🔗📧ℹ️🤝🚧✅❓🧠💰⏰🔄📊]*)?(\d+)[.)]\s+([^\n]{3,60}?)(?:\*{0,2})?\s*(?=\n)/g
    const matches = []
    let m
    while ((m = headerRe.exec(text)) !== null) {
      matches.push({ name: m[2].trim().toLowerCase(), pos: m.index + m[0].length })
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].pos
      const end = i + 1 < matches.length ? matches[i + 1].pos - 1 : text.length
      sections[matches[i].name] = text.slice(start, end).trim()
    }
    return sections
  }

  // Find section content by keyword (partial match, case-insensitive)
  function findSection(sections, ...keywords) {
    for (const kw of keywords) {
      for (const [name, content] of Object.entries(sections)) {
        if (name.includes(kw.toLowerCase())) return content
      }
    }
    return ''
  }

  // Parse a standard markdown table into array of {header: value} objects
  function parseTable(text) {
    if (!text) return []
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'))
    if (lines.length < 2) return []

    const headers = lines[0].split('|').map(h => h.trim().toLowerCase()).filter(h => h)
    const dataLines = lines.slice(1).filter(l => !/^\|[\s\-|]+\|$/.test(l))  // skip separator

    return dataLines.map(line => {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const obj = {}
      headers.forEach((h, i) => { obj[h] = cells[i] || '' })
      return obj
    }).filter(row => Object.values(row).some(v => v && v !== '-' && v.toLowerCase() !== 'n/a' && v !== ''))
  }

  // Parse bullet list items into strings (fallback when no table)
  function parseBullets(text) {
    if (!text) return []
    return text.split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l.length > 5 && !l.startsWith('|') && !l.startsWith('#'))
  }

  // Resolve "high/medium/low" from various column names
  function cellPriority(row, ...colNames) {
    for (const col of colNames) {
      const v = (row[col] || '').toLowerCase()
      if (!v) continue
      if (v.includes('critical') || v.includes('urgent')) return 'critical'
      if (v.includes('high')) return 'high'
      if (v.includes('low')) return 'low'
      return 'medium'
    }
    return 'medium'
  }

  // Resolve severity from a cell value
  function cellSeverity(val) {
    const v = (val || '').toLowerCase()
    if (v.includes('critical') || v.includes('high') || v.includes('major')) return 'high'
    if (v.includes('low') || v.includes('minor')) return 'low'
    return 'medium'
  }

  // Attempt to parse a plain date string; return YYYY-MM-DD or null
  function parseDate(str) {
    if (!str || str === '-' || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'tbd') return null
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
    return null
  }

  // ── Extract sections ──────────────────────────────────────────────────────
  const sections = extractSections(summaryText)

  const actionText    = findSection(sections, 'action item', 'action & follow', 'task')
  const decisionText  = findSection(sections, 'decision')
  const riskText      = findSection(sections, 'risk/exposure', 'risk', 'exposure', 'concern')
  const summaryText2  = findSection(sections, 'high-perform', 'executive summary', 'summary', 'overview')
  const openQText     = findSection(sections, 'open question', 'pending question', 'question')
  const deadlineText  = findSection(sections, 'deadline', 'time-sensitive')

  // ── Parse tables ──────────────────────────────────────────────────────────
  const actionRows   = parseTable(actionText)
  const decisionRows = parseTable(decisionText)
  const riskRows     = parseTable(riskText)
  const openQRows    = parseTable(openQText)

  // ── Ryan identification ───────────────────────────────────────────────────
  const ryanTokens = ['ryan hankins', 'ryan', 'r. hankins', 'rhankins']
  const isRyan = (name) => ryanTokens.some(t => (name || '').toLowerCase().includes(t))

  // ── Map action items ──────────────────────────────────────────────────────
  const ryan_action_items = []
  const others_action_items = []

  for (const row of actionRows) {
    const person = row['person'] || row['owner'] || row['assignee'] || row['name'] || row['responsible'] || row['driver'] || ''
    const task   = row['task'] || row['action item'] || row['action'] || row['description'] || row['deliverable'] || ''
    if (!task || task.length < 3) continue

    const item = {
      title:                  task,
      due_date:               parseDate(row['deadline'] || row['due date'] || row['due'] || row['target date']),
      urgency:                cellPriority(row, 'priority', 'urgency', 'impact'),
      attribution_confidence: 'high',
      attribution_basis:      'Plaud old-format action items section'
    }

    if (isRyan(person)) {
      ryan_action_items.push(item)
    } else {
      others_action_items.push({ ...item, assigned_to_name: person || null, assigned_to_email: null })
    }
  }

  // If no table, try bullet fallback
  if (ryan_action_items.length === 0 && others_action_items.length === 0 && actionText) {
    for (const bullet of parseBullets(actionText)) {
      // Heuristic: if bullet starts with a name pattern "Person: task", split it
      const colonIdx = bullet.indexOf(':')
      const person = colonIdx > 0 && colonIdx < 30 ? bullet.slice(0, colonIdx).trim() : ''
      const task   = colonIdx > 0 && colonIdx < 30 ? bullet.slice(colonIdx + 1).trim() : bullet
      if (task.length < 5) continue
      const item = { title: task, due_date: null, urgency: 'medium', attribution_confidence: 'medium', attribution_basis: 'Plaud old-format bullet list' }
      if (isRyan(person)) ryan_action_items.push(item)
      else others_action_items.push({ ...item, assigned_to_name: person || null, assigned_to_email: null })
    }
  }

  // ── Map decisions ─────────────────────────────────────────────────────────
  const decisions_made = decisionRows.map(row => ({
    decision:   row['decision'] || row['summary'] || row['outcome'] || row['description'] || '',
    decided_by: row['owner'] || row['lead'] || row['decision owner'] || row['driver'] || row['made by'] || 'Meeting',
    all_parties: [],
    implications: row['impact'] || row['implication'] || row['notes'] || row['rationale'] || '',
    attribution_confidence: 'high'
  })).filter(d => d.decision && d.decision.length > 3)

  // Bullet fallback for decisions
  if (decisions_made.length === 0 && decisionText) {
    for (const bullet of parseBullets(decisionText)) {
      if (bullet.length > 5) decisions_made.push({ decision: bullet, decided_by: 'Meeting', all_parties: [], implications: '', attribution_confidence: 'medium' })
    }
  }

  // ── Map risks ─────────────────────────────────────────────────────────────
  const risk_signals = riskRows.map(row => ({
    signal:   row['risk'] || row['exposure'] || row['concern'] || row['description'] || row['issue'] || '',
    type:     'scope',
    severity: cellSeverity(row['impact'] || row['severity'] || row['priority'] || row['level']),
    involves_key_contact:    false,
    involves_active_project: true,
    evidence: row['mitigation'] || row['notes'] || row['owner'] || ''
  })).filter(r => r.signal && r.signal.length > 3)

  if (risk_signals.length === 0 && riskText) {
    for (const bullet of parseBullets(riskText)) {
      if (bullet.length > 5) risk_signals.push({ signal: bullet, type: 'scope', severity: 'medium', involves_key_contact: false, involves_active_project: true, evidence: '' })
    }
  }

  // ── Map pending decisions / open questions ────────────────────────────────
  const pending_decisions = openQRows.map(row => ({
    decision: row['question'] || row['open question'] || row['topic'] || row['issue'] || '',
    blocking: false,
    due_date: parseDate(row['deadline'] || row['target'] || null),
    urgency:  'medium',
    decision_maker: row['owner'] || row['responsible'] || null
  })).filter(d => d.decision && d.decision.length > 3)

  if (pending_decisions.length === 0 && openQText) {
    for (const bullet of parseBullets(openQText)) {
      if (bullet.length > 5) pending_decisions.push({ decision: bullet, blocking: false, due_date: null, urgency: 'medium', decision_maker: null })
    }
  }

  // ── Quality gate: return null if nothing extracted ─────────────────────────
  // Caller will fall back to parsePlaudSummary (Haiku) for edge cases
  const totalItems = ryan_action_items.length + others_action_items.length + decisions_made.length + risk_signals.length
  if (totalItems === 0) {
    console.log(`    parseOldPlaudSections: no structured data found — will fall back to Haiku`)
    return null
  }

  console.log(`    parseOldPlaudSections (zero-AI): ${ryan_action_items.length} Ryan tasks, ${others_action_items.length} team tasks, ${decisions_made.length} decisions, ${risk_signals.length} risks`)

  return {
    ryan_action_items,
    others_action_items,
    decisions_made,
    risk_signals,
    pending_decisions,
    verbal_commitments_ryan:   [],
    verbal_commitments_others: [],
    technical_facts:           [],
    financial_signals:         [],
    schedule_signals:          [],
    scope_signals:             [],
    key_facts:                 [],
    meeting_outcome: {
      summary:          summaryText2 || summaryText.slice(0, 800),
      resolved_items:   decisions_made.map(d => d.decision).slice(0, 5),
      unresolved_items: pending_decisions.map(d => d.decision).slice(0, 5),
      next_steps:       ryan_action_items.map(a => a.title).slice(0, 5),
      overall_sentiment: 'productive'
    },
    speaker_attributions: []
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Support date override for backfill runs:
//   DATE_OVERRIDE=2026-05-20 node nightly-ai-local.js
//   OR: node nightly-ai-local.js 2026-05-20
const today = process.env.DATE_OVERRIDE || process.argv[2] || new Date().toISOString().split('T')[0]
const isBackfill = today !== new Date().toISOString().split('T')[0]

if (isBackfill) {
  console.log(`=== BACKFILL MODE: running for ${today} (not today) ===`)
}

// ─── IDEMPOTENCY CHECK
// ── Hard process timeout — 120 minutes ───────────────────────────────────────
// If the job is still alive after 120 min something hung (Sonnet call, network stall, etc.)
// Kill it cleanly so launchd doesn't hold an orphaned node process overnight.
const MAX_RUNTIME_MS = 110 * 60 * 1000  // 110 minutes — 10-min buffer before GitHub Actions hard-kills at 120
const jobKillTimer = setTimeout(() => {
  console.error(`\n⏱ HARD TIMEOUT: nightly job exceeded ${MAX_RUNTIME_MS / 60000} minutes — forcing exit`)
  process.exit(1)
}, MAX_RUNTIME_MS)
jobKillTimer.unref()  // don't keep process alive just for the timer

// If AI already ran for this date — exit (unless FORCE_RERUN is set)
async function checkAlreadyRan() {
  if (process.env.FORCE_RERUN === 'true') {
    console.log(`FORCE_RERUN=true — skipping idempotency check for ${today}`)
    return
  }
  const { data } = await supabase
    .from('pipeline_runs')
    .select('ai_completed_at, job_started_at, status')
    .eq('run_date', today)
    .maybeSingle()

  // Already completed — exit clean
  if (data?.ai_completed_at) {
    console.log(`AI job already completed for ${today}. Exiting.`)
    process.exit(0)
  }

  // Already running — started less than 110 min ago, no completion → another instance is live
  // Use 110 min threshold (slightly under our 120 min hard kill) to avoid a crashed job
  // blocking the next day's run if cleanup didn't write ai_completed_at
  if (data?.job_started_at && data?.status === 'in_progress') {
    const startedMs = new Date(data.job_started_at).getTime()
    const ageMin = (Date.now() - startedMs) / 60000
    if (ageMin < 110) {
      console.log(`AI job already in progress for ${today} (started ${Math.round(ageMin)}min ago). Exiting to prevent cascade.`)
      process.exit(0)
    } else {
      console.log(`AI job was in progress but appears stale (${Math.round(ageMin)}min ago) — proceeding with restart`)
    }
  }
}

// ─── THREAD HISTORY QUERY
// Reads accumulated history from database
// Does NOT call Outlook
// Memoized per email.id — called multiple times for the same email across Steps 3.5, 4, 4.5, 5.
// A single nightly run can fetch the same thread history 3-4x without this cache.
const _threadHistoryCache = new Map()
async function getThreadHistory(email) {
  const cacheKey = email.id || email.thread_subject || ''
  if (_threadHistoryCache.has(cacheKey)) {
    return _threadHistoryCache.get(cacheKey)
  }

  const subject = (email.thread_subject || email.subject || '')
    .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
    .trim()
    .substring(0, 60)

  if (!subject) {
    _threadHistoryCache.set(cacheKey, [])
    return []
  }

  const { data } = await supabase
    .from('emails')
    .select(
      'id, from_name, from_address, received_at, ai_summary, ' +
      'body_preview, sent_body, status, bucket, days_waiting, tags'
    )
    .ilike('thread_subject', `%${subject}%`)
    .order('created_at', { ascending: true })  // received_at is often null; created_at is always set
    .limit(20)

  const result = data || []
  _threadHistoryCache.set(cacheKey, result)
  return result
}

// ─── PROJECT KEYWORD MATCHING
// Module-level cache — loaded once per nightly run, avoids 75-125 redundant DB calls
let _projectCache = null

async function getActiveProjects() {
  if (!_projectCache) {
    const { data } = await supabase
      .from('projects')
      .select('id, name, keywords')
      .eq('status', 'active')
    _projectCache = data || []
  }
  return _projectCache
}

async function findProjectByKeywords(text) {
  if (!text) return null

  const projects = await getActiveProjects()

  if (!projects?.length) return null

  const textLower = text.toLowerCase()

  let bestMatch = null
  let bestScore = 0

  for (const project of projects) {
    const projectNameLower = project.name.toLowerCase()

    // Tier 1: exact project name match — highest confidence
    if (textLower.includes(projectNameLower)) {
      return project.id
    }

    // Tier 2: score based on keyword matches — require 2+ meaningful hits
    // Single common words (construction, building, project) are excluded
    const COMMON_WORDS = new Set([
      'construction', 'building', 'project', 'meeting', 'update',
      'call', 'oac', 'weekly', 'review', 'status', 'schedule', 'general'
    ])
    const keywords = [
      ...projectNameLower.split(' ').filter(k => k.length > 3 && !COMMON_WORDS.has(k)),
      ...(project.keywords || []).map(k => k.toLowerCase()).filter(k => k.length > 3 && !COMMON_WORDS.has(k))
    ]

    const matchCount = keywords.filter(k => textLower.includes(k)).length

    // Require at least 2 keyword matches, or 1 if it's a long specific keyword (>7 chars)
    const longKeywordMatch = keywords.some(k => k.length > 7 && textLower.includes(k))
    const qualifies = matchCount >= 2 || (matchCount >= 1 && longKeywordMatch)

    if (qualifies && matchCount > bestScore) {
      bestScore = matchCount
      bestMatch = project.id
    }
  }

  return bestMatch
}

// ─── LOG AI QUESTION
async function logAIQuestion(question, context, questionType, options = []) {
  try {
    await supabase.from('ai_questions').insert({
      question,
      context,
      question_type: questionType,
      response_type: questionType,
      options: options.length > 0 ? options : ['Yes', 'No'],
      conversation: [],
      answered_at: null,
      acted_on: false
    })
  } catch (err) {
    console.log(`Failed to log question: ${err.message}`)
  }
}

// ─── CATEGORY-SPECIFIC EXTRACTION HINTS ─────────────────────────────────────
// Tells the AI what to focus on for each meeting type.
// Injected into extractIntelligenceFromTranscript / parsePlaudSummary prompts.
function getCategoryExtractionHints(categoryName) {
  const hints = {
    'OAC': '- Schedule status, RFI/submittal log updates\n- Open owner issues and commitments\n- Cost impacts discussed\n- Next OAC date and agenda items',
    'Settlement Discussion': '- Dollar amounts or ranges mentioned\n- Each party\'s position and movement\n- Mediator/attorney involvement\n- Next steps and deadlines\n- What was agreed vs. still open',
    'Design Review': '- Design changes or revisions required\n- Coordination issues between disciplines\n- Owner/architect decisions needed\n- Impact on cost or schedule\n- Outstanding design deliverables',
    'Change Order / PCO': '- Scope description and cause\n- Cost and schedule impact amounts\n- Which party is responsible\n- Approval status and next steps\n- Any rejection or pushback',
    'RFI Review': '- RFI numbers and subjects discussed\n- Responses provided or outstanding\n- Design clarification impacts\n- Who owes responses and by when',
    'Subcontractor Coord.': '- Sequence and coordination conflicts\n- Material or equipment lead times\n- Crew availability / manpower\n- Safety or quality issues raised\n- Commitments made by sub',
    'Safety': '- Incidents or near-misses described\n- Corrective actions required\n- Responsible parties and deadlines\n- Regulatory or compliance concerns',
    'Internal Review': '- Strategic decisions made\n- Resource or staffing issues\n- Financial targets or concerns\n- Action items for team members',
    'Pursuit / BD': '- Client priorities and hot buttons\n- Competitive landscape mentioned\n- Win themes or differentiators\n- Next pursuit milestones and owners\n- Fee or proposal strategy discussed',
    'Client Check-in': '- Client satisfaction signals\n- Upcoming decisions or approvals\n- Relationship health indicators\n- Asks or concerns from client',
    'Close-out': '- Punch list status and count\n- Certificate of substantial completion\n- Retainage or final payment status\n- Outstanding warranty or training items',
    'Preconstruction': '- Budget or GMP status\n- Design completeness and gaps\n- Long-lead procurement needs\n- Schedule milestones and risks',
  }
  return hints[categoryName] || '- Key decisions made\n- Action items and owners\n- Risks or issues raised\n- Financial or schedule impacts'
}

// ─── DETECT LINK TYPE
function detectLinks(bodyText) {
  if (!bodyText) return []

  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
  const urls = bodyText.match(urlRegex) || []

  return urls.map(url => {
    let type = 'reference'
    if (
      url.includes('teams.microsoft.com') ||
      url.includes('zoom.us') ||
      url.includes('meet.google.com') ||
      url.includes('webex.com')
    ) type = 'meeting'
    else if (
      url.includes('sharepoint.com') ||
      url.includes('drive.google.com') ||
      url.includes('dropbox.com') ||
      url.includes('onedrive')
    ) type = 'document'

    return { url, type }
  })
}

// ─── SEMANTIC DEDUPLICATION (source-priority-aware)
// Priority: manual=4 (never deleted), ai_otter=3, ai_plaud=3, ai_upload=2, ai_email=2, system=1
// ai_plaud == ai_otter (both are meeting recordings — high signal quality)
// ai_upload == ai_email (structured but not manual)
async function deduplicateTable(tableName, emailField) {
  const SOURCE_PRIORITY = { manual: 4, ai_otter: 3, ai_plaud: 3, ai_upload: 2, ai_email: 2, system: 1 }

  let selectFields = 'id, title, source_type, created_at'
  if (emailField) selectFields += `, ${emailField}`

  const { data: items } = await supabase
    .from(tableName)
    .select(selectFields)
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  if (!items?.length) return 0

  // Group items by fingerprint key
  const groups = new Map()

  for (const item of items) {
    const fingerprint = (item.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(' ')
      .filter(w => w.length > 4)
      .slice(0, 5)
      .join('|')

    const emailKey = emailField ? (item[emailField] || 'unknown') : 'any'
    const key = `${fingerprint}:${emailKey}`

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  const toDelete = []

  for (const [, group] of groups) {
    if (group.length <= 1) continue

    // Sort: highest priority first; ties broken by oldest created_at (keep original)
    group.sort((a, b) => {
      const pa = SOURCE_PRIORITY[a.source_type] || 0
      const pb = SOURCE_PRIORITY[b.source_type] || 0
      if (pb !== pa) return pb - pa
      return new Date(a.created_at) - new Date(b.created_at)
    })

    // Keep first (winner), queue the rest for deletion — never delete manual
    for (let i = 1; i < group.length; i++) {
      if (group[i].source_type !== 'manual') {
        toDelete.push(group[i].id)
      }
    }
  }

  if (toDelete.length > 0) {
    await supabase.from(tableName).delete().in('id', toDelete)
  }

  return toDelete.length
}

// ─── PROJECT KEYWORD BOOTSTRAP
// On first run: infer keywords from project names
async function bootstrapProjectKeywords() {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, keywords')
    .eq('status', 'active')

  for (const project of (projects || [])) {
    if (project.keywords && project.keywords.length > 0) continue

    // Generate keywords from project name
    const nameWords = project.name
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 2)

    const keywords = [
      project.name.toLowerCase(),
      ...nameWords
    ]

    await supabase
      .from('projects')
      .update({ keywords })
      .eq('id', project.id)

    console.log(`  Bootstrapped keywords for ${project.name}: ${keywords.join(', ')}`)
  }
}

// ─── MAIN JOB FUNCTION
async function main() {
  console.log(
    '\n═══════════════════════════════\n' +
    'PERSONAL OS — NIGHTLY AI JOB\n' +
    `Date: ${today}\n` +
    '═══════════════════════════════\n'
  )

  await checkAlreadyRan()

  // ── WRITE job_started_at — cascade guard ──────────────────────────────────
  // Written immediately after idempotency check passes and BEFORE any API calls.
  // The GitHub Actions polling logic uses this to detect: job running (< 110 min ago)
  // vs. job crashed (> 110 min ago with no ai_completed_at). Prevents re-trigger cascade.
  try {
    await supabase.from('pipeline_runs').upsert({
      run_date: today,
      job_started_at: new Date().toISOString(),
      status: 'in_progress'
    }, { onConflict: 'run_date' })
    console.log('  ✓ job_started_at written — cascade guard active')
  } catch (startErr) {
    // Non-fatal — if this fails, cascade guard won't work but job still runs
    console.log(`  ⚠ job_started_at write failed (non-fatal): ${startErr.message}`)
  }

  // Warm AI context cache once — all subsequent AI calls use the cached version
  console.log('Warming AI context (live project + task + contact data)...')
  try {
    const ctx = await aiService.warmContext()
    const projectCount = (ctx.match(/^- /mg) || []).length
    console.log(`  ✓ Context warmed (${projectCount} entries loaded)`)
  } catch (err) {
    console.log(`  ⚠ Context warm failed: ${err.message} — using base context`)
  }

  const results = {
    date: today,
    threads_summarized: 0,
    tasks_created: 0,
    my_commitments_extracted: 0,
    others_commitments_extracted: 0,
    pre_meeting_briefs: 0,
    high_stakes_meetings_detected: 0,
    decisions_logged: 0,
    pending_decisions_created: 0,
    intelligence_notes_added: 0,
    risk_signals_detected: 0,
    contacts_created: 0,
    contacts_updated: 0,
    tasks_enriched: 0,
    questions_logged: 0,
    daily_brief: null,
    plaud_meetings_processed: 0,
    plaud_tasks_created: 0,
    plaud_my_commitments: 0,
    plaud_others_created: 0,
    cross_refs_created: 0,
    knowledge_created: 0,
    observations_created: 0,
    plaud_meetings_loaded: 0,
    errors: []
  }

  // ── SHARED DEDUP HELPERS ────────────────────────────────────────
  // These are used by Steps 1.5, 2.6, 4, 5, and 5.45 so they live
  // at the top of main() rather than being re-declared each step.

  const STOP_WORDS = new Set([
    'the','and','for','with','from','this','that','have','will','been',
    'more','week','next','last','meet','call','zoom','team','follow',
    'review','update','send','check','please','need','about','over',
    'fwd','reply','into','your','their','also','make','sure','task',
    'action','item','items','regarding','re','fw','asap','today'
  ])

  function taskTokens(title) {
    return (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  }

  function jaccard(setA, setB) {
    if (!setA.length || !setB.length) return 0
    const a = new Set(setA), b = new Set(setB)
    let intersection = 0
    for (const w of a) if (b.has(w)) intersection++
    return intersection / (a.size + b.size - intersection)
  }

  /**
   * semanticMatchCheck
   * Given a candidate title (and optional person email / project filter),
   * pull open records from `tableName`, compute Jaccard overlap, and for
   * pairs >= 0.55 call Haiku to get a confidence-scored duplicate verdict.
   *
   * Returns { match: existingRecord|null, confidence: number, bestTitle: string|null }
   *
   * @param {string}      candidateTitle
   * @param {string|null} candidatePersonEmail  — used only for others_commitments (committed_by_email filter)
   * @param {string}      tableName             — 'tasks' or 'others_commitments'
   * @param {string|null} projectId             — if provided, prefer same-project records
   */
  async function semanticMatchCheck(candidateTitle, candidatePersonEmail, tableName, projectId) {
    try {
      const candidateTokens = taskTokens(candidateTitle)
      if (candidateTokens.length < 2) return { match: null, confidence: 0, bestTitle: null }

      // Build query for open records (include reviewed flags to skip known pairs)
      const extraFields = (tableName === 'others_commitments' ? ', committed_by_email' : '') +
        ', duplicate_reviewed, known_not_duplicate_with'
      let query = supabase
        .from(tableName)
        .select('id, title, status, project_id' + extraFields)
        .eq('status', 'open')
        .or('duplicate_reviewed.is.null,duplicate_reviewed.eq.false')

      if (candidatePersonEmail && tableName === 'others_commitments') {
        query = query.eq('committed_by_email', candidatePersonEmail)
      }

      if (projectId) {
        // Pull same-project + unlinked records, limit 50
        const { data: projectRecs } = await query.eq('project_id', projectId).limit(50)
        const { data: unlinkedRecs } = await supabase
          .from(tableName)
          .select('id, title, status' + (tableName === 'others_commitments' ? ', committed_by_email' : '') + ', project_id')
          .eq('status', 'open')
          .is('project_id', null)
          .limit(25)
        var candidates = [...(projectRecs || []), ...(unlinkedRecs || [])]
      } else {
        const { data: recs } = await query.limit(50)
        var candidates = recs || []
      }

      // Also check recently-dismissed records (last 30 days) — prevents re-creating items
      // Ryan already chose to dismiss. No Haiku call needed for dismissed matches; just suppress.
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      let dismissedQuery = supabase
        .from(tableName)
        .select('id, title, status, project_id')
        .eq('status', 'dismissed')
        .gte('updated_at', thirtyDaysAgo.toISOString())
        .limit(50)
      if (candidatePersonEmail && tableName === 'others_commitments') {
        dismissedQuery = dismissedQuery.eq('committed_by_email', candidatePersonEmail)
      }
      const { data: dismissedRecs } = await dismissedQuery
      const dismissedIds = new Set((dismissedRecs || []).map(r => r.id))
      candidates = [...candidates, ...(dismissedRecs || [])]

      // Find best Jaccard match — skip pairs already reviewed as "keep separate"
      let bestMatch = null
      let bestScore = 0
      for (const rec of candidates) {
        // Skip if this candidate was explicitly flagged as NOT a duplicate of rec
        const recExcludes = rec.known_not_duplicate_with || []
        if (recExcludes.some(id => id === rec.id)) continue
        const score = jaccard(candidateTokens, taskTokens(rec.title))
        if (score >= 0.55 && score > bestScore) {
          bestScore = score
          bestMatch = rec
        }
      }

      if (!bestMatch) return { match: null, confidence: 0, bestTitle: null }

      // Dismissed match — suppress without Haiku call. Ryan already decided.
      if (dismissedIds.has(bestMatch.id)) {
        return { match: bestMatch, confidence: 90, bestTitle: bestMatch.title, isDismissed: true }
      }

      // Call Haiku for semantic confirmation with confidence score
      const haikuSMC = makeAnthropic()
      const smcPrompt = `Two ${tableName === 'tasks' ? 'tasks' : 'commitments'} from Ryan's personal OS:

Item A (candidate, not yet saved): "${candidateTitle}"

Item B (existing record): "${bestMatch.title}"

Are these the same underlying action item (just phrased differently), or genuinely distinct?

If they ARE the same: pick the best title (clearest, most specific), and identify which is the "winner" to keep (A or B).

Respond ONLY with valid JSON:
{
  "is_duplicate": true,
  "confidence": 82,
  "winner": "A",
  "best_title": "The clearest, most complete phrasing",
  "reason": "one sentence why they are the same"
}

The "confidence" field must be an integer 0-100 representing how certain you are they describe the same action.`

      const smcMsg = await haikuSMC.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: smcPrompt }]
      })

      const raw = (smcMsg.content[0]?.text || '').trim()
      let verdict
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        verdict = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
      } catch { return { match: null, confidence: 0, bestTitle: null } }

      if (!verdict?.is_duplicate) return { match: null, confidence: 0, bestTitle: null }

      const confidence = typeof verdict.confidence === 'number' ? verdict.confidence : 0
      return {
        match:      bestMatch,
        confidence,
        bestTitle:  verdict.best_title || null
      }
    } catch (smcErr) {
      console.log(`  semanticMatchCheck error (non-fatal): ${smcErr.message}`)
      return { match: null, confidence: 0, bestTitle: null }
    }
  }

  // ── STEP 1: Bootstrap and hygiene ──────────────────────────────
  console.log('Step 1: Bootstrap and hygiene...')
  try {
    await bootstrapProjectKeywords()

    // Update overdue days on tasks
    const { data: overdueTasks } = await supabase
      .from('tasks')
      .select('id, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .not('due_date', 'is', null)

    for (const task of (overdueTasks || [])) {
      const days = Math.floor(
        (new Date(today) - new Date(task.due_date)) / (1000 * 60 * 60 * 24)
      )
      await supabase
        .from('tasks')
        .update({ overdue_days: days })
        .eq('id', task.id)
    }

    // Update overdue days on commitments
    const { data: overdueC } = await supabase
      .from('commitments')
      .select('id, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .not('due_date', 'is', null)

    for (const c of (overdueC || [])) {
      const days = Math.floor(
        (new Date(today) - new Date(c.due_date)) / (1000 * 60 * 60 * 24)
      )
      await supabase
        .from('commitments')
        .update({ overdue_days: days })
        .eq('id', c.id)
    }

    // ── Delete ghost emails (no name, no address, no subject) ───
    try {
      const { data: ghosts } = await supabase
        .from('emails')
        .select('id')
        .is('from_name', null)
        .is('from_address', null)
        .or('thread_subject.is.null,thread_subject.eq.')
      if (ghosts?.length) {
        await supabase.from('emails').delete().in('id', ghosts.map(g => g.id))
        console.log(`  Deleted ${ghosts.length} ghost email records (no name/address/subject)`)
      }
    } catch (ghostErr) { /* non-fatal */ }

    // ── Deduplicate tasks and others_commitments ────────────────
    try {
      const othersDeleted = await deduplicateTable('others_commitments', 'committed_by_email')
      const tasksDeleted  = await deduplicateTable('tasks', null)
      console.log(`  Deduped: ${othersDeleted} commitments, ${tasksDeleted} tasks removed`)
    } catch (err) { /* non-fatal */ }

    // ── Deduplicate emails by (from_address + normalized subject) ──
    // Keeps the highest-bucket / most recently active record; merges data
    try {
      function normalizeSubject(s) {
        return (s || '')
          .replace(/^(re|fwd?|fw|aw|ant):\s*/gi, '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          .split(/\s+/)
          .slice(0, 8)
          .join(' ')
      }

      const { data: allActiveEmails } = await supabase
        .from('emails')
        .select('id, from_address, thread_subject, subject, bucket, status, days_waiting, created_at, ai_summary, action_needed, extracted')
        .not('status', 'eq', 'archived')

      const emailGroups = new Map()

      for (const e of (allActiveEmails || [])) {
        const normSubject = normalizeSubject(e.thread_subject || e.subject)
        const sender      = (e.from_address || '').toLowerCase().trim()
        if (!normSubject || !sender) continue
        const key = `${sender}::${normSubject}`
        if (!emailGroups.has(key)) emailGroups.set(key, [])
        emailGroups.get(key).push(e)
      }

      let emailDupsRemoved = 0
      for (const [, group] of emailGroups) {
        if (group.length <= 1) continue

        // Sort: prefer lower bucket number (higher priority), then most days_waiting, then newest
        group.sort((a, b) => {
          const ba = a.bucket ?? 99, bb = b.bucket ?? 99
          if (ba !== bb) return ba - bb
          if ((b.days_waiting ?? 0) !== (a.days_waiting ?? 0)) return (b.days_waiting ?? 0) - (a.days_waiting ?? 0)
          return new Date(b.created_at) - new Date(a.created_at)
        })

        const winner  = group[0]
        const losers  = group.slice(1)

        // Merge any richer data from losers into winner before deleting.
        // ai_summary: take from loser if winner has none.
        // extracted: Phase 1B intelligence from classify — critical for skipping Haiku calls.
        //   Newest row normally wins (sort above), so winner usually has extracted already.
        //   Fallback: propagate from any loser that has it, in case winner is older.
        const mergedSummary = winner.ai_summary || winner.action_needed
          ? null
          : losers.map(l => l.ai_summary || l.action_needed).find(Boolean)

        const mergedExtracted = (!winner.extracted || typeof winner.extracted !== 'object')
          ? losers.map(l => l.extracted).find(e => e && typeof e === 'object')
          : null

        const mergeUpdates = {}
        if (mergedSummary) mergeUpdates.ai_summary = mergedSummary
        if (mergedExtracted) mergeUpdates.extracted = mergedExtracted

        if (Object.keys(mergeUpdates).length > 0) {
          await supabase.from('emails').update(mergeUpdates).eq('id', winner.id)
        }

        // Delete the losers
        const loserIds = losers.map(l => l.id)
        await supabase.from('emails').delete().in('id', loserIds)
        emailDupsRemoved += loserIds.length
      }

      if (emailDupsRemoved > 0) {
        console.log(`  Deduped: ${emailDupsRemoved} duplicate email threads removed`)
      }
    } catch (emailDedupErr) {
      console.log(`  Email dedup error (non-fatal): ${emailDedupErr.message}`)
    }

    console.log('  ✓ Hygiene complete')
  } catch (err) {
    results.errors.push(`Hygiene: ${err.message}`)
    console.log(`  ✗ Hygiene error: ${err.message}`)
  }

  // ── STEP 1.5: Task context enrichment ───────────────────────────
  // For tasks extracted without context, generate a 1-line description from their source email
  console.log('Step 1.5: Task context enrichment...')
  try {
    const { data: allOpenTasks } = await supabase
      .from('tasks')
      .select('id, title, context, source_label, source_id, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    const needsContext = (allOpenTasks || []).filter(t => !t.context && t.source_label).slice(0, 25)

    if (!needsContext.length) {
      console.log('  No tasks need context enrichment')
    } else {
      const haikuEnrich = makeAnthropic()
      let enrichedTasks = 0

      for (const task of needsContext) {
        try {
          let sourceContext = ''
          if (task.source_id) {
            const { data: srcEmail } = await supabase
              .from('emails')
              .select('ai_summary, action_needed, thread_summary, body_preview')
              .eq('id', task.source_id)
              .maybeSingle()
            sourceContext = srcEmail?.action_needed || srcEmail?.ai_summary || srcEmail?.body_preview || ''
          }

          const enrichPrompt = `Task: "${task.title}"
Source thread: ${task.source_label || 'unknown'}
${sourceContext ? `Thread context: ${sourceContext.slice(0, 400)}` : ''}

Write a single plain-English sentence (max 100 chars) that gives Ryan enough context to act on this task without looking up the email. Focus on WHAT specifically needs to happen and WHY it matters.

Respond with just the sentence, no quotes, no JSON.`

          const msg = await haikuEnrich.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 80,
            messages: [{ role: 'user', content: enrichPrompt }]
          })

          const contextLine = (msg.content[0]?.text || '').trim().replace(/^"|"$/g, '')
          if (contextLine && contextLine.length > 10) {
            await supabase.from('tasks').update({ context: contextLine }).eq('id', task.id)
            enrichedTasks++
          }
        } catch (_) { /* non-fatal */ }
      }

      if (enrichedTasks > 0) console.log(`  ✓ Task context: ${enrichedTasks} tasks enriched`)
    }
  } catch (enrichErr) {
    console.log(`  ✗ Context enrichment error (non-fatal): ${enrichErr.message}`)
  }

  // ── STEP 2: Get active emails ───────────────────────────────────
  // Increased cap from 25→50. Orders critical/high urgency first, then by days_waiting.
  // This ensures the most important threads always get AI processing within the cap.
  const THREAD_CAP = parseInt(process.env.THREAD_CAP || '50', 10)
  // RESUME_FROM_STEP: skip expensive AI steps when resuming after a timeout.
  // Usage: RESUME_FROM_STEP=5 node api/src/jobs/nightly-ai-local.js
  // Steps 1-2.45 always run (fast DB reads that set required variables).
  // Steps 3-4.5 are skipped when RESUME_FROM_STEP >= 3 (already completed).
  // Step 5+ always runs.
  const RESUME_FROM_STEP = parseFloat(process.env.RESUME_FROM_STEP || '0')
  console.log('Step 2: Fetching active emails...')
  const { data: activeEmailsRaw } = await supabase
    .from('emails')
    .select('*')
    .in('bucket', [1, 2])
    .in('status', ['needs_reply', 'waiting_on'])
    .order('days_waiting', { ascending: false })
    .limit(THREAD_CAP)

  // Sort in JS: critical > high > elevated > normal, then days_waiting DESC within tier
  const URGENCY_RANK = { critical: 4, high: 3, elevated: 2, normal: 1 }
  const activeEmails = (activeEmailsRaw || []).sort((a, b) => {
    const rankDiff = (URGENCY_RANK[b.urgency] || 0) - (URGENCY_RANK[a.urgency] || 0)
    if (rankDiff !== 0) return rankDiff
    return (b.days_waiting || 0) - (a.days_waiting || 0)
  })

  // Detect which intelligence legs are available today
  const legStatus = {
    email:  activeEmails.length > 0,
    plaud:  false, // updated in Step 2.4
    manual: true   // always available — observations, decisions, knowledge base
  }

  console.log(`  ✓ Found ${activeEmails.length} active email threads (cap: ${THREAD_CAP}, priority-ordered)`)

  // ── Plaud participant map ─────────────────────────────────────────
  // Maps lowercase email address → [{title, date, summary}] for all today's Plaud meetings.
  // Built during Step 2.4 and used in Step 3 to cross-reference email threads with meetings —
  // the bridge between the email leg and the Plaud leg of the three-legged stool.
  const plaudParticipantMap = new Map()

  // ── STEP 2.4: Load Plaud meetings from storage → meeting_notes ──
  console.log('Step 2.4: Loading Plaud meetings into meeting_notes...')
  let plaudMeetingsLoaded = 0
  try {
    // Download plaud-{today}.json from Supabase storage
    const plaudStorageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/daily-reports/plaud-${today}.json`
    const plaudRes = await fetch(plaudStorageUrl, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
    })

    if (plaudRes.ok) {
      const plaudReport = await plaudRes.json()
      const meetings = plaudReport.meetings || []

      // Load calendar events for today once — used to cross-ref all meetings
      const { data: todayCalendarEvents } = await supabase
        .from('events')
        .select('title, start_time, attendees')
        .gte('start_time', `${today}T00:00:00Z`)
        .lte('start_time', `${today}T23:59:59Z`)
        .not('attendees', 'is', null)

      for (const meeting of meetings) {
        if (!meeting.gmail_message_id) continue

        // Check if already inserted (idempotent)
        const { data: existing } = await supabase
          .from('meeting_notes')
          .select('id')
          .eq('otter_id', `plaud_${meeting.gmail_message_id}`)
          .maybeSingle()

        if (existing) continue

        // ── Cross-reference calendar to get real attendees + start_time ──
        // Match on keyword overlap between Plaud title and calendar event title
        let calendarMatch = null
        const plaudKeywords = (meeting.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 4)

        for (const event of (todayCalendarEvents || [])) {
          const eventTitle = (event.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '')
          const overlap = plaudKeywords.filter(w => eventTitle.includes(w)).length
          // Require 2+ keyword matches — avoids false positives on generic words
          if (overlap >= 2) {
            calendarMatch = event
            break
          }
        }

        // Build participant roster from calendar attendees
        // Format is mixed: emails ("TinneyC@claycorp.com") or names ("Bill Huie")
        let participantRoster = []
        if (calendarMatch?.attendees?.length) {
          // Resolve emails → names via contacts table where possible
          const attendeeEntries = calendarMatch.attendees
          const emails = attendeeEntries.filter(a => a.includes('@'))
          const names = attendeeEntries.filter(a => !a.includes('@'))

          // Look up names for email entries
          if (emails.length > 0) {
            const { data: contacts } = await supabase
              .from('contacts')
              .select('name, email')
              .in('email', emails.map(e => e.toLowerCase()))
            const emailToName = {}
            for (const c of (contacts || [])) {
              emailToName[c.email.toLowerCase()] = c.name
            }
            for (const email of emails) {
              const name = emailToName[email.toLowerCase()]
              participantRoster.push(name || email)
            }
          }
          participantRoster = [...participantRoster, ...names]
          console.log(`  ✓ Calendar match for "${meeting.title}": ${participantRoster.length} attendees from "${calendarMatch.title}"`)
        } else {
          console.log(`  ℹ No calendar match for "${meeting.title}" on ${meeting.date}`)
        }

        // ── Build participant map entry for this meeting ──
        // Populates plaudParticipantMap so Step 3 email processing can find
        // meetings that share participants with each email thread.
        const meetingEntry = {
          title:   meeting.title || 'Untitled',
          date:    meeting.date  || today,
          summary: (meeting.summary || meeting.email_body_raw || '').slice(0, 300)
        }
        for (const participant of participantRoster) {
          if (participant.includes('@')) {
            const key = participant.toLowerCase()
            if (!plaudParticipantMap.has(key)) plaudParticipantMap.set(key, [])
            plaudParticipantMap.get(key).push(meetingEntry)
          }
        }
        legStatus.plaud = true

        // Map Plaud fields → meeting_notes schema
        const actionItemsRaw = [
          ...(meeting.ryan_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: 'Ryan Hankins',
            assignee_email: 'hankinsr@claycorp.com'
          })),
          ...(meeting.others_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: i.assignee || 'Unknown',
            assignee_email: null
          })),
          ...(meeting.unattributed_action_items || []).map(i => ({
            task_text: i.task,
            assignee_name: null,
            assignee_email: null
          }))
        ]

        // Start time resolution priority:
        // 1. Plaud MEETING_METADATA block recording_start_time (most accurate)
        // 2. Calendar match (if content-verified)
        // 3. Estimated from email_received_datetime − duration − 8 min buffer
        // 4. Default noon Phoenix (19:00 UTC)
        let startTime
        if (meeting.recording_start_time && meeting.recording_date) {
          // Plaud provides HH:MM local time. Convert to UTC ISO using Phoenix offset.
          // Phoenix is MST (UTC-7) year-round (no DST)
          const [rHH, rMM] = (meeting.recording_start_time + ':00').split(':').map(Number)
          const rDate = meeting.recording_date
          const phoenixHour = rHH + 7  // add 7 to convert MST→UTC
          const utcHour = phoenixHour % 24
          const dayCarry = phoenixHour >= 24 ? 1 : 0
          // Rebuild date with carry (simple — handles month boundaries imperfectly but
          // the calendar match step will correct any ±1 day edge cases)
          startTime = `${rDate}T${String(utcHour).padStart(2,'0')}:${String(rMM).padStart(2,'0')}:00Z`
          if (dayCarry) {
            const d = new Date(startTime)
            d.setUTCDate(d.getUTCDate() + dayCarry)
            startTime = d.toISOString().replace('.000Z', 'Z').slice(0, 20) + 'Z'
          }
        } else if (calendarMatch?.start_time) {
          startTime = calendarMatch.start_time
        } else if (meeting.email_received_datetime && meeting.duration_minutes) {
          // Estimate: email was sent ~8 min after recording ended
          const receivedMs = new Date(meeting.email_received_datetime).getTime()
          const startMs = receivedMs - (meeting.duration_minutes + 8) * 60 * 1000
          startTime = new Date(startMs).toISOString().slice(0, 20) + 'Z'
        } else {
          startTime = `${meeting.date}T19:00:00Z`  // noon Phoenix = 19:00 UTC
        }

        const { data: insertedMeeting } = await supabase.from('meeting_notes').insert({
          otter_id:               `plaud_${meeting.gmail_message_id}`,
          title:                  meeting.title,
          start_time:             startTime,
          short_summary:          meeting.summary || '',
          full_transcript:        meeting.transcript_text || null,
          raw_transcript:         meeting.transcript_text || null,
          action_items_raw:       actionItemsRaw,
          participants:           participantRoster,
          source:                 'plaud',
          intelligence_extracted: false,
          commitments_extracted:  false,
          // Structured block data — populated when Plaud email parser extracts them.
          // hasPlaudBlocks reads these columns; without them hasPlaudBlocks is always false
          // and mapPlaudBlocksToIntel never triggers (integration audit fix, session 26b).
          people_and_actions:     meeting.people_and_actions  || null,
          decisions_and_risks:    meeting.decisions_and_risks || null,
          meeting_metadata:       meeting.meeting_metadata    || null,
        }).select('id').single()
        plaudMeetingsLoaded++

        // ── Meeting-to-Calendar Content + Time Matching ───────────────
        // Stage 1: time proximity narrows candidates (±120 min, Phoenix tz)
        // Stage 2: Haiku reads transcript content to verify — prevents a
        //   phone call recorded before/after a meeting from being mislinked
        try {
          if (insertedMeeting?.id) {
            const meetingStartMs = new Date(startTime).getTime()
            const phoenixDate = new Date(startTime).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })

            // Pull all events for the Phoenix-local day — use explicit Phoenix offset
            // to avoid UTC midnight vs local midnight mismatch
            const dayStart2 = new Date(`${phoenixDate}T00:00:00-07:00`).toISOString()
            const dayEnd2   = new Date(`${phoenixDate}T23:59:59-07:00`).toISOString()
            const { data: dayEvents } = await supabase
              .from('events')
              .select('id, title, start_time, end_time, attendees')
              .gte('start_time', dayStart2)
              .lte('start_time', dayEnd2)

            // Stage 1: find all time-proximity candidates (within ±120 min)
            const candidates = (dayEvents || [])
              .map(evt => ({
                evt,
                diffMin: Math.abs(meetingStartMs - new Date(evt.start_time).getTime()) / 60000
              }))
              .filter(c => c.diffMin <= 120)
              .sort((a, b) => a.diffMin - b.diffMin)

            if (candidates.length === 0) {
              console.log(`  ℹ No calendar candidates for "${meeting.title}" on ${phoenixDate}`)
            } else {
              // Stage 2: content verification via Haiku
              // Build context from transcript/summary for content matching
              const recordingContent = (meeting.transcript_text || meeting.summary || meeting.email_body_raw || '').slice(0, 2000)
              const recordingParticipants = participantRoster.join(', ') || 'unknown'

              const candidateDescriptions = candidates.slice(0, 4).map((c, i) =>
                `Option ${i + 1}: "${c.evt.title}" at ${new Date(c.evt.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: '2-digit', minute: '2-digit' })} (${Math.round(c.diffMin)} min away) — attendees: ${(c.evt.attendees || []).slice(0, 6).join(', ') || 'unknown'}`
              ).join('\n')

              const verifyPrompt = `You are matching a Plaud audio recording to a calendar event.

RECORDING:
- Title from email: "${meeting.title || 'Untitled'}"
- Date: ${phoenixDate} (Phoenix time)
- Participants detected in recording: ${recordingParticipants}
- Content summary/transcript excerpt:
${recordingContent || '(no content available)'}

CALENDAR EVENTS THAT DAY (within 2 hours):
${candidateDescriptions}

TASK: Determine which calendar event this recording belongs to, or if it's a standalone call not on the calendar.

Key rules:
- A phone call between 2 people should NOT match a large group meeting (OAC, pre-con, all-hands)
- If the recording content mentions attendees, project topics, or agenda items from a specific event, that's a strong match
- If the recording happened right BEFORE a meeting started or AFTER it ended, it's likely a SEPARATE call, not the meeting itself
- If NO calendar event matches the content, return "none"

Respond with JSON only:
{
  "match": "1" | "2" | "3" | "4" | "none",
  "confidence": "high" | "medium" | "low",
  "reason": "one sentence explaining the match or why none matched",
  "inferred_title": "If the recording is clearly an OAC or specific meeting type based on content, provide a better title here. Otherwise null."
}`

              const haikuMatch = makeAnthropic()
              const matchMsg = await haikuMatch.messages.create({
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 200,
                messages:   [{ role: 'user', content: verifyPrompt }]
              })

              let verdict
              try {
                const raw = (matchMsg.content[0]?.text || '').trim()
                const jsonMatch = raw.match(/\{[\s\S]*\}/)
                verdict = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
              } catch { verdict = null }

              if (verdict && verdict.match !== 'none' && verdict.confidence !== 'low') {
                const matchIdx = parseInt(verdict.match) - 1
                const matched = candidates[matchIdx]?.evt

                if (matched) {
                  const evtAttendees = (matched.attendees || [])
                  const mergedParticipants = [...new Set([...participantRoster, ...evtAttendees])]

                  // Title resolution: use inferred title > event title for generic recordings
                  const genericTitles = ['plaud recording', 'recording', 'meeting recording', 'untitled', '']
                  const isGenericTitle = genericTitles.some(g => (meeting.title || '').toLowerCase().trim() === g)
                  const resolvedTitle = verdict.inferred_title ||
                    (isGenericTitle ? matched.title : (meeting.title || matched.title))

                  await supabase
                    .from('meeting_notes')
                    .update({
                      event_id:     matched.id,
                      event_title:  matched.title,
                      title:        resolvedTitle,
                      participants: mergedParticipants
                    })
                    .eq('id', insertedMeeting.id)

                  await supabase
                    .from('events')
                    .update({ meeting_note_id: insertedMeeting.id, has_recording: true })
                    .eq('id', matched.id)

                  console.log(`  ✓ Content-matched "${resolvedTitle}" → "${matched.title}" (${verdict.confidence} confidence: ${verdict.reason})`)
                }
              } else if (verdict?.inferred_title) {
                // No calendar match but AI inferred a better title from content
                await supabase
                  .from('meeting_notes')
                  .update({ title: verdict.inferred_title })
                  .eq('id', insertedMeeting.id)
                console.log(`  ℹ No calendar match for "${meeting.title}" — titled as "${verdict.inferred_title}" (${verdict.reason})`)
              } else {
                console.log(`  ℹ No match: "${meeting.title}" — ${verdict?.reason || 'no calendar candidates matched'}`)
              }
            }
          }
        } catch (matchErr) {
          console.log(`  ⚠ Meeting-calendar match error: ${matchErr.message}`)
        }
      }
      console.log(`  ✓ Plaud: ${plaudMeetingsLoaded} meetings loaded into meeting_notes`)
    } else {
      console.log(`  ℹ Plaud storage: no report for ${today} (status ${plaudRes.status})`)
    }
  } catch (err) {
    // Non-fatal — pipeline continues without Plaud data
    console.log(`  ⚠ Plaud load error: ${err.message}`)
  }

  // ── STEP 2.44: Re-match existing unlinked Plaud meetings to calendar ─────
  // The insert-time matching (Step 2.4) only runs for NEW meetings in today's
  // Plaud report. This step catches meetings already in the DB that never got
  // matched — e.g. backfill imports from before matching logic existed, or cases
  // where the calendar event wasn't available at insert time.
  console.log('Step 2.44: Re-matching unlinked Plaud meetings to calendar events...')
  try {
    // Match ALL unprocessed Plaud meetings that lack a calendar link.
    // Scoped to intelligence_extracted=false so each meeting is only attempted BEFORE
    // its intelligence extraction runs — once extracted, event_id is expected to be set
    // already; re-matching after extraction provides no benefit and wastes Haiku calls.
    // No date window or cap: backfill + new imports must ALL be matched before Step 2.6.
    const { data: unlinkedMeetings } = await supabase
      .from('meeting_notes')
      .select('id, title, start_time, participants, raw_transcript, full_transcript, summary, short_summary')
      .eq('source', 'plaud')
      .eq('intelligence_extracted', false)
      .is('event_id', null)
      .not('start_time', 'is', null)

    let relinked = 0
    for (const mn of (unlinkedMeetings || [])) {
      try {
        const startMs = new Date(mn.start_time).getTime()
        // Phoenix date for this meeting
        const phoenixDate = new Date(mn.start_time).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' })
        // Query a 2-day window to handle timezone edge cases (midnight Phoenix = 7am UTC)
        const dayStart = new Date(`${phoenixDate}T00:00:00-07:00`).toISOString()
        const dayEnd   = new Date(`${phoenixDate}T23:59:59-07:00`).toISOString()

        const { data: dayEvents } = await supabase
          .from('events')
          .select('id, title, start_time, end_time, attendees')
          .gte('start_time', dayStart)
          .lte('start_time', dayEnd)

        if (!dayEvents?.length) continue

        const candidates = dayEvents
          .map(evt => ({
            evt,
            diffMin: Math.abs(startMs - new Date(evt.start_time).getTime()) / 60000
          }))
          .filter(c => c.diffMin <= 120)
          .sort((a, b) => a.diffMin - b.diffMin)

        if (!candidates.length) continue

        const recordingContent = (mn.raw_transcript || mn.full_transcript || mn.summary || mn.short_summary || '').slice(0, 2000)
        const recordingParticipants = (mn.participants || []).join(', ') || 'unknown'

        const candidateDescriptions = candidates.slice(0, 4).map((c, i) =>
          `Option ${i + 1}: "${c.evt.title}" at ${new Date(c.evt.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: '2-digit', minute: '2-digit' })} (${Math.round(c.diffMin)} min away) — attendees: ${(c.evt.attendees || []).slice(0, 6).join(', ') || 'unknown'}`
        ).join('\n')

        const verifyPrompt = `You are matching a Plaud audio recording to a calendar event.

RECORDING:
- Title: "${mn.title || 'Untitled'}"
- Date: ${phoenixDate} (Phoenix time)
- Participants: ${recordingParticipants}
- Content excerpt:
${recordingContent || '(no content available)'}

CALENDAR EVENTS THAT DAY (within 2 hours):
${candidateDescriptions}

TASK: Determine which calendar event this recording belongs to, or if none match.

Key rules:
- A 2-person phone call should NOT match a large group meeting (OAC, pre-con, all-hands)
- If recording content mentions attendees, project topics, or agenda items from a specific event, that's a strong match
- If NO event clearly matches, return "none"

Respond with JSON only:
{
  "match": "1" | "2" | "3" | "4" | "none",
  "confidence": "high" | "medium" | "low",
  "reason": "one sentence"
}`

        const haikuClient = makeAnthropic()
        const matchMsg = await haikuClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: verifyPrompt }]
        })

        let verdict
        try {
          const raw = (matchMsg.content[0]?.text || '').trim()
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          verdict = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
        } catch { verdict = null }

        if (verdict && verdict.match !== 'none' && verdict.confidence !== 'low') {
          const matchIdx = parseInt(verdict.match) - 1
          const matched = candidates[matchIdx]?.evt
          if (matched) {
            const evtAttendees = (matched.attendees || [])
            const mergedParticipants = [...new Set([...(mn.participants || []), ...evtAttendees])]

            await supabase
              .from('meeting_notes')
              .update({ event_id: matched.id, event_title: matched.title, participants: mergedParticipants })
              .eq('id', mn.id)

            await supabase
              .from('events')
              .update({ meeting_note_id: mn.id, has_recording: true })
              .eq('id', matched.id)

            console.log(`  ✓ Re-linked "${mn.title}" → "${matched.title}" (${verdict.confidence}: ${verdict.reason})`)
            relinked++
          }
        }
      } catch (innerErr) {
        console.log(`  ⚠ Re-match error for "${mn.title}": ${innerErr.message}`)
      }
    }
    console.log(`  ✓ Step 2.44 complete: ${relinked} meetings re-linked to calendar events`)
  } catch (err) {
    console.log(`  ⚠ Step 2.44 error: ${err.message}`)
  }

  // ── STEP 2.45: Backfill participants for Plaud meetings with empty roster ──
  // Runs before intelligence extraction — catches meetings inserted on prior days
  // that had no calendar match at insert time, or were inserted before today's
  // calendar events were available. Skips meetings with manually-entered participants.
  console.log('Step 2.45: Backfilling Plaud meeting participants from calendar...')
  try {
    const { data: emptyParticipantMeetings } = await supabase
      .from('meeting_notes')
      .select('id, title, start_time, participants')
      .eq('source', 'plaud')
      .eq('intelligence_extracted', false)
      .or('participants.eq.[],participants.is.null')

    if (emptyParticipantMeetings?.length) {
      for (const mn of emptyParticipantMeetings) {
        const meetingDate = mn.start_time?.split('T')[0]
        if (!meetingDate) continue

        // Pull calendar events for that meeting's date — use Phoenix-aware boundaries
        // Phoenix is UTC-7, so midnight Phoenix = 07:00 UTC. Use explicit offsets.
        const dayStart = new Date(`${meetingDate}T00:00:00-07:00`).toISOString()
        const dayEnd   = new Date(`${meetingDate}T23:59:59-07:00`).toISOString()
        const { data: calEvents } = await supabase
          .from('events')
          .select('title, start_time, attendees')
          .gte('start_time', dayStart)
          .lte('start_time', dayEnd)
          .not('attendees', 'is', null)

        const mnKeywords = (mn.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 4)

        let match = null
        for (const ev of (calEvents || [])) {
          const evTitle = (ev.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '')
          const overlap = mnKeywords.filter(w => evTitle.includes(w)).length
          if (overlap >= 2) { match = ev; break }
        }

        if (!match) continue

        // Resolve attendees
        const attendeeEntries = match.attendees || []
        const emails = attendeeEntries.filter(a => a.includes('@'))
        const names  = attendeeEntries.filter(a => !a.includes('@'))
        let roster = [...names]

        if (emails.length > 0) {
          const { data: contacts } = await supabase
            .from('contacts')
            .select('name, email')
            .in('email', emails.map(e => e.toLowerCase()))
          const emailToName = {}
          for (const c of (contacts || [])) emailToName[c.email.toLowerCase()] = c.name
          for (const email of emails) roster.push(emailToName[email.toLowerCase()] || email)
        }

        if (roster.length > 0) {
          await supabase
            .from('meeting_notes')
            .update({
              participants: roster,
              start_time: match.start_time  // also fix the faked time
            })
            .eq('id', mn.id)
          console.log(`  ✓ Backfilled ${roster.length} participants for "${mn.title}"`)
        }
      }
    } else {
      console.log('  ✓ No Plaud meetings need participant backfill')
    }
  } catch (err) {
    console.log(`  ⚠ Participant backfill error: ${err.message}`)
  }

  // ── STEP 2.5: Load existing items as AI dedup context ──────────
  // Loaded once here — available to both email (STEP 4/5) and future Otter extraction
  let existingTasksContext = ''
  let existingOthersContext = ''
  let existingMineContext = ''
  try {
    const { data: openTasks } = await supabase
      .from('tasks')
      .select('title, context, urgency')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openTasks?.length) {
      existingTasksContext = openTasks
        .map(t => `- ${t.title}${t.context ? ` (${t.context.slice(0, 60)})` : ''}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  try {
    const { data: openOthers } = await supabase
      .from('others_commitments')
      .select('title, committed_by_name')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openOthers?.length) {
      existingOthersContext = openOthers
        .map(c => `- ${c.committed_by_name || 'Unknown'}: ${c.title}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  try {
    const { data: openMine } = await supabase
      .from('commitments')
      .select('title, made_to')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(60)
    if (openMine?.length) {
      existingMineContext = openMine
        .map(c => `- ${c.title}${c.made_to ? ` (to: ${c.made_to})` : ''}`)
        .join('\n')
    }
  } catch (err) { /* non-fatal */ }
  console.log(`  ✓ Context loaded: ${existingTasksContext.split('\n').filter(Boolean).length} tasks, ${existingOthersContext.split('\n').filter(Boolean).length} others, ${existingMineContext.split('\n').filter(Boolean).length} mine`)

  // ── Build meeting context for email analysis ──────────────────
  // Inject recent meeting summaries so email intelligence knows what
  // was discussed verbally — connects email threads to meeting decisions
  let meetingContext = ''
  try {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: recentMeetingNotes } = await supabase
      .from('meeting_notes')
      .select('title, start_time, short_summary, action_items_raw, participants, source')
      .gte('start_time', sevenDaysAgo.toISOString())
      .order('start_time', { ascending: false })
      .limit(20)

    if (recentMeetingNotes?.length) {
      meetingContext = recentMeetingNotes.map(m => {
        const date = m.start_time?.split('T')[0] || 'unknown date'
        const source = m.source === 'plaud' ? 'Plaud' : 'Otter'
        const summary = (m.short_summary || '').slice(0, 400)
        const participants = (m.participants || []).slice(0, 8).join(', ')

        // Format action items — show assignee + task so AI can connect email follow-ups
        const actionItems = (m.action_items_raw || [])
          .slice(0, 12)
          .map(a => {
            const who = a.assignee_name || 'Unassigned'
            return `  - ${who}: ${a.task_text}`
          })
          .join('\n')

        let block = `[${date} — ${m.title} (${source})]`
        if (participants) block += `\nAttendees: ${participants}`
        block += `\nSummary: ${summary}`
        if (actionItems) block += `\nAction items:\n${actionItems}`
        return block
      }).join('\n\n')
      console.log(`  ✓ Meeting context: ${recentMeetingNotes.length} meetings from last 7 days`)
    }
  } catch (err) {
    console.log(`  ⚠ Meeting context load error: ${err.message}`)
  }

  // ── Pre-compute email-Plaud cross-references for all active emails ──
  // Built once here so both Step 3 (summarize) and Step 3.5 (intelligence)
  // can use per-email meeting context without redundant lookups.
  // Maps email.id → formatted string of related Plaud meetings.
  const emailMeetingCrossRef = new Map()
  for (const email of (activeEmails || [])) {
    const participants = [email.from_address, ...(email.thread_participants || [])]
      .filter(p => p && p.includes('@'))
    const related = participants
      .flatMap(p => plaudParticipantMap.get(p.toLowerCase()) || [])
      .filter((m, i, arr) => arr.findIndex(x => x.title === m.title) === i)
      .slice(0, 3)
    if (related.length > 0) {
      emailMeetingCrossRef.set(email.id,
        '\n\nPLAUD MEETINGS INVOLVING THIS EMAIL\'S PARTICIPANTS:\n' +
        related.map(m => `  [${m.date}] ${m.title}${m.summary ? ': ' + m.summary : ''}`).join('\n')
      )
    }
  }
  if (emailMeetingCrossRef.size > 0) {
    console.log(`  ✓ Email-Plaud cross-reference: ${emailMeetingCrossRef.size} email threads linked to Plaud meetings`)
  }

  // ── PHASE 1B: Load pre-extracted classify output ─────────────────
  // email-classify-skill (Task 2) writes daily-reports/{today}.json with an
  // `extracted` object per thread (ai_summary, action_items, commitments, etc.).
  // If available, we skip per-email Haiku calls in Steps 3, 3.2, and 3.5.
  // Keyed by conversation_id (lowercase). Falls back gracefully if not found.
  const phase1bIndex = new Map()
  // Secondary key: when conversation_id is null (M365 connector limitation),
  // fall back to matching by normalized from_address:thread_subject
  function p1bSubjectKey(thread) {
    const from = (thread.from_address || '').toLowerCase().trim()
    const subj = (thread.thread_subject || thread.threadSubject || thread.subject || '').toLowerCase().trim()
    return from && subj ? `subj:${from}:${subj}` : null
  }

  // Phase 1B B3 oversight intelligence — populated from storage JSON, fed into daily brief.
  // B3 threads with full extraction (risk/financial/scope signals) are valuable project intel
  // that the brief generator needs but that never flows through activeEmails (B1/B2 only).
  let p1bOversightThreads = []

  try {
    const p1bStorageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/daily-reports/${today}.json`
    const p1bRes = await fetch(p1bStorageUrl, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
    })
    if (p1bRes.ok) {
      const p1bReport = await p1bRes.json()
      let p1bThreadCount = 0
      let p1bSubjCount = 0
      for (const bucket of ['bucket1', 'bucket2', 'bucket3', 'bucket4']) {
        for (const thread of (p1bReport[bucket] || [])) {
          if (!thread.extracted) continue
          // Primary key: conversation_id (when available)
          if (thread.conversation_id) {
            phase1bIndex.set(thread.conversation_id.toLowerCase(), thread.extracted)
            p1bThreadCount++
          }
          // Secondary key: from_address:subject (fallback for M365 connector limitation)
          const subjKey = p1bSubjectKey(thread)
          if (subjKey && !phase1bIndex.has(subjKey)) {
            phase1bIndex.set(subjKey, thread.extracted)
            p1bSubjCount++
          }
        }
      }
      console.log(`  ✓ Phase 1B index: ${p1bThreadCount} by conv_id + ${p1bSubjCount} by subject key`)

      // ── Extract B3 oversight intelligence for daily brief ──
      // B3 threads that classify ran full extraction on (they have signal data beyond ai_summary).
      // These represent project intel that Ryan is CC'd on — not action items, but critical context.
      // Filter to threads with at least one meaningful signal; cap at 10 for brief context budget.
      const bucket3All = p1bReport.bucket3 || []
      p1bOversightThreads = bucket3All
        .filter(t => {
          if (!t.extracted) return false
          const ex = t.extracted
          return (
            (ex.risk_signals && ex.risk_signals.length > 0) ||
            (ex.financial_items && ex.financial_items.length > 0) ||
            (ex.scope_changes && ex.scope_changes.length > 0) ||
            (ex.pending_decisions && ex.pending_decisions.length > 0) ||
            t.competitor_mentioned === true ||
            (t.contract_event && t.contract_event !== 'none')
          )
        })
        .map(t => ({
          subject: t.thread_subject || t.subject || '',
          from_name: t.from_name || '',
          sender_type: t.sender_type || 'unknown',
          ai_summary: t.extracted.ai_summary || '',
          risk_signals: (t.extracted.risk_signals || []).map(r => r.signal || r),
          financial_items: (t.extracted.financial_items || []).map(f => `${f.amount} — ${f.context}`),
          scope_changes: (t.extracted.scope_changes || []).map(s => s.description),
          pending_decisions: (t.extracted.pending_decisions || []).map(d => d.question),
          competitor_mentioned: t.competitor_mentioned || false,
          contract_event: t.contract_event || 'none'
        }))
        .slice(0, 10)
      if (p1bOversightThreads.length > 0) {
        console.log(`  ✓ Phase 1B oversight intel: ${p1bOversightThreads.length} B3 threads with signals (for brief)`)
      }
    } else {
      console.log(`  ⚠ Phase 1B classify output not found (HTTP ${p1bRes.status}) — falling back to per-email AI calls`)
    }
  } catch (p1bErr) {
    console.log(`  ⚠ Phase 1B load error (non-fatal): ${p1bErr.message} — falling back to per-email AI calls`)
  }

  // ── Phase 1B DB supplement: fill index gaps from emails.extracted column ──
  // push_email_report.py now writes emails.extracted for each thread (from classify output).
  // Storage JSON keys may mismatch (invented vs real subjects) but DB supplement is
  // self-consistent — same email row used for both building index and lookup → always matches.
  {
    let dbConvHits = 0
    let dbSubjHits = 0
    for (const email of (activeEmails || [])) {
      if (!email.extracted || typeof email.extracted !== 'object') continue
      const convKey = (email.conversation_id || '').toLowerCase()
      // Primary: conversation_id
      if (convKey && !phase1bIndex.has(convKey)) {
        phase1bIndex.set(convKey, email.extracted)
        dbConvHits++
      }
      // Secondary: from_address:subject (self-consistent — same row for build + lookup)
      const subjKey = p1bSubjectKey(email)
      if (subjKey && !phase1bIndex.has(subjKey)) {
        phase1bIndex.set(subjKey, email.extracted)
        dbSubjHits++
      }
    }
    if (dbConvHits + dbSubjHits > 0) {
      console.log(`  ✓ Phase 1B DB supplement: ${dbConvHits} by conv_id + ${dbSubjHits} by subject key (from emails.extracted)`)
    }
  }

  // ── RESUME GUARD: skip Steps 3–4.5 when resuming after a timeout ──────────
  // Steps 1-2.45 above always run (fast DB reads, set variables needed by Steps 5+).
  // Steps 3-4.5 below are the expensive AI-call block. If RESUME_FROM_STEP >= 3,
  // those steps were already completed in a prior run — skip straight to Step 5.
  stepsThreeToEmail: {
    if (RESUME_FROM_STEP >= 3) {
      console.log(`⏭  RESUME_FROM_STEP=${RESUME_FROM_STEP}: Skipping Steps 3–3.8 email AI (already completed in prior run)`)
      break stepsThreeToEmail
    }

  // ── STEP 3: Summarize threads ───────────────────────────────────
  console.log('Step 3: Summarizing threads...')
  let phase1bSummaryHits = 0
  let existingSummarySkips = 0
  let haikuSummaryCalls = 0
  for (const email of (activeEmails || [])) {
    try {
      // Detect links
      const links = detectLinks(
        email.full_thread_content || email.body_preview || ''
      )

      // ── Phase 1B fast path: use pre-extracted summary if available ──
      // Try conversation_id first, then fall back to from_address:subject key
      const convKey = (email.conversation_id || '').toLowerCase()
      const subjKey = p1bSubjectKey(email)
      const p1bData = (convKey && phase1bIndex.get(convKey)) || (subjKey && phase1bIndex.get(subjKey)) || null
      if (p1bData?.ai_summary) {
        await supabase
          .from('emails')
          .update({
            ai_summary: p1bData.ai_summary,
            context_type: p1bData.context_type || 'work',
            links_detected: links
          })
          .eq('id', email.id)
        results.threads_summarized++
        phase1bSummaryHits++
        continue  // skip Haiku call
      }

      // ── Already summarized + no classify update today → skip Haiku ──
      // Old active threads (needs_reply / waiting_on for days) won't appear
      // in today's classify output. Any thread that got a NEW email today will
      // be in classify and caught by Phase 1B above. Everything else with an
      // existing summary is unchanged — re-calling Haiku burns tokens for zero gain.
      if (email.ai_summary) {
        if (links.length > 0) {
          await supabase.from('emails').update({ links_detected: links }).eq('id', email.id)
        }
        results.threads_summarized++
        existingSummarySkips++
        continue
      }

      // ── No summary yet → Haiku (genuinely new thread without classify data) ──
      // Pre-fetch project context if email is linked to a project
      const emailProjectId = email.project_id || await findProjectByKeywords(email.thread_subject)
      const projectContext = emailProjectId
        ? await aiService.buildProjectContext(emailProjectId)
        : ''

      // ── Email-Plaud cross-reference (three-legged stool bridge) ──
      // Look up pre-computed meeting cross-reference for this email.
      // Computed once above (before Step 3) and shared across Step 3 + Step 3.5.
      const perEmailMeetingNote = emailMeetingCrossRef.get(email.id) || ''

      const summary = await aiService.summarizeThread(email, projectContext + perEmailMeetingNote)

      // Small throttle between sequential Haiku calls — prevents connection
      // pool exhaustion on the Mac that causes "Invalid response body" errors
      await new Promise(r => setTimeout(r, 150))

      await supabase
        .from('emails')
        .update({
          ai_summary: summary,
          links_detected: links
        })
        .eq('id', email.id)

      results.threads_summarized++
      haikuSummaryCalls++

      // Log response pattern
      await supabase.from('pattern_log').insert({
        pattern_type: 'email_thread_processed',
        text_value: email.thread_subject,
        context: `bucket:${email.bucket} urgency:${email.urgency}`,
        subject_type: 'contact',
        date: today,
        metadata: {
          from_address: email.from_address,
          days_waiting: email.days_waiting,
          links_found: links.length
        }
      })
    } catch (err) {
      results.errors.push(`Summarize ${email.thread_subject}: ${err.message}`)
      console.log(`  ✗ Summarize error: ${err.message}`)
    }
  }
  console.log(`  ✓ Summarized ${results.threads_summarized} threads (${phase1bSummaryHits} Phase 1B, ${existingSummarySkips} kept existing, ${haikuSummaryCalls} via Haiku)`)

  // ── STEP 3.2: Classify email context (work vs personal) ──────────
  console.log('Step 3.2: Classifying email context...')
  let classified = 0
  try {
    for (const email of (activeEmails || [])) {
      // Phase 1B fast path: already classified by classify skill
      const p1bCtx = phase1bIndex.get((email.conversation_id || '').toLowerCase())
      if (p1bCtx?.context_type && p1bCtx.context_type !== 'work') {
        await supabase.from('emails').update({ context_type: p1bCtx.context_type }).eq('id', email.id)
        classified++
        continue
      }

      // Skip if already classified
      if (email.context_type && email.context_type !== 'work') continue

      const content = email.ai_summary || email.body_preview || email.thread_subject || ''
      const subject = (email.thread_subject || '').toLowerCase()
      const from    = (email.from_address || '').toLowerCase()

      // Heuristic classification — skip AI call for obvious cases
      const personalSignals = [
        /southwest|delta|united|american airlines|flight|hotel|airbnb/i,
        /family|mom|dad|wife|husband|kids|baby|wedding|birthday|anniversary/i,
        /golf|tennis|fitness|health|gym|doctor|dentist|medical/i,
        /amazon|walmart|target|order confirm|shipping|delivery/i,
        /bank|mortgage|insurance|tax|irs|financial advisor/i,
        /linkedin newsletter|bizjournals|news digest|valley partnership/i,
      ]
      const isPersonal = personalSignals.some(re => re.test(content) || re.test(subject))

      // Check if it's clearly work (mentions active project names or clients)
      const workSignals = [
        /pacific fusion|project solis|gotion|asml|norsun|sofidel|lucid|canadian solar/i,
        /gmp|precon|submittal|rfi|change order|pay app|lien|contract/i,
        /claycorp|clayco|ljc|crg|concrete strategies/i,
      ]
      const isWork = workSignals.some(re => re.test(content) || re.test(subject))

      let contextType = 'work' // default
      if (isPersonal && !isWork) contextType = 'personal'
      else if (isPersonal && isWork) contextType = 'mixed'

      if (contextType !== 'work') {
        await supabase.from('emails').update({ context_type: contextType }).eq('id', email.id)
        classified++
      }
    }
    console.log(`  ✓ Classified: ${classified} non-work emails`)
  } catch (err) {
    console.log(`  ⚠ Classification error: ${err.message}`)
  }

  // ── STEP 3.5: Intelligence extraction ──────────────────────────
  console.log('Step 3.5: Extracting intelligence...')

  // Track topic clusters for unlinked intel
  const unlinkedClusters = {}

  let phase1bIntelHits = 0
  for (const email of (activeEmails || [])) {
    try {
      // ── Phase 1B fast path: use pre-extracted intelligence if available ──
      const p1bData = phase1bIndex.get((email.conversation_id || '').toLowerCase())
      let intel
      if (p1bData && (p1bData.pending_decisions?.length || p1bData.risk_signals?.length ||
                      p1bData.decisions_made?.length || p1bData.key_facts?.length)) {
        // Map Phase 1B schema → existing intel object shape for write compatibility
        intel = {
          technical_facts: [],
          financial_signals: [],
          schedule_signals: [],
          scope_signals: [],
          implicit_commitments: [],
          relationship_signals: [],
          key_facts: (p1bData.key_facts || []).map(f => ({
            fact: f.fact || f, source: email.thread_subject
          })),
          decisions_made: (p1bData.decisions_made || []).map(d => ({
            decision: d.decision,
            decided_by: d.decided_by || 'unknown',
            all_parties: d.all_parties || [],
            date: today
          })),
          pending_decisions: (p1bData.pending_decisions || []).map(pd => ({
            decision: pd.question,
            blocking: false,
            due_date: null,
            urgency: 'medium'
          })),
          risk_signals: (p1bData.risk_signals || [])
            .filter(r => r.severity !== 'low')
            .map(r => ({
              signal: r.signal,
              severity: r.severity,
              involves_key_contact: true,    // bucket1/2 threads are active/important
              involves_active_project: !!r.project_hint,
              source: email.thread_subject
            }))
        }
        phase1bIntelHits++
      } else {
        // ── Fallback: per-email Haiku intelligence extraction ──
        const threadHistory = await getThreadHistory(email)
        const intelProjectId = email.project_id || await findProjectByKeywords(email.thread_subject)
        const intelProjectContext = intelProjectId
          ? await aiService.buildProjectContext(intelProjectId)
          : ''

        // Inject per-email meeting cross-reference into intelligence extraction.
        // Pulls from the pre-computed emailMeetingCrossRef Map (built before Step 3)
        // so this loop doesn't need its own participant lookup.
        const perEmailMeetingNote = emailMeetingCrossRef.get(email.id) || ''
        const enrichedMeetingContext = perEmailMeetingNote
          ? meetingContext + perEmailMeetingNote
          : meetingContext

        // B1 (needs_reply) uses Sonnet — these are active asks where extraction quality matters.
        // B2 and below use Haiku — lower stakes, high volume.
        const intelModel = email.bucket === 1 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'
        intel = await aiService.extractIntelligence(email, threadHistory, enrichedMeetingContext, intelProjectContext, intelModel)
      }

      let projectId = email.project_id ||
        await findProjectByKeywords(email.thread_subject)

      if (projectId) {
        // Load current project data
        const { data: project } = await supabase
          .from('projects')
          .select('id, intelligence_notes, decisions_made, risk_signals, key_facts')
          .eq('id', projectId)
          .single()

        if (project) {
          const newNotes = [
            ...intel.technical_facts.map(f => ({
              ...f, type: 'technical', source: email.thread_subject, date: today
            })),
            ...intel.financial_signals.map(f => ({
              ...f, type: 'financial', source: email.thread_subject, date: today
            })),
            ...intel.schedule_signals.map(s => ({
              ...s, type: 'schedule', source: email.thread_subject, date: today
            })),
            ...intel.scope_signals.map(s => ({
              ...s, type: 'scope', source: email.thread_subject, date: today
            })),
            ...intel.implicit_commitments.map(c => ({
              ...c, type: 'implicit_commitment', source: email.thread_subject, date: today
            }))
          ]

          const qualifyingRisks = intel.risk_signals
            .filter(r =>
              r.involves_key_contact &&
              r.involves_active_project &&
              r.severity !== 'low'
            )
            .map(r => ({
              ...r, source: email.thread_subject, date: today, checked_off: false
            }))

          // Update project card
          await supabase
            .from('projects')
            .update({
              intelligence_notes: [
                ...(project.intelligence_notes || []),
                ...newNotes
              ].slice(-50),
              decisions_made: [
                ...(project.decisions_made || []),
                ...intel.decisions_made.map(d => ({
                  ...d, source: email.thread_subject, date: today
                }))
              ],
              risk_signals: [
                ...(project.risk_signals || []),
                ...qualifyingRisks
              ].slice(-20),
              key_facts: [
                ...(project.key_facts || []),
                ...intel.key_facts.map(f => ({
                  ...f, source: email.thread_subject, date: today
                }))
              ].slice(-30)
            })
            .eq('id', projectId)

          results.intelligence_notes_added += newNotes.length
          results.risk_signals_detected += qualifyingRisks.length

          // Log decisions to decisions table
          for (const d of intel.decisions_made) {
            const { data: existD } = await supabase
              .from('decisions')
              .select('id')
              .eq('title', d.decision)
              .eq('project_id', projectId)
              .maybeSingle()

            if (!existD) {
              await supabase.from('decisions').insert({
                title: d.decision,
                what_was_decided: d.decision,
                who_was_present: d.all_parties?.join(', '),
                decided_on: d.date || today,
                project_id: projectId,
                decision_maker: d.decided_by,
                all_parties: d.all_parties || [],
                source_type: 'ai_email',
                source_id: email.id,
                status: 'made'
              })
              results.decisions_logged++
            }
          }

          // Log pending decisions
          for (const p of intel.pending_decisions) {
            const { data: existP } = await supabase
              .from('pending_decisions')
              .select('id')
              .eq('title', p.decision)
              .eq('status', 'open')
              .maybeSingle()

            if (!existP) {
              await supabase.from('pending_decisions').insert({
                title:        p.decision,
                context:      p.decision,
                blocking:     p.blocking,
                due_date:     p.due_date,
                urgency:      p.urgency || 'medium',
                project_id:   projectId,
                source_type:  'ai_email',
                source_id:    email.id,
                source_label: email.thread_subject || email.subject || 'Email',
                status:       'open'
              })
              results.pending_decisions_created++
            }
          }
        }
      } else {
        // No project match — store as unlinked
        const intelItems = [
          ...intel.technical_facts,
          ...intel.financial_signals,
          ...intel.key_facts,
          ...intel.decisions_made
        ]

        if (intelItems.length > 0) {
          // Extract topic from subject
          const topic = (email.thread_subject || '')
            .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
            .split(' ')
            .slice(0, 3)
            .join(' ')

          // Track clusters
          if (!unlinkedClusters[topic]) {
            unlinkedClusters[topic] = []
          }
          unlinkedClusters[topic].push(email)

          // Dedup: skip if this email already has an unlinked intelligence entry
          // (regardless of status — avoids re-surfacing filed/dismissed items)
          const { data: existingIntel } = await supabase
            .from('unlinked_intelligence')
            .select('id')
            .eq('source_email_id', email.id)
            .maybeSingle()

          if (!existingIntel) {
            await supabase.from('unlinked_intelligence').insert({
              content: JSON.stringify(intelItems),
              intelligence_type: 'mixed',
              source_email_id: email.id,
              suggested_project: topic,
              status: 'unreviewed'
            })
          }
        }
      }

      // Log relationship signals
      for (const s of intel.relationship_signals) {
        await supabase.from('pattern_log').insert({
          pattern_type: 'relationship_signal',
          text_value: s.signal,
          context: `${s.person}: ${s.type}`,
          subject_type: 'contact',
          date: today,
          metadata: {
            person: s.person,
            signal_type: s.type,
            evidence: s.evidence,
            source: email.thread_subject
          }
        })
      }
    } catch (err) {
      results.errors.push(`Intel ${email.thread_subject}: ${err.message}`)
    }
  }

  // Check for topic clusters suggesting new projects
  for (const [topic, emails] of Object.entries(unlinkedClusters)) {
    if (emails.length >= 3) {
      const { data: existingSuggestion } = await supabase
        .from('suggested_projects')
        .select('id')
        .ilike('name', `%${topic}%`)
        .eq('status', 'pending')
        .maybeSingle()

      if (!existingSuggestion) {
        await supabase.from('suggested_projects').insert({
          name: topic,
          email_count: emails.length,
          key_contacts: emails.map(e => ({
            name: e.from_name,
            email: e.from_address
          })),
          summary: `${emails.length} emails found about "${topic}" with no matching project card.`,
          sample_emails: emails.slice(0, 3).map(e => ({
            subject: e.thread_subject,
            from: e.from_name
          })),
          status: 'pending'
        })

        await logAIQuestion(
          `I found ${emails.length} emails about "${topic}" that don't match any existing project. Should I create a project card?`,
          `Emails: ${emails.map(e => e.thread_subject).join(', ')}`,
          'binary'
        )
        results.questions_logged++
      }
    }
  }

  console.log(
    `  ✓ Intelligence: ${results.intelligence_notes_added} notes, ` +
    `${results.decisions_logged} decisions, ` +
    `${results.pending_decisions_created} pending, ` +
    `${results.risk_signals_detected} risks ` +
    `(${phase1bIntelHits}/${activeEmails.length} from Phase 1B, ${activeEmails.length - phase1bIntelHits} via Haiku)`
  )

  // ── STEP 3.55: Email context enrichment ────────────────────────
  // For each active email (needs_reply or waiting_on):
  //   1. Read full thread content
  //   2. Pull surrounding emails from same sender (last 7 business days)
  //   3. Claude Haiku classifies type + extracts action_needed, deadline, summary
  //
  // Required columns (run once in Supabase SQL editor if missing):
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS email_category text;
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS action_needed text;
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS extracted_deadline text;
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS thread_summary text;
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS can_auto_archive boolean DEFAULT false;
  //   ALTER TABLE emails ADD COLUMN IF NOT EXISTS context_enriched_at timestamptz;
  console.log('Step 3.55: Email context enrichment...')

  try {
    const threeDaysAgo  = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const tenDaysAgo    = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // ~7 business days

    // Emails that need enrichment
    const { data: enrichQueue } = await supabase
      .from('emails')
      .select(
        'id, thread_subject, subject, from_name, from_address, ' +
        'full_thread_content, body_preview, ai_summary, sent_body, ' +
        'status, bucket, urgency, days_waiting, received_at, ' +
        'waiting_since, my_last_reply_time, thread_message_count, ' +
        'thread_participants, conversation_id'
      )
      .in('status', ['needs_reply', 'waiting_on'])
      .not('bucket', 'eq', 5)
      .or(`context_enriched_at.is.null,context_enriched_at.lt.${threeDaysAgo}`)
      .order('days_waiting', { ascending: false })
      .limit(40)

    const haikuClient = makeAnthropic()
    let enriched = 0

    for (const email of (enrichQueue || [])) {
      try {
        // ── 1. Build full thread context ──────────────────────────
        const threadContent = email.full_thread_content || email.body_preview || email.ai_summary || ''

        // Thread history: other emails in same thread
        const threadHistory = await getThreadHistory(email)
        const threadHistoryText = threadHistory
          .filter(e => e.id !== email.id)
          .slice(0, 8)
          .map(e =>
            `[${e.from_name || e.from_address} — ${e.received_at ? e.received_at.split('T')[0] : 'unknown'}]\n` +
            (e.ai_summary || e.body_preview || '(no content)').slice(0, 400)
          )
          .join('\n\n---\n\n')

        // ── 2. Surrounding emails from same sender (last 7 biz days) ──
        let surroundingText = ''
        if (email.from_address) {
          const { data: surrounding } = await supabase
            .from('emails')
            .select('thread_subject, ai_summary, body_preview, received_at, status')
            .eq('from_address', email.from_address)
            .neq('id', email.id)
            .gte('created_at', tenDaysAgo)
            .order('created_at', { ascending: false })
            .limit(6)

          if (surrounding?.length) {
            surroundingText = surrounding
              .map(e =>
                `[Other thread: "${e.thread_subject}" — ${e.received_at ? e.received_at.split('T')[0] : 'unknown'}]\n` +
                (e.ai_summary || e.body_preview || '').slice(0, 200)
              )
              .join('\n\n')
          }
        }

        // ── 3. Build prompt ───────────────────────────────────────
        const isWaiting = email.status === 'waiting_on'
        const prompt = `You are analyzing an email thread for Ryan Hankins, a Project Executive at Clayco (construction/real estate).

EMAIL DETAILS:
- Subject: ${email.thread_subject || email.subject || '(none)'}
- From: ${email.from_name || email.from_address || 'Unknown'}
- Status: ${isWaiting ? 'WAITING ON (Ryan sent last, awaiting response)' : 'NEEDS REPLY (received, Ryan needs to respond)'}
- Days waiting: ${email.days_waiting || 0}
- Messages in thread: ${email.thread_message_count || 1}
- Last reply from Ryan: ${email.my_last_reply_time ? email.my_last_reply_time.split('T')[0] : 'unknown'}

FULL THREAD CONTENT:
${threadContent.slice(0, 4000) || '(not available)'}

${threadHistoryText ? `THREAD HISTORY (earlier messages):\n${threadHistoryText}` : ''}

${surroundingText ? `OTHER RECENT EMAILS FROM THIS SENDER (last 7 business days — for context only):\n${surroundingText}` : ''}

Based on the FULL thread context above, classify this email and extract action details.

${isWaiting
  ? 'For WAITING ON threads: What did Ryan send? What is he waiting to receive back?'
  : 'For NEEDS REPLY threads: What is the sender asking of Ryan specifically?'
}

Respond ONLY with valid JSON (no markdown):
{
  "email_category": "${isWaiting
    ? 'submittal|question|action_request|informational|follow_up|approval_pending'
    : 'question_to_ryan|approval_needed|action_needed|submittal_received|fyi|introduction'
  }",
  "action_needed": "Single sentence: who needs to do what, by when if known. Max 120 chars.",
  "extracted_deadline": "YYYY-MM-DD or null",
  "thread_summary": "2-3 sentences covering the full arc of this conversation — what was originally discussed, where it stands now, what is unresolved.",
  "can_auto_archive": false
}

Set can_auto_archive to true ONLY if this is clearly a no-action-needed FYI with no open question or deliverable.`

        // ── 4. Call Haiku ────────────────────────────────────────
        const msg = await haikuClient.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages:   [{ role: 'user', content: prompt }]
        })

        const raw = (msg.content[0]?.text || '').trim()
        let parsed
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
        } catch {
          console.log(`  ✗ Enrich parse error for "${email.thread_subject}": ${raw.slice(0, 80)}`)
          continue
        }

        // ── 5. Update email ──────────────────────────────────────
        const update = {
          context_enriched_at: new Date().toISOString()
        }
        if (parsed.email_category)    update.email_category    = parsed.email_category
        if (parsed.action_needed)     update.action_needed     = parsed.action_needed
        if (parsed.extracted_deadline) update.extracted_deadline = parsed.extracted_deadline
        if (parsed.thread_summary)    update.thread_summary    = parsed.thread_summary
        if (parsed.can_auto_archive === true) update.can_auto_archive = true

        // Auto-downgrade obvious FYIs: move to bucket 4 if currently 2 or 3
        if (parsed.can_auto_archive && (email.bucket === 2 || email.bucket === 3)) {
          update.bucket  = 4
          update.urgency = 'low'
        }

        await supabase.from('emails').update(update).eq('id', email.id)
        enriched++

      } catch (emailErr) {
        console.log(`  ✗ Enrich error for "${email.thread_subject}": ${emailErr.message}`)
      }
    }

    console.log(`  ✓ Enriched ${enriched}/${(enrichQueue || []).length} emails with context`)
    results.emails_context_enriched = enriched

  } catch (enrichErr) {
    console.log(`  ✗ Email enrichment step failed: ${enrichErr.message}`)
  }

  // ── STEP 3.6b: Auto-expand project keywords ────────────────────
  console.log('Step 3.6b: Learning project keywords...')
  try {
    const { data: activeProjects } = await supabase
      .from('projects')
      .select('id, name, keywords')
      .eq('status', 'active')

    for (const project of (activeProjects || [])) {
      // Find emails linked to this project
      const { data: linkedEmails } = await supabase
        .from('emails')
        .select('thread_subject, from_name, from_address')
        .eq('project_id', project.id)
        .limit(20)

      if (!linkedEmails?.length) continue

      // Extract candidate keywords from thread subjects and sender names
      const candidates = new Map()

      for (const email of linkedEmails) {
        // Words from thread subject
        const words = (email.thread_subject || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(' ')
          .filter(w => w.length > 3)
          .filter(w => ![
            'from', 'with', 'this', 'that',
            'have', 'will', 'your', 'been',
            'more', 'week', 'next', 'last',
            'meet', 'call', 'zoom', 'team',
            'fwd', 'reply', 'over', 'about'
          ].includes(w))

        for (const word of words) {
          candidates.set(word, (candidates.get(word) || 0) + 1)
        }

        // Last name of sender as keyword (weighted higher)
        const nameParts = (email.from_name || '').split(' ')
        const lastName  = nameParts[nameParts.length - 1]?.toLowerCase()
        if (lastName && lastName.length > 3) {
          candidates.set(lastName, (candidates.get(lastName) || 0) + 2)
        }
      }

      // Keywords appearing 3+ times are strong candidates
      const currentKeywords = new Set(
        (project.keywords || []).map(k => k.toLowerCase())
      )

      const newKeywords = []
      for (const [word, count] of candidates) {
        if (count >= 3 && !currentKeywords.has(word)) {
          newKeywords.push(word)
        }
      }

      if (newKeywords.length > 0) {
        const updatedKeywords = [...(project.keywords || []), ...newKeywords]
        await supabase
          .from('projects')
          .update({ keywords: updatedKeywords })
          .eq('id', project.id)

        console.log(`  ${project.name}: added keywords ${newKeywords.join(', ')}`)
      }
    }
  } catch (err) {
    // Non-fatal
    console.log(`  Keyword learning error: ${err.message}`)
  }

  // ── STEP 3.6: Auto-create contacts (with deduplication) ────────
  // ── Name normalization helper ─────────────────────────────────────────────
  // Cleans up Outlook display name formats before storing on contacts
  function normalizeDisplayName(rawName) {
    if (!rawName) return rawName
    let name = rawName.trim()

    // "Last, First" → "First Last"
    if (/^[^,]+,\s*[^,]+$/.test(name)) {
      const parts = name.split(',').map(p => p.trim())
      name = `${parts[1]} ${parts[0]}`
    }

    // Title-case if ALL CAPS or all lowercase (e.g. "TAYLOR BISCHOFF" → "Taylor Bischoff")
    if (name === name.toUpperCase() || name === name.toLowerCase()) {
      name = name.replace(/\b\w/g, c => c.toUpperCase())
    }

    // Remove trailing/leading junk: extra spaces, quotes
    name = name.replace(/^["']+|["']+$/g, '').trim()

    return name
  }

  // ── STEP 3.6: Auto-create contacts — scan ALL of today's emails ──
  // activeEmails only covers 25 bucket-1/2 threads. New senders in bucket 3-5
  // or outside that narrow slice never got contacts. Fix: query the full emails
  // table for today's report date across all buckets.
  console.log('Step 3.6: Updating contacts...')
  const { data: allTodayEmails } = await supabase
    .from('emails')
    .select('from_address, from_name, thread_subject, is_internal')
    .eq('last_report_date', today)
    .not('from_address', 'is', null)
    .neq('from_address', 'hankinsr@claycorp.com')
    .limit(200)

  // Merge with activeEmails (which have richer fields) — deduplicate by from_address
  const allEmailSenders = new Map()
  for (const e of (activeEmails || [])) {
    if (e.from_address) allEmailSenders.set(e.from_address.toLowerCase(), e)
  }
  for (const e of (allTodayEmails || [])) {
    if (e.from_address && !allEmailSenders.has(e.from_address.toLowerCase())) {
      allEmailSenders.set(e.from_address.toLowerCase(), e)
    }
  }
  const emailsForContactSync = Array.from(allEmailSenders.values())
  console.log(`  → Scanning ${emailsForContactSync.length} unique senders from today's report`)

  for (const email of emailsForContactSync) {
    try {
      if (!email.from_address) continue
      if (email.from_address === 'hankinsr@claycorp.com') continue
      // Use email username as fallback name if from_name missing (bucket 3-5 may lack it)
      if (!email.from_name) email.from_name = email.from_address.split('@')[0]

      // Priority 1: exact email match
      const { data: byEmail } = await supabase
        .from('contacts')
        .select('id, email, secondary_email')
        .eq('email', email.from_address)
        .maybeSingle()

      if (byEmail) {
        // Exact match — just update recency
        await supabase
          .from('contacts')
          .update({ last_contact_date: today, last_topic: email.thread_subject })
          .eq('id', byEmail.id)
        results.contacts_updated++
        continue
      }

      // Priority 2: name + domain match (same person, different address)
      const domain = email.from_address.split('@')[1] || ''
      const firstName = email.from_name.trim().split(/\s+/)[0]
      const { data: byNameDomain } = firstName.length > 2
        ? await supabase
            .from('contacts')
            .select('id, email, secondary_email')
            .ilike('name', `%${firstName}%`)
            .ilike('email', `%${domain}%`)
            .maybeSingle()
        : { data: null }

      if (byNameDomain) {
        // Same person, different address — add as secondary, update recency
        const updates = {
          last_contact_date: today,
          last_topic: email.thread_subject
        }
        if (!byNameDomain.secondary_email &&
            byNameDomain.email !== email.from_address) {
          updates.secondary_email = email.from_address
        }
        await supabase.from('contacts').update(updates).eq('id', byNameDomain.id)
        results.contacts_updated++
        continue
      }

      // Priority 3: exact name match across any domain
      // Catches same person with completely different email addresses (e.g. work vs personal)
      const nameParts = email.from_name.trim().split(/\s+/)
      const firstN    = nameParts[0]
      const lastN     = nameParts[nameParts.length - 1]
      if (firstN && lastN && firstN !== lastN) {
        const { data: byNameOnly } = await supabase
          .from('contacts')
          .select('id, email, secondary_email')
          .ilike('name', email.from_name.trim())
          .neq('email', email.from_address)
          .maybeSingle()

        if (byNameOnly) {
          // Same name, different email — store as secondary
          if (!byNameOnly.secondary_email) {
            await supabase
              .from('contacts')
              .update({ secondary_email: email.from_address })
              .eq('id', byNameOnly.id)
          }
          // Update recency regardless
          await supabase
            .from('contacts')
            .update({ last_contact_date: today, last_topic: email.thread_subject })
            .eq('id', byNameOnly.id)
          results.contacts_updated++
          continue
        }
      }

      // Priority 4: no match — create new
      const company = domain && !['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud'].includes(domain.split('.')[0])
        ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
        : null

      await supabase.from('contacts').insert({
        name: normalizeDisplayName(email.from_name),
        email: email.from_address,
        company: company,
        last_contact_date: today,
        last_topic: email.thread_subject,
        relationship_warmth: email.is_internal ? 'warm' : 'cool',
        notes: `Auto-created from: ${email.thread_subject}`
      })
      results.contacts_created++

    } catch (err) {
      // Non-fatal
    }
  }
  console.log(`  ✓ Contacts: ${results.contacts_created} created, ${results.contacts_updated} updated`)

  // ── STEP 3.6b: Backfill contacts from historical emails ──────────
  // Catches senders who emailed before contact creation was expanded.
  // Runs a lightweight pass: find distinct from_addresses in emails table
  // that have NO matching contact yet. Limit 50 to stay fast.
  console.log('Step 3.6b: Backfilling missing contacts from email history...')
  let backfillCreated = 0
  try {
    const { data: orphanedSenders } = await supabase
      .rpc('get_emails_without_contacts', { row_limit: 50 })
      .then(r => r, () => ({ data: null })) // RPC may not exist yet — non-fatal

    if (orphanedSenders && orphanedSenders.length > 0) {
      for (const row of orphanedSenders) {
        try {
          if (!row.from_address || row.from_address === 'hankinsr@claycorp.com') continue
          const domain = row.from_address.split('@')[1] || ''
          const company = domain && !['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud'].includes(domain.split('.')[0])
            ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
            : null
          await supabase.from('contacts').insert({
            name: normalizeDisplayName(row.from_name || row.from_address.split('@')[0]),
            email: row.from_address,
            company: company,
            last_contact_date: today,
            last_topic: row.thread_subject,
            relationship_warmth: row.is_internal ? 'warm' : 'cool',
            notes: `Auto-created (backfill): ${row.thread_subject}`
          })
          backfillCreated++
        } catch (_) { /* non-fatal */ }
      }
      console.log(`  ✓ Backfill: ${backfillCreated} missing contacts created`)
    } else {
      console.log('  → No orphaned senders found (RPC unavailable or all senders already have contacts)')
    }
  } catch (backfillErr) {
    console.log(`  ⚠️  Backfill skipped: ${backfillErr.message}`)
  }

  // ── STEP 3.7: Enrich contacts from email signatures ─────────────
  // Targets contacts that need enrichment — not just active email senders.
  // Includes: never enriched, missing key fields, or enriched > 30 days ago.
  // ── STEP 3.7a: Context questions ────────────────────────────────
  // Surfaces open-ended questions Ryan can type a response to.
  // Answers feed back into buildRyanContext() as persistent knowledge.
  console.log('Step 3.7a: Generating context questions...')

  // Helper: skip if we already have an unanswered question on the same subject
  async function questionAlreadyOpen(keyPhrase) {
    const { data } = await supabase
      .from('ai_questions')
      .select('id')
      .ilike('question', `%${keyPhrase.slice(0, 40)}%`)
      .is('answered_at', null)
      .maybeSingle()
    return !!data
  }

  try {
    // ── 1. Unknown person appearing in multiple threads ─────────────
    // Find contacts with no role AND appearing in 3+ active emails this week
    const nameCounts = {}
    for (const email of (activeEmails || [])) {
      const name = email.from_name
      if (name && name !== 'Ryan Hankins') {
        nameCounts[name] = (nameCounts[name] || 0) + 1
      }
    }
    for (const [name, count] of Object.entries(nameCounts)) {
      if (count < 3) continue
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, role, company, relationship_tier')
        .ilike('name', `%${name.split(' ')[0]}%`)
        .maybeSingle()

      // Only ask if no role is set (we don't know who they are yet)
      if (!contact?.role) {
        const alreadyAsked = await questionAlreadyOpen(name)
        if (!alreadyAsked) {
          await logAIQuestion(
            `I keep seeing ${name} across ${count} of your active email threads. Who are they — what's their role, company, and how do they fit into your work?`,
            `Threads: ${(activeEmails || []).filter(e => e.from_name === name).map(e => e.thread_subject).slice(0, 3).join(', ')}`,
            'context_person'
          )
          results.questions_logged++
        }
      }
    }

    // ── 2. Thread sitting in bucket 2–3 for 7+ days with no action ──
    // Surfaces threads that have gone stale — still active but not prioritized
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: staleThreads } = await supabase
      .from('emails')
      .select('id, thread_subject, from_name, days_waiting')
      .in('bucket', [2, 3])
      .lt('received_at', sevenDaysAgo.toISOString())
      .order('days_waiting', { ascending: false })
      .limit(3)

    for (const thread of (staleThreads || [])) {
      const alreadyAsked = await questionAlreadyOpen(thread.thread_subject)
      if (!alreadyAsked) {
        await logAIQuestion(
          `The thread "${thread.thread_subject}" from ${thread.from_name} has been sitting for ${thread.days_waiting} days without action. Is this still relevant, or should I drop it from your active list?`,
          `${thread.days_waiting} days waiting, currently bucket 2-3`,
          'context_importance'
        )
        results.questions_logged++
      }
    }

    // ── 3. High-stakes calendar event with no meeting notes ────────
    // Ask for context on upcoming meetings where prep matters
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 2)

    const { data: upcomingHighStakes } = await supabase
      .from('events')
      .select('id, title, start_time, body')
      .eq('high_stakes', true)
      .is('body', null)          // no pre-meeting brief yet
      .gte('start_time', new Date().toISOString())
      .lte('start_time', tomorrow.toISOString())
      .limit(2)

    for (const event of (upcomingHighStakes || [])) {
      const alreadyAsked = await questionAlreadyOpen(event.title)
      if (!alreadyAsked) {
        await logAIQuestion(
          `You have "${event.title}" coming up — flagged as high-stakes. What's your primary goal for this meeting, and is there anything I should know going in?`,
          `Scheduled: ${new Date(event.start_time).toLocaleString()}`,
          'context_meeting'
        )
        results.questions_logged++
      }
    }

    // ── 4. Overdue commitment (mine) ───────────────────────────────
    const fiveDaysAgo = new Date()
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)

    const { data: overdueCommitments } = await supabase
      .from('commitments')
      .select('id, description, committed_to, due_date')
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(2)

    for (const c of (overdueCommitments || [])) {
      const alreadyAsked = await questionAlreadyOpen(c.description?.slice(0, 40) || 'commitment')
      if (!alreadyAsked) {
        const daysLate = Math.floor((new Date() - new Date(c.due_date)) / (1000 * 60 * 60 * 24))
        await logAIQuestion(
          `You committed to "${c.description}" for ${c.committed_to || 'someone'} — that's ${daysLate} day${daysLate !== 1 ? 's' : ''} past due. Did you handle this? If not, what's the hold-up?`,
          `Due: ${c.due_date}`,
          'overdue_commitment'
        )
        results.questions_logged++
      }
    }

    // ── 5. Stalled pending decision (7+ days, no resolution) ──────
    const { data: stalledDecisions } = await supabase
      .from('pending_decisions')
      .select('id, title, context, created_at')
      .eq('status', 'open')
      .lt('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: true })
      .limit(2)

    for (const d of (stalledDecisions || [])) {
      const daysOld = Math.floor((new Date() - new Date(d.created_at)) / (1000 * 60 * 60 * 24))
      const alreadyAsked = await questionAlreadyOpen(d.title?.slice(0, 40) || 'decision')
      if (!alreadyAsked) {
        await logAIQuestion(
          `The "${d.title}" decision has been open for ${daysOld} days. What's needed to resolve it — are you waiting on someone, more information, or is this on you to call?`,
          d.context || '',
          'stalled_decision'
        )
        results.questions_logged++
      }
    }

  } catch (err) {
    results.errors.push(`Context questions: ${err.message}`)
  }

  console.log(`  ✓ Context questions logged: ${results.questions_logged}`)

  // ── Step 3.65: Auto-create contacts from all email participants ──
  // Captures senders AND recipients/CC from thread_participants
  // Skips internal Clayco domains — those aren't relationship contacts
  console.log('Step 3.65: Auto-creating contacts from email participants...')
  const SKIP_DOMAINS_CONTACT = new Set([
    'claycorp.com', 'theljc.com', 'realcrg.com', 'concretestrategies.com',
    'ventanaconstruction.com', 'ventana.vc', 'ljcdesign.com',
    'noreply', 'no-reply', 'donotreply', 'mailer', 'notifications',
    'amazonses.com', 'sendgrid.net', 'mailchimp.com', 'hubspot.com',
    'bounce', 'helpdesk', 'proofpoint', 'southwest.com',
  ])
  function shouldSkipContact(email) {
    const domain = (email || '').split('@')[1]?.toLowerCase() || ''
    return SKIP_DOMAINS_CONTACT.has(domain) ||
      [...SKIP_DOMAINS_CONTACT].some(d => domain.includes(d))
  }

  try {
    // Fetch all emails — senders + participants
    const { data: allEmails } = await supabase
      .from('emails')
      .select('from_address, from_name, thread_participants')
      .not('from_address', 'is', null)
      .neq('from_address', '')

    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('email')

    const existingEmails = new Set(
      (existingContacts || []).map(c => (c.email || '').toLowerCase())
    )

    const newPeople = {} // email → name

    for (const e of (allEmails || [])) {
      // Add sender
      const fromAddr = (e.from_address || '').toLowerCase().trim()
      if (fromAddr && !existingEmails.has(fromAddr) && !shouldSkipContact(fromAddr) && !newPeople[fromAddr]) {
        newPeople[fromAddr] = e.from_name || fromAddr.split('@')[0]
      }

      // Add all thread participants (TO + CC)
      const participants = e.thread_participants || []
      for (const p of participants) {
        const addr = typeof p === 'string'
          ? p.toLowerCase().trim()
          : (p.email || p.address || '').toLowerCase().trim()
        const name = typeof p === 'string'
          ? (p.includes('@') ? p.split('@')[0] : p)
          : (p.name || addr.split('@')[0])

        if (addr && addr.includes('@') && !existingEmails.has(addr) &&
            !shouldSkipContact(addr) && !newPeople[addr]) {
          newPeople[addr] = name
        }
      }
    }

    const toCreate = Object.entries(newPeople).slice(0, 300)
    let autoCreated = 0
    for (const [email, name] of toCreate) {
      const { error } = await supabase
        .from('contacts')
        .insert({ email, name: normalizeDisplayName(name), source: 'email', enriched: false })
      if (!error) autoCreated++
    }
    console.log(`  ✓ Auto-created ${autoCreated} contacts from email senders + participants`)
  } catch (err) {
    console.log(`  ⚠ Auto-create contacts error: ${err.message}`)
  }

  // ── Step 3.66: Auto-set relationship_tier from 30-day email frequency ──
  // tier 1 = 15+ emails in 30 days (high-volume relationship)
  // tier 2 = 5–14 emails in 30 days (regular relationship)
  // Never downgrades — only sets null tiers or promotes to a higher tier
  console.log('Step 3.66: Auto-setting contact relationship_tier from email frequency...')
  try {
    const thirtyDaysAgoTier = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Count emails per sender in last 30 days (skip internal domains)
    const { data: recentEmails } = await supabase
      .from('emails')
      .select('from_address')
      .gte('received_at', thirtyDaysAgoTier)
      .not('from_address', 'is', null)

    // Tally per address
    const countByEmail = {}
    for (const e of (recentEmails || [])) {
      const addr = (e.from_address || '').toLowerCase().trim()
      if (addr) countByEmail[addr] = (countByEmail[addr] || 0) + 1
    }

    // Bucket into tiers
    const tier1Addresses = Object.entries(countByEmail).filter(([, n]) => n >= 15).map(([a]) => a)
    const tier2Addresses = Object.entries(countByEmail).filter(([, n]) => n >= 5 && n < 15).map(([a]) => a)

    let tierUpdates = 0

    // Tier 1 upgrades — set tier='tier1' if currently null, tier2, or tier3
    // Matches the string enum used everywhere else: ai.js queries ['tier1','tier2']
    for (const addr of tier1Addresses) {
      const { error } = await supabase
        .from('contacts')
        .update({ relationship_tier: 'tier1' })
        .eq('email', addr)
        .or('relationship_tier.is.null,relationship_tier.eq.tier2,relationship_tier.eq.tier3')
      if (!error) tierUpdates++
    }

    // Tier 2 upgrades — set tier='tier2' if currently null or tier3 (don't overwrite tier1)
    for (const addr of tier2Addresses) {
      const { error } = await supabase
        .from('contacts')
        .update({ relationship_tier: 'tier2' })
        .eq('email', addr)
        .or('relationship_tier.is.null,relationship_tier.eq.tier3')
      if (!error) tierUpdates++
    }

    console.log(`  ✓ Relationship tiers updated: ${tier1Addresses.length} tier-1 candidates, ${tier2Addresses.length} tier-2 candidates → ${tierUpdates} updates applied`)
  } catch (err) {
    console.log(`  ⚠ Relationship tier error: ${err.message}`)
    results.errors.push(`RelationshipTier: ${err.message}`)
  }

  console.log('Step 3.7: Enriching contacts from signatures...')
  let contactsEnriched = 0

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Contacts qualify for enrichment if any key profile field is missing OR never enriched.
  // No time-based cooldown — if a contact emails Ryan today, we want to catch it immediately.
  // Contacts with no email content are cheap (just a DB query, no AI call).
  // Priority ordering by last_contact_date ensures recently active contacts (who likely
  // have email content) get the 250 slots before dormant contacts with no emails.
  const { data: contactsToEnrich } = await supabase
    .from('contacts')
    .select('*')
    .or(
      'enriched.is.null,' +
      'enriched.eq.false,' +
      'title.is.null,' +
      'phone_mobile.is.null,' +
      'company.is.null,' +
      'address.is.null,' +
      `enriched_at.lt.${thirtyDaysAgo.toISOString()}`
    )
    .not('email', 'is', null)
    .order('last_contact_date', { ascending: false, nullsFirst: false })
    .limit(50)  // reduced from 250 — each contact is one Haiku call; 50 = ~2-3 min, 250 = 15-20 min

  for (const contact of (contactsToEnrich || [])) {
    try {
      if (!contact.email) continue
      if (contact.email === 'hankinsr@claycorp.com') continue

      // ── Gather ALL content sources for this contact ───────────────
      const contentParts = []

      // Source 1: Emails they SENT — best source for their own signature
      // Signatures are at the BOTTOM — take last 2500 chars, not the first
      const { data: sentEmails } = await supabase
        .from('emails')
        .select('full_thread_content, body_preview, sent_body, from_name')
        .eq('from_address', contact.email)
        .order('received_at', { ascending: false })
        .limit(5)

      for (const e of (sentEmails || [])) {
        if (e.full_thread_content) {
          // Split by message break — signatures live at the BOTTOM of each message segment.
          // Taking only the last 2500 chars of the full thread fails for bucket 2 threads
          // where Ryan replied last: Ryan's signature ends up at the tail, not the contact's.
          // Instead: take the tail of each individual message segment.
          const segments = e.full_thread_content.split('---MESSAGE BREAK---')
          for (const seg of segments.slice(0, 6)) { // cap at 6 segments
            const trimmed = seg.trim()
            if (trimmed.length > 80) {
              // Last 1200 chars of each message — this is where email signatures live
              contentParts.push(trimmed.slice(-1200))
            }
          }
        } else if (e.body_preview) {
          // body_preview is a short preview — less useful for signatures but better than nothing
          contentParts.push(e.body_preview.slice(-1200))
        }
        // sent_body is Ryan's own sent message — not useful for extracting the contact's sig
      }

      // Source 2 REMOVED: participant threads caused cross-contamination — other people's
      // signatures in the same thread were being attributed to this contact. Source 1
      // (emails sent FROM this contact) is authoritative and sufficient.

      // Source 3: Meeting transcripts — introductions often contain title/company
      // Look for the contact's name in recent Plaud recordings
      const nameParts = (contact.name || '').split(' ').filter(w => w.length > 2)
      if (nameParts.length > 0) {
        const { data: mentionedInMeetings } = await supabase
          .from('meeting_notes')
          .select('raw_transcript, full_transcript, summary, short_summary, title')
          .or(nameParts.map(n => `participants.cs.{"${contact.name}"}`).join(',') +
              `,raw_transcript.ilike.%${nameParts[nameParts.length - 1]}%`)
          .order('meeting_date', { ascending: false })
          .limit(3)

        for (const m of (mentionedInMeetings || [])) {
          const transcript = m.raw_transcript || m.full_transcript || ''
          if (transcript.length > 100) {
            // Find the portion of the transcript where their name appears
            const lastName = nameParts[nameParts.length - 1]
            const idx = transcript.toLowerCase().indexOf(lastName.toLowerCase())
            if (idx > -1) {
              // Extract context around where their name appears (intro/bio likely nearby)
              const start = Math.max(0, idx - 200)
              const end   = Math.min(transcript.length, idx + 800)
              contentParts.push(`[From meeting: ${m.title}]\n${transcript.slice(start, end)}`)
            }
          }
          if (m.summary) contentParts.push(`[Meeting summary: ${m.title}]\n${m.summary.slice(0, 500)}`)
        }
      }

      if (contentParts.length === 0) {
        // No email content yet — skip silently. Don't write anything.
        // This contact stays in the queue and will be retried tomorrow.
        // If they email Ryan tonight, their content will be here tomorrow and enrichment fires.
        // enriched=true is only set when we actually find and write profile data.
        continue
      }

      const combinedContent = contentParts.join('\n---\n').slice(0, 6000)

      const extracted = await aiService.extractContactFromSignature(
        combinedContent,
        contact.name,
        contact.email
      )

      // Accept medium + high — only skip if truly nothing found
      if (!extracted) continue
      if (extracted.confidence === 'low' &&
          !extracted.title && !extracted.phone_mobile &&
          !extracted.phone_office && !extracted.company) continue

      // Build updates — never overwrite existing good data
      const updates = {}

      // Name: update if signature reveals a clearer full name
      // Handles: "B. Taylor" → "Taylor Bischoff", "Bischoff, Taylor" → "Taylor Bischoff",
      //          partial/initial names, or any single-word name
      if (extracted.name && extracted.name !== contact.name) {
        const currentName = contact.name || ''
        const extractedName = extracted.name.trim()
        const isCurrentIncomplete = (
          currentName.includes(',') ||           // "Last, First" reversed format
          /^[A-Z]\.\s/.test(currentName) ||      // starts with initial like "B. Taylor"
          !currentName.includes(' ') ||           // single word (no last name)
          currentName.split(' ').some(p => p.length === 1 || (p.length === 2 && p.endsWith('.'))) // has initials
        )
        const isExtractedFullName = (
          extractedName.includes(' ') &&          // has first + last
          !extractedName.includes(',') &&         // not reversed
          extractedName.split(' ').every(p => p.length > 1) // no single-char parts
        )
        if (isCurrentIncomplete && isExtractedFullName) {
          updates.name = extractedName
        }
      }

      // Title: set if empty
      if (extracted.title && !contact.title) {
        updates.title = extracted.title
      }

      // Company: set if empty, auto-correct formatting, or flag genuine job change
      if (extracted.company) {
        // Normalize: lowercase, strip .com/.org/.net, remove all spaces/punctuation
        function normalizeCompany(s) {
          return (s || '').toLowerCase()
            .replace(/\.(com|org|net|co|inc|llc|corp)\.?$/i, '')
            .replace(/[^a-z0-9]/g, '')
        }
        const normExtracted = normalizeCompany(extracted.company)
        const normExisting  = normalizeCompany(contact.company)

        if (!contact.company) {
          // No company stored — set it
          updates.company = extracted.company
        } else if (normExtracted === normExisting) {
          // Same company after normalization — just update formatting silently
          // e.g. "Pacificfusion" → "Pacific Fusion", "claycorp.com" → "Clayco"
          if (extracted.company !== contact.company) {
            updates.company = extracted.company
          }
        } else if (
          normExtracted.includes(normExisting) ||
          normExisting.includes(normExtracted)
        ) {
          // One is a substring of the other — formatting/shortening variant, auto-update
          // e.g. "Claycorp" → "Clayco", "ThorntonTomasetti" → "Thornton Tomasetti"
          updates.company = extracted.company
        } else if (normExtracted.length > 3 && normExisting.length > 3) {
          // Genuinely different company name — flag as potential job change
          updates.company_pending    = extracted.company
          updates.job_change_detected = true

          await logAIQuestion(
            `${contact.name} may have changed jobs. Currently listed at ` +
            `"${contact.company}" but their recent email signature shows ` +
            `"${extracted.company}". Update their profile?`,
            `Source: recent email signature`,
            'binary'
          )
        }
      }

      // Phones — additive only
      if (extracted.phone_mobile) {
        if (!contact.phone_mobile) {
          updates.phone_mobile = extracted.phone_mobile
        } else if (
          contact.phone_mobile !== extracted.phone_mobile &&
          !contact.phone_mobile_2
        ) {
          updates.phone_mobile_2 = extracted.phone_mobile
        }
      }

      if (extracted.phone_office) {
        if (!contact.phone_office) {
          updates.phone_office = extracted.phone_office
        } else if (
          contact.phone_office !== extracted.phone_office &&
          !contact.phone_office_2
        ) {
          updates.phone_office_2 = extracted.phone_office
        }
      }

      if (extracted.linkedin && !contact.linkedin) updates.linkedin = extracted.linkedin
      if (extracted.address  && !contact.address)  updates.address  = extracted.address

      updates.enriched    = true
      updates.enriched_at = new Date().toISOString()

      if (Object.keys(updates).length > 2) { // more than just enriched + enriched_at
        await supabase.from('contacts').update(updates).eq('id', contact.id)
        contactsEnriched++
      }

    } catch (err) {
      // Non-fatal
      console.log(`  ⚠️  Enrich error for ${contact.email}: ${err.message}`)
    }
  }
  console.log(`  ✓ Enriched ${contactsEnriched} contacts from signatures`)

  // ── STEP 3.7c: Content-first signature backstop ──────────────────
  // Complements Step 3.7. Goes the other direction: scours today's full
  // thread content for ALL signature blocks, matches each one to a contact
  // using the email address found IN the signature as the anchor.
  // Catches: CC participants, newly created contacts needing same-night
  // enrichment, anyone who's only ever been on threads but never the FROM.
  // Only writes when signature contains an email address — prevents cross-contamination.
  console.log('Step 3.7c: Content-first signature backstop...')
  let backstopEnriched = 0
  let backstopCreated  = 0
  const INTERNAL_DOMAINS = new Set([
    'claycorp.com','clayco.com','ljcdesign.com',
    'crg.com','concretestrategies.com','ventanaconstruction.com'
  ])

  try {
    const { data: threadsWithContent } = await supabase
      .from('emails')
      .select('thread_subject, full_thread_content')
      .eq('last_report_date', today)
      .not('full_thread_content', 'is', null)
      .limit(50)

    for (const thread of (threadsWithContent || [])) {
      try {
        const signatures = await aiService.extractAllSignaturesFromThread(
          thread.full_thread_content,
          thread.thread_subject
        )

        for (const sig of (signatures || [])) {
          try {
            if (!sig.email || !sig.email.includes('@')) continue
            const sigEmail = sig.email.toLowerCase().trim()
            if (sigEmail === 'hankinsr@claycorp.com') continue

            const { data: existing } = await supabase
              .from('contacts')
              .select('id, title, company, phone_mobile, phone_office, address')
              .eq('email', sigEmail)
              .maybeSingle()

            if (existing) {
              // Enrich missing fields — never overwrite existing data
              const updates = {}
              if (sig.title        && !existing.title)        updates.title        = sig.title
              if (sig.company      && !existing.company)      updates.company      = sig.company
              if (sig.phone_mobile && !existing.phone_mobile) updates.phone_mobile = sig.phone_mobile
              if (sig.phone_office && !existing.phone_office) updates.phone_office = sig.phone_office
              if (sig.address      && !existing.address)      updates.address      = sig.address

              if (Object.keys(updates).length > 0) {
                updates.enriched    = true
                updates.enriched_at = new Date().toISOString()
                await supabase.from('contacts').update(updates).eq('id', existing.id)
                backstopEnriched++
              }
            } else {
              // New contact — create with profile data already populated
              const domain = sigEmail.split('@')[1] || ''
              const isInternal = INTERNAL_DOMAINS.has(domain)
              const guessedCompany = sig.company || (
                domain && !['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com'].includes(domain)
                  ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
                  : null
              )
              await supabase.from('contacts').insert({
                name:             normalizeDisplayName(sig.name || sigEmail.split('@')[0]),
                email:            sigEmail,
                title:            sig.title        || null,
                company:          guessedCompany,
                phone_mobile:     sig.phone_mobile || null,
                phone_office:     sig.phone_office || null,
                address:          sig.address      || null,
                last_contact_date: today,
                last_topic:       thread.thread_subject,
                relationship_warmth: isInternal ? 'warm' : 'cool',
                enriched:         true,
                enriched_at:      new Date().toISOString(),
                notes:            `Auto-created via signature backstop: ${thread.thread_subject}`
              })
              backstopCreated++
            }
          } catch (_) { /* non-fatal per-signature */ }
        }
      } catch (_) { /* non-fatal per-thread */ }
    }

    console.log(`  ✓ Backstop: ${backstopEnriched} enriched, ${backstopCreated} new contacts from thread signatures`)
  } catch (backstopErr) {
    console.log(`  ⚠️  Backstop error (non-fatal): ${backstopErr.message}`)
  }

  // ── STEP 3.8: Process unprocessed lead file attachments ─────────
  console.log('Step 3.8: Processing lead file attachments with AI...')
  try {
    const haikuLeads = makeAnthropic()
    const { data: unprocessedFiles } = await supabase
      .from('lead_files')
      .select('id, lead_id, filename, storage_path, mime_type')
      .eq('ai_processed', false)
      .order('created_at', { ascending: true })
      .limit(20)

    let leadFilesProcessed = 0

    for (const lf of (unprocessedFiles || [])) {
      try {
        // Download file from Supabase Storage
        const { data: blob, error: dlErr } = await supabase.storage
          .from('lead-files')
          .download(lf.storage_path)
        if (dlErr) { console.log(`    ⚠ Download error for ${lf.filename}: ${dlErr.message}`); continue }

        // Convert Blob → Buffer → text
        const buf = Buffer.from(await blob.arrayBuffer())
        let rawText = ''
        const ext = (lf.filename || '').toLowerCase()
        try {
          if (ext.endsWith('.pdf')) {
            const pdfParse = require('pdf-parse')
            const parsed = await pdfParse(buf)
            rawText = parsed.text
          } else if (ext.endsWith('.docx')) {
            const mammoth = require('mammoth')
            const result = await mammoth.extractRawText({ buffer: buf })
            rawText = result.value
          } else {
            rawText = buf.toString('utf-8')
          }
        } catch (parseErr) {
          rawText = buf.toString('utf-8').slice(0, 50000)
        }

        if (!rawText || rawText.trim().length < 50) {
          await supabase.from('lead_files').update({ ai_processed: true, extracted_at: new Date().toISOString() }).eq('id', lf.id)
          continue
        }

        const textSnippet = rawText.slice(0, 12000) // Haiku context window is generous

        // Fetch parent lead for context
        const { data: lead } = await supabase.from('leads').select('codename, client_name, project_type').eq('id', lf.lead_id).single()

        const prompt = `You are analyzing an article, press release, or document attached to a construction/development lead tracker.

Lead context: ${lead?.codename || 'Unknown project'}${lead?.client_name ? ` — ${lead.client_name}` : ''}${lead?.project_type ? ` (${lead.project_type})` : ''}
File: ${lf.filename}

DOCUMENT TEXT:
${textSnippet}

Extract the following intelligence in a concise, structured format. Only include fields where there is clear evidence in the document. Skip fields that are not mentioned.

Return your response as a compact summary with these sections (skip sections with no data):

FACILITY TYPE: [data center / advanced manufacturing / pharma / industrial / etc.]
PROCESS / USE: [what they will make, store, or do in the facility]
SCALE / SIZE: [SF, MW, units, or other scale indicators]
LOCATION: [city, state, region — be specific]
KEY STAKEHOLDERS: [developer, owner, tenant, GC, architect — names and roles]
TIMELINE: [when construction starts, when operational, key milestones]
INVESTMENT / VALUE: [capital investment, project cost, bond size]
PROCUREMENT: [how they will hire builder — CM-at-risk, design-build, bid, etc.]
COMPETITIVE INTEL: [other builders/developers mentioned, market positioning signals]
SALES NOTES: [anything else relevant to Clayco pursuing this project — relationships, hurdles, opportunities]

Be specific and cite concrete details. Avoid generic statements.`

        const response = await haikuLeads.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages:   [{ role: 'user', content: prompt }],
        })

        const aiSummary = response.content?.[0]?.text?.trim() || null

        // Write AI summary to lead_files
        await supabase.from('lead_files').update({
          ai_processed: true,
          ai_summary:   aiSummary,
          extracted_at: new Date().toISOString(),
        }).eq('id', lf.id)

        // Roll up all processed file summaries to parent lead.ai_summary
        const { data: allFiles } = await supabase
          .from('lead_files')
          .select('filename, ai_summary')
          .eq('lead_id', lf.lead_id)
          .eq('ai_processed', true)
          .not('ai_summary', 'is', null)

        if (allFiles?.length > 0) {
          const rolled = allFiles.map(f => `=== ${f.filename} ===\n${f.ai_summary}`).join('\n\n')
          await supabase.from('leads').update({ ai_summary: rolled }).eq('id', lf.lead_id)
        }

        leadFilesProcessed++
        console.log(`    ✓ Processed: ${lf.filename} (${lead?.codename || lf.lead_id})`)
      } catch (fileErr) {
        console.log(`    ✗ Lead file error [${lf.filename}]: ${fileErr.message}`)
      }
    }

    console.log(`  ✓ Lead files processed: ${leadFilesProcessed}`)
  } catch (err) {
    results.errors.push(`Lead file processing: ${err.message}`)
    console.log(`  ✗ Lead file processing error: ${err.message}`)
  }

  } // end stepsThreeToEmail — email AI block (Steps 3–3.8)
  // Step 2.6 runs ALWAYS regardless of RESUME_FROM_STEP.
  // Plaud meeting intelligence is independent of email summarization — it reads
  // directly from meeting_notes in the DB and must not be skipped on resume runs.

  // ── STEP 2.6: Process Plaud meeting transcripts ──────────────────
  console.log('Step 2.6: Processing Plaud meeting intelligence...')

  // Load global + project category map once — used to inject category context per meeting
  const { data: allMeetingCategories = [] } = await supabase
    .from('meeting_categories')
    .select('id, name, description')
  const categoryMap = new Map((allMeetingCategories || []).map(c => [c.id, c]))

  try {
    // Load unprocessed meetings + meetings flagged for reprocessing (category changed)
    const [{ data: unprocessedRaw }, { data: reprocessRaw }] = await Promise.all([
      supabase
        .from('meeting_notes')
        .select('*')
        .eq('intelligence_extracted', false)
        .order('start_time', { ascending: false })
        .limit(15), // steady state: 15/night
      supabase
        .from('meeting_notes')
        .select('*')
        .eq('needs_ai_reprocess', true)
        .eq('intelligence_extracted', true) // only re-run already-processed meetings
        .order('start_time', { ascending: false })
        .limit(10), // cap reprocessing — category backfill can queue many at once
    ])

    // Deduplicate (a meeting could appear in both lists if somehow flagged + unprocessed)
    const seen = new Set()
    const unprocessedMeetings = [...(unprocessedRaw || []), ...(reprocessRaw || [])].filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })

    if ((reprocessRaw || []).length > 0) {
      console.log(`  ↺ Reprocessing ${reprocessRaw.length} meeting(s) with updated categories`)
    }

    for (const meeting of unprocessedMeetings) {
      try {
        // ── Resolve category context for this meeting ─────────────────────────
        // Injected into AI prompts so extraction is category-aware
        const primaryCat   = meeting.primary_category_id ? categoryMap.get(meeting.primary_category_id) : null
        const categoryHint = primaryCat
          ? `\n\nMEETING TYPE: ${primaryCat.name}${primaryCat.description ? ` — ${primaryCat.description}` : ''}.\nExtract intelligence that is specifically relevant to ${primaryCat.name} meetings. For example:\n${getCategoryExtractionHints(primaryCat.name)}`
          : ''

        // PASS 1: Process metadata action items
        // SKIP entirely for information-only meetings — they build context, not tasks
        const actionItems = meeting.information_only ? [] : (meeting.action_items_raw || [])
        if (meeting.information_only) {
          console.log(`  ℹ Info-only meeting: "${meeting.title}" — skipping action item extraction`)
        }

        // Project ID comes from manual assignment in frontend — not keyword guessing
        const meetingProjectId  = meeting.project_id || null
        const meetingSource     = meeting.source === 'plaud' ? 'plaud' : meeting.source === 'manual' ? 'manual' : 'otter'
        const meetingSourceType = meeting.source === 'plaud' ? 'ai_plaud' : meeting.source === 'manual' ? 'ai_upload' : 'ai_otter'

        for (const item of actionItems) {
          const isRyan = item.assignee_email === 'hankinsr@claycorp.com'

        if (isRyan) {
            // Level 1: exact title match
            const { data: exactTask } = await supabase
              .from('tasks')
              .select('id')
              .eq('title', item.task_text)
              .eq('status', 'open')
              .maybeSingle()

            if (exactTask) {
              // Exact match — add source row pointing to existing task
              try {
                await supabase.from('work_item_sources').insert({
                  work_item_id:   exactTask.id,
                  work_item_type: 'task',
                  source_type:    meetingSourceType,
                  source_id:      meeting.id,
                  source_label:   meeting.title || 'Meeting',
                  excerpt:        item.task_text.slice(0, 500),
                  confidence:     'high',
                })
              } catch (_) {}
            } else {
              // Level 2: semantic dedup check (cap at 30 per step)
              const smcResult = await semanticMatchCheck(
                item.task_text,
                null,
                'tasks',
                meetingProjectId
              )

              if (smcResult.isDismissed) {
                // Matched a dismissed item — Ryan already decided. Suppress re-creation silently.
                console.log(`  Suppressed (dismissed match): "${item.task_text}" → dismissed "${smcResult.match.title}"`)
              } else if (smcResult.match && smcResult.confidence >= 75) {
                // High confidence match — add source row to existing task, skip insert
                try {
                  await supabase.from('work_item_sources').insert({
                    work_item_id:   smcResult.match.id,
                    work_item_type: 'task',
                    source_type:    meetingSourceType,
                    source_id:      meeting.id,
                    source_label:   meeting.title || 'Meeting',
                    excerpt:        item.task_text.slice(0, 500),
                    confidence:     'high',
                  })
                } catch (_) {}
                console.log(`  Dedup (conf=${smcResult.confidence}): skipped "${item.task_text}" → existing "${smcResult.match.title}"`)
              } else {
                // Insert new task
                const insertPatch = {
                  title:            item.task_text,
                  context:          `Action item from: ${meeting.title || 'Meeting'}`,
                  status:           'open',
                  source:           meetingSource,
                  source_type:      meetingSourceType,
                  source_label:     meeting.title || 'Meeting',
                  source_date:      today,
                  meeting_note_id:  meeting.id,
                  ai_enriched:      true,
                  source_confidence: 0.9,
                  project_id:       meetingProjectId
                }

                if (smcResult.match && smcResult.confidence >= 65) {
                  // Medium confidence — flag as potential duplicate
                  insertPatch.potential_duplicate_of = smcResult.match.id
                  insertPatch.duplicate_confidence   = smcResult.confidence
                }

                const { data: newTask } = await supabase
                  .from('tasks')
                  .insert(insertPatch)
                  .select('id')
                  .maybeSingle()

                results.plaud_tasks_created++

                if (smcResult.match && smcResult.confidence >= 65) {
                  await logAIQuestion(
                    `Two tasks look like the same thing — merge or keep separate? Task A: "${smcResult.match.title}" Task B: "${item.task_text}"`,
                    `Confidence: ${smcResult.confidence}%. Source: ${meeting.title || 'Meeting'}`,
                    'binary'
                  )
                }

                // Write source row for the new task
                if (newTask?.id) {
                  try {
                    await supabase.from('work_item_sources').insert({
                      work_item_id:   newTask.id,
                      work_item_type: 'task',
                      source_type:    meetingSourceType,
                      source_id:      meeting.id,
                      source_label:   meeting.title || 'Meeting',
                      excerpt:        item.task_text.slice(0, 500),
                      confidence:     'high',
                    })
                  } catch (_) {}
                }
              }
            }
          } else {
            // Level 1: exact title match for others_commitments
            const { data: exactCommitment } = await supabase
              .from('others_commitments')
              .select('id')
              .eq('title', item.task_text)
              .eq('status', 'open')
              .maybeSingle()

            if (exactCommitment) {
              // Exact match — add source row
              try {
                await supabase.from('work_item_sources').insert({
                  work_item_id:   exactCommitment.id,
                  work_item_type: 'commitment',
                  source_type:    meetingSourceType,
                  source_id:      meeting.id,
                  source_label:   meeting.title || 'Meeting',
                  excerpt:        item.task_text.slice(0, 500),
                  confidence:     'high',
                })
              } catch (_) {}
            } else {
              const { data: contact } = await supabase
                .from('contacts')
                .select('id, email')
                .ilike('name', `%${item.assignee_name}%`)
                .maybeSingle()

              const assigneeEmail = item.assignee_email || contact?.email || null

              // Level 2: semantic dedup check for same person
              const smcResult = await semanticMatchCheck(
                item.task_text,
                assigneeEmail,
                'others_commitments',
                meetingProjectId
              )

              if (smcResult.isDismissed) {
                // Matched a dismissed commitment — suppress re-creation.
                console.log(`  Suppressed (dismissed match): commitment "${item.task_text}" → dismissed "${smcResult.match.title}"`)
              } else if (smcResult.match && smcResult.confidence >= 75) {
                // High confidence — add source row to existing commitment
                try {
                  await supabase.from('work_item_sources').insert({
                    work_item_id:   smcResult.match.id,
                    work_item_type: 'commitment',
                    source_type:    meetingSourceType,
                    source_id:      meeting.id,
                    source_label:   meeting.title || 'Meeting',
                    excerpt:        item.task_text.slice(0, 500),
                    confidence:     'high',
                  })
                } catch (_) {}
                console.log(`  Dedup (conf=${smcResult.confidence}): skipped commitment "${item.task_text}" → existing "${smcResult.match.title}"`)
              } else {
                const insertPatch = {
                  committed_by_name:  item.assignee_name,
                  committed_by_email: assigneeEmail,
                  title:        item.task_text,
                  context:      `Action item from meeting: ${meeting.title || 'Meeting'}`,
                  source:       meetingSource,
                  source_type:  meetingSourceType,
                  source_id:    meeting.id,
                  source_label: meeting.title || 'Meeting',
                  source_date:  today,
                  meeting_note_id: meeting.id,
                  status:       'open',
                  project_id:   meetingProjectId,
                  urgency:      'medium',
                  delivery_type: 'general'
                }

                if (smcResult.match && smcResult.confidence >= 65) {
                  insertPatch.potential_duplicate_of = smcResult.match.id
                  insertPatch.duplicate_confidence   = smcResult.confidence
                }

                const { data: newCommitment } = await supabase
                  .from('others_commitments')
                  .insert(insertPatch)
                  .select('id')
                  .maybeSingle()

                results.plaud_others_created++

                if (smcResult.match && smcResult.confidence >= 65) {
                  await logAIQuestion(
                    `Two commitments look like the same thing — merge or keep separate? Commitment A: "${smcResult.match.title}" Commitment B: "${item.task_text}"`,
                    `Confidence: ${smcResult.confidence}%. Person: ${item.assignee_name || 'unknown'}. Source: ${meeting.title || 'Meeting'}`,
                    'binary'
                  )
                }

                // Write source row for the new commitment
                if (newCommitment?.id) {
                  try {
                    await supabase.from('work_item_sources').insert({
                      work_item_id:   newCommitment.id,
                      work_item_type: 'commitment',
                      source_type:    meetingSourceType,
                      source_id:      meeting.id,
                      source_label:   meeting.title || 'Meeting',
                      excerpt:        item.task_text.slice(0, 500),
                      confidence:     'high',
                    })
                  } catch (_) {}
                }
              }
            }
          }
        }

        // PASS 2: Full transcript extraction (skip all-hands)
        const participantCount = (meeting.participants || []).length
        const isAllHands = participantCount > 30 ||
          ['all hands', 'all-hands', 'operations mtg', 'company update'].some(phrase =>
            (meeting.title || '').toLowerCase().includes(phrase)
          )

        // hasRichSummary: true when ANY rich text source has enough content to parse.
        // email_body_raw is the Plaud-formatted email body (bold headers + markdown tables).
        // short_summary/summary are plain-text attachments. All three count.
        const hasRichSummary = (
          (meeting.email_body_raw || '').trim().length > 500 ||
          (meeting.short_summary || meeting.summary || '').trim().length > 500
        )
        const isPlaud = meeting.source === 'plaud'

        // Plaud meetings: read pre-parsed structured blocks from pull step (zero AI cost for factual extraction)
        //   PEOPLE_AND_ACTIONS + DECISIONS_AND_RISKS parsed by Plaud's own AI → mapped to intel schema
        //   Three Haiku calls run separately for knowledge / learnings / project context
        //   NO fallback to extractIntelligenceFromTranscript — that caused the 90-min hang
        //
        // Otter / no-block meetings: extract from raw transcript (extractIntelligenceFromTranscript)
        // Backfill always uses extractIntelligenceFromTranscript — no structured blocks available
        const hasTranscript = !!(meeting.full_transcript || meeting.raw_transcript)
        const hasPlaudBlocks = isPlaud && !!(meeting.people_and_actions || meeting.decisions_and_risks)
        const shouldUsePlaudParser = isPlaud && hasRichSummary  // legacy: true for old-format meetings

        let intel = null  // declared here so speaker attributions + meetingFinalUpdate can access it

        if ((hasTranscript || hasPlaudBlocks || shouldUsePlaudParser) && !isAllHands) {
          const attendeeRoster = meeting.participants || []

          const keywords = ((meeting.title || '') + ' ' + (meeting.short_summary || ''))
            .toLowerCase()
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 5)

          const { data: relatedEmails } = await supabase
            .from('emails')
            .select('thread_subject, from_name, ai_summary, body_preview, received_at')
            .or(keywords.length ? keywords.map(k => `thread_subject.ilike.%${k}%`).join(',') : 'id.is.null')
            .limit(5)

          if (hasPlaudBlocks) {
            // ── New path: structured blocks parsed by Plaud AI in pull step ──
            // Direct mapping → intel schema. Zero Haiku cost here. Fast. No timeout risk.
            console.log(`    Using Plaud structured blocks for: ${meeting.title}${primaryCat ? ` [${primaryCat.name}]` : ''}`)
            intel = mapPlaudBlocksToIntel(meeting.people_and_actions, meeting.decisions_and_risks)
            if (intel?.meeting_outcome) intel.meeting_outcome.summary = meeting.summary || meeting.short_summary || ''
            console.log(`    Block mapping: ${intel?.ryan_action_items?.length || 0} Ryan tasks, ${intel?.decisions_made?.length || 0} decisions, ${intel?.risk_signals?.length || 0} risks`)
          } else if (shouldUsePlaudParser) {
            // ── Legacy path: old Plaud format (numbered sections + markdown tables) ──
            // Step 1: zero-AI callword parser — extracts directly from section headers + tables
            //   Primary source: email_body_raw (has **bold** headers and |table| formatting)
            //   Fallback source: short_summary/summary (plain text, no tables — limited extraction)
            // Step 2: Haiku fallback if parser returns null (edge case: non-standard formatting)
            console.log(`    Old Plaud format: trying zero-AI section parser for: ${meeting.title}${primaryCat ? ` [${primaryCat.name}]` : ''}`)
            intel = parseOldPlaudSections(meeting)
            if (intel) {
              // Preserve full summary text for frontend display
              if (intel.meeting_outcome) intel.meeting_outcome.summary = summaryForParse
            } else {
              // Edge case: non-standard section formatting — fall back to Haiku
              console.log(`    Zero-AI parser returned null → falling back to parsePlaudSummary (Haiku)`)
              intel = await aiService.parsePlaudSummary(meeting, categoryHint)
              if (!intel) {
                console.log(`    Both parsers returned null for: ${meeting.title} — skipping intelligence extraction`)
              }
            }
          } else {
            // ── Otter or non-Plaud meeting — extract from raw transcript ──
            if (primaryCat) console.log(`    Category context: [${primaryCat.name}]`)
            intel = await aiService.extractIntelligenceFromTranscript(meeting, attendeeRoster, relatedEmails || [], categoryHint)
          }

          if (intel) {
            // Use manually-assigned project_id — no keyword guessing
            const projectId = meetingProjectId

            // ── Project JSONB writes (only if project assigned) ──────────
            if (projectId) {
              const { data: project } = await supabase
                .from('projects')
                .select('intelligence_notes, decisions_made, risk_signals, key_facts')
                .eq('id', projectId)
                .single()

              if (project) {
                const newNotes = [
                  ...(intel.technical_facts || []).map(f => ({
                    ...f, type: 'technical', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.financial_signals || []).map(f => ({
                    ...f, type: 'financial', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.schedule_signals || []).map(s => ({
                    ...s, type: 'schedule', source: meeting.title, source_type: meetingSource, date: today
                  })),
                  ...(intel.scope_signals || []).map(s => ({
                    ...s, type: 'scope', source: meeting.title, source_type: meetingSource, date: today
                  }))
                ]
                const newRisks = (intel.risk_signals || []).map(r => ({
                  ...r, source: meeting.title, source_type: meetingSource, date: today
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
                      ...newRisks
                    ].slice(-30),
                    decisions_made: [
                      ...(project.decisions_made || []),
                      ...(intel.decisions_made || []).map(d => ({
                        ...d, source: meeting.title, source_type: meetingSource, date: today
                      }))
                    ].slice(-50),
                    key_facts: [
                      ...(project.key_facts || []),
                      ...(intel.key_facts || []).map(f => ({
                        ...f, source: meeting.title, source_type: meetingSource, date: today
                      }))
                    ].slice(-30)
                  })
                  .eq('id', projectId)
              }
            }

            // ── Decisions table — always write, project_id nullable ───────
            for (const d of (intel.decisions_made || [])) {
              if (!d.decision) continue
              const { data: existD } = await supabase
                .from('decisions')
                .select('id')
                .eq('title', d.decision)
                .eq('source_id', meeting.id)
                .maybeSingle()

              if (!existD) {
                await supabase.from('decisions').insert({
                  title:            d.decision,
                  what_was_decided: d.decision,
                  who_was_present:  d.all_parties?.join(', '),
                  decided_on:       today,
                  project_id:       projectId || null,
                  source_type:      meetingSourceType,
                  source_id:        meeting.id,
                  status:           'made'
                })
                results.decisions_logged++
              }
            }

            // ── Ryan's action items → tasks (always, project_id nullable) ─
            for (const item of (intel.ryan_action_items || [])) {
              const taskText = item.title || item.task_text || item.task
              if (!taskText) continue
              if ((item.attribution_confidence || 'medium') === 'low') continue
              const { data: existingTask } = await supabase
                .from('tasks')
                .select('id')
                .ilike('title', taskText.slice(0, 80))
                .eq('status', 'open')
                .maybeSingle()

              if (!existingTask) {
                await supabase.from('tasks').insert({
                  title:           taskText,
                  urgency:         item.urgency || 'medium',
                  due_date:        item.due_date || null,
                  status:          'open',
                  type:            'action',
                  source_type:     meetingSourceType,
                  source_label:    meeting.title || 'Meeting',
                  source_date:     today,
                  meeting_note_id: meeting.id,
                  project_id:      projectId || null,
                  ai_enriched:     true,
                  context:         item.attribution_basis || null,
                })
                results.tasks_created = (results.tasks_created || 0) + 1
              }
            }

            // Ryan's verbal commitments
            for (const c of (intel.verbal_commitments_ryan || [])) {
              const { data: existing } = await supabase
                .from('commitments')
                .select('id')
                .eq('title', c.title)
                .eq('status', 'open')
                .maybeSingle()

              if (!existing) {
                await supabase.from('commitments').insert({
                  title:           c.title,
                  made_to:         c.made_to,
                  urgency:         c.urgency,
                  due_date:        c.due_date,
                  status:          'open',
                  source_type:     meetingSourceType,
                  commitment_type: c.commitment_type || 'hard',
                  implicit:        false,
                  made_on:         today,
                  project_id:      projectId || null,
                })
                results.plaud_my_commitments++
              }
            }

            // Others' verbal commitments + general action items assigned to others
            const allOthersItems = [
              ...(intel.verbal_commitments_others || []),
              ...(intel.others_action_items       || []),
            ]
            for (const c of allOthersItems) {
              const personName  = c.committed_by_name || c.assigned_to_name || 'Unassigned'
              const personEmail = c.committed_by_email || c.assigned_to_email || null
              const title       = c.title || c.task_text
              if (!title) continue
              if (personName === 'Ryan' || personName === 'Ryan Hankins') continue
              if ((c.attribution_confidence || 'medium') === 'low') continue

              const { data: existing } = await supabase
                .from('others_commitments')
                .select('id')
                .ilike('title', title.slice(0, 60))
                .in('status', ['open', 'pending'])
                .maybeSingle()

              if (!existing) {
                // Try to find linked contact
                const nameParts = personName.trim().split(/\s+/)
                const { data: contact } = nameParts.length > 1
                  ? await supabase.from('contacts').select('id, email')
                      .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
                  : { data: null }

                await supabase.from('others_commitments').insert({
                  committed_by_name:    personName,
                  committed_by_email:   personEmail || contact?.email || null,
                  contact_id:      contact?.id || null,
                  title:           title,
                  context:         `From meeting: ${meeting.title}`,
                  due_date:        c.due_date || null,
                  urgency:         c.urgency || 'medium',
                  source:          meetingSource,
                  source_type:     meetingSourceType,
                  source_id:       meeting.id,
                  source_label:    meeting.title,
                  source_date:     meeting.start_time?.split('T')[0] || today,
                  project_id:      projectId || null,
                  meeting_note_id: meeting.id,
                  status:          'open',
                })
                results.plaud_others_created++
              }
            }

            // Pending decisions — always write, project_id nullable
            for (const p of (intel.pending_decisions || [])) {
              const decisionTitle = p.decision || p.title
              if (!decisionTitle) continue
              const { data: existP } = await supabase
                .from('pending_decisions')
                .select('id')
                .ilike('title', decisionTitle.slice(0, 80))
                .eq('status', 'open')
                .maybeSingle()

              if (!existP) {
                await supabase.from('pending_decisions').insert({
                  title:        decisionTitle,
                  context:      p.context || p.decision || decisionTitle,
                  blocking:     p.blocking || false,
                  due_date:     p.due_date || null,
                  urgency:      p.urgency || 'medium',
                  project_id:   projectId || null,
                  source_type:  meetingSourceType,
                  source_id:    meeting.id,
                  source_label: meeting.title || 'Meeting',
                  status:       'open'
                })
                results.pending_decisions_created++
              }
            }
          }
        } else if (isAllHands) {
          console.log(`  Skipping full extraction for all-hands: ${meeting.title}`)
        }

        // ── Haiku reasoning layer: Knowledge, Learnings, Project Context ──
        // Runs for all Plaud meetings that have a transcript (full or email body).
        // Three concurrent Haiku calls — max_tokens: 8192 each — full transcript input.
        // Outputs route to: knowledge_base, observations, and projects tables.
        // Independent from block parsing above. If this fails, factual extraction still committed.
        if (isPlaud && !isAllHands && (hasTranscript || meeting.email_body_raw)) {
          try {
            const projectId = meetingProjectId

            // Load existing knowledge and observations for context injection
            const [{ data: existingKnowledge }, { data: priorObservations }] = await Promise.all([
              projectId
                ? supabase.from('knowledge_base').select('content, title').eq('project_id', projectId).order('created_at', { ascending: false }).limit(10)
                : { data: [] },
              projectId
                ? supabase.from('observations').select('content, title').eq('project_id', projectId).order('created_at', { ascending: false }).limit(10)
                : { data: [] }
            ])

            const meetingIntel = await aiService.extractMeetingIntelligence(
              meeting,
              existingKnowledge || [],
              priorObservations || []
            )

            if (meetingIntel) {
              // ── Write knowledge items → knowledge_base ──────────────────
              for (const k of (meetingIntel.knowledge || [])) {
                if (!k.what) continue
                const { data: existK } = await supabase
                  .from('knowledge_base')
                  .select('id')
                  .ilike('content', k.what.slice(0, 80))
                  .maybeSingle()

                if (!existK) {
                  await supabase.from('knowledge_base').insert({
                    content:        k.what,
                    title:          k.what.slice(0, 120),
                    context:        [k.why_it_matters, k.decision_trigger].filter(Boolean).join(' | '),
                    transferability: k.transferability || 'this-project',
                    confidence:     k.confidence || 'inferred',
                    source_context: k.source_context || null,
                    source_type:    meetingSourceType,
                    source_id:      meeting.id,
                    source_label:   meeting.title || 'Meeting',
                    project_id:     projectId || null,
                  })
                  results.knowledge_created = (results.knowledge_created || 0) + 1
                }
              }

              // ── Write learnings → observations ──────────────────────────
              for (const l of (meetingIntel.learnings || [])) {
                if (!l.pattern) continue
                const { data: existL } = await supabase
                  .from('observations')
                  .select('id')
                  .ilike('content', l.pattern.slice(0, 80))
                  .maybeSingle()

                if (!existL) {
                  await supabase.from('observations').insert({
                    content:      l.pattern,
                    title:        l.pattern.slice(0, 120),
                    evidence:     l.evidence     || null,
                    implication:  l.implication  || null,
                    applicable_to: l.applicable_to || null,
                    confidence:   l.confidence   || 'moderate',
                    source_type:  meetingSourceType,
                    source_id:    meeting.id,
                    source_label: meeting.title || 'Meeting',
                    project_id:   projectId || null,
                  })
                  results.observations_created = (results.observations_created || 0) + 1
                }
              }

              // ── Write project context → projects table ──────────────────
              if (meetingIntel.project_context && projectId) {
                const pc = meetingIntel.project_context
                // These columns are added via the session24 migration script.
                // If columns don't exist yet the update is a no-op (Postgres ignores unknown columns
                // via the JS client — will surface as a warning, not a crash).
                await supabase
                  .from('projects')
                  .update({
                    project_phase:           pc.project_phase     || null,
                    key_constraints:         pc.key_constraints   || [],
                    core_problem:            pc.core_problem      || null,
                    next_milestone:          pc.next_milestone    || null,
                    open_dependencies:       pc.open_dependencies || [],
                    workstream_owners:       pc.workstream_owners || [],
                    project_context_updated_at: new Date().toISOString()
                  })
                  .eq('id', projectId)
              }

              console.log(`    Haiku reasoning: ${meetingIntel.knowledge?.length || 0} knowledge, ${meetingIntel.learnings?.length || 0} learnings, context: ${!!meetingIntel.project_context}`)
            }
          } catch (err) {
            console.error(`  extractMeetingIntelligence failed for "${meeting.title}": ${err.message}`)
            // Non-fatal — factual extraction already committed above
          }
        }

        // ── Recurring Series Continuity ────────────────────────────────
        // Compute a recurring_series_key and compare against prior instances
        // to generate continuity_context (cross-meeting trajectory analysis)
        try {
          const rawTitle = (meeting.title || '').toLowerCase()
          // Strip dates like 6/3, 06/03, June 3, 2026 etc.
          let seriesKey = rawTitle
            .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
            .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(,? \d{4})?\b/gi, '')
            .replace(/\b\d{4}\b/g, '')
            // Strip standalone numbers
            .replace(/\b\d+\b/g, '')
            // Normalize separators and collapse spaces
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim()

          if (seriesKey.length > 3) {
            await supabase
              .from('meeting_notes')
              .update({ recurring_series_key: seriesKey })
              .eq('id', meeting.id)

            // Find prior instances (last 6 months, limit 5, exclude current)
            const sixMonthsAgo = new Date()
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
            const { data: priorInstances } = await supabase
              .from('meeting_notes')
              .select('id, title, start_time, short_summary, action_items_raw')
              .eq('recurring_series_key', seriesKey)
              .neq('id', meeting.id)
              .gte('start_time', sixMonthsAgo.toISOString())
              .order('start_time', { ascending: false })
              .limit(5)

            if ((priorInstances || []).length >= 2) {
              // Build continuity prompt from prior summaries + action items
              const priorSummaries = priorInstances.map(p => {
                const date = p.start_time?.split('T')[0] || 'unknown'
                const items = (p.action_items_raw || []).map(a => `  - ${a.task_text || a.task || a}`).join('\n')
                return `[${date}] ${p.title}\nSummary: ${(p.short_summary || 'No summary').slice(0, 400)}\nAction items:\n${items || '  (none)'}`
              }).join('\n\n---\n\n')

              const currentSummary = meeting.short_summary || 'No summary available'
              const currentItems = (meeting.action_items_raw || []).map(a => `  - ${a.task_text || a.task || a}`).join('\n')

              const continuityHaiku = makeAnthropic()
              const continuityMsg = await continuityHaiku.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 500,
                messages: [{
                  role: 'user',
                  content: `You are analyzing a recurring meeting series to identify patterns and trajectory.

PRIOR MEETINGS (${priorInstances.length} instances):
${priorSummaries}

CURRENT MEETING (${meeting.title} — ${today}):
Summary: ${currentSummary}
Action items:
${currentItems || '  (none)'}

Write a concise continuity analysis (150-200 words) covering:
1. Recurring themes/topics that appear across multiple meetings
2. Items explicitly resolved vs. items that keep coming back unresolved
3. Trajectory: is this project/relationship trending better or worse?
4. 1-2 specific things Ryan should raise at the next meeting of this type

Be direct and specific. No fluff.`
                }]
              })

              const continuityContext = continuityMsg.content[0]?.text || ''
              if (continuityContext) {
                await supabase
                  .from('meeting_notes')
                  .update({ continuity_context: continuityContext })
                  .eq('id', meeting.id)
                console.log(`  ✓ Continuity context generated for "${meeting.title}" (series: ${seriesKey})`)
              }
            }
          }
        } catch (continuityErr) {
          console.log(`  ⚠ Continuity context error for ${meeting.title}: ${continuityErr.message}`)
        }

        // ── Speaker attributions — always write, Ryan resolves in frontend ──
        for (const s of (intel?.speaker_attributions || [])) {
          if (!s.speaker_label || !s.likely_person) continue
          const { data: existSA } = await supabase
            .from('speaker_attributions')
            .select('id')
            .eq('meeting_id', meeting.id)
            .eq('speaker_label', s.speaker_label)
            .maybeSingle()
          if (!existSA) {
            const nameParts = (s.likely_person || '').trim().split(/\s+/)
            const { data: contact } = nameParts.length > 1
              ? await supabase.from('contacts').select('id, email')
                  .ilike('name', `%${nameParts[nameParts.length - 1]}%`).maybeSingle()
              : { data: null }
            await supabase.from('speaker_attributions').insert({
              meeting_id:               meeting.id,
              speaker_label:            s.speaker_label,
              attributed_to_name:       s.likely_person,
              attributed_to_email:      contact?.email || null,
              attributed_to_contact_id: contact?.id || null,
              confidence:               s.confidence || 'medium',
              attribution_basis:        s.basis ? [s.basis] : [],
              confirmed_by_ryan:        false,
            })
          }
        }

        // Mark meeting as processed — save summary, outcome, and cached intel
        const meetingFinalUpdate = {
          intelligence_extracted:  true,
          commitments_extracted:   true,
          extraction_date:         today,
          extracted_intelligence:  intel || null,  // cache full extraction for later project assignment
          needs_ai_reprocess:      false,          // clear reprocess flag
          last_ai_processed_at:    new Date().toISOString(),
        }
        // Save narrative summary from meeting_outcome (the comprehensive one)
        if (intel?.meeting_outcome?.summary && !meeting.summary) {
          meetingFinalUpdate.summary = intel.meeting_outcome.summary
        }
        if (intel?.meeting_outcome?.summary && (!meeting.short_summary || meeting.short_summary.length < 100)) {
          meetingFinalUpdate.short_summary = intel.meeting_outcome.summary  // full text — no truncation
        }
        await supabase
          .from('meeting_notes')
          .update(meetingFinalUpdate)
          .eq('id', meeting.id)

        // ── Secondary category → topic pod routing ──────────────────────────
        // For each secondary category that has a linked topic pod, run a
        // lightweight focused extraction and route the result into the pod.
        if (intel) {
          try {
            const { data: secondaryRows } = await supabase
              .from('meeting_note_categories')
              .select('category_id')
              .eq('meeting_note_id', meeting.id)

            if (secondaryRows?.length > 0) {
              const secondaryCatIds = secondaryRows.map(r => r.category_id)

              // Also check primary category for pod routing
              if (meeting.primary_category_id) secondaryCatIds.push(meeting.primary_category_id)

              const { data: linkedPods } = await supabase
                .from('topic_pods')
                .select('id, name, category_id')
                .in('category_id', secondaryCatIds)
                .eq('status', 'active')

              for (const pod of (linkedPods || [])) {
                const cat = categoryMap.get(pod.category_id)
                if (!cat) continue

                // Skip if this meeting already has content routed to this pod
                const { data: existing } = await supabase
                  .from('topic_pod_content')
                  .select('id')
                  .eq('pod_id', pod.id)
                  .eq('meeting_note_id', meeting.id)
                  .maybeSingle()
                if (existing) continue

                const secondaryCategoryHint = `\n\nCATEGORY FOCUS: ${cat.name}${cat.description ? ` — ${cat.description}` : ''}.\nFocus areas for ${cat.name}:\n${getCategoryExtractionHints(cat.name)}`

                const focusResult = await aiService.extractCategoryFocusFromIntel(
                  meeting, intel, cat.name, secondaryCategoryHint
                )

                if (focusResult?.bullets?.length > 0) {
                  await supabase.from('topic_pod_content').insert({
                    pod_id:           pod.id,
                    content_type:     'meeting_extract',
                    title:            focusResult.title,
                    raw_text:         focusResult.raw_text,
                    extracted_points: focusResult.bullets.map(b => ({
                      point:        b.point,
                      significance: b.significance || 'medium',
                      tags:         [cat.name],
                    })),
                    source_label:    `Meeting: ${meeting.title || 'Untitled'}`,
                    meeting_note_id: meeting.id,
                  })

                  // Touch pod updated_at so it shows as recently active
                  await supabase
                    .from('topic_pods')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', pod.id)

                  console.log(`    → Routed [${cat.name}] extract to pod: "${pod.name}"`)
                }
              }
            }
          } catch (podErr) {
            console.log(`    ⚠ Pod routing error: ${podErr.message}`)
          }
        }

        results.plaud_meetings_processed++
      } catch (err) {
        results.errors.push(`Plaud ${meeting.id}: ${err.message}`)
      }
    }

    console.log(
      `  ✓ Plaud: ${results.plaud_meetings_processed} meetings, ` +
      `${results.plaud_tasks_created} tasks, ` +
      `${results.plaud_my_commitments} my commitments, ` +
      `${results.plaud_others_created} others`
    )
    // If Step 2.6 processed meetings, mark Plaud leg as active for three-leg synthesis
    // (Step 2.4 only sets this when loading NEW meetings; meetings already in DB also count)
    if (results.plaud_meetings_processed > 0) legStatus.plaud = true
  } catch (err) {
    results.errors.push(`Plaud processing: ${err.message}`)
    console.log(`  ✗ Plaud error: ${err.message}`)
  }

  // Step 2.6 complete — legStatus.plaud is now set for Step 3.9 below.
  // ── RESUME GUARD 2: skip Steps 3.9–4.5 when resuming ──────────────────────
  // Step 2.6 above always runs. Steps 3.9–4.5 were already completed
  // in the prior run and don't need to repeat on a resume.
  stepsObsToFour: {
    if (RESUME_FROM_STEP >= 3) {
      console.log(`⏭  RESUME_FROM_STEP=${RESUME_FROM_STEP}: Skipping Steps 3.9–4.5 observations/tasks (already completed)`)
      break stepsObsToFour
    }

  // ── STEP 3.9: Extract daily observations — unified three-leg synthesis ────
  // Three-legged stool: Email + Plaud + Manual. Synthesizes ALL available legs.
  // If one leg is missing today (e.g. email pull crashed), uses what the others provide.
  // Writes atomic factual observations to the observations table.
  // These feed back into buildRyanContext() as accumulated institutional memory.
  console.log('Step 3.9: Extracting daily observations (three-leg synthesis)...')
  console.log(`  Legs available today — Email: ${legStatus.email}, Plaud: ${legStatus.plaud}, Manual: ${legStatus.manual}`)
  try {
    // ── Leg 1: Email signals ──
    const emailObsContext = legStatus.email
      ? (activeEmails || []).slice(0, 15).map(e => {
          const summary = e.ai_summary || e.body_preview || ''
          return `Thread: ${e.thread_subject || e.subject}\nFrom: ${e.from_name || e.from_address}\nBucket: ${e.bucket} | Urgency: ${e.urgency} | Days waiting: ${e.days_waiting || 0}\nSummary: ${summary.slice(0, 300)}`
        }).join('\n\n---\n\n')
      : null

    // ── Leg 2: Plaud/meeting signals ──
    const { data: recentMeetingsObs } = await supabase
      .from('meeting_notes')
      .select('title, short_summary, action_items_raw, participants, start_time')
      .gte('start_time', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order('start_time', { ascending: false })
      .limit(6)

    const plaudObsContext = (recentMeetingsObs || []).length > 0
      ? recentMeetingsObs.map(m => {
          const date = (m.start_time || '').split('T')[0]
          const people = (m.participants || []).slice(0, 6).join(', ')
          const actions = (m.action_items_raw || []).slice(0, 5)
            .map(a => `  - ${a.assignee_name || 'Unassigned'}: ${a.task_text}`).join('\n')
          return `Meeting: ${m.title} [${date}]\nAttendees: ${people}\nSummary: ${(m.short_summary || '').slice(0, 300)}${actions ? '\nActions:\n' + actions : ''}`
        }).join('\n\n---\n\n')
      : null

    // ── Leg 3: Manual signals — Ryan's own inputs ──
    const { data: recentManualObs } = await supabase
      .from('observations')
      .select('content, source_type, created_at')
      .eq('source_type', 'manual')
      .order('created_at', { ascending: false })
      .limit(10)

    const { data: openStrategicDecs } = await supabase
      .from('strategic_decisions')
      .select('decision, why, expected_outcome, category, decided_on')
      .in('status', ['open', 'monitoring'])
      .order('decided_on', { ascending: false })
      .limit(8)

    const manualObsContext = [
      recentManualObs?.length
        ? 'RYAN\'S MANUAL OBSERVATIONS (last 10):\n' +
          recentManualObs.map(o => `- [${(o.created_at || '').split('T')[0]}] ${o.content}`).join('\n')
        : null,
      openStrategicDecs?.length
        ? 'RYAN\'S OPEN STRATEGIC DECISIONS:\n' +
          openStrategicDecs.map(d => `- ${d.decision}${d.why ? ' — Why: ' + d.why.slice(0, 100) : ''}`).join('\n')
        : null
    ].filter(Boolean).join('\n\n')

    const hasAnyContext = emailObsContext || plaudObsContext || manualObsContext

    if (hasAnyContext) {
      // Build the unified three-leg prompt — note which legs are present
      const legLabels = [
        legStatus.email ? 'Email' : null,
        legStatus.plaud ? 'Plaud meetings' : null,
        'Manual inputs'
      ].filter(Boolean).join(' + ')

      const obsPrompt = `You are extracting atomic observations from Ryan Hankins' day. Ryan is a Project Executive at Clayco (commercial construction GC) — design-build, large industrial and commercial projects.

Today's intelligence comes from ${legLabels}. Synthesize across ALL legs — the most valuable observations often connect what was discussed in a meeting to what's pending in email, or validate a past observation with new evidence.

Extract 4-6 specific, factual observations Ryan should retain permanently. These are NOT tasks — they are patterns, insights, and learnings about people, clients, projects, or how this business works.

Good observation examples:
- "ABB/Sofidel team escalates quickly on schedule items — two emails and a follow-up call within 48h of any delay signal"
- "Data center developers consistently prioritize speed-to-revenue over first cost — scope expansions get faster approval than cost savings"
- "Owner decision latency on scope changes is running 12+ days across three active projects — budget approvals are the bottleneck, not technical review"
- "J. Miller raised scope concerns in email AND the OAC call this week — pattern suggests he's building a paper trail before a formal dispute"

Bad observations (too generic, do not produce these):
- "Ryan had several emails today"
- "There are open items on multiple projects"
- "Meeting was held about project X"

${emailObsContext ? `\n═══ LEG 1: EMAIL ═══\n${emailObsContext}` : '\n[Email leg unavailable today — email pull did not complete]'}

${plaudObsContext ? `\n═══ LEG 2: PLAUD MEETINGS ═══\n${plaudObsContext}` : '\n[Plaud leg unavailable today — no meetings recorded]'}

${manualObsContext ? `\n═══ LEG 3: MANUAL INPUTS ═══\n${manualObsContext}` : ''}

Return a JSON array of observation strings only. No explanation.
["Observation 1", "Observation 2", "Observation 3", "Observation 4"]`

      const obsClient = makeAnthropic()
      const raw = await obsClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: obsPrompt }]
      })

      const text = raw.content[0]?.text?.trim() || '[]'
      let observations = []
      try {
        const match = text.match(/\[[\s\S]*\]/)
        if (match) observations = JSON.parse(match[0])
      } catch { /* skip on parse error */ }

      let obsCount = 0
      for (const content of observations) {
        if (!content || typeof content !== 'string' || content.length < 20) continue
        const { error } = await supabase
          .from('observations')
          .insert({ content: content.trim(), source_type: 'ai_nightly' })
        if (!error) obsCount++
      }
      console.log(`  ✓ ${obsCount} observations extracted (${legLabels})`)
    } else {
      console.log('  — No context available across any leg for observation extraction')
    }
  } catch (err) {
    results.errors.push(`Observation extraction: ${err.message}`)
    console.log(`  ✗ Observation extraction error: ${err.message}`)
  }

  // ── STEP 4: Extract tasks ───────────────────────────────────────
  console.log('Step 4: Extracting tasks...')
  const bucket1 = (activeEmails || []).filter(e => e.bucket === 1)

  for (const email of bucket1) {
    try {
      // Phase 1B fast path: if classify pre-extracted Ryan's action items for this thread,
      // skip the Haiku extractTasks call entirely. Falls back to Haiku when no p1b data.
      const p1bData = phase1bIndex.get((email.conversation_id || '').toLowerCase())
      let tasks
      if (p1bData?.action_items?.some(a => a.owner === 'ryan')) {
        tasks = p1bData.action_items
          .filter(a => a.owner === 'ryan')
          .map(a => ({
            title:                  a.text,
            urgency:                'medium',
            due_date:               a.due_date || null,
            attribution_confidence: a.confidence || 0.85,
          }))
      } else {
        const threadHistory = await getThreadHistory(email)
        tasks = await aiService.extractTasks(email, threadHistory, existingTasksContext)
      }

      for (const task of tasks) {
        // Level 1: exact title match
        const { data: exactTask } = await supabase
          .from('tasks')
          .select('id, source_type')
          .eq('title', task.title)
          .eq('status', 'open')
          .maybeSingle()

        let existing = exactTask

        // Level 2: semantic similarity (keyword overlap)
        if (!existing) {
          const keyWords = task.title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 4)

          if (keyWords.length >= 2) {
            const { data: candidates } = await supabase
              .from('tasks')
              .select('id, title, source_type')
              .eq('status', 'open')
              .ilike('title', `%${keyWords[0]}%`)

            for (const candidate of (candidates || [])) {
              const candidateWords = candidate.title
                .toLowerCase().split(' ')
                .filter(w => w.length > 4)
              const overlap = keyWords.filter(w =>
                candidateWords.some(cw => cw.includes(w) || w.includes(cw))
              ).length

              if (overlap >= 3) {
                existing = candidate
                break
              }
            }
          }
        }

        if (!existing) {
          const projectId = await findProjectByKeywords(email.thread_subject)

          const { data: newEmailTask } = await supabase.from('tasks').insert({
            ...task,
            status: 'open',
            source: 'email',
            source_type: 'ai_email',
            source_id: email.id,
            source_label: email.thread_subject,
            source_date: today,
            ai_enriched: true,
            source_confidence: 0.85,
            project_id: projectId || null
          }).select('id').single()
          results.tasks_created++

          if (newEmailTask?.id) {
            try {
              await supabase.from('work_item_sources').insert({
                work_item_id:   newEmailTask.id,
                work_item_type: 'task',
                source_type:    'ai_email',
                source_id:      email.id,
                source_label:   email.thread_subject,
                excerpt:        task.title,
                confidence:     'high',
              })
            } catch (_) {}
          }
        } else if (existing.source_type && existing.source_type !== 'ai_email') {
          // CHANGE 5: Cross-source enrichment — same task seen from a different source
          // Patch cross_references on existing item instead of silently skipping
          try {
            const { data: fullTask } = await supabase
              .from('tasks')
              .select('cross_references')
              .eq('id', existing.id)
              .single()
            const crossRefs = fullTask?.cross_references || []
            const alreadyCrossReferenced = crossRefs.some(
              r => r.source_label === email.thread_subject
            )
            if (!alreadyCrossReferenced) {
              crossRefs.push({
                source_type: 'ai_email',
                source_label: email.thread_subject,
                date: today
              })
              await supabase
                .from('tasks')
                .update({ cross_references: crossRefs })
                .eq('id', existing.id)
            }
          } catch (err) { /* non-fatal */ }
        }
      }
    } catch (err) {
      results.errors.push(`Tasks: ${err.message}`)
    }
  }
  console.log(`  ✓ Tasks: ${results.tasks_created} created`)

  // ── STEP 4.5: Refresh stale open items ──────────────────────────
  // For every active email thread, find open tasks + commitments linked to it
  // that are 3+ days old and re-evaluate urgency/due_date/context.
  // Also detect re-opens: completed tasks whose thread has new activity.
  console.log('Step 4.5: Refreshing stale open items...')
  let refreshed = 0
  let reopened  = 0

  try {
    for (const email of (activeEmails || [])) {
      try {
        // Any open task/commitment linked to an active thread refreshes every night.
        // No age threshold — if the thread is in today's active email set, update it.

        // ── Find open tasks linked to this thread ──
        const { data: staleTasks } = await supabase
          .from('tasks')
          .select('id, title, urgency, due_date, context, ai_context, user_modified, source_date, created_at, updated_at')
          .eq('status', 'open')
          .eq('source_label', email.thread_subject)

        if (staleTasks?.length) {
          const threadHistory = await getThreadHistory(email)
          for (const task of staleTasks) {
            const refresh = await aiService.refreshStaleItem(task, email, threadHistory)
            if (refresh?.changed) {
              const patch = {
                // Only update user-facing fields if user hasn't manually edited them
                ...(task.user_modified ? {} : {
                  urgency:  refresh.urgency  || task.urgency,
                  due_date: refresh.due_date ?? task.due_date,
                }),
                // AI context always goes to ai_context — never overwrites user's context field
                ai_context:           refresh.context              || task.ai_context || null,
                ai_suggests_complete: refresh.ai_suggests_complete || false,
                fulfillment_evidence: refresh.fulfillment_evidence || null,
                source_date:          today
              }
              await supabase.from('tasks').update(patch).eq('id', task.id)
              refreshed++
            }
          }
        }

        // ── Find open others_commitments linked to this thread ──
        const { data: staleCommitments } = await supabase
          .from('others_commitments')
          .select('id, title, urgency, due_date, context, ai_context, user_modified, source_date, created_at, delivery_type')
          .eq('status', 'open')
          .eq('source_label', email.thread_subject)

        if (staleCommitments?.length) {
          const threadHistory = await getThreadHistory(email)
          for (const c of staleCommitments) {
            const refresh = await aiService.refreshStaleItem(c, email, threadHistory)
            if (refresh?.changed) {
              const patch = {
                // Only update user-facing fields if user hasn't manually edited them
                ...(c.user_modified ? {} : {
                  urgency:  refresh.urgency  || c.urgency,
                  due_date: refresh.due_date ?? c.due_date,
                }),
                // AI context always goes to ai_context
                ai_context:           refresh.context              || c.ai_context || null,
                ai_suggests_complete: refresh.ai_suggests_complete || false,
                fulfillment_evidence: refresh.fulfillment_evidence || null,
                source_date:          today
              }
              await supabase.from('others_commitments').update(patch).eq('id', c.id)
              refreshed++
            }
          }
        }

        // ── Re-open detection: completed task + thread has new activity ──
        // If a task was completed but the same thread is now back in bucket 1,
        // create a NEW follow-up task rather than re-opening the old one.
        if (email.bucket === 1) {
          const { data: completedTask } = await supabase
            .from('tasks')
            .select('id, title, updated_at')
            .eq('status', 'complete')
            .eq('source_label', email.thread_subject)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (completedTask) {
            // Thread has activity after the task was completed — check if new enough to matter
            const taskCompletedAt  = new Date(completedTask.updated_at)
            const emailReceivedAt  = email.received_at ? new Date(email.received_at) : null
            if (emailReceivedAt && emailReceivedAt > taskCompletedAt) {
              // New activity on a completed thread — check if it's already been re-created
              const { data: existingReopen } = await supabase
                .from('tasks')
                .select('id')
                .eq('status', 'open')
                .eq('source_label', email.thread_subject)
                .maybeSingle()

              if (!existingReopen) {
                const projectId = await findProjectByKeywords(email.thread_subject)
                await supabase.from('tasks').insert({
                  title:            `Follow-up: ${email.thread_subject}`,
                  context:          `Thread re-activated after prior task completed. New activity from ${email.from_name}.`,
                  urgency:          email.urgency || 'high',
                  status:           'open',
                  source:           'email',
                  source_type:      'ai_email',
                  source_id:        email.id,
                  source_label:     email.thread_subject,
                  source_date:      today,
                  ai_enriched:      false,
                  source_confidence: 0.7,
                  project_id:       projectId || null
                })
                reopened++
              }
            }
          }
        }

      } catch (err) { /* non-fatal per email */ }
    }
  } catch (err) {
    results.errors.push(`Refresh stale: ${err.message}`)
  }

  results.tasks_enriched += refreshed
  console.log(`  ✓ Refreshed: ${refreshed} stale items updated, ${reopened} re-opened threads flagged`)

  } // end stepsObsToFour — Steps 3.9–4.5 resume guard

  // ── STEP 5: Extract commitments ─────────────────────────────────
  console.log('Step 5: Extracting commitments...')
  for (const email of (activeEmails || [])) {
    try {
      // Phase 1B fast path: classify pre-extracts others' commitments from two fields:
      //   action_items[owner="other"] — explicit asks directed at non-Ryan people
      //   commitments[]              — explicit promises made by others ("I'll send X by Y")
      // Fetch threadHistory lazily: only when Haiku path needed OR bucket2 myC needed.
      const p1bData = phase1bIndex.get((email.conversation_id || '').toLowerCase())
      const hasOthersP1b = !!(p1bData && (
        p1bData.action_items?.some(a => a.owner === 'other') ||
        p1bData.commitments?.length
      ))

      // Fetch thread history once, only when needed
      let threadHistory = null
      if (!hasOthersP1b || email.bucket === 2) {
        threadHistory = await getThreadHistory(email)
      }

      // Others' commitments
      let othersC
      if (hasOthersP1b) {
        const fromActions = (p1bData.action_items || [])
          .filter(a => a.owner === 'other')
          .map(a => ({
            title:                a.text,
            committed_by_name:    a.owner_name  || null,
            committed_by_email:   a.owner_email || null,
            due_date:             a.due_date    || null,
            urgency:              'medium',
            context:              null,
            ai_suggests_complete: false,
            delivery_type:        'general',
          }))
        const fromCommitments = (p1bData.commitments || [])
          .map(c => ({
            title:                c.text,
            committed_by_name:    c.made_by_name  || null,
            committed_by_email:   c.made_by_email || null,
            due_date:             c.due_date      || null,
            urgency:              'medium',
            context:              null,
            ai_suggests_complete: false,
            delivery_type:        'general',
          }))
        othersC = [...fromActions, ...fromCommitments]
      } else {
        othersC = await aiService.extractOthersCommitments(email, threadHistory, existingOthersContext)
      }

      for (const c of othersC) {
        // Level 1: exact match (title + email)
        const { data: exactMatch } = await supabase
          .from('others_commitments')
          .select('id, source_type')
          .eq('title', c.title)
          .eq('committed_by_email', c.committed_by_email)
          .eq('status', 'open')
          .maybeSingle()

        let existing = exactMatch

        // Level 2: semantic similarity check (same person, overlapping keywords)
        if (!existing && c.committed_by_email) {
          const keyWords = c.title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(' ')
            .filter(w => w.length > 4)
            .slice(0, 4)

          if (keyWords.length >= 2) {
            const { data: candidates } = await supabase
              .from('others_commitments')
              .select('id, title, source_type')
              .eq('status', 'open')
              .eq('committed_by_email', c.committed_by_email)
              .ilike('title', `%${keyWords[0]}%`)

            for (const candidate of (candidates || [])) {
              const candidateWords = candidate.title
                .toLowerCase().split(' ')
                .filter(w => w.length > 4)
              const overlap = keyWords.filter(w =>
                candidateWords.some(cw => cw.includes(w) || w.includes(cw))
              ).length

              if (overlap >= 3) {
                existing = candidate
                break
              }
            }
          }
        }

        if (!existing) {
          const projectId = await findProjectByKeywords(email.thread_subject)
          let emailContactId = null
          if (c.committed_by_email) {
            const { data: ec } = await supabase.from('contacts').select('id')
              .ilike('email', c.committed_by_email).maybeSingle()
            emailContactId = ec?.id || null
          }

          const { data: newCommitment } = await supabase.from('others_commitments').insert({
            committed_by_name: c.committed_by_name,
            committed_by_email: c.committed_by_email,
            contact_id: emailContactId,
            title: c.title,
            context: c.context,
            due_date: c.due_date,
            urgency: c.urgency,
            source_type: 'ai_email',
            source_id: email.id,
            source_label: email.thread_subject,
            ai_suggests_complete: c.ai_suggests_complete || false,
            fulfillment_evidence: c.fulfillment_evidence || null,
            status: 'open',
            project_id: projectId || null,
            delivery_type: c.delivery_type || 'general'
          }).select('id').single()
          results.others_commitments_extracted++

          if (newCommitment?.id) {
            try {
              await supabase.from('work_item_sources').insert({
                work_item_id:   newCommitment.id,
                work_item_type: 'commitment',
                source_type:    'ai_email',
                source_id:      email.id,
                source_label:   email.thread_subject,
                excerpt:        c.title,
                confidence:     'high',
              })
            } catch (_) {}
          }
        } else if (existing && existing.source_type && existing.source_type !== 'ai_email' && !c.ai_suggests_complete) {
          // CHANGE 5: Cross-source enrichment for others_commitments
          try {
            const { data: fullC } = await supabase
              .from('others_commitments')
              .select('cross_references')
              .eq('id', existing.id)
              .single()
            const crossRefs = fullC?.cross_references || []
            const alreadyCrossReferenced = crossRefs.some(
              r => r.source_label === email.thread_subject
            )
            if (!alreadyCrossReferenced) {
              crossRefs.push({
                source_type: 'ai_email',
                source_label: email.thread_subject,
                date: today
              })
              await supabase
                .from('others_commitments')
                .update({ cross_references: crossRefs })
                .eq('id', existing.id)
            }
          } catch (err) { /* non-fatal */ }
        } else if (c.ai_suggests_complete) {
          // Suggest completion — don't auto-complete
          await supabase
            .from('others_commitments')
            .update({
              ai_suggests_complete: true,
              fulfillment_evidence: c.fulfillment_evidence,
              ai_suggestion_date: today
            })
            .eq('id', existing.id)

          // Log question for Ryan to confirm
          await logAIQuestion(
            `${c.committed_by_name} appears to have fulfilled their commitment: "${c.title}". Mark it complete?`,
            c.fulfillment_evidence || '',
            'binary'
          )
          results.questions_logged++
        }
      }

      // My commitments (from Bucket 2 sent body) — no Phase 1B fast path yet
      // threadHistory is guaranteed loaded above for bucket === 2 regardless of hasOthersP1b
      if (email.bucket === 2) {
        const myC = await aiService.extractMyCommitments(email, threadHistory, existingMineContext)

        for (const c of myC) {
          const { data: existing } = await supabase
            .from('commitments')
            .select('id')
            .eq('title', c.title)
            .eq('status', 'open')
            .maybeSingle()

          if (!existing) {
            const projectId = await findProjectByKeywords(email.thread_subject)

            await supabase.from('commitments').insert({
              title: c.title,
              made_to: c.made_to,
              urgency: c.urgency,
              due_date: c.due_date,
              status: 'open',
              source_type: 'ai_email',
              commitment_type: c.commitment_type || 'hard',
              condition_text: c.condition_text || null,
              implicit: c.implicit || false,
              made_on: today,
              project_id: projectId || null
            })
            results.my_commitments_extracted++
          }
        }
      }
    } catch (err) {
      results.errors.push(`Commitments: ${err.message}`)
    }
  }
  console.log(
    `  ✓ Commitments: ${results.my_commitments_extracted} mine, ` +
    `${results.others_commitments_extracted} others`
  )

  // ── STEP 5.45: Auto-link waiting_on emails → others_commitments ──
  // For each email Ryan marked as waiting_on that doesn't already have
  // a linked others_commitment, extract WHO and WHAT via Haiku and
  // create the commitment automatically (high confidence only).
  console.log('Step 5.45: Linking waiting_on emails to others_commitments...')
  try {
    const { data: waitingEmails } = await supabase
      .from('emails')
      .select(
        'id, thread_subject, from_name, from_address, action_needed, ' +
        'ai_summary, full_thread_content, body_preview, sent_body, ' +
        'thread_participants, days_waiting, waiting_since, email_category'
      )
      .eq('status', 'waiting_on')
      .not('bucket', 'eq', 5)
      .order('days_waiting', { ascending: false })
      .limit(60)

    const haikuLink = makeAnthropic()
    let linked = 0

    for (const email of (waitingEmails || [])) {
      try {
        // Skip if already has a linked others_commitment
        const { data: existing } = await supabase
          .from('others_commitments')
          .select('id')
          .eq('source_id', email.id)
          .eq('status', 'open')
          .maybeSingle()
        if (existing) continue

        // Skip large group threads (>5 participants) — can't assign to one person
        const participants = email.thread_participants || []
        if (participants.length > 5) continue

        // Skip internal-only threads
        const internalDomains = ['claycorp', 'theljc', 'realcrg', 'concretestrategies', 'ventana']
        const isFullyInternal = participants.every(p =>
          internalDomains.some(d => (p || '').toLowerCase().includes(d))
        )
        if (isFullyInternal) continue

        const content = email.sent_body || email.full_thread_content || email.action_needed || email.body_preview || ''

        const prompt = `Ryan Hankins sent an email and is now waiting for a response or deliverable.

Thread: "${email.thread_subject || 'unknown'}"
From (original sender/recipient): ${email.from_name || email.from_address || 'unknown'}
Participants: ${participants.slice(0, 6).join(', ') || 'unknown'}
Days waiting: ${email.days_waiting || 0}
AI action needed: ${email.action_needed || 'none'}

Email content:
${content.slice(0, 2000)}

Determine:
1. Who SPECIFICALLY is Ryan waiting on? (name + email if visible)
2. What EXACTLY do they need to deliver?
3. Is there a deadline mentioned?
4. How confident are you that this is ONE specific person's responsibility?

Rules:
- If multiple people share the responsibility equally, confidence = low
- If it's a large group/committee decision, confidence = low
- If one person is clearly the owner, confidence = high
- If someone specific was asked but it's not 100% clear, confidence = medium

Respond ONLY with valid JSON:
{
  "confident_owner": true,
  "confidence": "high|medium|low",
  "person_name": "Full Name or null",
  "person_email": "email@domain.com or null",
  "what_they_owe": "Specific one-sentence description of what Ryan is waiting to receive",
  "deadline": "YYYY-MM-DD or null",
  "reason": "one sentence why this is or isn't assignable to one person"
}`

        const msg = await haikuLink.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 250,
          messages:   [{ role: 'user', content: prompt }]
        })

        let verdict
        try {
          const raw = (msg.content[0]?.text || '').trim()
          const jsonMatch = raw.match(/\{[\s\S]*\}/)
          verdict = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
        } catch { continue }

        // Only auto-create for high confidence with a named person
        if (verdict?.confidence !== 'high' || !verdict?.what_they_owe) continue
        if (!verdict.person_name && !verdict.person_email) continue

        const projectId = await findProjectByKeywords(email.thread_subject)

        // Also check by person+title to prevent cross-step duplication
        const { data: titleMatch } = await supabase
          .from('others_commitments')
          .select('id')
          .eq('status', 'open')
          .ilike('title', `%${verdict.what_they_owe.slice(0, 30)}%`)
          .eq('committed_by_email', verdict.person_email || email.from_address || '')
          .maybeSingle()
        if (titleMatch) continue

        const personEmail3 = verdict.person_email || email.from_address || null
        let verdictContactId = null
        if (personEmail3) {
          const { data: vc } = await supabase.from('contacts').select('id')
            .ilike('email', personEmail3).maybeSingle()
          verdictContactId = vc?.id || null
        }

        await supabase.from('others_commitments').insert({
          committed_by_name:  verdict.person_name  || email.from_name  || 'Unknown',
          committed_by_email: personEmail3,
          contact_id:         verdictContactId,
          title:              verdict.what_they_owe,
          context:            `Waiting since email: "${email.thread_subject}"${email.days_waiting > 0 ? ` (${email.days_waiting}d)` : ''}`,
          due_date:           verdict.deadline || null,
          urgency:            email.days_waiting >= 7 ? 'high' : email.days_waiting >= 3 ? 'medium' : 'normal',
          source_type:        'ai_email',
          source_id:          email.id,
          source_label:       email.thread_subject,
          status:             'open',
          project_id:         projectId || null,
          delivery_type:      'to_ryan',
        })

        // Flag the email so UI knows it's tracked in Others
        await supabase
          .from('emails')
          .update({ has_linked_commitment: true })
          .eq('id', email.id)

        linked++
        console.log(`  ✓ Linked: "${verdict.what_they_owe}" ← ${verdict.person_name || email.from_name}`)

      } catch (linkErr) {
        // Non-fatal
      }
    }

    console.log(`  ✓ Waiting_on linking: ${linked} others_commitments auto-created`)
  } catch (linkStepErr) {
    console.log(`  ✗ Waiting_on linking error: ${linkStepErr.message}`)
  }

  // ── STEP 5.5: Cross-reference synthesis ────────────────────────
  console.log('Step 5.5: Cross-referencing sources...')
  try {
    const { data: plaudItems } = await supabase
      .from('tasks')
      .select('*')
      .in('source_type', ['ai_otter', 'ai_plaud'])
      .eq('source_date', today)
      .limit(20)

    const { data: plaudCommitments } = await supabase
      .from('commitments')
      .select('*')
      .in('source_type', ['ai_otter', 'ai_plaud'])
      .eq('made_on', today)
      .limit(10)

    const { data: recentEmails } = await supabase
      .from('emails')
      .select('id, thread_subject, from_name, ai_summary, body_preview, received_at')
      .in('bucket', [1, 2])
      .limit(20)

    const allPlaudItems = [
      ...(plaudItems || []),
      ...(plaudCommitments || [])
    ]

    for (const item of allPlaudItems) {
      const titleWords = (item.title || '')
        .toLowerCase()
        .split(' ')
        .filter(w => w.length > 4)
        .slice(0, 4)

      const relatedEmails = (recentEmails || []).filter(email => {
        const subject = (email.thread_subject || '').toLowerCase()
        return titleWords.some(w => subject.includes(w))
      })

      if (relatedEmails.length > 0) {
        const refs = relatedEmails.map(e => ({
          source_type:    'email',
          source_label:   e.thread_subject,
          reference_type: 'related',
          context:        e.ai_summary || e.body_preview,
          date:           e.received_at?.split('T')[0],
          confidence:     'medium'
        }))

        const table = item.made_on ? 'commitments' : 'tasks'

        await supabase
          .from(table)
          .update({ cross_references: refs })
          .eq('id', item.id)

        results.cross_refs_created += refs.length
      }
    }

    console.log(`  ✓ Cross-references: ${results.cross_refs_created}`)
  } catch (err) {
    // Non-fatal
    console.log(`  Cross-ref error: ${err.message}`)
  }

  // ── STEP 6: Enrich manual tasks ─────────────────────────────────
  console.log('Step 6: Enriching manual tasks...')
  const { data: manualTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('source_type', 'manual')
    .eq('ai_enriched', false)
    .eq('status', 'open')
    .limit(10)

  for (const task of (manualTasks || [])) {
    try {
      const keywords = task.title
        .split(' ')
        .filter(w => w.length > 4)
        .slice(0, 3)

      const { data: relatedEmails } = await supabase
        .from('emails')
        .select('thread_subject, body_preview, from_name, ai_summary')
        .or(keywords.map(k => `thread_subject.ilike.%${k}%`).join(','))
        .limit(3)

      if (relatedEmails?.length > 0) {
        const enriched = await aiService.enrichTask(task, relatedEmails)
        await supabase
          .from('tasks')
          .update({
            ai_context: enriched,
            ai_enriched: true
          })
          .eq('id', task.id)
        results.tasks_enriched++
      }
    } catch (err) {
      // Non-fatal
    }
  }
  console.log(`  ✓ Enriched ${results.tasks_enriched} tasks`)

  // ── STEP 7: Pre-meeting briefs ──────────────────────────────────
  console.log('Step 7: Pre-meeting briefs...')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('*')
    .gte('start_time', `${today}T00:00:00Z`)
    .lte('start_time', `${tomorrowStr}T23:59:59Z`)
    .order('start_time', { ascending: true })

  for (const event of (upcomingEvents || [])) {
    try {
      const { data: relatedEmails } = await supabase
        .from('emails')
        .select('*')
        .in('status', ['needs_reply', 'waiting_on'])
        .limit(5)

      const stakeCheck = await aiService.detectHighStakesMeeting(
        event, relatedEmails || []
      )

      // Update event — targeted update only
      // Does not overwrite existing AI fields
      await supabase
        .from('events')
        .update({
          high_stakes: stakeCheck.high_stakes,
          stakes_reason: stakeCheck.reason,
          preparation_required: stakeCheck.preparation_required
        })
        .eq('id', event.id)

      if (stakeCheck.high_stakes) {
        results.high_stakes_meetings_detected++
      }

      // Generate brief for ALL upcoming events with attendees, not just high-stakes.
      // Skip if brief already exists AND no pre_meeting_notes have changed.
      const hasAttendees = (event.attendees || []).length > 0
      const briefExists  = !!event.body
      const hasPreNotes  = !!event.pre_meeting_notes

      if (hasAttendees && (!briefExists || hasPreNotes)) {
        const { data: openTasks } = await supabase
          .from('tasks')
          .select('title, urgency')
          .eq('status', 'open')
          .limit(5)

        const { data: projectCtx } = await supabase
          .from('ai_context')
          .select('content')
          .eq('context_type', 'rolling_summary')
          .eq('subject_type', 'global')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Look up continuity_context from recurring meeting series
        // Compute series key from event title using same normalization logic
        let continuityCtxForBrief = null
        try {
          const eventSeriesKey = (event.title || '').toLowerCase()
            .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
            .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(,? \d{4})?\b/gi, '')
            .replace(/\b\d{4}\b/g, '')
            .replace(/\b\d+\b/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim()

          if (eventSeriesKey.length > 3) {
            const { data: priorMeetingWithContinuity } = await supabase
              .from('meeting_notes')
              .select('continuity_context, title, start_time')
              .eq('recurring_series_key', eventSeriesKey)
              .not('continuity_context', 'is', null)
              .order('start_time', { ascending: false })
              .limit(1)
              .maybeSingle()
            continuityCtxForBrief = priorMeetingWithContinuity?.continuity_context || null
          }
        } catch (ctxErr) {
          // Non-fatal
        }

        // Append continuity context to pre_meeting_notes if found
        const enrichedPreNotes = [
          event.pre_meeting_notes,
          continuityCtxForBrief ? `\n\n=== RECURRING MEETING CONTEXT ===\n${continuityCtxForBrief}` : null
        ].filter(Boolean).join('') || null

        const brief = await aiService.generatePreMeetingBrief(
          event,
          relatedEmails || [],
          openTasks || [],
          projectCtx?.content || null,
          enrichedPreNotes
        )
        await supabase
          .from('events')
          .update({ body: brief })
          .eq('id', event.id)
        results.pre_meeting_briefs++
      }
    } catch (err) {
      results.errors.push(`Brief ${event.title}: ${err.message}`)
    }
  }
  console.log(
    `  ✓ Briefs: ${results.pre_meeting_briefs} generated, ` +
    `${results.high_stakes_meetings_detected} high-stakes detected`
  )

  // ── STEP 8: Contact profiles ────────────────────────────────────
  console.log('Step 8: Updating contact profiles...')
  const { data: activeContacts } = await supabase
    .from('contacts')
    .select('*')
    .order('last_contact_date', { ascending: false })
    .limit(10)

  for (const contact of (activeContacts || [])) {
    try {
      const { data: interactions } = await supabase
        .from('emails')
        .select('thread_subject, days_waiting, urgency, status, ai_summary')
        .eq('from_address', contact.email)
        .order('received_at', { ascending: false })
        .limit(10)

      if (interactions?.length > 0) {
        const profile = await aiService.createContactProfile(contact, interactions)

        const { data: existing } = await supabase
          .from('ai_context')
          .select('id')
          .eq('context_type', 'contact_profile')
          .eq('subject_id', contact.id)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('ai_context')
            .update({
              content: profile,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
        } else {
          await supabase.from('ai_context').insert({
            context_type: 'contact_profile',
            subject_id: contact.id,
            subject_type: 'contact',
            content: profile,
            date: today
          })
        }
      }
    } catch (err) {
      // Non-fatal
    }
  }
  console.log('  ✓ Contact profiles updated')

  // ── STEP 9: Generate daily brief ───────────────────────────────
  console.log('Step 9: Generating daily brief...')
  try {
    const { data: rollingCtx } = await supabase
      .from('ai_context')
      .select('content')
      .eq('context_type', 'rolling_summary')
      .eq('subject_type', 'global')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: overdueOthers } = await supabase
      .from('others_commitments')
      .select('*')
      .eq('status', 'open')
      .lt('due_date', today)
      .limit(5)

    const overdueWithDays = (overdueOthers || []).map(c => ({
      ...c,
      days_overdue: Math.floor(
        (new Date(today) - new Date(c.due_date)) / (1000 * 60 * 60 * 24)
      )
    }))

    const { data: todayEvents } = await supabase
      .from('events')
      .select('title, start_time, location, high_stakes')
      .gte('start_time', `${today}T00:00:00Z`)
      .lte('start_time', `${today}T23:59:59Z`)
      .order('start_time', { ascending: true })

    const { data: highStakesEvents } = await supabase
      .from('events')
      .select('title, start_time')
      .eq('high_stakes', true)
      .gte('start_time', `${today}T00:00:00Z`)
      .lte('start_time', `${today}T23:59:59Z`)

    const { data: openTasks } = await supabase
      .from('tasks')
      .select('title, urgency, due_date')
      .eq('status', 'open')
      .order('urgency', { ascending: false })
      .limit(5)

    const { data: criticalEmails } = await supabase
      .from('emails')
      .select('thread_subject, from_name, days_waiting, urgency')
      .eq('bucket', 1)
      .order('days_waiting', { ascending: false })
      .limit(5)

    const { data: openCommitments } = await supabase
      .from('commitments')
      .select('title, made_to, due_date, urgency, commitment_type')
      .eq('status', 'open')
      .limit(5)

    const { data: pendingDecisions } = await supabase
      .from('pending_decisions')
      .select('title, blocking, due_date')
      .eq('status', 'open')
      .order('due_date', { ascending: true })
      .limit(5)

    const { data: projectsWithRisks } = await supabase
      .from('projects')
      .select('name, risk_signals')
      .eq('status', 'active')

    // Load recent meeting notes for cross-source brief
    const { data: recentMeetings } = await supabase
      .from('meeting_notes')
      .select('title, start_time, short_summary')
      .order('start_time', { ascending: false })
      .limit(7)

    const riskSignalsList = (projectsWithRisks || [])
      .flatMap(p =>
        (p.risk_signals || [])
          .filter(r => !r.checked_off)
          .map(r => ({ ...r, project: p.name }))
      )
      .slice(0, 3)

    const briefContext = {
      date: today,
      meetings_today: (todayEvents || []).length,
      high_stakes_meetings: (highStakesEvents || []).length,
      calendar: (todayEvents || []).map(e => ({
        title: e.title,
        time: e.start_time,
        high_stakes: e.high_stakes || false
      })),
      critical_emails: criticalEmails || [],
      open_tasks: openTasks || [],
      open_commitments: openCommitments || [],
      overdue_others: overdueWithDays,
      pending_decisions: pendingDecisions || [],
      risk_signals: riskSignalsList,
      rolling_summary: rollingCtx?.content || null,
      recent_meetings: recentMeetings || [],
      // Phase 1B: B3 oversight threads with extracted signals — project intel from CC-only emails.
      // These threads never appear in activeEmails (B1/B2 only) so must be fed explicitly.
      oversight_intel: p1bOversightThreads
    }

    const brief = await aiService.generateDailyBrief(briefContext)
    results.daily_brief = brief

    // Store brief — scheduled run type
    await supabase.from('captures').insert({
      content: brief,
      type: 'daily_brief',
      routed: true,
      routed_to: 'dashboard',
      ai_generated: true,
      run_type: 'scheduled'
    })
    console.log('  ✓ Daily brief generated')

    // Write daily digest for memory
    const digest = await aiService.generateDailyDigest({
      date: today,
      tasks_created: results.tasks_created,
      commitments_extracted: results.my_commitments_extracted,
      others_commitments: results.others_commitments_extracted,
      threads_processed: results.threads_summarized,
      decisions_logged: results.decisions_logged,
      pending_decisions: results.pending_decisions_created,
      intelligence_notes: results.intelligence_notes_added,
      risk_signals: results.risk_signals_detected,
      emails_snapshot: (criticalEmails || []).map(e =>
        `${e.from_name}: ${e.thread_subject}`
      ),
      tasks_snapshot: (openTasks || []).map(t => t.title)
    })

    await supabase.from('ai_context').insert({
      context_type: 'daily_digest',
      subject_type: 'global',
      content: digest,
      date: today
    })

    // Update rolling context on Sundays or first run
    const dayOfWeek = new Date().getDay()
    const hasRolling = !!rollingCtx?.content

    if (dayOfWeek === 0 || !hasRolling) {
      console.log('  Updating rolling context...')
      const updatedRolling = await aiService.updateRollingContext(
        rollingCtx?.content,
        digest,
        today
      )

      if (rollingCtx) {
        await supabase
          .from('ai_context')
          .update({
            content: updatedRolling,
            updated_at: new Date().toISOString()
          })
          .eq('context_type', 'rolling_summary')
          .eq('subject_type', 'global')
      } else {
        await supabase.from('ai_context').insert({
          context_type: 'rolling_summary',
          subject_type: 'global',
          content: updatedRolling,
          date: today
        })
      }
      console.log('  ✓ Rolling context updated')
    }
  } catch (err) {
    results.errors.push(`Daily brief: ${err.message}`)
    console.log(`  ✗ Brief error: ${err.message}`)
  }

  // ── STEP 9.3: Project Intelligence Documents ─────────────────────
  // Pre-compute a rich narrative for each active project so the chat
  // can read a single document instead of correlating 5 tables.
  console.log('Step 9.3: Building project intelligence documents...')
  try {
    const { data: activeProjects } = await supabase
      .from('projects')
      .select('id, name, status, keywords')
      .eq('status', 'active')
      .limit(10)

    const projectIntelHaiku = makeAnthropic()
    let projectIntelCount = 0

    for (const project of (activeProjects || [])) {
      try {
        const projectKeywords = [
          project.name,
          ...((project.keywords || []))
        ].filter(Boolean)

        // Build keyword OR filter for email subjects
        const keywordFilter = projectKeywords
          .map(k => `thread_subject.ilike.%${k}%`)
          .join(',')

        const [
          { data: projectEmails },
          { data: projectMeetings },
          { data: openTasks },
          { data: openCommitmentsForProject },
          { data: othersCommitmentsForProject },
          { data: pendingDecisionsForProject }
        ] = await Promise.all([
          // Emails linked by project_id OR keyword match in subject
          supabase.from('emails')
            .select('thread_subject, from_name, ai_summary, received_at, status')
            .or(`project_id.eq.${project.id}${keywordFilter ? ',' + keywordFilter : ''}`)
            .order('received_at', { ascending: false })
            .limit(10),
          supabase.from('meeting_notes')
            .select('title, start_time, short_summary, action_items_raw, participants')
            .eq('project_id', project.id)
            .order('start_time', { ascending: false })
            .limit(8),
          supabase.from('tasks')
            .select('title, urgency, due_date, context, status')
            .eq('project_id', project.id)
            .eq('status', 'open')
            .order('urgency', { ascending: false })
            .limit(10),
          supabase.from('commitments')
            .select('title, made_to, due_date, urgency, commitment_type')
            .eq('project_id', project.id)
            .eq('status', 'open')
            .limit(8),
          supabase.from('others_commitments')
            .select('title, committed_by_name, due_date, urgency')
            .eq('project_id', project.id)
            .eq('status', 'open')
            .limit(8),
          supabase.from('pending_decisions')
            .select('title, blocking, due_date, urgency')
            .eq('project_id', project.id)
            .eq('status', 'open')
            .limit(8)
        ])

        // Build prompt context
        const emailsText = (projectEmails || []).map(e =>
          `[${e.received_at?.split('T')[0]}] ${e.thread_subject} (from ${e.from_name}) — ${(e.ai_summary || '').slice(0, 200)}`
        ).join('\n')

        const meetingsText = (projectMeetings || []).map(m => {
          const items = (m.action_items_raw || []).map(a => `  • ${a.task_text || a.task || a} (${a.assignee_name || 'unassigned'})`).join('\n')
          return `[${m.start_time?.split('T')[0] || 'unknown'}] ${m.title}\n${(m.short_summary || '').slice(0, 300)}\n${items}`
        }).join('\n\n')

        const tasksText = (openTasks || []).map(t =>
          `[${t.urgency || 'normal'}] ${t.title} — due ${t.due_date || 'TBD'}: ${(t.context || '').slice(0, 150)}`
        ).join('\n')

        const commitmentsText = [
          ...(openCommitmentsForProject || []).map(c => `Ryan → ${c.made_to}: ${c.title} (due ${c.due_date || 'TBD'})`),
          ...(othersCommitmentsForProject || []).map(c => `${c.committed_by_name} → Ryan: ${c.title} (due ${c.due_date || 'TBD'})`)
        ].join('\n')

        const decisionsText = (pendingDecisionsForProject || []).map(d =>
          `${d.title}${d.blocking ? ' [BLOCKING]' : ''} — due ${d.due_date || 'TBD'}`
        ).join('\n')

        const intelMsg = await projectIntelHaiku.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `You are generating a concise project intelligence document for Ryan Hankins' Personal OS.

PROJECT: ${project.name}

RECENT EMAILS (${(projectEmails || []).length}):
${emailsText || '(none)'}

RECENT MEETINGS (${(projectMeetings || []).length}):
${meetingsText || '(none)'}

OPEN TASKS (${(openTasks || []).length}):
${tasksText || '(none)'}

COMMITMENTS IN/OUT:
${commitmentsText || '(none)'}

PENDING DECISIONS:
${decisionsText || '(none)'}

Write a 300-400 word project intelligence narrative covering:
1. Current status and phase
2. Top open items and who owns them
3. What's been resolved recently
4. Key risks and pending decisions
5. Commitments in and out

Be specific, direct, and actionable. Today is ${today}.`
          }]
        })

        const projectContext = intelMsg.content[0]?.text || ''
        if (projectContext) {
          await supabase
            .from('projects')
            .update({
              project_context: projectContext,
              project_context_updated_at: new Date().toISOString()
            })
            .eq('id', project.id)
          projectIntelCount++
          console.log(`  ✓ Project intel: ${project.name}`)
        }
      } catch (projErr) {
        console.log(`  ⚠ Project intel error for ${project.name}: ${projErr.message}`)
      }
    }
    console.log(`  ✓ Step 9.3: Project intelligence documents generated for ${projectIntelCount} projects`)
  } catch (err) {
    results.errors.push(`Project intel: ${err.message}`)
    console.log(`  ✗ Project intel error: ${err.message}`)
  }

  // ── STEP 9.5: 5-day lookahead ───────────────────────────────────
  console.log('Step 9.5: Building 5-day lookahead...')
  try {
    const fiveDaysOut = new Date()
    fiveDaysOut.setDate(fiveDaysOut.getDate() + 5)
    const fiveDaysStr = fiveDaysOut.toISOString().split('T')[0]

    const tomorrowDate = new Date()
    tomorrowDate.setDate(tomorrowDate.getDate() + 1)
    const tomorrowStrLA = tomorrowDate.toISOString().split('T')[0]

    const thirtyDaysOut = new Date()
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
    const thirtyDaysStr = thirtyDaysOut.toISOString().split('T')[0]

    const [
      upcomingHighStakes,
      upcomingTasks,
      upcomingCommitments,
      upcomingDecisions,
      longRunwayItems
    ] = await Promise.all([
      supabase.from('events').select('*')
        .eq('high_stakes', true)
        .gte('start_time', `${tomorrowStrLA}T00:00:00Z`)
        .lte('start_time', `${fiveDaysStr}T23:59:59Z`)
        .order('start_time', { ascending: true }),
      supabase.from('tasks').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr)
        .order('urgency', { ascending: false }),
      supabase.from('commitments').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr)
        .order('urgency', { ascending: false }),
      supabase.from('pending_decisions').select('*')
        .eq('status', 'open')
        .gte('due_date', tomorrowStrLA)
        .lte('due_date', fiveDaysStr),
      supabase.from('tasks').select('*')
        .eq('status', 'open')
        .gt('due_date', fiveDaysStr)
        .lte('due_date', thirtyDaysStr)
        .in('urgency', ['critical', 'high'])
        .order('due_date', { ascending: true })
        .limit(5)
    ])

    const lookaheadData = {
      generated_date: today,
      high_stakes_events: upcomingHighStakes.data || [],
      tasks_due: upcomingTasks.data || [],
      commitments_due: upcomingCommitments.data || [],
      decisions_due: upcomingDecisions.data || [],
      long_runway_items: longRunwayItems.data || [],
      date_range: {
        start: tomorrowStrLA,
        end: fiveDaysStr
      }
    }

    const { data: existingLookahead } = await supabase
      .from('ai_context')
      .select('id')
      .eq('context_type', 'lookahead')
      .eq('subject_type', 'global')
      .maybeSingle()

    if (existingLookahead) {
      await supabase
        .from('ai_context')
        .update({
          content: JSON.stringify(lookaheadData),
          date: today,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingLookahead.id)
    } else {
      await supabase.from('ai_context').insert({
        context_type: 'lookahead',
        subject_type: 'global',
        content: JSON.stringify(lookaheadData),
        date: today
      })
    }
    console.log('  ✓ 5-day lookahead updated')
  } catch (err) {
    results.errors.push(`Lookahead: ${err.message}`)
  }

  // ── STEP 9.7: Propose knowledge base entries ──────────────────────
  console.log('Step 9.7: Extracting knowledge base proposals...')
  let knowledgeProposed = 0
  const haiku = makeAnthropic()

  async function proposeWithHaiku(prompt) {
    const msg = await haiku.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
    const text = msg.content[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }

  try {
    // Source 1: Recently decided pending_decisions
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: decidedItems } = await supabase
      .from('pending_decisions')
      .select('id, title, description, status, outcome, decided_at, project_id')
      .eq('status', 'decided')
      .gte('decided_at', thirtyDaysAgo.toISOString())
      .limit(10)

    for (const item of (decidedItems || [])) {
      if (!item.outcome) continue
      // Check not already proposed
      const { data: existing } = await supabase
        .from('knowledge_base')
        .select('id')
        .eq('source_id', item.id)
        .maybeSingle()
      if (existing) continue

      try {
        const prompt = `A pending decision was resolved. Extract the institutional knowledge worth saving.

Decision: ${item.title}
Background: ${item.description || 'none'}
Outcome: ${item.outcome}

Return JSON only:
{
  "topic": "short memorable title (< 8 words)",
  "category": "decision",
  "context": "what the situation/issue was (2-3 sentences)",
  "resolution": "what was decided and why — the actual learning (2-3 sentences)",
  "applies_to": ["project or topic tags, 2-4 items"],
  "worth_saving": true/false
}`

        const parsed = await proposeWithHaiku(prompt)
        if (!parsed?.worth_saving) continue

        await supabase.from('knowledge_base').insert({
          topic:        parsed.topic,
          category:     'decision',
          context:      parsed.context,
          resolution:   parsed.resolution,
          applies_to:   parsed.applies_to || [],
          status:       'proposed',
          proposed_by:  'ai_nightly',
          source_type:  'pending_decision',
          source_id:    item.id,
          source_label: item.title ? `Decision: ${item.title.slice(0, 80)}` : 'Resolved decision',
          project_id:   item.project_id || null,
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        knowledgeProposed++
      } catch { /* non-fatal */ }
    }

    // Source 2: High-signal intelligence notes (risk + pattern clusters)
    const { data: intelNotes } = await supabase
      .from('intelligence_notes')
      .select('id, note, category, project_id, created_at')
      .in('category', ['risk', 'pattern', 'insight', 'lesson'])
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(20)

    // Group by similar topics to find repeating patterns
    const noteMap = {}
    for (const n of (intelNotes || [])) {
      const words = (n.note || '').toLowerCase().split(/\s+/).filter(w => w.length > 5).slice(0, 5).join('|')
      if (!noteMap[words]) noteMap[words] = []
      noteMap[words].push(n)
    }

    // Only propose if a pattern appears 2+ times (recurring issue)
    for (const [, group] of Object.entries(noteMap)) {
      if (group.length < 2) continue
      const sample = group[0]

      const { data: existing } = await supabase
        .from('knowledge_base')
        .select('id')
        .eq('source_id', sample.id)
        .maybeSingle()
      if (existing) continue

      try {
        const combinedNotes = group.slice(0, 3).map(n => n.note).join('\n---\n')
        const prompt = `Multiple intelligence notes show a recurring pattern. Extract the institutional knowledge.

Notes (${group.length} occurrences):
${combinedNotes}

Return JSON only:
{
  "topic": "short memorable title (< 8 words)",
  "category": "project_lesson",
  "context": "what keeps happening / the pattern (2-3 sentences)",
  "resolution": "what this means / what to watch for / how to handle it (2-3 sentences)",
  "applies_to": ["project or topic tags, 2-4 items"],
  "worth_saving": true/false
}`

        const parsed = await proposeWithHaiku(prompt)
        if (!parsed?.worth_saving) continue

        await supabase.from('knowledge_base').insert({
          topic:       parsed.topic,
          category:    'project_lesson',
          context:     parsed.context,
          resolution:  parsed.resolution,
          applies_to:  parsed.applies_to || [],
          status:      'proposed',
          proposed_by: 'ai_nightly',
          source_type: 'intelligence_pattern',
          source_id:   sample.id,
          project_id:  sample.project_id || null,
          created_at:  new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        knowledgeProposed++
      } catch { /* non-fatal */ }
    }

    console.log(`  ✓ Knowledge proposals: ${knowledgeProposed} new entries queued for review`)
  } catch (err) {
    console.log(`  ⚠ Knowledge extraction error: ${err.message}`)
    results.errors.push(`Knowledge: ${err.message}`)
  }

  // ── STEP 9.8: Auto-route today's knowledge/observations to topic pods ──
  // Keyword-based routing — no Haiku cost. Each active pod builds a keyword
  // set from its name + description + research_directive. New knowledge_base
  // entries and observations from today are routed when they share 2+ keywords.
  console.log('Step 9.8: Auto-routing new content to topic pods...')
  let podRoutedCount = 0
  try {
    const { data: routingPods } = await supabase
      .from('topic_pods')
      .select('id, name, description, research_directive')
      .eq('status', 'active')

    if (routingPods && routingPods.length > 0) {
      // Build keyword sets per pod
      const podKeywordSets = routingPods.map(pod => {
        const raw = `${pod.name} ${pod.description || ''} ${pod.research_directive || ''}`
        const words = new Set(raw.toLowerCase().split(/\W+/).filter(w => w.length > 4))
        return { pod, words }
      })

      // Today's new knowledge_base entries
      const { data: newKnowledge } = await supabase
        .from('knowledge_base')
        .select('id, topic, context, source_label')
        .gte('created_at', `${today}T00:00:00Z`)

      for (const entry of (newKnowledge || [])) {
        const entryWords = `${entry.topic || ''} ${entry.context || ''}`.toLowerCase().split(/\W+/).filter(w => w.length > 4)
        for (const { pod, words: podWords } of podKeywordSets) {
          const overlap = entryWords.filter(w => podWords.has(w)).length
          if (overlap < 2) continue
          const { data: dup } = await supabase.from('topic_pod_content').select('id').eq('pod_id', pod.id).eq('source_id', entry.id).eq('content_type', 'knowledge').maybeSingle()
          if (dup) continue
          await supabase.from('topic_pod_content').insert({
            pod_id: pod.id, content_type: 'knowledge', source_id: entry.id,
            title: entry.topic || 'Knowledge entry', source_label: entry.source_label || 'Nightly extraction',
            raw_text: entry.context || '', extracted_points: [], created_at: new Date().toISOString()
          })
          podRoutedCount++
        }
      }

      // Today's new observations
      const { data: newObservations } = await supabase
        .from('observations')
        .select('id, title, summary, source_label')
        .gte('created_at', `${today}T00:00:00Z`)

      for (const obs of (newObservations || [])) {
        const obsWords = `${obs.title || ''} ${obs.summary || ''}`.toLowerCase().split(/\W+/).filter(w => w.length > 4)
        for (const { pod, words: podWords } of podKeywordSets) {
          const overlap = obsWords.filter(w => podWords.has(w)).length
          if (overlap < 2) continue
          const { data: dup } = await supabase.from('topic_pod_content').select('id').eq('pod_id', pod.id).eq('source_id', obs.id).eq('content_type', 'observation').maybeSingle()
          if (dup) continue
          await supabase.from('topic_pod_content').insert({
            pod_id: pod.id, content_type: 'observation', source_id: obs.id,
            title: obs.title || 'Observation', source_label: obs.source_label || 'Nightly extraction',
            raw_text: obs.summary || '', extracted_points: [], created_at: new Date().toISOString()
          })
          podRoutedCount++
        }
      }
    }
    console.log(`  ✓ Pod routing: ${podRoutedCount} new items auto-routed`)
  } catch (err) {
    console.log(`  ⚠ Pod routing error: ${err.message}`)
    results.errors.push(`PodRouting: ${err.message}`)
  }

  // ── STEP 9.5: Topic Pod nightly research ───────────────────────
  console.log('Step 9.5: Running topic pod research directives...')
  try {
    const { data: activePods } = await supabase
      .from('topic_pods')
      .select('id, name, description, research_directive')
      .eq('status', 'active')
      .not('research_directive', 'is', null)

    if (activePods && activePods.length > 0) {
      console.log(`  Found ${activePods.length} pods with research directives`)

      for (const pod of activePods) {
        try {
          console.log(`  Researching: ${pod.name}`)
          const haikuResearch = makeAnthropic()

          // Generate a web search query from the directive
          const queryMsg = await haikuResearch.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: `Convert this research directive into 2-3 concise web search queries (one per line, no numbering):
"${pod.research_directive}"

Return only the queries, nothing else.`
            }]
          })
          const queries = queryMsg.content[0].text.trim().split('\n').filter(Boolean).slice(0, 3)

          // Simulate research via AI synthesis (actual web search would need a search API)
          // For now, generate insights based on the directive using Claude's knowledge
          const researchMsg = await haikuResearch.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `You are doing research for a topic pod called "${pod.name}".
${pod.description ? `Context: ${pod.description}` : ''}
Research directive: ${pod.research_directive}
Today's date: ${today}

Generate a brief research update as if you had just searched the web. Include:
- 3-5 key developments, facts, or insights relevant to this topic
- Focus on what's actionable or strategically relevant
- Be specific — include names, numbers, trends

Format as a short paragraph of 150-200 words. Start with "Research update [${today}]:"`
            }]
          })

          const researchText = researchMsg.content[0].text.trim()

          // Extract key points
          const pointsMsg = await haikuResearch.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages: [{
              role: 'user',
              content: `Extract key intelligence points from this research update about "${pod.name}":

${researchText}

Return JSON array: [{"point": "...", "significance": "high|medium|low", "tags": []}]
3-6 points max. Return only valid JSON.`
            }]
          })

          const rawPoints = pointsMsg.content[0].text.trim()
          const pointsMatch = rawPoints.match(/\[[\s\S]*\]/)
          const extractedPoints = pointsMatch ? JSON.parse(pointsMatch[0]) : []

          // Save to topic_pod_content
          await supabase.from('topic_pod_content').insert({
            pod_id:           pod.id,
            content_type:     'research',
            title:            `Nightly research — ${today}`,
            raw_text:         researchText,
            extracted_points: extractedPoints,
            source_label:     `Research: ${today}`,
          })

          // Update last_researched_at and trigger synthesis
          await supabase.from('topic_pods').update({
            last_researched_at: new Date().toISOString(),
            updated_at:         new Date().toISOString(),
          }).eq('id', pod.id)

          // Regenerate synthesis inline
          const { data: allContent } = await supabase
            .from('topic_pod_content')
            .select('title, content_type, source_label, extracted_points, created_at')
            .eq('pod_id', pod.id)
            .order('created_at', { ascending: false })
            .limit(30)

          if (allContent && allContent.length > 0) {
            const digest = allContent.map(c => {
              const pts = (c.extracted_points || []).map(p => `  • [${p.significance}] ${p.point}`).join('\n')
              return `[${c.created_at?.split('T')[0]} | ${c.source_label}]\n${pts}`
            }).join('\n\n')

            const synthMsg = await haikuResearch.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1500,
              messages: [{
                role: 'user',
                content: `Synthesize all accumulated intelligence for topic pod "${pod.name}":
${pod.description ? `Context: ${pod.description}` : ''}

ALL CONTENT:
${digest}

Return JSON:
{
  "summary": "2-3 sentence narrative of current state and key trajectory",
  "sections": [{"title": "section name", "bullets": ["point", "point"]}]
}
Return only valid JSON.`
              }]
            })

            const rawSynth = synthMsg.content[0].text.trim()
            const synthMatch = rawSynth.match(/\{[\s\S]*\}/)
            if (synthMatch) {
              const parsed = JSON.parse(synthMatch[0])
              await supabase.from('topic_pods').update({
                synthesis:           parsed.summary || null,
                synthesis_bullets:   parsed.sections || null,
                last_synthesized_at: new Date().toISOString(),
              }).eq('id', pod.id)
            }
          }

          console.log(`  ✓ ${pod.name}: research added and synthesis updated`)
          results.processed = (results.processed || 0) + 1
        } catch (podErr) {
          console.log(`  ⚠ Pod "${pod.name}" research error: ${podErr.message}`)
          results.errors.push(`TopicPod ${pod.name}: ${podErr.message}`)
        }
      }
    } else {
      console.log('  No pods with research directives')
    }
  } catch (err) {
    console.log(`  ⚠ Topic pod research error: ${err.message}`)
    results.errors.push(`TopicPods: ${err.message}`)
  }

  // ── STEP 10: Mark complete ──────────────────────────────────────
  console.log('Step 10: Marking complete...')
  // Flush local counter → results so pipeline_runs gets the real meeting count
  // (plaudMeetingsLoaded is incremented in Step 2.4 but was never assigned to results — fix session 26b)
  results.plaud_meetings_loaded = plaudMeetingsLoaded
  const pendingQCount = results.questions_logged

  await supabase.from('pipeline_runs').upsert({
    run_date:              today,
    ai_completed_at:       new Date().toISOString(),
    status:                'complete',
    pending_questions:     pendingQCount,
    error_count:           results.errors.length,
    // Extraction counts — read by Dashboard "Extracted last night" panel
    tasks_created:         results.tasks_created         || 0,
    decisions_logged:      results.decisions_logged       || 0,
    pending_decisions:     results.pending_decisions_created || 0,
    commitments_extracted: results.my_commitments_extracted  || 0,
    others_commitments:    results.others_commitments_extracted || 0,
    knowledge_created:     results.knowledge_created      || 0,
    observations_created:  results.observations_created   || 0,
    risk_signals:          results.risk_signals_detected  || 0,
    threads_processed:     results.threads_summarized     || 0,
    meetings_processed:    results.plaud_meetings_loaded  || 0,
  }, { onConflict: 'run_date' })

  // ── FINAL REPORT ────────────────────────────────────────────────
  console.log('\n═══════════════════════════════')
  console.log('NIGHTLY AI JOB COMPLETE')
  console.log('═══════════════════════════════')
  console.log(JSON.stringify(results, null, 2))

  if (results.errors.length > 0) {
    console.log('\nErrors encountered:')
    results.errors.forEach(e => console.log(`  - ${e}`))
  }

  return results
}

// ── RUN ──────────────────────────────────────────────────────────
main()
  .then(results => {
    if (results.errors.length > 5) {
      console.log('Too many errors — exiting with code 1')
      process.exit(1)
    }
    process.exit(0)
  })
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
