'use strict'
// personal-os — AI service layer
// All Claude API calls centralized here

const Anthropic = require('@anthropic-ai/sdk')
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

// ─── Supabase client for live context injection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Ryan's base context — role and operating style
const RYAN_BASE = `Ryan Hankins is a Project Executive at Clayco, a national design-build construction firm. He operates at the intersection of pursuit, preconstruction, and execution. He thinks like an owner-side integrator trapped in a GC role. Values: decision advantage, risk clarity, no surprises. Email: hankinsr@claycorp.com.`

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

// ─── Exponential backoff for API rate limits
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxRetries) throw err
      if (
        err.status === 429 ||
        err.status === 529 ||
        err.message?.includes('rate limit') ||
        err.message?.includes('overloaded')
      ) {
        const delay = Math.pow(2, attempt) * 1000
        console.log(`Rate limited. Waiting ${delay}ms before retry ${attempt + 1}...`)
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
async function summarizeThread(email) {
  const RYAN_CONTEXT = await buildRyanContext()
  const content =
    email.full_thread_content ||
    email.sent_body ||
    email.body_preview ||
    'No content available'

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

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
async function extractIntelligence(email, threadHistory = [], meetingContext = '') {
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
        content: `${RYAN_CONTEXT}

Extract ALL valuable intelligence from this email thread. Use thread history to understand what is current vs already resolved. Use meeting context to connect email threads to verbal discussions — flag when an email is a follow-up to a meeting commitment or contradicts something said in a meeting.

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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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

// ─── EXTRACT INTELLIGENCE FROM TRANSCRIPT
// Full 10-category extraction from meeting transcripts
// Speaker labels are generic (Speaker 1, 2...) — we resolve via roster + context
async function extractIntelligenceFromTranscript(meeting, attendeeRoster, relatedEmailContext) {
  const RYAN_CONTEXT = await buildRyanContext()
  const transcript = meeting.full_transcript || meeting.raw_transcript
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

  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract ALL valuable intelligence from this meeting transcript. Audio recording — speakers may be labeled "Speaker 1" etc. or by name if the recording tool identified them.

Speaker attribution signals:
1. Action items show who was assigned what
2. Names mentioned directly in conversation
3. First person language near topics owned by specific attendees
4. Context clues from discussion topics

Meeting: ${meeting.title || 'Untitled'}
Date: ${meeting.start_time}
Duration: ${meeting.duration_raw}

Confirmed attendees:
${attendeeList || 'Unknown'}
${structuredSummary}
Related active email threads:
${emailContext || 'None'}

Action items already extracted from meeting:
${(meeting.action_items_raw || [])
  .map(a => `- ${a.assignee_name}: ${a.task_text}`)
  .join('\n') || 'None'}

Full transcript:
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
  "verbal_commitments_ryan": [{"title": "what Ryan committed to", "made_to": "person name", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "commitment_type": "hard|soft|conditional", "attribution_confidence": "high|medium|low", "attribution_basis": "why attributed to Ryan"}],
  "verbal_commitments_others": [{"title": "what they committed to", "committed_by_name": "name", "committed_by_email": "email or null", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high|medium|low"}],
  "others_action_items": [{"title": "what they need to do", "assigned_to_name": "name", "assigned_to_email": "email or null", "due_date": "YYYY-MM-DD or null", "urgency": "critical|high|medium|low", "attribution_confidence": "high|medium|low", "attribution_basis": "how we know this was assigned to them"}],
  "key_facts": [{"fact": "important fact", "category": "project|person|contract|technical|financial", "stated_by": "name or Speaker X"}],
  "meeting_outcome": {"summary": "comprehensive narrative summary — cover all major topics discussed, key positions taken, context behind decisions, and important subtext. Length should match meeting complexity: simple check-in = 1 paragraph, complex negotiation or OAC = 3-5 paragraphs. Do not truncate important content.", "resolved_items": ["what was resolved"], "unresolved_items": ["what was not resolved or still open"], "next_steps": ["specific agreed next steps with owner if known"], "overall_sentiment": "productive|tense|unclear|routine"},
  "speaker_attributions": [{"speaker_label": "Speaker 1", "likely_person": "name", "confidence": "high|medium|low", "basis": "how we know"}]
}`
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

module.exports = {
  buildRyanContext,
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
  extractIntelligenceFromTranscript
}
