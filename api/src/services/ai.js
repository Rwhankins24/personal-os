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
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract commitments OTHER PEOPLE made to Ryan. Use thread history to identify fulfilled vs outstanding commitments.

Commitment strength:
Hard: specific deadline explicitly stated
Soft: implied or flexible timing

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Content: ${content}
${historyContext}
${existingSection}
Return JSON array only.
[{
  "committed_by_name": "full name",
  "committed_by_email": "email address",
  "title": "exactly what they committed to",
  "context": "why this matters and consequence",
  "due_date": "YYYY-MM-DD or null",
  "urgency": "critical|high|medium|low",
  "commitment_strength": "hard|soft",
  "ai_suggests_complete": false,
  "fulfillment_evidence": null
}]
If thread history shows fulfillment evidence:
Set ai_suggests_complete to true.
Describe evidence in fulfillment_evidence.
Still include — Ryan confirms manually.
If no open commitments return [].`
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
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Extract commitments RYAN made to others. Sent_body contains Ryan's own sent message in this thread — check it carefully for commitment language. Use thread history — only return open ones.

Types:
Hard: specific deadline explicitly stated
Soft: implied or flexible timing
Conditional: depends on something else first

Thread: ${email.thread_subject || email.subject}
Content: ${content}
${historyContext}
${existingSection}
Return JSON array only.
[{
  "title": "exactly what Ryan committed to",
  "made_to": "person name",
  "urgency": "critical|high|medium|low",
  "due_date": "YYYY-MM-DD or null",
  "commitment_type": "hard|soft|conditional",
  "condition_text": "prerequisite or null",
  "implicit": false
}]
If no open commitments return [].`
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
async function generatePreMeetingBrief(event, relatedEmails, openTasks, projectContext) {
  const RYAN_CONTEXT = await buildRyanContext()
  const message = await withRetry(() =>
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

Generate a pre-meeting brief for Ryan. Direct. Trusted advisor tone. Flag risks. Maximum 4 sentences.

Meeting: ${event.title}
Time: ${event.start_time}
Location: ${event.location || 'Not set'}
Attendees: ${JSON.stringify(event.attendees || [])}

Related emails:
${relatedEmails.slice(0, 3).map(e =>
  `- ${e.from_name}: ${e.thread_subject} (${e.days_waiting}d, ${e.urgency})`
).join('\n') || 'None'}

Open tasks:
${openTasks.slice(0, 3).map(t =>
  `- ${t.title} (${t.urgency})`
).join('\n') || 'None'}

Context: ${projectContext || 'None available'}

Return only the brief. No preamble.`
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
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract contact information from this email content. Look specifically at the email signature block which typically appears at the bottom of the email.

From: ${fromName} (${fromEmail})
Email content:
${emailContent.substring(0, 2000)}

Extract whatever is present. Return JSON only.
{
  "name": "full name if different from ${fromName}",
  "title": "job title or role",
  "company": "company name",
  "phone_mobile": "mobile number or null",
  "phone_office": "office number or null",
  "linkedin": "linkedin URL or null",
  "address": "office address or null",
  "confidence": "high|medium|low"
}
If no signature found return: { "confidence": "low" }
Return only JSON. No other text.`
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
  const transcript = meeting.full_transcript
  if (!transcript) return null

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
      max_tokens: 2000,
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
  "key_facts": [{"fact": "important fact", "category": "project|person|contract|technical|financial", "stated_by": "name or Speaker X"}],
  "meeting_outcome": {"summary": "2-3 sentence outcome", "resolved_items": ["what was resolved"], "unresolved_items": ["what was not"], "next_steps": ["agreed next steps"], "overall_sentiment": "productive|tense|unclear|routine"},
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
  createContactProfile,
  extractContactFromSignature,
  extractIntelligenceFromTranscript
}
