const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// Uses the anon key to validate user JWTs issued by Supabase Auth
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' })
    }

    const token = authHeader.split(' ')[1]

    const { data, error } = await supabaseAuth.auth.getUser(token)

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    // Attach user to request for downstream use
    req.user = data.user
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { requireAuth }
