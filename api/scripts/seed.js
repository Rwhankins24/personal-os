/**
 * personal-os :: Database Seed Script
 * Run from api/ folder: node scripts/seed.js
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const today    = new Date().toISOString().split('T')[0]
const friday   = (() => {
  const d = new Date()
  d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7 || 7)
  return d.toISOString().split('T')[0]
})()

async function seed() {
  console.log('🌱 Seeding personal-os database...\n')

  // ── STEP 1: User ──────────────────────────────────────────
  console.log('Step 1: Inserting user...')
  const { data: users, error: uErr } = await supabase
    .from('users').insert([{
      email: 'ryan@clayco.com',
      name: 'Ryan Hankins',
      role: 'owner'
    }]).select()
  if (uErr) throw uErr
  const userId = users[0].id
  console.log(`  ✅ User: ${userId}`)

  // ── STEP 2: Workspaces ────────────────────────────────────
  console.log('Step 2: Inserting workspaces...')
  const { data: workspaces, error: wsErr } = await supabase
    .from('workspaces').insert([
      { name: 'work',     color: '#185FA5', user_id: userId },
      { name: 'personal', color: '#3B6D11', user_id: userId },
      { name: 'other',    color: '#854F0B', user_id: userId },
    ]).select()
  if (wsErr) throw wsErr
  const workId     = workspaces.find(w => w.name === 'work').id
  const personalId = workspaces.find(w => w.name === 'personal').id
  const otherId    = workspaces.find(w => w.name === 'other').id
  console.log(`  ✅ work: ${workId}`)
  console.log(`  ✅ personal: ${personalId}`)
  console.log(`  ✅ other: ${otherId}`)

  // ── STEP 3: Projects ──────────────────────────────────────
  console.log('Step 3: Inserting projects...')
  const { data: projects, error: pErr } = await supabase
    .from('projects').insert([
      {
        name: 'Southbank Tower', type: 'pursuit',
        workspace_id: workId,
        delivery_method: 'Design-Build',
        contract_type: 'GMP - Negotiated',
        est_value: 310000000,
        fee_position: '3.2% - under review',
        decision_date: '2026-06-15',
        win_probability: 'Medium',
        key_risk: 'Fee sensitivity + LWIC scope gap',
        status: 'active'
      },
      { name: 'Clayco Internal', type: 'active',    workspace_id: workId,     status: 'active' },
      { name: 'Home Renovation', type: 'personal',  workspace_id: personalId, est_value: 300000, status: 'active' },
      { name: 'Due Date Unknown', type: 'book',     workspace_id: otherId,    status: 'active' },
    ]).select()
  if (pErr) throw pErr
  const southbankId = projects.find(p => p.name === 'Southbank Tower').id
  const claycoId    = projects.find(p => p.name === 'Clayco Internal').id
  const homeId      = projects.find(p => p.name === 'Home Renovation').id
  const bookId      = projects.find(p => p.name === 'Due Date Unknown').id
  console.log(`  ✅ ${projects.length} projects inserted`)

  // ── STEP 4: Tasks ─────────────────────────────────────────
  console.log('Step 4: Inserting tasks...')
  const { data: tasks, error: tErr } = await supabase
    .from('tasks').insert([
      {
        title: 'Resolve LWIC scope gap — roofer vs fireproofer',
        context: 'Fireproofer installed LWIC on roof deck achieving R-11. Question is whether this satisfies ASHRAE 90.1 continuous insulation requirement and eliminates roofer obligation. Blocking permit submission.',
        project_id: southbankId, workspace_id: workId,
        type: 'coord', status: 'open', due_date: today, urgency: 'critical',
        source: 'email', source_label: 'Miller email thread - RE: insulation scope clarification', source_date: today
      },
      {
        title: 'Send revised fee proposal to Southbank team',
        context: 'Fee position needs to be revised down 15bps to stay competitive. CFO aligned on range. Draft exists, needs final numbers from estimating.',
        project_id: southbankId, workspace_id: workId,
        type: 'pursuit', status: 'open', due_date: friday, urgency: 'critical',
        source: 'meeting', source_label: 'Pursuit strategy session May 12', source_date: '2026-05-12'
      },
      {
        title: 'Pull energy code section for roofer',
        context: 'Committed to pull ASHRAE 90.1 continuous insulation language and send to Kowalski before end of day.',
        project_id: southbankId, workspace_id: workId,
        type: 'contract', status: 'open', due_date: today, urgency: 'high',
        source: 'meeting', source_label: 'Subcontractor coordination call May 13', source_date: '2026-05-13'
      },
      {
        title: 'Review subcontractor coordination matrix v3',
        context: 'Updated coordination matrix came in from PM. Needs a pass to confirm scope assignments across MEP, structural, and envelope trades before next OAC.',
        project_id: southbankId, workspace_id: workId,
        type: 'coord', status: 'open', due_date: '2026-05-18', urgency: 'medium',
        source: 'email', source_label: 'PM forwarded updated matrix', source_date: '2026-05-11'
      },
      {
        title: 'Confirm renovation GC scope with contractor',
        context: 'Need to confirm which scopes the GC is self-performing vs subbing out. Kitchen, primary bath, and structural addition are the three areas still unclear.',
        project_id: homeId, workspace_id: personalId,
        type: 'personal', status: 'open', due_date: '2026-05-18', urgency: 'medium',
        source: 'manual', source_label: 'Added manually'
      },
      {
        title: 'Share pursuit deck draft with BD team',
        context: 'BD team needs draft pursuit deck to incorporate into Monday board materials.',
        project_id: claycoId, workspace_id: workId,
        type: 'pursuit', status: 'open', due_date: '2026-05-18', urgency: 'high',
        source: 'meeting', source_label: 'BD weekly May 13', source_date: '2026-05-13'
      },
      {
        title: 'Outline Chapter 3 — embryo transfer decision',
        context: 'Chapter 3 covers the embryo transfer decision point. Need to outline key beats before next writing session.',
        project_id: bookId, workspace_id: otherId,
        type: 'book', status: 'open', due_date: '2026-05-21', urgency: 'low',
        source: 'manual', source_label: 'Added manually'
      },
    ]).select()
  if (tErr) throw tErr
  console.log(`  ✅ ${tasks.length} tasks inserted`)

  // ── STEP 5: Commitments ───────────────────────────────────
  console.log('Step 5: Inserting commitments...')
  const { data: commitments, error: cErr } = await supabase
    .from('commitments').insert([
      { title: 'Send Miller the LWIC spec language',  made_to: 'J. Miller - Fireproofer', made_on: '2026-05-12', due_date: today,   urgency: 'critical', status: 'open', project_id: southbankId },
      { title: 'Pull energy code section for roofer', made_to: 'D. Kowalski - Roofer',   made_on: '2026-05-13', due_date: friday,  urgency: 'high',     status: 'open', project_id: southbankId },
      { title: 'Share pursuit deck draft with BD team', made_to: 'BD Team - Clayco',     made_on: '2026-05-13', due_date: '2026-05-18', urgency: 'medium', status: 'open', project_id: claycoId },
    ]).select()
  if (cErr) throw cErr
  console.log(`  ✅ ${commitments.length} commitments inserted`)

  // ── STEP 6: Emails ────────────────────────────────────────
  console.log('Step 6: Inserting emails...')
  const { data: emails, error: eErr } = await supabase
    .from('emails').insert([
      {
        from_address: 'j.miller@fireproofing.com', from_name: 'J. Miller',
        subject: 'RE: Insulation scope clarification — LWIC coordination',
        body_preview: 'Ryan — attaching the Siplast product data sheet. Confirmed R-11 achieved across the full assembly. Ball is in your court on the contract language.',
        received_at: '2026-05-10T14:30:00Z', status: 'needs_reply',
        project_id: southbankId, thread_id: 'thread_lwic_001', importance: 'high',
        ai_summary: 'Miller confirmed LWIC achieves R-11 satisfying ASHRAE 90.1. Attached product data sheet. Waiting on Ryan for contract language direction.'
      },
      {
        from_address: 'schen@southbankdev.com', from_name: 'Sarah Chen',
        subject: 'Southbank fee structure questions',
        body_preview: 'Ryan, following up on the fee proposal. Our board is asking questions about the current position and we need clarity before Friday.',
        received_at: '2026-05-12T09:15:00Z', status: 'needs_reply',
        project_id: southbankId, thread_id: 'thread_fee_001', importance: 'high',
        ai_summary: 'Owner rep following up on fee proposal. Board asking questions. Needs clarity before Friday. Fee proposal has not been sent yet.'
      },
      {
        from_address: 'mpowell@ljcarch.com', from_name: 'Marcus Powell',
        subject: 'Delivery schedule — milestone review',
        body_preview: 'Ryan, wanted to share the updated milestone schedule for your review before the next coordination meeting.',
        received_at: '2026-05-09T11:00:00Z', status: 'waiting_on',
        project_id: southbankId, thread_id: 'thread_schedule_001', importance: 'normal',
        ai_summary: 'Architect shared updated milestone schedule for review. Waiting on Ryan response.'
      },
    ]).select()
  if (eErr) throw eErr
  console.log(`  ✅ ${emails.length} emails inserted`)

  // ── STEP 7: Events ────────────────────────────────────────
  console.log('Step 7: Inserting events...')
  const { data: events, error: evErr } = await supabase
    .from('events').insert([
      {
        title: 'Southbank pursuit — scope alignment',
        start_time: `${today}T16:00:00Z`, end_time: `${today}T17:00:00Z`,
        location: 'Southbank Tower, 22nd Floor - Conference C',
        join_link: 'https://teams.microsoft.com/meet/southbank-scope',
        organizer: 'Sarah Chen',
        attendees: JSON.stringify(['Sarah Chen', 'Marcus Powell', 'Tom Walsh', 'Ryan Hankins']),
        workspace_id: workId, source: 'outlook', external_id: 'evt_southbank_001'
      },
      {
        title: 'Clayco preconstruction weekly',
        start_time: `${today}T18:00:00Z`, end_time: `${today}T19:00:00Z`,
        location: 'Clayco HQ - Conference Room B',
        join_link: 'https://teams.microsoft.com/meet/precon-weekly',
        organizer: 'Ryan Hankins',
        attendees: JSON.stringify(['Ryan Hankins', 'Preconstruction Team']),
        workspace_id: workId, source: 'outlook', external_id: 'evt_precon_001'
      },
      {
        title: 'OB appointment',
        start_time: `${today}T19:30:00Z`, end_time: `${today}T20:30:00Z`,
        location: 'Scottsdale OB/GYN - 8900 E Via de Ventura',
        organizer: 'Ryan Hankins',
        attendees: JSON.stringify(['Ryan Hankins']),
        workspace_id: personalId, source: 'apple_calendar', external_id: 'evt_ob_001'
      },
      {
        title: 'Fee structure review — CFO call',
        start_time: `${today}T22:00:00Z`, end_time: `${today}T23:00:00Z`,
        location: '',
        join_link: 'https://teams.microsoft.com/meet/cfo-fee-review',
        organizer: 'Ryan Hankins',
        attendees: JSON.stringify(['Ryan Hankins', 'CFO']),
        workspace_id: workId, source: 'outlook', external_id: 'evt_cfo_001'
      },
    ]).select()
  if (evErr) throw evErr
  console.log(`  ✅ ${events.length} events inserted`)

  // ── STEP 8: Contacts ──────────────────────────────────────
  console.log('Step 8: Inserting contacts...')
  const { data: contacts, error: conErr } = await supabase
    .from('contacts').insert([
      { name: 'Sarah Chen',    email: 'schen@southbankdev.com',        company: 'Southbank Development', role: 'Owner Representative',     last_contact_date: '2026-05-12', last_topic: 'Fee structure questions',          relationship_warmth: 'warm', project_id: southbankId },
      { name: 'J. Miller',     email: 'j.miller@fireproofing.com',     company: 'Miller Fireproofing',   role: 'Fireproofer / Subcontractor', last_contact_date: '2026-05-10', last_topic: 'LWIC insulation scope clarification', relationship_warmth: 'warm', project_id: southbankId },
      { name: 'Dave Kowalski', email: 'd.kowalski@kowalskiroofing.com', company: 'Kowalski Roofing',     role: 'Roofer / Subcontractor',    last_contact_date: '2026-05-08', last_topic: 'Scope confirmation for insulation',  relationship_warmth: 'cold', project_id: southbankId },
      { name: 'Marcus Powell', email: 'mpowell@ljcarch.com',           company: 'LJC Architecture',      role: 'Architect of Record',       last_contact_date: '2026-05-09', last_topic: 'Delivery schedule milestone review',  relationship_warmth: 'warm', project_id: southbankId },
    ]).select()
  if (conErr) throw conErr
  console.log(`  ✅ ${contacts.length} contacts inserted`)

  console.log('\n🎉 Seed complete!')
  console.log(`   Users: 1 | Workspaces: 3 | Projects: 4`)
  console.log(`   Tasks: ${tasks.length} | Commitments: ${commitments.length} | Emails: ${emails.length}`)
  console.log(`   Events: ${events.length} | Contacts: ${contacts.length}`)
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})
