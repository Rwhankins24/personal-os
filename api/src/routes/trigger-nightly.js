/**
 * POST /api/jobs/trigger-nightly
 * Dispatches the nightly-ai.yml GitHub Actions workflow on demand.
 * Requires GITHUB_PAT env var (Personal Access Token with `workflow` scope).
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-trigger-secret')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' })

  // Verify secret
  const secret = req.headers['x-trigger-secret']
  if (secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const pat = process.env.GITHUB_PAT
  if (!pat) {
    return res.status(500).json({ error: 'GITHUB_PAT not configured' })
  }

  try {
    const response = await fetch(
      'https://api.github.com/repos/Rwhankins24/personal-os/actions/workflows/nightly-ai.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept':        'application/vnd.github+json',
          'Content-Type':  'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref:    'main',
          inputs: { force_run: 'true' },
        }),
      }
    )

    if (response.status === 204) {
      return res.json({ ok: true, message: 'Workflow dispatched — check GitHub Actions for progress' })
    }

    const text = await response.text()
    console.error('GitHub dispatch error:', response.status, text)
    return res.status(502).json({ error: `GitHub returned ${response.status}`, detail: text })

  } catch (err) {
    console.error('Trigger nightly error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
