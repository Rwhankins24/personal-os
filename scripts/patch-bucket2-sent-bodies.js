'use strict'
// One-time script: populate sent_body for 4 Bucket 2 emails missing it.
// Usage: node ~/personal-os/scripts/patch-bucket2-sent-bodies.js

const path = require('path')
const API_DIR = path.join(__dirname, '../api')
require(path.join(API_DIR, 'node_modules/dotenv')).config({ path: path.join(API_DIR, '.env') })
const { createClient } = require(path.join(API_DIR, 'node_modules/@supabase/supabase-js'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const PATCHES = [
  {
    id: 'e6acbe74-e882-4d70-9103-5510777f193a',
    label: 'T1 — Pacific Fusion Owner (Cash Flow)',
    sent_body: `See attached; my best guess of where we are heading.

I'll have it to you today; probably 2pm my time. I think 200 million is the right number to track for the moment.

Thanks for being patient the last week, I've had no idea where the cost was going; I still don't have a firm clear line of sight.

Nick did say yesterday night that the Cost goal is between 180 to 200 MM (including our contingency) With a potential to go up another 20 million depending on what savings they find in their soft cost side of their equation.

After meetings yesterday with them on VE, I think we're probably down to 225 million so we have a little bit of a disconnect still

I am having meetings all week next week in Albuquerque With the expectation and goal set that we walk away with alignment on:
- Static cost expectations
- Static scope, expectations and understanding the design timeline associated with those expectations
- We understand the schedule expectation, And feel it is achievable
- Pacific Fusion knows all of the things they're going to have to do in order to support that cost and that schedule -- Including the specific roadmap and risks to a break ground in two months.`,
  },
  {
    id: '95e26503-9398-406e-8981-ead3687749ac',
    label: 'T2 — Project Solis Elevation Study + Fire Protection',
    sent_body: `Thank you Lulu!!!!

[Earlier in same thread:]

Lulu –

Is there a specific finish and/or color range that was included?

I bet the design team wants a premium color / finish; probably worth communicating the range they can select from.`,
  },
  {
    id: 'c5ed60fd-0801-499b-9e11-bbcd4c5224ca',
    label: 'T3 — Pacific Fusion DS3 Structural Weekly',
    sent_body: `Sounds like we should carry 3 1/2 million.

What's the cost per ton on steel and cost per square foot on the stainless steel plate?

Any insight into the Concrete Strategies number?

Let's communicate everything at one time so we can drive the conversation to where we want the conversation To go`,
  },
  {
    id: '99733060-ca45-4e3f-b762-0622fa84f365',
    label: 'T4 — DS3 Infra Leadership Discussion',
    sent_body: `Conor – notes from after you left on some clarifications I asked.

With Keith's dry and direct to the point personality, we should likely be prepared for Keith to open with: "So are we still on schedule?"

Overall Goal of the Meeting with Keith
- Show we have a realistic plan to:
  - Accommodate scope reductions & late design changes
  - Protect R&D steel / mill order and other critical long-lead items
  - Still aim for mid-July break ground; avoid stating that break ground is going to delay
- Set expectations that:
  - The downstream schedule will shift
  - Final costs and dates will be refined over the next few months

Things we can say:
- We can still break ground around mid-July, but late design changes mean the post-July schedule will look different than last week's assumptions.
- We're focusing on protecting R&D steel and long-lead MEP so the project can keep moving even as design is reworked
- There are a few key decisions still in play in the scope reductions list; we'll highlight what's already accepted, what still needs your approval, and any impact on critical path.
- We're still validating the delivery-team entry date with Jeremy and Advanced Tank; current dates are aggressive and not commit-ready.`,
  },
]

async function main() {
  console.log('\n═══ PATCH BUCKET 2 SENT BODIES ═══\n')

  for (const patch of PATCHES) {
    process.stdout.write(`Patching ${patch.label}... `)

    const { error } = await supabase
      .from('emails')
      .update({
        sent_body:        patch.sent_body,
        extraction_depth: 'full',
      })
      .eq('id', patch.id)

    if (error) {
      console.log(`✗ ERROR: ${error.message}`)
    } else {
      console.log('✓ done')
    }
  }

  console.log('\nAll done. Now run:')
  console.log('  cd ~/personal-os/api && node src/jobs/nightly-ai-local.js\n')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
