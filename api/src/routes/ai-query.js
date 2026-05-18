// personal-os — AI query endpoint (Layer 2)
// POST /api/ai/query — answer questions using stored context

const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const RYAN_CONTEXT = `Ryan Hankins is a Project Executive at Clayco. Direct, systems-thinker, relationship-driven. Values decision advantage and no surprises.`

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { question, context_type, subject_id, question_id } = req.body || {}
  if (!question) {
    return res.status(400).json({ error: 'Question required' })
  }

  try {
    let context = ''

    // Get rolling summary
    const { data: rolling } = await supabase
      .from('ai_context')
      .select('content')
      .eq('context_type', 'rolling_summary')
      .eq('subject_type', 'global')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (rolling?.content) {
      context += `Recent context: ${rolling.content}\n\n`
    }

    // Get subject-specific context if provided
    if (subject_id && context_type) {
      const { data: subjectCtx } = await supabase
        .from('ai_context')
        .select('content')
        .eq('context_type', context_type)
        .eq('subject_id', subject_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (subjectCtx?.content) {
        context += `Specific context: ${subjectCtx.content}\n\n`
      }
    }

    // Load question context if question_id provided
    let updatedConversation = null
    if (question_id) {
      const { data: questionRecord } = await supabase
        .from('ai_questions')
        .select('question, context, conversation')
        .eq('id', question_id)
        .maybeSingle()

      if (questionRecord) {
        context +=
          `\n\nQuestion context: ${questionRecord.question}` +
          `\nBackground: ${questionRecord.context || ''}` +
          `\nConversation so far: ${JSON.stringify(questionRecord.conversation || [])}`

        // Prepare updated conversation (append user message)
        updatedConversation = [
          ...(questionRecord.conversation || []),
          {
            role: 'user',
            content: question,
            timestamp: new Date().toISOString()
          }
        ]
      }
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `${RYAN_CONTEXT}

${context}Question from Ryan: ${question}

Answer directly and specifically. Be concise. Flag any risks or gaps.`
      }]
    })

    const answer = message.content[0].text

    // Update question conversation if applicable
    if (question_id && updatedConversation) {
      const finalConvo = [
        ...updatedConversation,
        {
          role: 'assistant',
          content: answer,
          timestamp: new Date().toISOString()
        }
      ]

      await supabase
        .from('ai_questions')
        .update({ conversation: finalConvo })
        .eq('id', question_id)
        .catch(() => {}) // Non-fatal
    }

    return res.json({
      answer,
      context_used: !!context
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
