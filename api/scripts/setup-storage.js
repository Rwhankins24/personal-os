// personal-os — Supabase Storage Setup
// Run once: node api/scripts/setup-storage.js
// Creates the 'daily-reports' bucket used by the email pipeline.

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function setupStorage() {
  console.log('Setting up Supabase storage...')

  const { data, error } = await supabase
    .storage
    .createBucket('daily-reports', {
      public: false,
      fileSizeLimit: 10485760  // 10 MB
    })

  if (error) {
    if (error.message?.includes('already exists')) {
      console.log('✓ Bucket already exists: daily-reports')
    } else {
      console.error('✗ Bucket error:', error.message)
      process.exit(1)
    }
  } else {
    console.log('✓ Bucket created:', data)
  }

  // Verify the bucket is accessible
  const { data: buckets, error: listError } = await supabase
    .storage
    .listBuckets()

  if (listError) {
    console.error('✗ Could not list buckets:', listError.message)
  } else {
    const found = buckets.find(b => b.name === 'daily-reports')
    if (found) {
      console.log('✓ Bucket verified:', found.name, '— public:', found.public)
    } else {
      console.error('✗ Bucket not found after creation')
    }
  }
}

setupStorage()
