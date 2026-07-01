'use strict'
// personal-os — AI service layer
// All Claude API calls centralized here

const https = require('https')
const Anthropic = require('@anthropic-ai/sdk')
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

// The SDK's built-in agentkeepalive (_shims/node-runtime.js) pools sockets
// for 5 min. GitHub Actions NAT closes idle sockets after ~60–90s. When
// node-fetch tries to reuse a NAT-closed socket it gets "Premature close."
// Fix: keepAlive: false — fresh TCP+TLS per call, no stale-socket risk.
// Standard pattern for ephemeral compute (Lambda, Actions, GCP Cloud Run).
const _freshConnectionAgent = new https.Agent({ keepAlive: false })

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  httpAgent: _freshConnectionAgent,
  timeout: 120000,  // 2 min — matches nightly-ai-local.js
  maxRetries: 2     // SDK retries; withRetry() adds another layer on top
})

// ─── Supabase client for live context injection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Ryan's base context — role and operating style
const RYAN_BASE = `Ryan Hankins is a Project Executive at Clayco, a national design-build construction firm. He operates at the intersection of pursuit, preconstruction, and execution. He thinks like an owner-side integrator trapped in a GC role. Values: decision advantage, risk clarity, no surprises. Email: hankinsr@claycorp.com.`

// ─── Construction domain context — terminology + commitment attribution conventions
// Injected into meeting transcript and email extraction prompts to reduce ambiguity
const CONSTRUCTION_DOMAIN_CONTEXT = `
CONSTRUCTION DOMAIN CONTEXT (use this to interpret terminology and attribute ownership correctly):

Clayco is a national design-build general contractor. Key roles in meetings:
- Ryan Hankins (GC/Clayco side) — Project Executive; owns scope, risk, budget, and owner relationship
- Owner / Owner's team — the client who hired Clayco; their commitments belong to them, not Ryan
- Architect / Design team / LJC — design authority; RFIs and ASIs are their outputs
- AHJ — Authority Having Jurisdiction (permitting/code); external third party

Key construction terminology:
- OAC Meeting = Owner, Architect, Contractor — core project leadership team
- GMP = Guaranteed Maximum Price (Clayco's contract type; budget is fixed once set)
- NTE = Not to Exceed (budget ceiling)
- RFI = Request for Information (formal design clarification request to architect)
- ASI = Architect's Supplemental Instructions (design change directive from architect)
- PCO/PCCO = Proposed/Potential Change Order (unresolved cost change; Clayco's exposure until signed)
- CO = Change Order (executed scope/cost change; mutually agreed)
- BESS = Battery Energy Storage System (industrial project type)
- BIM = Building Information Modeling (3D coordination)
- DD / CD = Design Development / Construction Documents (drawing stages)
- MEP = Mechanical, Electrical, Plumbing (systems coordination)
- LTI = Long-Lead Item (equipment with 20+ week procurement lead time)
- SOV = Schedule of Values (payment breakdown)
- Buyout = procurement / subcontractor selection phase

Commitment attribution rules:
- "The owner will..." or "Owner's team will..." = their commitment, not Ryan's
- "We will..." or "Clayco will..." in GC context = Ryan/Clayco team owns it
- "I'll [verb]" / "I will [verb]" / "Let me [verb]" from Ryan = Ryan's action item
- "[Name], can you..." or "Can you [verb]" addressed to someone = that person's commitment
- "Design team will..." or "Architect will..." = architect/LJC commitment
- "Your team will..." = belongs to the person being spoken to, not Ryan
- Passive voice ("it will be done") = flag as ambiguous, assign to most likely owner from context
`

// ─── Build live RYAN_CONTEXT by pulling current project state from DB
// Returns a context string injected into every AI call
let _cachedContext = null
let _cacheBuiltAt = null

async function buildRyanContext() {
  // Cache for 30 minutes within a single job run
  if (_cachedContext && _cacheBuiltAt && (Date.now() - _cacheBuiltAt) < 30 * 60 * 1000) {
    return _cachedContext
  }

  try {
    // Pull active projects with status/phase info
    const { data: projects } = await supabase
      .from('projects')
      .select('name, status, phase, description, keywords')
      .eq('status', 'active')
      .limit(20)

    // Pull open high-priority tasks (gives AI a sense of Ryan's current load)
    const { data: openTasks } = await supabase
      .from('tasks')
      .select('title, urgency, due_date, type')
      .eq('status', 'open')
      .in('urgency', ['critical', 'high'])
      .order('due_date', { ascending: true })
      .limit(10)

    // Pull contacts marked as key (high-frequency or high-importance)
    const { data: keyContacts } = await supabase
      .from('contacts')
      .select('name, company, role, relationship_tier')
      .in('relationship_tier', ['tier1', 'tier2'])
      .order('last_contact_date', { ascending: false })
      .limit(15)

    let ctx = RYAN_BASE + '\n\n'

    if (projects?.length) {
      ctx += 'ACTIVE PROJECTS:\n'
      ctx += projects.map(p => {
        let line = `- ${p.name}`
        if (p.phase) line += ` [${p.phase}]`
        if (p.description) line += `: ${p.description.slice(0, 120)}`
        return line
      }).join('\n')
      ctx += '\n\n'
    }

    if (openTasks?.length) {
      ctx += 'RYAN\'S CURRENT HIGH-PRIORITY OPEN ITEMS:\n'
      ctx += openTasks.map(t => {
        let line = `- [${t.urgency.toUpperCase()}] ${t.title}`
        if (t.due_date) line += ` (due ${t.due_date})`
        return line
      }).join('\n')
      ctx += '\n\n'
    }

    if (keyContacts?.length) {
      ctx += 'KEY CONTACTS (use names when attributing statements or actions):\n'
      ctx += keyContacts.map(c => {
        let line = `- ${c.name}`
        if (c.role) line += `, ${c.role}`
        if (c.company) line += ` @ ${c.company}`
        return line
      }).join('\n')
      ctx += '\n\n'
    }

    // Pull recent meeting summaries — gives AI context about what was discussed
    const { data: recentMeetings } = await supabase
      .from('meeting_notes')
      .select('title, summary, meeting_date, start_time, project_id')
      .eq('intelligence_extracted', true)
      .not('summary', 'is', null)
      .order('start_time', { ascending: false, nullsFirst: false })
      .limit(25)

    // Pull open pending decisions
    const { data: openDecisions } = await supabase
      .from('pending_decisions')
      .select('title, context, project_id, urgency')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20)

    // Pull projects map for linking meeting/decision context
    const projectMap = {}
    for (const p of (projects || [])) projectMap[p.id] = p.name

    if (recentMeetings?.length) {
      ctx += 'RECENT MEETING INTELLIGENCE (summaries from recorded meetings):\n'
      ctx += recentMeetings.map(m => {
        const date = (m.meeting_date || m.start_time || '').split('T')[0]
        const proj = m.project_id && projectMap[m.project_id] ? ` [${projectMap[m.project_id]}]` : ''
        const summary = (m.summary || '').slice(0, 200)
        return `- ${date}${proj} — "${m.title}": ${summary}`
      }).join('\n')
      ctx += '\n\n'
    }

    if (openDecisions?.length) {
      ctx += 'OPEN PENDING DECISIONS (require resolution):\n'
      ctx += openDecisions.map(d => {
        const proj = d.project_id && projectMap[d.project_id] ? ` [${projectMap[d.project_id]}]` : ''
        const urgency = d.urgency ? ` [${d.urgency.toUpperCase()}]` : ''
        const context = d.context ? ` — ${d.context.slice(0, 120)}` : ''
        return `- ${d.title}${proj}${urgency}${context}`
      }).join('\n')
      ctx += '\n\n'
    }

    // Pull Ryan's answers to AI questions — this is the knowledge accumulation loop.
    // Every answer Ryan types becomes permanent context that shapes all future AI calls.
    const { data: answeredQs } = await supabase
      .from('ai_questions')
      .select('question, answer_chat, answered_at')
      .not('answer_chat', 'is', null)
      .not('answer_chat', 'eq', '')
      .order('answered_at', { ascending: false })
      .limit(30)

    // Exclude skipped questions (__skip__ means "not relevant right now")
    const realAnswers = (answeredQs || []).filter(q => q.answer_chat !== '__skip__')
    if (realAnswers.length) {
      ctx += 'CONTEXT RYAN HAS PROVIDED (his direct answers to AI questions — treat as ground truth):\n'
      ctx += realAnswers.map(q =>
        `- Q: ${q.question}\n  A: ${q.answer_chat}`
      ).join('\n')
      ctx += '\n'
    }

    // ── THREE-LEGGED STOOL: accumulated intelligence from all three legs ──
    // Leg 1 — Email: what's actively pending in Ryan's inbox
    const { data: activeEmailThreads } = await supabase
      .from('emails')
      .select('thread_subject, from_name, from_address, bucket, urgency, days_waiting, tags, ai_summary')
      .in('bucket', [1, 2])
      .in('status', ['needs_reply', 'waiting_on'])
      .order('days_waiting', { ascending: false })
      .limit(15)

    if (activeEmailThreads?.length) {
      ctx += '\nACTIVE EMAIL THREADS REQUIRING ATTENTION (email intelligence leg):\n'
      ctx += activeEmailThreads.map(e => {
        const urgency = e.urgency ? ` [${e.urgency.toUpperCase()}]` : ''
        const waiting = e.days_waiting > 0 ? ` — ${e.days_waiting}d waiting` : ''
        const bucket  = e.bucket === 1 ? 'NEEDS REPLY' : 'WAITING ON THEM'
        const summary = e.ai_summary ? ` — ${e.ai_summary.slice(0, 100)}` : ''
        return `- [${bucket}]${urgency} "${e.thread_subject}" from ${e.from_name || e.from_address}${waiting}${summary}`
      }).join('\n')
      ctx += '\n\n'
    }

    // Leg 2 — Plaud/meetings: already captured via recentMeetings above

    // Leg 3 — Manual: Ryan's own observations and strategic decisions
    const { data: recentObservations } = await supabase
      .from('observations')
      .select('content, source_type, created_at')
      .order('created_at', { ascending: false })
      .limit(20)

    if (recentObservations?.length) {
      ctx += 'ACCUMULATED OBSERVATIONS (patterns and learnings — treat as institutional memory):\n'
      ctx += recentObservations.map(o => {
        const date = (o.created_at || '').split('T')[0]
        const source = o.source_type === 'ai_nightly' ? 'AI' : 'Manual'
        return `- [${date}/${source}] ${o.content}`
      }).join('\n')
      ctx += '\n\n'
    }

    const { data: strategicDecisions } = await supabase
      .from('strategic_decisions')
      .select('decision, why, expected_outcome, actual_outcome, lesson, status, decided_on, category')
      .in('status', ['open', 'monitoring', 'reviewed'])
      .order('decided_on', { ascending: false })
      .limit(15)

    if (strategicDecisions?.length) {
      const openDecisions = strategicDecisions.filter(d => d.status === 'open' || d.status === 'monitoring')
      const reviewedWithLesson = strategicDecisions.filter(d => d.status === 'reviewed' && d.lesson)

      if (openDecisions.length) {
        ctx += "RYAN'S OPEN STRATEGIC DECISIONS (his own reasoning — use as decision-making context):\n"
        ctx += openDecisions.map(d => {
          const cat = d.category ? ` [${d.category}]` : ''
          const why = d.why ? ` — Why: ${d.why.slice(0, 100)}` : ''
          const expected = d.expected_outcome ? ` | Expecting: ${d.expected_outcome.slice(0, 80)}` : ''
          return `- ${d.decided_on || 'undated'}${cat}: ${d.decision}${why}${expected}`
        }).join('\n')
        ctx += '\n\n'
      }

      if (reviewedWithLesson.length) {
        ctx += "RYAN'S DECISION RETROSPECTIVES (lessons from past decisions — use to avoid repeating mistakes):\n"
        ctx += reviewedWithLesson.slice(0, 8).map(d => {
          const cat = d.category ? ` [${d.category}]` : ''
          return `- ${d.decided_on || 'undated'}${cat}: ${d.decision}\n  → Lesson: ${d.lesson}`
        }).join('\n')
        ctx += '\n\n'
      }
    }

    // ── Knowledge base: domain expertise accumulated by Ryan and AI ──────────
    // These are structured learnings — contract terms, project patterns, owner
    // positions, risk findings — that should inform task/commitment extraction.
    // Kept token-light: topic + category + short context + position + risk.
    const { data: knowledgeItems } = await supabase
      .from('knowledge_base')
      .select('topic, category, context, our_position, client_asks, risk_level, applies_to, project_refs')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(30)

    if (knowledgeItems?.length) {
      ctx += 'DOMAIN KNOWLEDGE BASE (accumulated learnings — use to correctly interpret actions, risk, and context):\n'
      ctx += knowledgeItems.map(k => {
        const cat      = k.category   ? ` [${k.category}]`                  : ''
        const risk     = k.risk_level ? ` [${k.risk_level.toUpperCase()} RISK]` : ''
        const applies  = [...(k.applies_to || []), ...(k.project_refs || [])].filter(Boolean)
        const scope    = applies.length ? ` (${applies.slice(0, 3).join(', ')})` : ''
        let line = `- ${k.topic}${cat}${risk}${scope}`
        if (k.context)      line += `\n  Context: ${k.context.slice(0, 200)}`
        if (k.our_position) line += `\n  Our position: ${k.our_position.slice(0, 150)}`
        if (k.client_asks)  line += `\n  Client asks: ${k.client_asks.slice(0, 120)}`
        return line
      }).join('\n')
      ctx += '\n\n'
    }

    _cachedContext = ctx
    _cacheBuiltAt = Date.now()
    return ctx
  } catch (err) {
    // If DB lookup fails, fall back to static context — don't break AI calls
    console.log(`[ai.js] Live context build failed: ${err.message} — using base context`)
    return RYAN_BASE
  }
}

// ─── Warm the context cache before a job run
// Call once at the start of nightly-ai-local.js so all subsequent calls are instant
async function warmContext() {
  _cachedContext = null // force fresh build
  return buildRyanContext()
}

// ─── BUILD PROJECT CONTEXT
// Deep, project-scoped intelligence bundle.
// Call before any AI operation that relates to a specific project:
// email summarization, task extraction, meeting analysis, chat queries.
// Pulls meetings, decisions, risks, others' commitments, email history.
async function buildProjectContext(projectId) {
  if (!projectId) return ''

  try {
    const [
      { data: project },
      { data: meetings },
      { data: decisions },
      { data: othersCommitments },
      { data: recentEmails },
      { data: projectIntel },
      { data: projectContacts },
    ] = await Promise.all([
      supabase
        .from('projects')
        .select('name, status, phase, description')
        .eq('id', projectId)
        .single(),

      supabase
        .from('meeting_notes')
        .select('title, summary, meeting_date, start_time, user_notes, primary_category_id, information_only')
        .eq('project_id', projectId)
        .eq('intelligence_extracted', true)
        .not('summary', 'is', null)
        .order('meeting_date', { ascending: false })
        .limit(20),

      supabase
        .from('pending_decisions')
        .select('title, context, urgency, created_at')
        .eq('project_id', projectId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(15),

      supabase
        .from('others_commitments')
        .select('title, committed_by_name, due_date, urgency, status')
        .eq('project_id', projectId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(15),

      supabase
        .from('emails')
        .select('thread_subject, ai_summary, from_name, received_at')
        .eq('project_id', projectId)
        .not('ai_summary', 'is', null)
        .order('received_at', { ascending: false })
        .limit(8),

      supabase
        .from('projects')
        .select('intelligence_notes, risk_signals, key_facts')
        .eq('id', projectId)
        .single(),

      supabase
        .from('contacts')
        .select('name, role, company, relationship_tier')
        .eq('project_id', projectId)
        .order('last_contact_date', { ascending: false })
        .limit(10),
    ])

    if (!project) return ''

    // Resolve category names for meetings that have a primary_category_id
    const categoryIds = [...new Set((meetings || []).map(m => m.primary_category_id).filter(Boolean))]
    let categoryNames = {} // id → name
    if (categoryIds.length > 0) {
      const { data: cats } = await supabase
        .from('meeting_categories')
        .select('id, name')
        .in('id', categoryIds)
      ;(cats || []).forEach(c => { categoryNames[c.id] = c.name })
    }

    let ctx = `\n\n── PROJECT CONTEXT: ${project.name} ──`
    if (project.phase) ctx += ` [${project.phase}]`
    if (project.description) ctx += `\n${project.description.slice(0, 150)}`
    ctx += '\n'

    if (meetings?.length) {
      // Group meetings by primary category for structured AI context
      const byCategory = {}
      const uncategorized = []
      for (const m of meetings) {
        const catName = m.primary_category_id ? categoryNames[m.primary_category_id] : null
        if (catName) {
          if (!byCategory[catName]) byCategory[catName] = []
          byCategory[catName].push(m)
        } else {
          uncategorized.push(m)
        }
      }

      ctx += '\nMEETING HISTORY BY TYPE (most recent first):\n'

      // Write categorized meetings grouped by type
      for (const [catName, catMeetings] of Object.entries(byCategory)) {
        ctx += `\n  [${catName.toUpperCase()}]\n`
        ctx += catMeetings.map(m => {
          const date = (m.meeting_date || m.start_time || '').split('T')[0]
          const infoFlag = m.information_only ? ' (context only)' : ''
          let line = `    [${date}${infoFlag}] ${m.title}: ${(m.summary || '').slice(0, 200)}`
          if (m.user_notes) line += `\n      → Ryan's notes: ${m.user_notes.slice(0, 120)}`
          return line
        }).join('\n')
        ctx += '\n'
      }

      // Write uncategorized meetings if any
      if (uncategorized.length > 0) {
        ctx += '\n  [OTHER MEETINGS]\n'
        ctx += uncategorized.map(m => {
          const date = (m.meeting_date || m.start_time || '').split('T')[0]
          let line = `    [${date}] ${m.title}: ${(m.summary || '').slice(0, 160)}`
          if (m.user_notes) line += `\n      → Ryan's notes: ${m.user_notes.slice(0, 120)}`
          return line
        }).join('\n')
        ctx += '\n'
      }
    }

    if (decisions?.length) {
      ctx += '\nOPEN DECISIONS REQUIRING RESOLUTION:\n'
      ctx += decisions.map(d => {
        const urgency = d.urgency ? ` [${d.urgency.toUpperCase()}]` : ''
        const context = d.context ? ` — ${d.context.slice(0, 120)}` : ''
        return `  - ${d.title}${urgency}${context}`
      }).join('\n')
      ctx += '\n'
    }

    if (othersCommitments?.length) {
      ctx += '\nOPEN COMMITMENTS FROM OTHERS:\n'
      ctx += othersCommitments.map(c => {
        const who = c.committed_by_name || 'Unknown'
        const due = c.due_date ? ` (due ${c.due_date})` : ''
        return `  - ${who}: ${c.title}${due}`
      }).join('\n')
      ctx += '\n'
    }

    if (recentEmails?.length) {
      ctx += '\nRECENT EMAIL THREADS:\n'
      ctx += recentEmails.map(e => {
        const date = (e.received_at || '').split('T')[0]
        return `  [${date}] ${e.thread_subject} (${e.from_name}): ${(e.ai_summary || '').slice(0, 150)}`
      }).join('\n')
      ctx += '\n'
    }

    // Key risks from accumulated project intelligence
    const riskSignals = projectIntel?.risk_signals || []
    if (riskSignals.length) {
      ctx += '\nKNOWN RISK SIGNALS:\n'
      ctx += riskSignals.slice(0, 10).map(r => {
        const severity = r.severity ? ` [${r.severity.toUpperCase()}]` : ''
        return `  - ${r.signal || r.fact || JSON.stringify(r)}${severity}`
      }).join('\n')
      ctx += '\n'
    }

    // Key facts / intelligence notes accumulated on the project
    const keyFacts = projectIntel?.key_facts || []
    if (keyFacts.length) {
      ctx += '\nACCUMULATED PROJECT INTELLIGENCE:\n'
      ctx += keyFacts.slice(0, 8).map(f => {
        const fact = f.fact || f.signal || JSON.stringify(f)
        const by = f.stated_by ? ` (${f.stated_by})` : ''
        return `  - ${fact}${by}`
      }).join('\n')
      ctx += '\n'
    }

    if (projectContacts?.length) {
      ctx += '\nKEY CONTACTS ON THIS PROJECT:\n'
      ctx += projectContacts.map(c => {
        let line = `  - ${c.name}`
        if (c.role) line += `, ${c.role}`
        if (c.company) line += ` @ ${c.company}`
        if (c.relationship_tier) line += ` [${c.relationship_tier}]`
        return line
      }).join('\n')
      ctx += '\n'
    }

    ctx += '── END PROJECT CONTEXT ──\n'
    return ctx

  } catch (err) {
    console.log(`[ai.js] Project context build failed for ${projectId}: ${err.message}`)
    return ''
  }
}

// ─── Exponential backoff for API rate limits AND transient network errors
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxRetries) throw err
      const isRateLimit =
        err.status === 429 ||
        err.status === 529 ||
        err.message?.includes('rate limit') ||
        err.message?.includes('overloaded')
      const isNetworkError =
        err.message?.includes('Premature close') ||
        err.message?.includes('fetch failed') ||
        err.message?.includes('Invalid response body') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('operation was canceled') ||
        err.name === 'AbortError' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT'
      if (isRateLimit || isNetworkError) {
        const delay = Math.pow(2, attempt) * 1000
        const reason = isRateLimit ? 'Rate limited' : 'Network error'
        console.log(`${reason} (${err.message?.slice(0, 60)}). Waiting ${delay}ms before retry ${attempt + 1}...`)
        await new Promise(r => setTimeout(r, delay))
      } else {
        throw err
      }
    }
  }
}

// ─── Format thread history for AI context
function formatThreadHistoryForAI(history) {
  if (!history || history.length <= 1) return ''
  return (
    '\n\nThread history from database ' +
    `(${history.length} messages):\n` +
    history.map(m => {
      const date = m.received_at?.split('T')[0] || 'unknown'
      const content = m.ai_summary || m.body_preview || 'no content'
      return `[${date}] ${m.from_name}: ${content}`
    }).join('\n')
  )
}

// ─── SUMMARIZE THREAD
// Forces specificity — this summary becomes
// the permanent memory of this thread
async function summarizeThread(email, projectContext = '') {
  const subject = email.thread_subject || email.subject || ''
  const rawContent =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    ''

  // ── Skip Haiku when body content is degenerate ───────────────────────────
  // The M365 connector often returns only the subject line as full_thread_content.
  // Calling Haiku on "No content available" or a 50-char subject wastes API calls,
  // adds latency on GitHub Actions, and produces useless summaries.
  const isDegenerate = !rawContent
    || rawContent.trim().length < 60
    || rawContent.trim().toLowerCase() === subject.trim().toLowerCase()

  if (isDegenerate) {
    const fromPart = email.from_name || email.from_address || 'Unknown sender'
    const daysPart = email.days_waiting > 0 ? ` (${email.days_waiting}d waiting)` : ''
    const tagPart  = (email.tags || []).length ? ` [${email.tags.join(', ')}]` : ''
    return `Email from ${fromPart} re: "${subject}"${daysPart}. Body content unavailable — summary based on metadata only.${tagPart}`
  }

  const content = rawContent

  const RYAN_CONTEXT = await buildRyanContext()

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}${projectContext}

Summarize this email thread for future AI reference. This summary becomes the permanent memory of this thread. Future AI runs read this summary — not the original email. Accuracy and specificity are critical.

You MUST include all present:
1. Exactly what was asked or requested
2. Dollar figures, dates, deadlines — exact
3. What each party committed to do with deadlines — named specifically
4. Decision made OR pending decision
5. What is blocking progress if anything
6. What Ryan needs to do next
7. Current status: resolved/waiting/pending/escalating

Rules:
- Never use vague language like "discussed" or "mentioned" or "talked about"
- Always name specific people
- Always include specific dates and amounts
- If promised: state exactly what and by when
- If decided: state exactly what and who
- Maximum 4 sentences
- Write as if this is the only record that will ever exist of this conversation

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name} (${email.from_address})
Days waiting: ${email.days_waiting || 0}
Tags: ${(email.tags || []).join(', ')}
Content:
${content}

Return only the summary. No preamble.`
      }]
    })
  )
  return message.content[0].text
}

// ─── EXTRACT INTELLIGENCE
// Extracts all 10 categories of intelligence
async function extractIntelligence(email, threadHistory = [], meetingContext = '', projectContext = '') {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    ''
  const historyContext = formatThreadHistoryForAI(threadHistory)
  const meetingContextBlock = meetingContext
    ? `\nRECENT MEETING CONTEXT (last 7 days — use this to connect email threads to verbal discussions and decisions):\n${meetingContext}\n`
    : ''

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}${projectContext}
${CONSTRUCTION_DOMAIN_CONTEXT}
Extract ALL valuable intelligence from this email thread. Use thread history to understand what is current vs already resolved. Use meeting context to connect email threads to verbal discussions — flag when an email is a follow-up to a meeting commitment or contradicts something said in a meeting. Use project context to cross-reference against known decisions, open commitments, and risks for this project.

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Content: ${content}
${historyContext}${meetingContextBlock}

Return ONLY valid JSON. Empty arrays fine.
{
  "technical_facts": [{
    "fact": "specific technical fact",
    "stated_by": "person name",
    "date": "YYYY-MM-DD or null",
    "confidence": "high|medium|low"
  }],
  "financial_signals": [{
    "amount": "exact dollar figure",
    "context": "what it relates to",
    "stated_by": "person name",
    "date": "YYYY-MM-DD or null"
  }],
  "schedule_signals": [{
    "date_or_deadline": "specific date",
    "context": "what is due",
    "stated_by": "person name",
    "hard_deadline": true
  }],
  "scope_signals": [{
    "signal": "scope addition/change/assumption",
    "type": "addition|change|assumption|risk",
    "stated_by": "person name"
  }],
  "decisions_made": [{
    "decision": "exactly what was decided",
    "decided_by": "person or group",
    "date": "YYYY-MM-DD or null",
    "all_parties": ["name1", "name2"],
    "implications": "why this matters"
  }],
  "pending_decisions": [{
    "decision": "what needs to be decided",
    "blocking": "what this blocks",
    "due_date": "YYYY-MM-DD or null",
    "urgency": "critical|high|medium|low",
    "decision_maker": "who decides"
  }],
  "risk_signals": [{
    "signal": "specific risk observed",
    "type": "escalation|silence|scope|legal|relationship|schedule|financial",
    "severity": "high|medium|low",
    "involves_key_contact": true,
    "involves_active_project": true,
    "evidence": "specific evidence from email"
  }],
  "implicit_commitments": [{
    "commitment": "what Ryan implied he'd do",
    "basis": "why this is implied",
    "party_relying_on_it": "who relies on this",
    "risk_if_not_met": "consequence if missed"
  }],
  "relationship_signals": [{
    "person": "contact name",
    "signal": "specific behavioral observation",
    "type": "cooling|warming|escalating|avoidant|collaborative",
    "evidence": "what shows this"
  }],
  "key_facts": [{
    "fact": "important fact worth remembering",
    "category": "project|person|contract|technical|financial",
    "person": "who stated it"
  }]
}

Risk signals: Include if ANY of these are true:
- severity is high or critical (regardless of who is involved)
- type is escalation, scope, legal, or financial and amount > $10k
- involves_key_contact AND relationship signal is deteriorating or avoidant
- involves_active_project AND a hard deadline is at risk
Low-severity or purely informational signals: omit.`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      technical_facts: [],
      financial_signals: [],
      schedule_signals: [],
      scope_signals: [],
      decisions_made: [],
      pending_decisions: [],
      risk_signals: [],
      implicit_commitments: [],
      relationship_signals: [],
      key_facts: []
    }
  }
}

// ─── EXTRACT TASKS
async function extractTasks(email, threadHistory = [], existingItemsContext = '') {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    ''
  const historyContext = formatThreadHistoryForAI(threadHistory)
  const existingSection = existingItemsContext
    ? `\nExisting open tasks — do NOT re-extract these. Skip anything that is essentially the same action:\n${existingItemsContext}\n`
    : ''

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract tasks Ryan needs to complete. Use thread history — only extract tasks that are genuinely still open. Do not extract tasks for completed items. Do not duplicate existing commitments.

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Days waiting: ${email.days_waiting || 0}
Tags: ${(email.tags || []).join(', ')}
Content: ${content}
${historyContext}
${existingSection}
Return JSON array only. No other text.
[{
  "title": "specific action required",
  "context": "why this exists and stakes",
  "urgency": "critical|high|medium|low",
  "due_date": "YYYY-MM-DD or null",
  "type": "pursuit|contract|coord|personal|home|book",
  "blocking": "what this blocks or null"
}]
If no open tasks return [].`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

// ─── EXTRACT OTHERS COMMITMENTS
async function extractOthersCommitments(email, threadHistory = [], existingItemsContext = '') {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.body_preview ||
    ''
  const historyContext = formatThreadHistoryForAI(threadHistory)
  const existingSection = existingItemsContext
    ? `\nExisting tracked commitments from others — do NOT re-extract these. Skip anything that is essentially the same commitment:\n${existingItemsContext}\n`
    : ''

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract ALL commitments OTHER PEOPLE made in this thread. Cast a wide net — err on the side of inclusion. Ryan is bad at tracking these and needs visibility.

Count as a commitment ANY of the following signals:
- "I'll send / I'll get you / I'll have this to you / I'll follow up / I'll circle back"
- "sending over / sending you / will forward / will share / will provide"
- "by [day/date] / by end of week / by Friday / by EOD / by next week"
- "let me check on that / let me look into it / let me confirm / I'll find out"
- "will connect you / will introduce / will loop in / will set up a call"
- "I'll review / I'll take a look / I'll get back to you"
- "working on it / getting it together / finalizing / almost ready"
- "will have the [document/number/answer/proposal/contract/schedule]"
- Any implicit promise to deliver, respond, schedule, or act

Commitment strength:
Hard: specific deadline or date mentioned
Soft: implied timing or no date given

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Content: ${content}
${historyContext}
${existingSection}
delivery_type classification:
- "to_ryan": they are delivering something specifically TO Ryan (sending him a document, answering his question, completing something he asked for, a response he is waiting on)
- "general": action they committed to for the project/team generally, not specifically owed to Ryan

Return JSON array only. Include every commitment found, even soft/implied ones.
[{
  "committed_by_name": "full name",
  "committed_by_email": "email address",
  "title": "exactly what they committed to do",
  "context": "why this matters to Ryan and consequence if not done",
  "due_date": "YYYY-MM-DD or null",
  "urgency": "critical|high|medium|low",
  "commitment_strength": "hard|soft",
  "delivery_type": "to_ryan|general",
  "ai_suggests_complete": false,
  "fulfillment_evidence": null
}]
If thread history shows this was already delivered: set ai_suggests_complete to true and describe the evidence in fulfillment_evidence. Still include — Ryan confirms completion manually.
If genuinely no commitments exist in this thread, return [].`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

// ─── EXTRACT MY COMMITMENTS
async function extractMyCommitments(email, threadHistory = [], existingItemsContext = '') {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    ''
  const historyContext = formatThreadHistoryForAI(threadHistory)
  const existingSection = existingItemsContext
    ? `\nExisting tracked commitments Ryan already has open — do NOT re-extract these. Skip anything that is essentially the same commitment:\n${existingItemsContext}\n`
    : ''

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract ALL commitments RYAN made to others in this thread. Cast a wide net — err on inclusion. Ryan forgets things he said he'd do and needs these surfaced.

Check sent_body and full_thread_content carefully. Count as a commitment ANY of the following signals from Ryan:
- "I'll send / I'll get you / I'll have this to you / I'll follow up / I'll circle back"
- "sending over / sending you / will forward / will share / will provide"
- "by [day/date] / by end of week / by Friday / by EOD / by next week"
- "let me check on that / let me look into it / let me confirm / I'll find out"
- "will connect you / will introduce / will loop in / will set up a call"
- "I'll review / I'll take a look / I'll get back to you"
- "working on it / getting it together / finalizing / almost ready"
- "will have the [number/estimate/proposal/contract/schedule/answer]"
- Any implicit promise to deliver, respond, schedule, or act

Commitment types:
Hard: specific deadline or date mentioned
Soft: implied timing or no date given
Conditional: depends on something else happening first

Thread: ${email.thread_subject || email.subject}
Content: ${content}
${historyContext}
${existingSection}
Return JSON array only. Include every commitment found, even soft/implied ones.
[{
  "title": "exactly what Ryan committed to do",
  "made_to": "person name",
  "urgency": "critical|high|medium|low",
  "due_date": "YYYY-MM-DD or null",
  "commitment_type": "hard|soft|conditional",
  "condition_text": "prerequisite or null",
  "implicit": false
}]
Set implicit: true for commitments that are strongly implied but not stated explicitly.
If thread history shows Ryan already fulfilled this commitment, omit it.
If genuinely no commitments exist in this thread, return [].`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

// ─── DETECT HIGH STAKES MEETING
async function detectHighStakesMeeting(event, relatedEmails) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Is this meeting high-stakes requiring significant preparation from Ryan?

HIGH STAKES — any of:
- Owner, client, or owner representative
- Contract negotiation or scope discussion
- Pursuit presentation or interview
- First meeting with new external party
- Crisis, dispute, or conflict resolution
- Major financial decision or approval
- Design milestone or formal sign-off
- Decision that will be hard to reverse

NOT HIGH STAKES — any of:
- Regular internal weekly sync
- Routine status update, no decisions
- Large all-hands 50+ attendees
- Social or purely informational

Meeting: ${event.title}
Attendees: ${JSON.stringify(event.attendees || [])}
Organizer: ${event.organizer || 'Unknown'}
Related emails:
${relatedEmails.slice(0, 3).map(e =>
  `- ${e.thread_subject} (${e.from_name})`
).join('\n') || 'None'}

Return JSON only.
{
  "high_stakes": true or false,
  "reason": "one sentence explanation",
  "preparation_required": true or false,
  "preparation_notes": "what to prepare or null"
}`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      high_stakes: false,
      reason: 'Could not determine',
      preparation_required: false,
      preparation_notes: null
    }
  }
}

// ─── GENERATE PRE-MEETING BRIEF
async function generatePreMeetingBrief(event, relatedEmails, openTasks, projectContext, preNotes = null) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Generate a pre-meeting brief for Ryan. Direct. Trusted advisor tone. Flag risks and open items. 4-6 sentences max.

Meeting: ${event.title}
Time: ${event.start_time}
Location: ${event.location || 'Not set'}
Attendees: ${JSON.stringify(event.attendees || [])}
${preNotes ? `\nRyan's notes for this meeting (treat as primary intent — build the brief around this):\n${preNotes}\n` : ''}
Related emails:
${relatedEmails.slice(0, 3).map(e =>
  `- ${e.from_name}: ${e.thread_subject} (${e.days_waiting}d, ${e.urgency})`
).join('\n') || 'None'}

Open tasks:
${openTasks.slice(0, 3).map(t =>
  `- ${t.title} (${t.urgency})`
).join('\n') || 'None'}

Context: ${projectContext || 'None available'}

Return only the brief. No preamble. If Ryan provided notes above, anchor the brief to his stated intent.`
      }]
    })
  )
  return message.content[0].text
}

// ─── GENERATE DAILY BRIEF
// Three sections: Yesterday, Today's Focus, Watch List
async function generateDailyBrief(context) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Generate Ryan's daily brief in exactly three sections. Direct. Specific. Actionable. Trusted senior advisor tone. No fluff.

**YESTERDAY**
One sentence: what moved, what didn't. If first run say so. Note resolved items.

**TODAY'S FOCUS**
Maximum 3 numbered items. Each: specific action + specific person + specific stakes. Lead with highest risk.

**WATCH LIST**
Maximum 3 items. Not action items today — monitoring items. Risk signals, pending decisions building, relationship signals, long-runway items approaching.
Format: "[Person/Project]: [observation]"

Today's data:
Date: ${context.date}
Meetings: ${context.meetings_today} total, ${context.high_stakes_meetings || 0} high-stakes
Schedule: ${context.calendar.map(e =>
  `${e.title}${e.high_stakes ? ' ⚡HIGH STAKES' : ''}`
).join(', ') || 'No meetings'}

Emails needing reply (by urgency):
${context.critical_emails.map(e =>
  `- ${e.from_name}: ${e.thread_subject} (${e.days_waiting}d, ${e.urgency})`
).join('\n') || 'None'}

My open tasks:
${context.open_tasks.map(t =>
  `- ${t.title} (${t.urgency}, due ${t.due_date || 'no date'})`
).join('\n') || 'None'}

My open commitments:
${context.open_commitments.map(c =>
  `- ${c.title} to ${c.made_to} (${c.commitment_type || 'hard'}, due ${c.due_date || 'TBD'})`
).join('\n') || 'None'}

Others overdue:
${context.overdue_others.map(c =>
  `- ${c.committed_by_name}: ${c.title} (${c.days_overdue}d overdue)`
).join('\n') || 'None'}

Pending decisions:
${(context.pending_decisions || []).map(d =>
  `- ${d.title}${d.blocking ? ` (blocking: ${d.blocking})` : ''}`
).join('\n') || 'None'}

Risk signals:
${(context.risk_signals || []).map(r =>
  `- ${r.signal} (${r.type}, ${r.severity})`
).join('\n') || 'None'}

Rolling context:
${context.rolling_summary || 'First run — no history yet'}

Recent meetings (last 7 days):
${(context.recent_meetings || []).map(m =>
  `[${m.start_time?.split('T')[0] || 'unknown'}] ${m.title}: ${m.short_summary || 'no summary'}`
).join('\n') || 'No meeting data'}

Cross-source intelligence: When an item has evidence from BOTH email AND meeting transcripts — explicitly note this connection. Example: "Verbally committed in [meeting] AND no email follow-through yet." Flag when verbal commitments from meetings have no corresponding email follow-up — these are highest risk for falling through cracks. Flag when email threads reference a meeting discussion that is still unresolved.

Return only the brief with three labeled sections. No preamble.`
      }]
    })
  )
  return message.content[0].text
}

// ─── GENERATE DAILY DIGEST
// Stored as permanent memory record
async function generateDailyDigest(data) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Write a structured daily digest for ${data.date}. This is stored as AI memory for future runs. Be factual and specific. Note patterns, what moved, what didn't, relationship observations, risk flags.

Data:
${JSON.stringify(data, null, 2)}

Return a structured paragraph. Concise. This will be read by AI in future runs.`
      }]
    })
  )
  return message.content[0].text
}

// ─── UPDATE ROLLING CONTEXT
// Rewrites the 30-day rolling summary
async function updateRollingContext(existingContext, todayDigest, date) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Update Ryan's 30-day rolling context. Read before every daily brief generation. Rewrite it incorporating today's digest. Remove information older than 30 days. Keep: patterns, relationship observations, ongoing risks, project status, behavioral notes, commitment patterns.

MAXIMUM 400 WORDS — enforce strictly.

Existing context:
${existingContext || 'No existing context — first run'}

Today (${date}) digest:
${todayDigest}

Return only the updated rolling context.`
      }]
    })
  )
  return message.content[0].text
}

// ─── ENRICH MANUAL TASK
async function enrichTask(task, relatedEmails) {
  const RYAN_CONTEXT = await buildRyanContext()
  const emailContext = relatedEmails
    .map(e => `${e.thread_subject}: ${e.ai_summary || e.body_preview}`)
    .join('\n')

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Enrich this manually added task with context from related emails. Write 2-3 sentences: why this task exists, what is at stake, key considerations.

Task: ${task.title}
Related email context:
${emailContext || 'No related emails found'}

Return only the context paragraph.`
      }]
    })
  )
  return message.content[0].text
}

// ─── CREATE CONTACT PROFILE
async function createContactProfile(contact, interactions) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Create a relationship profile for this contact based on email interactions. Include: communication style, what they respond to, their priorities, relationship observations, patterns noted. Be specific and useful for future briefings.

Contact: ${contact.name} (${contact.email})
Company: ${contact.company || 'Unknown'}
Role: ${contact.role || 'Unknown'}
Interactions: ${interactions.length}
Last contact: ${contact.last_contact_date}

Recent interactions:
${interactions.slice(0, 5).map(e =>
  `- ${e.thread_subject} (${e.days_waiting}d, ${e.urgency}, ${e.status})`
).join('\n')}

Return only the profile paragraph.`
      }]
    })
  )
  return message.content[0].text
}

// ─── EXTRACT CONTACT FROM EMAIL SIGNATURE
async function extractContactFromSignature(emailContent, fromName, fromEmail) {
  const RYAN_CONTEXT = await buildRyanContext()
  if (!emailContent) return null

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are extracting contact details from the email signature of ONE SPECIFIC PERSON.

TARGET PERSON: ${fromName} (${fromEmail})

CRITICAL RULES:
- You are ONLY extracting information from ${fromName}'s OWN signature block
- Email threads contain signatures from MULTIPLE people — IGNORE all signatures that do NOT belong to ${fromName}
- A signature belongs to ${fromName} if it appears directly under their name, OR if it's in an email sent FROM ${fromEmail}
- If you see a company name, phone number, or title that belongs to someone OTHER than ${fromName}, IGNORE IT completely
- When in doubt about whether information belongs to ${fromName}, return null for that field

Look for ${fromName}'s OWN signature block containing:
- Phone numbers labeled: M: / C: / Mobile: / Cell: / Direct: / Office: / Tel: in any format
- Job title: text appearing under their name like "Vice President", "Project Manager", "Director of..."
- Company name: usually on its own line under their title
- LinkedIn: linkedin.com/in/... URL
- Physical address: street, city, state, zip

EMAIL CONTENT (contains ${fromName}'s emails and possibly others — only extract ${fromName}'s own info):
${emailContent.slice(-5000)}

Return JSON only — null for anything not found or not clearly belonging to ${fromName}:
{
  "name": "full name if found clearer than '${fromName}' or null",
  "title": "exact job title from ${fromName}'s signature or null",
  "company": "company from ${fromName}'s signature or null",
  "phone_mobile": "cell/mobile number from ${fromName}'s signature or null",
  "phone_office": "office/direct number from ${fromName}'s signature or null",
  "linkedin": "full linkedin URL from ${fromName}'s signature or null",
  "address": "full address from ${fromName}'s signature or null",
  "confidence": "high|medium|low"
}
high = found ${fromName}'s explicit signature with 3+ fields
medium = found 1-2 fields clearly from ${fromName}'s signature
low = no clear signature found for ${fromName}, or info is ambiguous
Return ONLY the JSON object.`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return null
  }
}

// ─── EXTRACT ALL SIGNATURES FROM A THREAD (Haiku — content-first backstop)
// Goes the opposite direction from extractContactFromSignature.
// Instead of contact → find their emails → extract their sig,
// this takes a full thread and extracts EVERY signature block present.
// Only returns entries with a confirmed email address — that's the
// high-confidence anchor that prevents cross-contamination.
async function extractAllSignaturesFromThread(threadContent, threadSubject) {
  if (!threadContent || threadContent.length < 100) return []

  // Split by message break, take the tail of each segment (where sigs live)
  const segments = threadContent.split('---MESSAGE BREAK---')
  const tails = segments
    .map(s => s.trim())
    .filter(s => s.length > 80)
    .map(s => s.slice(-1500))
    .slice(0, 8)

  if (tails.length === 0) return []

  const content = tails.join('\n---NEXT MESSAGE TAIL---\n')

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Extract all professional email signatures from these email message tails.

EMAIL THREAD: "${threadSubject || 'unknown'}"

RULES:
- Only return signatures where you can find the EMAIL ADDRESS — this is required
- Do NOT include Ryan Hankins or hankinsr@claycorp.com
- If the same person appears multiple times, return them once
- Skip automated senders, noreply addresses, marketing emails
- A signature typically has: name, title, company, phone, email on consecutive lines

MESSAGE TAILS (one per message — signature is near the bottom of each):
${content}

Return a JSON array. Omit any entry without a clear email address:
[
  {
    "name": "Full Name or null",
    "email": "their@email.com",
    "title": "Job Title or null",
    "company": "Company Name or null",
    "phone_mobile": "mobile number or null",
    "phone_office": "office/direct number or null",
    "address": "physical address or null"
  }
]

Return ONLY the JSON array. Return [] if no signatures with email addresses found.`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    const results = JSON.parse(clean)
    if (!Array.isArray(results)) return []
    return results.filter(r =>
      r.email &&
      r.email.includes('@') &&
      !r.email.toLowerCase().includes('hankinsr@claycorp.com') &&
      !r.email.toLowerCase().includes('noreply') &&
      !r.email.toLowerCase().includes('no-reply') &&
      !r.email.toLowerCase().includes('donotreply')
    )
  } catch {
    return []
  }
}

// ─── PARSE PLAUD SUMMARY (Haiku — fast, cheap)
// Plaud emails contain a fully structured intelligence report in the email body:
// decisions with confidence, action items with owners/dates, risks with owners,
// open loops, schedule impacts, commercial signals, scope, people reads.
// This function parses that pre-structured summary directly into the same JSON
// schema as extractIntelligenceFromTranscript — no need to re-derive from raw transcript.
//
// Use this for all ongoing Plaud recordings (source='plaud', summary present).
// Fall back to extractIntelligenceFromTranscript only when summary is absent/thin.
// Backfill (transcript-only) always uses extractIntelligenceFromTranscript.
async function parsePlaudSummary(meeting, categoryHint = '') {
  const RYAN_CONTEXT = await buildRyanContext()
  // Prefer email_body_raw: it has **bold** headers and |table| formatting that
  // Haiku can parse more reliably than the plain-text summary attachments.
  const summaryText = (
    (meeting.email_body_raw || '').trim().length > 200
      ? meeting.email_body_raw
      : (meeting.short_summary || meeting.summary || '')
  ).trim()
  if (!summaryText || summaryText.length < 200) return null

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}
${CONSTRUCTION_DOMAIN_CONTEXT}${categoryHint}

You are parsing a pre-structured meeting intelligence report generated by Plaud AI from a recorded meeting. This is NOT raw text — it is already organized into labeled sections. Extract every data point into the JSON schema below.

Meeting: ${meeting.title || 'Untitled'}
Date: ${meeting.start_time || 'Unknown'}
Participants: ${(meeting.participants || []).join(', ') || 'Unknown'}

PLAUD INTELLIGENCE REPORT:
${summaryText}

Parse the above into this exact JSON schema. Use real names where Plaud has already identified speakers (e.g., "Driver: Chris Tinney" means Chris Tinney). For Ryan's items look for "Ryan Hankins" or "Ryan" as owner. Preserve exact language from the report — do not paraphrase.

Return ONLY valid JSON:
{
  "technical_facts": [{"fact": "string", "stated_by": "name", "attribution_confidence": "high|medium|low", "attribution_basis": "from report section"}],
  "financial_signals": [{"amount": "string", "context": "string", "stated_by": "name", "attribution_confidence": "high|medium|low"}],
  "schedule_signals": [{"date_or_deadline": "string", "context": "string", "stated_by": "name", "hard_deadline": true, "attribution_confidence": "high|medium|low"}],
  "scope_signals": [{"signal": "string", "type": "addition|change|assumption|risk", "stated_by": "name", "attribution_confidence": "high|medium|low"}],
  "decisions_made": [{"decision": "string", "decided_by": "name", "all_parties": ["name"], "implications": "string", "attribution_confidence": "high|medium|low"}],
  "pending_decisions": [{"decision": "string", "blocking": "string", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "decision_maker": "name"}],
  "risk_signals": [{"signal": "string", "type": "escalation|silence|scope|legal|relationship|schedule|financial", "severity": "high|medium|low", "involves_key_contact": true, "involves_active_project": true, "evidence": "string"}],
  "ryan_action_items": [{"title": "string", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high", "attribution_basis": "from action items section"}],
  "verbal_commitments_ryan": [{"title": "string", "made_to": "name", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "commitment_type": "hard|soft|conditional", "attribution_confidence": "high"}],
  "verbal_commitments_others": [{"title": "string", "committed_by_name": "name", "committed_by_email": null, "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high"}],
  "others_action_items": [{"title": "string", "assigned_to_name": "name", "assigned_to_email": null, "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high", "attribution_basis": "from action items section"}],
  "key_facts": [{"fact": "string", "category": "project|person|contract|technical|financial", "stated_by": "name"}],
  "meeting_outcome": {
    "summary": "Use the full Plaud report text as-is — do not summarize it",
    "resolved_items": ["string"],
    "unresolved_items": ["string"],
    "next_steps": ["string"],
    "overall_sentiment": "productive|tense|unclear|routine"
  },
  "speaker_attributions": [{"speaker_label": "name as used in report", "likely_person": "full name", "confidence": "high", "basis": "named explicitly in Plaud report"}]
}`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    // Haiku sometimes appends explanatory text after the closing brace — extract
    // just the outermost JSON object to avoid "Unexpected non-whitespace" parse errors
    const firstBrace = clean.indexOf('{')
    const lastBrace = clean.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object found in response')
    const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1))
    // Always preserve the full Plaud report as summary — don't let Haiku summarize it
    if (parsed.meeting_outcome) {
      parsed.meeting_outcome.summary = summaryText
    }
    return parsed
  } catch (parseErr) {
    console.error(`parsePlaudSummary JSON parse error: ${parseErr.message}`)
    return null
  }
}

// ─── EXTRACT INTELLIGENCE FROM TRANSCRIPT
// Full 10-category extraction from meeting transcripts
// Speaker labels are generic (Speaker 1, 2...) — we resolve via roster + context
// Use for: backfill (transcript-only), Otter meetings, Plaud meetings without summary
// categoryHint: optional string injected to focus extraction on meeting type specifics
async function extractIntelligenceFromTranscript(meeting, attendeeRoster, relatedEmailContext, categoryHint = '') {
  const RYAN_CONTEXT = await buildRyanContext()

  // Prefer the Otter pre-processed summary over the raw transcript.
  // (Note: Plaud meetings use parseOldPlaudSections / parsePlaudSummary — not this function.)
  // The summary is already distilled — sending the full transcript just adds tokens
  // and causes model hangs on long recordings. Fall back to transcript only when
  // no usable summary exists. If transcript is all we have, cap at 20K chars
  // (covers ~30-40min of dense content) to bound the call to seconds not minutes.
  const shortSummary = (meeting.short_summary || '').trim()
  const hasSummary = shortSummary.length >= 200
  const rawTranscript = meeting.full_transcript || meeting.raw_transcript
  const transcript = hasSummary
    ? shortSummary
    : rawTranscript
      ? rawTranscript.length > 20000
        ? rawTranscript.slice(0, 20000) + '\n\n[Transcript truncated — summary unavailable]'
        : rawTranscript
      : null
  if (!transcript || transcript.trim().length < 100) return null

  // Attendee roster can be {name, email} objects or strings (from Plaud participants array)
  // Augment with names derived from action item assignees if roster is thin
  const rosterNames = new Set(
    (attendeeRoster || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean)
  )
  const actionItemAssignees = (meeting.action_items_raw || [])
    .map(a => a.assignee_name)
    .filter(Boolean)
  for (const name of actionItemAssignees) {
    rosterNames.add(name)
  }

  const attendeeList = [...rosterNames]
    .map(name => {
      const match = (attendeeRoster || []).find(a => (typeof a === 'string' ? a : a.name) === name)
      const email = (match && typeof match === 'object') ? match.email : null
      return email ? `${name} (${email})` : name
    })
    .join('\n')

  // Include Plaud's pre-processed summary if available — helps with speaker attribution
  const structuredSummary = meeting.short_summary
    ? `\nPre-processed meeting summary (from recording tool — use for speaker attribution and context):\n${meeting.short_summary}\n`
    : ''

  const emailContext = relatedEmailContext
    .map(e =>
      `Thread: ${e.thread_subject}\n` +
      `From: ${e.from_name}\n` +
      `Summary: ${e.ai_summary || e.body_preview}`
    )
    .join('\n\n')

  // This function now handles Otter and non-Plaud meetings only.
  // Old Plaud format is routed to parseOldPlaudSections (zero-AI) first, then parsePlaudSummary.
  // When we have a pre-processed summary (e.g. Otter AI summary), use a neutral
  // "meeting summary" prompt — NOT the "labeled sections" prompt (that's Plaud-specific).
  // When we only have raw transcript, use the speaker-attribution transcript prompt.
  const inputLabel = hasSummary ? 'MEETING SUMMARY (AI-generated, narrative format):' : 'Full transcript:'
  const preamble = hasSummary
    ? `Extract ALL valuable intelligence from this AI-generated meeting summary. The summary is a narrative distillation of the meeting — speaker names may be partially resolved. Focus on extracting action items, decisions, risks, and commitments from the summary text.`
    : `Extract ALL valuable intelligence from this meeting transcript. Audio recording — speakers may be labeled "Speaker 1" etc. or by name if the recording tool identified them.

Speaker attribution signals:
1. Action items show who was assigned what
2. Names mentioned directly in conversation
3. First person language near topics owned by specific attendees
4. Context clues from discussion topics`

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}
${CONSTRUCTION_DOMAIN_CONTEXT}${categoryHint}
${preamble}

Meeting: ${meeting.title || 'Untitled'}
Date: ${meeting.start_time}
Duration: ${meeting.duration_raw}

Confirmed attendees:
${attendeeList || 'Unknown'}
${hasSummary ? '' : structuredSummary}
Related active email threads:
${emailContext || 'None'}

Action items already extracted from meeting:
${(meeting.action_items_raw || [])
  .map(a => `- ${a.assignee_name}: ${a.task_text}`)
  .join('\n') || 'None'}

${inputLabel}
${transcript}

Return ONLY valid JSON. Empty arrays fine.
{
  "technical_facts": [{"fact": "specific technical fact", "stated_by": "name or Speaker X", "attribution_confidence": "high|medium|low", "attribution_basis": "why attributed"}],
  "financial_signals": [{"amount": "exact figure", "context": "what it relates to", "stated_by": "name or Speaker X", "attribution_confidence": "high|medium|low"}],
  "schedule_signals": [{"date_or_deadline": "specific date", "context": "what is due", "stated_by": "name or Speaker X", "hard_deadline": true, "attribution_confidence": "high|medium|low"}],
  "scope_signals": [{"signal": "scope change or assumption", "type": "addition|change|assumption|risk", "stated_by": "name or Speaker X", "attribution_confidence": "high|medium|low"}],
  "decisions_made": [{"decision": "exactly what was decided", "decided_by": "name or group", "all_parties": ["name1", "name2"], "implications": "why this matters", "attribution_confidence": "high|medium|low"}],
  "pending_decisions": [{"decision": "what needs to be decided", "blocking": "what this blocks", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "decision_maker": "who decides"}],
  "risk_signals": [{"signal": "specific risk observed", "type": "escalation|silence|scope|legal|relationship|schedule|financial", "severity": "high|medium|low", "involves_key_contact": true, "involves_active_project": true, "evidence": "what in transcript shows this"}],
  "ryan_action_items": [
    {
      "INSTRUCTIONS_READ_CAREFULLY": "Extract EVERY task or action item that Ryan Hankins owns. Cast wide: (1) Explicit — assigned by name to Ryan or Ryan Hankins. (2) First-person — ANY: I'll send / I'll get back / I'll follow up / I'll review / I'll check / I'll confirm / I'll loop in / I'll reach out / let me... / I need to... / I should... / I can take that / I'll handle / I'll own. (3) Implicit — Ryan discussing something he owns where a next step is clear. (4) Carry-forward from action_items_raw above if assigned to Ryan. If in doubt include it. Missed item >> false positive.",
      "title": "clear plain-English action item",
      "due_date": "YYYY-MM-DD or null",
      "urgency": "critical|high|medium|low",
      "attribution_confidence": "high|medium|low",
      "attribution_basis": "exact quote or signal showing this is Ryan's item"
    }
  ],
  "verbal_commitments_ryan": [{"title": "what Ryan committed to", "made_to": "person name", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "commitment_type": "hard|soft|conditional", "attribution_confidence": "high|medium|low", "attribution_basis": "why attributed to Ryan"}],
  "verbal_commitments_others": [{"title": "what they committed to", "committed_by_name": "name", "committed_by_email": "email or null", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high|medium|low"}],
  "others_action_items": [{"title": "what they need to do", "assigned_to_name": "name", "assigned_to_email": "email or null", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high|medium|low", "attribution_basis": "how we know this was assigned to them"}],
  "key_facts": [{"fact": "important fact", "category": "project|person|contract|technical|financial", "stated_by": "name or Speaker X"}],
  "meeting_outcome": {"summary": "Structured summary with headings and bullets. Format EXACTLY as:\n## Context\n• 1-2 bullets on what this meeting was about and why it happened\n## Key Decisions\n• one bullet per decision made (omit section if none)\n## Risks & Blockers\n• one bullet per risk or blocker surfaced (omit section if none)\n## Next Steps\n• one bullet per agreed next step with owner name if known (omit section if none)\nRules: NO paragraph prose anywhere. Each bullet max 1 sentence. Omit any section with nothing to say.", "resolved_items": ["what was resolved"], "unresolved_items": ["what was not resolved or still open"], "next_steps": ["specific agreed next steps with owner if known"], "overall_sentiment": "productive|tense|unclear|routine"},
  "speaker_attributions": [{"speaker_label": "Speaker 1", "likely_person": "name", "confidence": "high|medium|low", "basis": "how we know"}]
}`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (parseErr) {
    const text = message?.content?.[0]?.text || ''
    console.error(`extractIntelligenceFromTranscript JSON parse error: ${parseErr.message}`)
    console.error(`Raw response (first 300 chars): ${text.slice(0, 300)}`)
    return null
  }
}

// ─── REFRESH STALE ITEM
// Called on open tasks/commitments that are 3+ days old when their source
// thread has new activity. Returns patched fields only if something material changed.
async function refreshStaleItem(item, email, threadHistory = []) {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    ''
  const historyContext = formatThreadHistoryForAI(threadHistory)

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',  // fast + cheap for refresh pass
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

You are reviewing an existing tracked item to see if it needs updating based on new thread activity.

Existing item:
Title: ${item.title}
Current urgency: ${item.urgency || 'medium'}
Current due_date: ${item.due_date || 'none'}
Current context: ${item.context || 'none'}
Created: ${item.source_date || item.created_at}

Latest thread activity:
Thread: ${email.thread_subject || email.subject}
Days waiting: ${email.days_waiting || 0}
Content: ${content.slice(0, 1500)}
${historyContext}

Has anything material changed? Look for:
- Deadline moved, added, or passed
- Urgency escalated (new stakeholder pressure, explicit deadline, blocking issue)
- Scope or ask changed
- Item may now be resolved (evidence of completion)

Return JSON only. If nothing material changed, return {"changed": false}.
If changed: {"changed": true, "urgency": "critical|high|medium|low", "due_date": "YYYY-MM-DD or null", "context": "updated 1-sentence context", "ai_suggests_complete": false, "fulfillment_evidence": null}
Set ai_suggests_complete true only if there is clear evidence the item was completed.`
      }]
    })
  )

  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return { changed: false } }
}

// ── extractCategoryFocusFromIntel ─────────────────────────────────────────────
// Lightweight secondary-category pass. Takes already-extracted primary intel
// and re-synthesizes it through a specific category lens. Used by the nightly
// job to route content into linked topic pods.
// Returns { title, raw_text, bullets: [{point, significance}] } or null.
async function extractCategoryFocusFromIntel(meeting, intel, categoryName, categoryHint = '') {
  if (!intel) return null

  // Flatten primary intel into a compact text block for the focused re-synthesis
  const intelSummary = [
    intel.meeting_outcome?.summary && `OUTCOME: ${intel.meeting_outcome.summary}`,
    (intel.decisions_made || []).length  && `DECISIONS:\n${intel.decisions_made.map(d => `- ${d.decision}`).join('\n')}`,
    (intel.ryan_action_items || []).length && `RYAN ACTIONS:\n${intel.ryan_action_items.map(a => `- ${a.title || a.task || a}`).join('\n')}`,
    (intel.others_action_items || []).length && `OTHERS' ACTIONS:\n${intel.others_action_items.map(a => `- ${a.person}: ${a.task}`).join('\n')}`,
    (intel.technical_facts || []).length && `TECHNICAL:\n${intel.technical_facts.map(f => `- ${f.fact || f}`).join('\n')}`,
    (intel.financial_signals || []).length && `FINANCIAL:\n${intel.financial_signals.map(f => `- ${f.signal || f}`).join('\n')}`,
    (intel.risk_signals || []).length && `RISKS:\n${intel.risk_signals.map(r => `- ${r.risk || r}`).join('\n')}`,
    (intel.schedule_signals || []).length && `SCHEDULE:\n${intel.schedule_signals.map(s => `- ${s.signal || s}`).join('\n')}`,
    (intel.key_facts || []).length && `KEY FACTS:\n${intel.key_facts.map(f => `- ${f.fact || f}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')

  if (!intelSummary.trim()) return null

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are extracting specific intelligence signals from a construction meeting for a focused topic pod.

Meeting: ${meeting.title || 'Untitled'}
Date: ${(meeting.start_time || '').slice(0, 10)}
${categoryHint}

PRIMARY INTELLIGENCE ALREADY EXTRACTED:
${intelSummary}

Task: From the above intelligence, extract ONLY the signals directly relevant to "${categoryName}".
Be specific and concrete. Ignore anything that doesn't directly relate to this category.
If there is nothing clearly relevant, return null.

Return JSON only:
{
  "relevant": true,
  "bullets": [
    {"point": "specific signal or fact", "significance": "high|medium|low"},
    ...
  ],
  "summary": "1-2 sentence summary of what this meeting revealed from a ${categoryName} perspective"
}
Or if nothing is relevant: {"relevant": false}`
      }]
    })
  )

  try {
    const text  = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!parsed.relevant || !parsed.bullets?.length) return null

    return {
      title:    `[${(meeting.start_time || '').slice(0, 10)}] ${meeting.title || 'Meeting'} — ${categoryName}`,
      raw_text: parsed.summary || '',
      bullets:  parsed.bullets,
    }
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// extractMeetingIntelligence — Three targeted Haiku calls for Plaud meetings
// Reads the full transcript (27k+ chars). No truncation. max_tokens: 8192.
//
// Call A — Knowledge: reusable insights worth keeping in knowledge_base
// Call B — Learnings: patterns and dynamics for observations table
// Call C — Project Context: current project state snapshot for future injection
//
// All three calls run concurrently. Any call that fails returns its zero value.
// Never falls through to Sonnet — if calls fail, we log and return what we have.
// ─────────────────────────────────────────────────────────────────────────────
async function extractMeetingIntelligence(meeting, existingKnowledge = [], priorObservations = []) {
  // Prefer full transcript → email body → short summary. Never truncate.
  const transcript = meeting.full_transcript || meeting.raw_transcript ||
                     meeting.email_body_raw   || meeting.short_summary || ''

  if (!transcript || transcript.trim().length < 200) {
    console.log(`  extractMeetingIntelligence: insufficient input for "${meeting.title}" — skipping`)
    return null
  }

  const inputType   = meeting.full_transcript  ? 'transcript'  :
                      meeting.email_body_raw   ? 'email_body'  : 'summary'
  const meetingTitle = meeting.title || 'Untitled Meeting'
  const meetingDate  = meeting.recording_date || meeting.date || 'unknown'

  const knowledgeContext = existingKnowledge.length > 0
    ? `\nExisting knowledge for this project (do not duplicate):\n${
        existingKnowledge.slice(0, 10).map(k => `- ${k.content || k.title || ''}`).join('\n')
      }`
    : ''

  const observationsContext = priorObservations.length > 0
    ? `\nPrior observations on record (look for reinforcing or contradicting patterns):\n${
        priorObservations.slice(0, 10).map(o => `- ${o.content || o.title || ''}`).join('\n')
      }`
    : ''

  const MODEL = 'claude-haiku-4-5-20251001'
  const MAX   = 8192

  // Run all three calls concurrently — independent inputs, independent outputs
  const [knowledgeResult, learningsResult, contextResult] = await Promise.allSettled([

    // ── Call A: Knowledge ────────────────────────────────────────────────────
    (async () => {
      const msg = await withRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: MAX,
        messages: [{
          role: 'user',
          content: `You are extracting reusable knowledge from a meeting transcript for Ryan Hankins, Project Executive at Clayco (construction and real estate).

Meeting: ${meetingTitle} (${meetingDate})
Input type: ${inputType}
${knowledgeContext}

TRANSCRIPT:
${transcript}

Extract knowledge worth storing permanently in a knowledge base. Test each item:
- Is it reusable beyond this specific meeting instance?
- Does it inform future decisions on similar projects or pursuits?
- Is it genuinely new vs. already obvious to an experienced construction executive?

Be selective — quality over quantity. Omit meeting logistics, status updates, and anything that won't matter in 6 months.

Return a JSON array only (no markdown fences, no commentary):
[
  {
    "what": "the concept, fact, or insight — stated fully and clearly",
    "why_it_matters": "specific implication for Ryan's work on this type of project",
    "decision_trigger": "what future decision or situation would benefit from knowing this",
    "transferability": "this-project | cross-project | industry-wide",
    "confidence": "confirmed | inferred",
    "source_context": "brief note on where in the meeting this came from"
  }
]

Return [] if nothing genuinely reusable is present.`
        }]
      }))
      const raw = msg.content[0].text.replace(/```json|```/g, '').trim()
      return JSON.parse(raw)
    })(),

    // ── Call B: Learnings / Patterns ─────────────────────────────────────────
    (async () => {
      const msg = await withRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: MAX,
        messages: [{
          role: 'user',
          content: `You are identifying behavioral patterns and learnings from a meeting transcript for Ryan Hankins, Project Executive at Clayco.

Meeting: ${meetingTitle} (${meetingDate})
Input type: ${inputType}
${observationsContext}

TRANSCRIPT:
${transcript}

Identify patterns this meeting evidences. Not just what happened — what recurring dynamic, risk type, owner behavior, or structural problem does it represent?

Test each item:
- Is this a genuine pattern, or a one-off incident?
- Does it apply beyond this project?
- What should change or be watched as a result?

Return a JSON array only (no markdown fences, no commentary):
[
  {
    "pattern": "the observable pattern or dynamic — not a description of the event",
    "evidence": "specific evidence from this meeting that demonstrates the pattern",
    "implication": "what should change, be monitored, or be protected against as a result",
    "applicable_to": "which projects, roles, or situations this pattern typically appears in",
    "confidence": "strong | moderate | weak"
  }
]

Return [] if no genuine patterns are evidenced.`
        }]
      }))
      const raw = msg.content[0].text.replace(/```json|```/g, '').trim()
      return JSON.parse(raw)
    })(),

    // ── Call C: Project Context Snapshot ─────────────────────────────────────
    (async () => {
      const msg = await withRetry(() => client.messages.create({
        model: MODEL,
        max_tokens: MAX,
        messages: [{
          role: 'user',
          content: `You are capturing the current state of a project based on a meeting transcript, for Ryan Hankins, Project Executive at Clayco.

Meeting: ${meetingTitle} (${meetingDate})
Input type: ${inputType}

TRANSCRIPT:
${transcript}

Describe the current project state as evidenced by this meeting. This snapshot will be injected as context into future AI processing of meetings on this same project — so prioritize what another AI would need to understand "where things stand" without having read this transcript.

Return a JSON object only (no markdown fences, no commentary):
{
  "project_phase": "description of where the project is right now (e.g. design development, GMP negotiation, procurement, construction)",
  "key_constraints": ["constraints actively driving decisions in this meeting"],
  "workstream_owners": [{ "workstream": "what area", "owner": "person's name" }],
  "core_problem": "the central problem or challenge the team is trying to solve right now",
  "next_milestone": "the next significant milestone, gate, or deliverable",
  "open_dependencies": ["things that must happen or be resolved before the project can move forward"]
}`
        }]
      }))
      const raw = msg.content[0].text.replace(/```json|```/g, '').trim()
      return JSON.parse(raw)
    })()

  ])

  const knowledge = knowledgeResult.status === 'fulfilled' ? (knowledgeResult.value || []) : []
  const learnings = learningsResult.status === 'fulfilled' ? (learningsResult.value || []) : []
  const project_context = contextResult.status === 'fulfilled' ? (contextResult.value || null) : null

  if (knowledgeResult.status === 'rejected') {
    console.error(`  extractMeetingIntelligence Call A (knowledge) failed: ${knowledgeResult.reason?.message}`)
  }
  if (learningsResult.status === 'rejected') {
    console.error(`  extractMeetingIntelligence Call B (learnings) failed: ${learningsResult.reason?.message}`)
  }
  if (contextResult.status === 'rejected') {
    console.error(`  extractMeetingIntelligence Call C (project context) failed: ${contextResult.reason?.message}`)
  }

  console.log(`  extractMeetingIntelligence: ${knowledge.length} knowledge, ${learnings.length} learnings, context: ${!!project_context}`)

  return { knowledge, learnings, project_context, input_type: inputType }
}

module.exports = {
  buildRyanContext,
  buildProjectContext,
  warmContext,
  withRetry,
  formatThreadHistoryForAI,
  summarizeThread,
  extractIntelligence,
  extractTasks,
  extractOthersCommitments,
  extractMyCommitments,
  detectHighStakesMeeting,
  generatePreMeetingBrief,
  generateDailyBrief,
  generateDailyDigest,
  updateRollingContext,
  enrichTask,
  refreshStaleItem,
  createContactProfile,
  extractContactFromSignature,
  extractAllSignaturesFromThread,
  extractIntelligenceFromTranscript,
  parsePlaudSummary,
  extractCategoryFocusFromIntel,
  extractMeetingIntelligence,
}
