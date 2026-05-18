'use strict'
// personal-os — Process Archive Sweep
// Reads ~/personal-os/data/archive-sweep.json (written by Cowork skill)
// Deduplicates against existing Supabase contacts
// Inserts new contacts, enriches existing ones
// Writes review file for flagged entries
//
// Usage: node ~/personal-os/scripts/process-archive-sweep.js

const path = require('path')
const fs   = require('fs')
require('dotenv').config({ path: path.join(__dirname, '../api/.env') })

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const SWEEP_FILE  = path.join(__dirname, '../data/archive-sweep.json')
const REVIEW_FILE = path.join(__dirname, '../data/contact-sweep-review.json')

// ─── Normalisation helpers ──────────────────────────────────────────────────

function normalizeEmail(email) {
  if (!email) return ''
  return email.toLowerCase().trim()
}

function normalizeName(name) {
  if (!name) return ''
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function getDomain(email) {
  const e = normalizeEmail(email)
  const at = e.indexOf('@')
  return at >= 0 ? e.slice(at + 1) : ''
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'aol.com',
  'protonmail.com', 'pm.me', 'fastmail.com', 'hey.com',
])

function isFreeEmail(email) {
  return FREE_EMAIL_DOMAINS.has(getDomain(email))
}

// Jaccard-style word overlap similarity [0, 1]
function nameSimilarity(a, b) {
  if (!a || !b) return 0
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 1))
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 1))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / Math.max(wa.size, wb.size)
}

// ─── Match against existing contacts ───────────────────────────────────────

function findExistingContact(extracted, existingContacts) {
  const email  = normalizeEmail(extracted.email)
  const domain = getDomain(email)

  // Priority 1: exact email match
  const byEmail = existingContacts.find(c =>
    normalizeEmail(c.email) === email ||
    normalizeEmail(c.secondary_email) === email
  )
  if (byEmail) return { contact: byEmail, matchType: 'email_exact' }

  // Priority 2: name + domain (same person, different address)
  if (domain && !isFreeEmail(email)) {
    const byNameDomain = existingContacts.find(c => {
      if (!c.email) return false
      const cDomain = getDomain(c.email)
      return cDomain === domain && nameSimilarity(c.name, extracted.name) >= 0.67
    })
    if (byNameDomain) return { contact: byNameDomain, matchType: 'name_domain' }
  }

  // Priority 3: high-confidence full name match
  const byName = existingContacts.find(c =>
    nameSimilarity(c.name, extracted.name) >= 0.9
  )
  if (byName) return { contact: byName, matchType: 'name_fuzzy' }

  return null
}

// ─── Build enrichment update object ────────────────────────────────────────
// Never overwrites existing good data. Additive only.

function buildEnrichmentUpdates(extracted, existing) {
  const updates = {}

  // Title: fill if empty
  if (extracted.title && !existing.title) {
    updates.title = extracted.title
  }

  // Company: fill if empty; flag for review if different
  if (extracted.company) {
    if (!existing.company) {
      updates.company = extracted.company
    } else if (
      extracted.company.toLowerCase() !== existing.company.toLowerCase()
    ) {
      // Possible job change — flag, don't auto-overwrite
      updates.company_pending     = extracted.company
      updates.job_change_detected = true
    }
  }

  // Phones — additive: fill slot 1, then slot 2
  if (extracted.phone_mobile) {
    if (!existing.phone_mobile) {
      updates.phone_mobile = extracted.phone_mobile
    } else if (
      existing.phone_mobile !== extracted.phone_mobile &&
      !existing.phone_mobile_2
    ) {
      updates.phone_mobile_2 = extracted.phone_mobile
    }
  }

  if (extracted.phone_office) {
    if (!existing.phone_office) {
      updates.phone_office = extracted.phone_office
    } else if (
      existing.phone_office !== extracted.phone_office &&
      !existing.phone_office_2
    ) {
      updates.phone_office_2 = extracted.phone_office
    }
  }

  // LinkedIn, address: fill if empty
  if (extracted.linkedin && !existing.linkedin) updates.linkedin = extracted.linkedin
  if (extracted.address  && !existing.address)  updates.address  = extracted.address

  // Secondary email: if extracted email differs from primary
  const extEmail = normalizeEmail(extracted.email)
  if (
    extEmail &&
    extEmail !== normalizeEmail(existing.email) &&
    !existing.secondary_email
  ) {
    updates.secondary_email = extracted.email
  }

  // Always mark enrichment timestamp
  updates.enriched    = true
  updates.enriched_at = new Date().toISOString()

  return updates
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══ PROCESS ARCHIVE SWEEP ═══\n')

  // 1. Read sweep file
  if (!fs.existsSync(SWEEP_FILE)) {
    console.error(`ERROR: Sweep file not found at ${SWEEP_FILE}`)
    console.error('Run the archive-sweep skill in Cowork first.')
    process.exit(1)
  }

  const sweepRaw = fs.readFileSync(SWEEP_FILE, 'utf8')
  let sweep
  try {
    sweep = JSON.parse(sweepRaw)
  } catch (err) {
    console.error(`ERROR: Could not parse ${SWEEP_FILE}: ${err.message}`)
    process.exit(1)
  }

  const contacts = sweep.contacts || []
  console.log(`Sweep date:        ${sweep.sweep_date || 'unknown'}`)
  console.log(`Contacts in file:  ${contacts.length}`)
  console.log(`  High confidence: ${sweep.high_confidence || 0}`)
  console.log(`  Med confidence:  ${sweep.medium_confidence || 0}`)
  console.log(`  Low confidence:  ${sweep.low_confidence || 0}`)
  console.log('')

  // 2. Load all existing contacts
  console.log('Loading existing contacts from Supabase...')
  const { data: existingContacts, error: loadErr } = await supabase
    .from('contacts')
    .select('id, name, email, secondary_email, title, company, company_pending, ' +
            'phone_mobile, phone_mobile_2, phone_office, phone_office_2, ' +
            'linkedin, address, enriched, enriched_at, job_change_detected, ' +
            'relationship_warmth, last_contact_date')

  if (loadErr) {
    console.error(`ERROR loading contacts: ${loadErr.message}`)
    process.exit(1)
  }
  console.log(`Existing contacts: ${existingContacts.length}\n`)

  // 3. Process each extracted contact
  const results = {
    created: 0,
    enriched: 0,
    skipped_low_confidence: 0,
    skipped_no_match: 0,
    flagged_job_change: 0,
    errors: [],
  }
  const reviewItems = []

  for (const extracted of contacts) {
    try {
      // Skip low confidence unless they have at least a real name and email
      if (extracted.confidence === 'low') {
        results.skipped_low_confidence++
        continue
      }

      if (!extracted.email || !extracted.name) {
        results.skipped_no_match++
        continue
      }

      const match = findExistingContact(extracted, existingContacts)

      if (match) {
        // Enrich existing contact
        const { contact: existing, matchType } = match
        const updates = buildEnrichmentUpdates(extracted, existing)

        // Track job changes for review
        if (updates.job_change_detected) {
          results.flagged_job_change++
          reviewItems.push({
            type:           'job_change',
            contact_id:     existing.id,
            name:           existing.name,
            email:          existing.email,
            current_company: existing.company,
            detected_company: extracted.company,
            confidence:     extracted.confidence,
            match_type:     matchType,
          })
        }

        // Only update if we have substantive new data (more than just enriched_at)
        const substantiveKeys = Object.keys(updates).filter(
          k => !['enriched', 'enriched_at'].includes(k)
        )

        if (substantiveKeys.length > 0) {
          const { error: updateErr } = await supabase
            .from('contacts')
            .update(updates)
            .eq('id', existing.id)

          if (updateErr) {
            results.errors.push(`Update ${existing.email}: ${updateErr.message}`)
          } else {
            results.enriched++
            // Update local cache so subsequent matches see the new data
            Object.assign(existing, updates)
          }
        }

      } else {
        // Create new contact
        const today   = new Date().toISOString().split('T')[0]
        const domain  = getDomain(extracted.email)
        const company = extracted.company || (
          domain && !isFreeEmail(extracted.email)
            ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
            : null
        )

        const newContact = {
          name:              normalizeName(extracted.name),
          email:             normalizeEmail(extracted.email),
          title:             extracted.title   || null,
          company:           company           || null,
          phone_mobile:      extracted.phone_mobile  || null,
          phone_office:      extracted.phone_office  || null,
          linkedin:          extracted.linkedin      || null,
          address:           extracted.address       || null,
          last_contact_date: extracted.last_email_date || today,
          relationship_warmth: 'cool',
          enriched:          true,
          enriched_at:       new Date().toISOString(),
          notes:             `Imported from archive sweep (${extracted.confidence} confidence, ${extracted.email_count || 1} emails)`,
        }

        const { data: created, error: insertErr } = await supabase
          .from('contacts')
          .insert(newContact)
          .select()
          .single()

        if (insertErr) {
          results.errors.push(`Insert ${extracted.email}: ${insertErr.message}`)
        } else {
          results.created++
          // Add to local cache so we don't double-insert
          existingContacts.push(created)
        }
      }

    } catch (err) {
      results.errors.push(`Process ${extracted.email}: ${err.message}`)
    }
  }

  // 4. Write review file
  if (reviewItems.length > 0) {
    fs.writeFileSync(
      REVIEW_FILE,
      JSON.stringify({ generated_at: new Date().toISOString(), items: reviewItems }, null, 2),
      'utf8'
    )
    console.log(`Review file written: ${REVIEW_FILE}`)
    console.log(`  ${reviewItems.length} item(s) need review`)
  }

  // 5. Summary
  console.log('\n═══ RESULTS ═══')
  console.log(`✓ New contacts created:  ${results.created}`)
  console.log(`✓ Existing enriched:     ${results.enriched}`)
  console.log(`⚠ Job changes flagged:   ${results.flagged_job_change}`)
  console.log(`  Low conf skipped:      ${results.skipped_low_confidence}`)
  if (results.errors.length > 0) {
    console.log(`\n✗ Errors (${results.errors.length}):`)
    results.errors.forEach(e => console.log(`  - ${e}`))
  }
  console.log('\nDone. Check /contacts in your dashboard.')
  if (reviewItems.length > 0) {
    console.log(`Review flagged items: cat ${REVIEW_FILE}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
