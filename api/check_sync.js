const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://dvevqwhphrcboyjpvnlz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXZxd2hwaHJjYm95anB2bmx6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc4NjMwNiwiZXhwIjoyMDk0MzYyMzA2fQ.HSstuAETV0tUHDF2PQm0gsC4jLqX3DtLqik8k8R0pQ4'
)

async function main() {
  // Get all active others_commitments
  const { data: items, error } = await supabase
    .from('others_commitments')
    .select('id, contact_id, committed_by_email, committed_by_name, status')
    .not('status', 'in', '("archived","closed")')

  if (error) { console.error(error); return }

  // Get all contacts
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, email, name')

  const contactById = {}
  const contactByEmail = {}
  for (const c of contacts || []) {
    contactById[c.id] = c
    if (c.email) contactByEmail[c.email.toLowerCase()] = c
  }

  let total = items.length
  let hasContactId = items.filter(i => i.contact_id).length
  let hasEmail = items.filter(i => i.committed_by_email).length
  let hasBoth = items.filter(i => i.contact_id && i.committed_by_email).length
  let neitherLink = items.filter(i => !i.contact_id && !i.committed_by_email).length

  // contact_id set but email doesn't match contact's email
  let mismatch = items.filter(i => {
    if (!i.contact_id || !i.committed_by_email) return false
    const c = contactById[i.contact_id]
    if (!c || !c.email) return false
    return c.email.toLowerCase() !== i.committed_by_email.toLowerCase()
  })

  // has matching email but no contact_id
  let emailMatchNoId = items.filter(i => {
    if (i.contact_id || !i.committed_by_email) return false
    return !!contactByEmail[i.committed_by_email.toLowerCase()]
  })

  // has contact_id but no email, and contact has an email
  let idNoEmail = items.filter(i => {
    if (!i.contact_id || i.committed_by_email) return false
    const c = contactById[i.contact_id]
    return c && c.email
  })

  // totally unlinked (no contact_id, no email match)
  let fullyUnlinked = items.filter(i => {
    if (i.contact_id) return false
    if (!i.committed_by_email) return true
    return !contactByEmail[i.committed_by_email.toLowerCase()]
  })

  console.log(`\n── Data sync audit ──────────────────────`)
  console.log(`Total active items:          ${total}`)
  console.log(`Has contact_id:              ${hasContactId}`)
  console.log(`Has committed_by_email:      ${hasEmail}`)
  console.log(`Has both:                    ${hasBoth}`)
  console.log(`\n── Sync gaps ────────────────────────────`)
  console.log(`contact_id ≠ email mismatch: ${mismatch.length}`)
  if (mismatch.length > 0) mismatch.forEach(i => {
    const c = contactById[i.contact_id]
    console.log(`  item "${i.committed_by_name}" → contact email: ${c?.email}, item email: ${i.committed_by_email}`)
  })
  console.log(`Email match but no contact_id: ${emailMatchNoId.length}`)
  if (emailMatchNoId.length > 0) emailMatchNoId.slice(0,5).forEach(i => {
    console.log(`  "${i.committed_by_name}" <${i.committed_by_email}>`)
  })
  console.log(`contact_id but no email (contact has email): ${idNoEmail.length}`)
  if (idNoEmail.length > 0) idNoEmail.slice(0,5).forEach(i => {
    const c = contactById[i.contact_id]
    console.log(`  "${i.committed_by_name}" → contact: ${c?.name} <${c?.email}>`)
  })
  console.log(`Fully unlinked (no contact, no email match): ${fullyUnlinked.length}`)
  console.log(`─────────────────────────────────────────\n`)
}

main()
