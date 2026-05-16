// personal-os — AI service layer
// All Claude API calls centralized here

const Anthropic = require('@anthropic-ai/sdk')
require('dotenv').config()

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const RYAN_CONTEXT = `Ryan Hankins is a Project Executive at Clayco, a major construction company. He works on large commercial projects including data centers (DS3, Pacific Fusion), industrial facilities, and mixed-use developments (Southbank). He is relationship-driven, direct, and operates at the intersection of pursuit, preconstruction, and execution. He thinks like an owner-side integrator. He values: decision advantage, risk clarity, and no surprises. His email is hankinsr@claycorp.com.`

async function summarizeThread(email) {
  const content = email.full_thread_content || email.body_preview || 'No content available'
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Summarize this email thread in 2-3 sentences. Be specific about what's being asked and what action is needed from Ryan if any.

Thread subject: ${email.thread_subject || email.subject}
From: ${email.from_name} (${email.from_address})
Days waiting: ${email.days_waiting || 0}
Tags: ${(email.tags || []).join(', ')}

Content:
${content}

Return only the summary. No preamble.`
    }]
  })
  return message.content[0].text
}

async function extractTasks(email) {
  const content = email.full_thread_content || email.body_preview || ''
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Extract tasks Ryan needs to complete from this email thread. Only include explicit asks or clear action items directed at Ryan.

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Days waiting: ${email.days_waiting || 0}
Content: ${content}

Return JSON array only. No other text.
Format:
[{
  "title": "specific action",
  "context": "why this exists",
  "urgency": "critical|high|medium|low",
  "due_date": "YYYY-MM-DD or null",
  "type": "pursuit|contract|coord|personal|home|book"
}]
If no tasks return [].`
    }]
  })
  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

async function extractOthersCommitments(email) {
  const content = email.full_thread_content || email.body_preview || ''
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Extract commitments OTHER PEOPLE made to Ryan in this email thread. Look for things like "I will send", "I'll get you", "we will provide", "I'll have that", "will follow up", etc. Do NOT include things Ryan committed to do.

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name} (${email.from_address})
Content: ${content}

Return JSON array only. No other text.
Format:
[{
  "committed_by_name": "person who made commitment",
  "committed_by_email": "their email",
  "title": "what they committed to do",
  "context": "why this matters to Ryan",
  "due_date": "YYYY-MM-DD or null",
  "urgency": "critical|high|medium|low"
}]
If no commitments return [].`
    }]
  })
  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

async function extractMyCommitments(email) {
  const content = email.full_thread_content || email.body_preview || ''
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Extract commitments RYAN made to others in this email thread. Look for things Ryan said like "I'll send", "let me follow up", "I will", "I'll get you", "I'll confirm" etc.

Thread: ${email.thread_subject || email.subject}
From: ${email.from_name}
Content: ${content}

Return JSON array only. No other text.
Format:
[{
  "title": "what Ryan committed to do",
  "made_to": "person Ryan committed to",
  "urgency": "critical|high|medium|low",
  "due_date": "YYYY-MM-DD or null"
}]
If no commitments return [].`
    }]
  })
  try {
    const text = message.content[0].text
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return [] }
}

async function generatePreMeetingBrief(event, relatedEmails, openTasks, projectContext) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Generate a pre-meeting brief for Ryan. Be direct. Sound like a trusted advisor. Flag risks. Maximum 4 sentences.

Meeting: ${event.title}
Time: ${event.start_time}
Location: ${event.location || 'No location set'}
Attendees: ${JSON.stringify(event.attendees || [])}

Related open emails (${relatedEmails.length}):
${relatedEmails.slice(0, 3).map(e =>
  `- ${e.from_name}: ${e.thread_subject} (${e.days_waiting}d waiting, ${e.urgency})`
).join('\n') || 'None'}

Open tasks related to this meeting:
${openTasks.slice(0, 3).map(t =>
  `- ${t.title} (${t.urgency})`
).join('\n') || 'None'}

Project context:
${projectContext || 'No project context available'}

Return only the brief. No preamble.`
    }]
  })
  return message.content[0].text
}

async function generateDailyBrief(context) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Generate Ryan's daily brief. Be direct and specific. Flag the biggest risks. Tell him what needs action today vs what can wait. Maximum 5 sentences. Second person voice.

Date: ${context.date}
Meetings today: ${context.meetings_today}
Calendar: ${context.calendar.map(e => `${e.title} at ${e.time}`).join(', ')}

Most urgent emails needing reply:
${context.critical_emails.map(e =>
  `- ${e.from_name}: ${e.thread_subject} (${e.days_waiting}d, ${e.urgency})`
).join('\n') || 'None'}

Open tasks:
${context.open_tasks.map(t =>
  `- ${t.title} (${t.urgency}, due ${t.due_date || 'no date'})`
).join('\n') || 'None'}

Open commitments you made:
${context.open_commitments.map(c =>
  `- ${c.title} to ${c.made_to} (due ${c.due_date || 'TBD'})`
).join('\n') || 'None'}

Things others committed to you (overdue):
${context.overdue_others.map(c =>
  `- ${c.committed_by_name}: ${c.title} (${c.days_overdue}d overdue)`
).join('\n') || 'None'}

Rolling context (last 30 days):
${context.rolling_summary || 'First run - no history yet'}

Return only the brief. No preamble.`
    }]
  })
  return message.content[0].text
}

async function generateDailyDigest(data) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Write a structured daily digest for ${data.date}. This is stored as context for future AI runs. Be factual and specific. Note patterns. Include: what happened, what moved, what didn't, relationship observations, risk flags.

Data:
${JSON.stringify(data, null, 2)}

Return a structured paragraph. Be concise. This will be read by AI in future runs.`
    }]
  })
  return message.content[0].text
}

async function updateRollingContext(existingContext, todayDigest, date) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

You are updating Ryan's 30-day rolling context. This context is read before generating every daily brief. Keep it current and useful. Rewrite it incorporating today's digest. Remove information older than 30 days. Keep: patterns, relationship observations, ongoing risks, project status, behavioral notes. Maximum 400 words.

Existing context:
${existingContext || 'No existing context - first run'}

Today (${date}) digest:
${todayDigest}

Return only the updated rolling context.`
    }]
  })
  return message.content[0].text
}

async function enrichTask(task, relatedEmails) {
  const emailContext = relatedEmails
    .map(e => `${e.thread_subject}: ${e.body_preview}`)
    .join('\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Enrich this manually added task with context from related emails. Write 2-3 sentences explaining why this task exists, what's at stake, and what the key considerations are.

Task: ${task.title}
Related email context:
${emailContext || 'No related emails found'}

Return only the context paragraph.`
    }]
  })
  return message.content[0].text
}

async function createContactProfile(contact, interactions) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `${RYAN_CONTEXT}

Create a relationship profile for this contact based on their email interactions with Ryan. Include: communication style, what they respond to, their priorities, relationship observations, any patterns noted. Be specific and useful.

Contact: ${contact.name} (${contact.email})
Company: ${contact.company || 'Unknown'}
Role: ${contact.role || 'Unknown'}
Total interactions: ${interactions.length}
Last contact: ${contact.last_contact_date}

Recent interactions:
${interactions.slice(0, 5).map(e =>
  `- ${e.thread_subject} (${e.days_waiting}d, ${e.urgency}, ${e.status})`
).join('\n')}

Return only the profile paragraph.`
    }]
  })
  return message.content[0].text
}

module.exports = {
  summarizeThread,
  extractTasks,
  extractOthersCommitments,
  extractMyCommitments,
  generatePreMeetingBrief,
  generateDailyBrief,
  generateDailyDigest,
  updateRollingContext,
  enrichTask,
  createContactProfile
}
