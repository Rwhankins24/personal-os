'use strict'
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── meeting-categories route ─────────────────────────────────────────────────
//
// GET  /api/meeting-categories                 — all global categories
// GET  /api/meeting-categories?project_id=X   — global + project-scoped
// GET  /api/meeting-categories?meeting_id=X   — categories assigned to a meeting
// POST /api/meeting-categories                 — create category
// PATCH /api/meeting-categories?id=X          — update category
// DELETE /api/meeting-categories?id=X         — delete category
//
// Category assignment (primary):
// PATCH /api/meeting-categories?assign=primary&meeting_id=X&category_id=Y
//
// Category assignment (secondary add/remove):
// POST  /api/meeting-categories?assign=secondary  body: { meeting_id, category_id }
// DELETE /api/meeting-categories?assign=secondary&meeting_id=X&category_id=Y
//
// Information-only toggle:
// PATCH /api/meeting-categories?toggle_info_only=1&meeting_id=X  body: { information_only }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { id, project_id, meeting_id, category_id, assign, toggle_info_only } = req.query

  try {

    // ── Toggle information_only flag ──────────────────────────────────────────
    // Information-only meetings: UI hides action items / commitments sections.
    // Nightly job also skips action item extraction. Context/intelligence still runs.
    if (req.method === 'PATCH' && toggle_info_only && meeting_id) {
      const { information_only } = req.body
      const { data, error } = await supabase
        .from('meeting_notes')
        .update({ information_only: !!information_only })
        .eq('id', meeting_id)
        .select('id, information_only')
        .single()
      if (error) throw error
      return res.json(data)
    }

    // ── Assign primary category to meeting ────────────────────────────────────
    // Sets needs_ai_reprocess so nightly job re-runs with category context tonight.
    if (req.method === 'PATCH' && assign === 'primary' && meeting_id) {
      const { data, error } = await supabase
        .from('meeting_notes')
        .update({
          primary_category_id: category_id || null,
          needs_ai_reprocess: true   // re-process tonight with category context
        })
        .eq('id', meeting_id)
        .select('id, primary_category_id, needs_ai_reprocess')
        .single()
      if (error) throw error
      return res.json(data)
    }

    // ── Add secondary category to meeting ─────────────────────────────────────
    if (req.method === 'POST' && assign === 'secondary') {
      const { meeting_id: bodyMeetingId, category_id: bodyCategoryId } = req.body
      const mId = bodyMeetingId || meeting_id
      const cId = bodyCategoryId || category_id
      if (!mId || !cId) return res.status(400).json({ error: 'meeting_id and category_id required' })

      const [insertResult] = await Promise.all([
        supabase
          .from('meeting_note_categories')
          .upsert({ meeting_note_id: mId, category_id: cId, assigned_by: 'manual' }, {
            onConflict: 'meeting_note_id,category_id',
            ignoreDuplicates: true
          }),
        // Flag for re-processing
        supabase
          .from('meeting_notes')
          .update({ needs_ai_reprocess: true })
          .eq('id', mId)
      ])
      if (insertResult.error) throw insertResult.error
      return res.status(201).json({ ok: true })
    }

    // ── Remove secondary category from meeting ────────────────────────────────
    if (req.method === 'DELETE' && assign === 'secondary') {
      if (!meeting_id || !category_id) return res.status(400).json({ error: 'meeting_id and category_id required' })
      await Promise.all([
        supabase
          .from('meeting_note_categories')
          .delete()
          .eq('meeting_note_id', meeting_id)
          .eq('category_id', category_id),
        supabase
          .from('meeting_notes')
          .update({ needs_ai_reprocess: true })
          .eq('id', meeting_id)
      ])
      return res.status(204).end()
    }

    // ── List categories assigned to a meeting ─────────────────────────────────
    if (req.method === 'GET' && meeting_id) {
      const [primaryResult, secondaryResult, meetingResult] = await Promise.all([
        // Get full meeting row to resolve primary_category_id
        supabase
          .from('meeting_notes')
          .select('primary_category_id, information_only')
          .eq('id', meeting_id)
          .single(),
        // Get secondary categories via junction
        supabase
          .from('meeting_note_categories')
          .select('category_id, assigned_at, assigned_by, meeting_categories(id, name, color, description, project_id)')
          .eq('meeting_note_id', meeting_id)
      ])

      let primaryCategory = null
      if (primaryResult.data?.primary_category_id) {
        const { data: pc } = await supabase
          .from('meeting_categories')
          .select('id, name, color, description, project_id')
          .eq('id', primaryResult.data.primary_category_id)
          .single()
        primaryCategory = pc
      }

      return res.json({
        information_only: primaryResult.data?.information_only ?? false,
        primary: primaryCategory,
        secondaries: (secondaryResult.data || []).map(r => r.meeting_categories).filter(Boolean)
      })
    }

    // ── List all categories (global + project-scoped) ─────────────────────────
    if (req.method === 'GET') {
      let query = supabase
        .from('meeting_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })

      if (project_id) {
        // Return global (project_id IS NULL) + this project's custom ones
        query = query.or(`project_id.is.null,project_id.eq.${project_id}`)
      } else {
        // Return global only
        query = query.is('project_id', null)
      }

      const { data, error } = await query
      if (error) throw error
      return res.json(data)
    }

    // ── Create category ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { name, description, color = '#64748b', project_id: pId, sort_order = 0 } = req.body
      if (!name) return res.status(400).json({ error: 'name required' })

      const { data, error } = await supabase
        .from('meeting_categories')
        .insert({ name, description, color, project_id: pId || null, sort_order })
        .select()
        .single()
      if (error) throw error
      return res.status(201).json(data)
    }

    // ── Update category ───────────────────────────────────────────────────────
    if (req.method === 'PATCH' && id) {
      const { name, description, color, sort_order } = req.body
      const updates = {}
      if (name        !== undefined) updates.name        = name
      if (description !== undefined) updates.description = description
      if (color       !== undefined) updates.color       = color
      if (sort_order  !== undefined) updates.sort_order  = sort_order

      const { data, error } = await supabase
        .from('meeting_categories')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return res.json(data)
    }

    // ── Delete category ───────────────────────────────────────────────────────
    if (req.method === 'DELETE' && id) {
      const { error } = await supabase
        .from('meeting_categories')
        .delete()
        .eq('id', id)
      if (error) throw error
      return res.status(204).end()
    }

    // ── Merge categories ──────────────────────────────────────────────────────
    // POST /api/meeting-categories?merge=1  body: { source_id, target_id }
    // Transfers all primary + secondary assignments from source → target, then
    // deletes the source category. Safe across all entity types that follow the
    // same junction table pattern.
    if (req.method === 'POST' && req.query.merge) {
      const { source_id, target_id } = req.body
      if (!source_id || !target_id) return res.status(400).json({ error: 'source_id and target_id required' })
      if (source_id === target_id)  return res.status(400).json({ error: 'source and target must differ' })

      // 1. Reassign primary on meeting_notes
      const { error: e1 } = await supabase
        .from('meeting_notes')
        .update({ primary_category_id: target_id, needs_ai_reprocess: true })
        .eq('primary_category_id', source_id)
      if (e1) throw e1

      // 2. Fetch source secondary rows so we can re-insert under target
      const { data: srcRows, error: e2 } = await supabase
        .from('meeting_note_categories')
        .select('meeting_note_id, assigned_by')
        .eq('category_id', source_id)
      if (e2) throw e2

      // 3. Upsert each row under target (ignore conflicts — meeting already has target)
      if (srcRows && srcRows.length > 0) {
        const inserts = srcRows.map(r => ({
          meeting_note_id: r.meeting_note_id,
          category_id:     target_id,
          assigned_by:     r.assigned_by || 'merge',
        }))
        const { error: e3 } = await supabase
          .from('meeting_note_categories')
          .upsert(inserts, { onConflict: 'meeting_note_id,category_id', ignoreDuplicates: true })
        if (e3) throw e3
      }

      // 4. Delete all source secondary rows
      const { error: e4 } = await supabase
        .from('meeting_note_categories')
        .delete()
        .eq('category_id', source_id)
      if (e4) throw e4

      // 5. Delete the source category itself
      const { error: e5 } = await supabase
        .from('meeting_categories')
        .delete()
        .eq('id', source_id)
      if (e5) throw e5

      return res.json({ ok: true, transferred: srcRows?.length || 0 })
    }

    return res.status(405).json({ error: 'Method not allowed' })

  } catch (err) {
    console.error('meeting-categories error:', err)
    return res.status(500).json({ error: err.message })
  }
}
