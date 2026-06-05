/**
 * InlineEdit — reusable inline editing for tasks, commitments, waiting-on, decisions
 *
 * Usage:
 *   <InlineEdit item={item} type="task" onSave={(id, patch) => updateTask(id, patch)} />
 *
 * When a user edits any field, user_modified: true is set — nightly AI job will
 * no longer overwrite urgency/due_date for that item (but still updates ai_context).
 */
import { useState, useRef, useEffect } from 'react'
import dayjs from 'dayjs'

const URGENCY_STYLES = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  high:     'text-orange-600 bg-orange-50 border-orange-200',
  medium:   'text-yellow-700 bg-yellow-50 border-yellow-200',
  low:      'text-gray-500 bg-gray-100 border-gray-200',
}

const URGENCY_LABELS = {
  critical: '🔴 Critical',
  high:     '🟠 High',
  medium:   '🟡 Medium',
  low:      '⚪ Low',
}

const DELIVERY_LABELS = {
  blocking_ryan: '🚧 Blocking',
  to_ryan:       '📬 Owed to me',
  general:       '📋 General',
}

function EditableTitle({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value)
  const inputRef              = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function save() {
    if (val.trim() && val.trim() !== value) onSave(val.trim())
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className="cursor-text hover:text-blue-600 transition-colors"
        title="Click to edit"
      >
        {value}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value); setEditing(false) } }}
      className="w-full text-sm font-medium border-b border-blue-400 bg-transparent focus:outline-none py-0.5"
    />
  )
}

export default function InlineEdit({ item, type, onSave }) {
  const [saving, setSaving] = useState(false)

  async function save(patch) {
    setSaving(true)
    try {
      await onSave(item.id, { ...patch, user_modified: true })
    } finally {
      setSaving(false)
    }
  }

  const aiContext = item.ai_context || item.context || null
  const dueDate   = item.due_date

  // Due date badge color
  const dueDays    = dueDate ? dayjs().diff(dayjs(dueDate), 'day') : null
  const dueBadge   = dueDate
    ? dueDays > 0  ? 'text-red-600 font-medium'
    : dueDays === 0 ? 'text-orange-600 font-medium'
    : 'text-[#6b6b67]'
    : 'text-[#9b9b97]'

  return (
    <div className="flex-1 min-w-0">

      {/* Title row — click to edit */}
      <div className="text-sm font-medium text-[#1a1a18] leading-snug">
        <EditableTitle
          value={item.title || ''}
          onSave={title => save({ title })}
        />
        {item.user_modified && (
          <span className="ml-1.5 text-[9px] text-blue-400 font-normal align-middle" title="You've edited this — AI won't overwrite your changes">✎</span>
        )}
      </div>

      {/* Badges row — urgency, delivery type, due date (all editable) */}
      <div className="flex items-center gap-1.5 flex-wrap mt-1">

        {/* Urgency — click to cycle */}
        {(type === 'task' || type === 'waiting') && item.urgency && (
          <select
            value={item.urgency}
            onChange={e => save({ urgency: e.target.value })}
            onClick={e => e.stopPropagation()}
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-pointer focus:outline-none ${URGENCY_STYLES[item.urgency] || 'text-gray-500 bg-gray-100 border-gray-200'}`}
          >
            <option value="critical">🔴 Critical</option>
            <option value="high">🟠 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">⚪ Low</option>
          </select>
        )}

        {/* Delivery type — for waiting-on */}
        {type === 'waiting' && item.delivery_type && (
          <select
            value={item.delivery_type}
            onChange={e => save({ delivery_type: e.target.value })}
            onClick={e => e.stopPropagation()}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[#e5e5e3] text-[#6b6b67] bg-white cursor-pointer focus:outline-none"
          >
            <option value="blocking_ryan">🚧 Blocking</option>
            <option value="to_ryan">📬 Owed to me</option>
            <option value="general">📋 General</option>
          </select>
        )}

        {/* Commitment type */}
        {type === 'commitment' && item.commitment_type && (
          <select
            value={item.commitment_type}
            onChange={e => save({ commitment_type: e.target.value })}
            onClick={e => e.stopPropagation()}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[#e5e5e3] text-[#6b6b67] bg-white cursor-pointer focus:outline-none"
          >
            <option value="hard">Hard deadline</option>
            <option value="soft">Soft deadline</option>
            <option value="conditional">Conditional</option>
          </select>
        )}

        {/* Due date — click to edit */}
        <span className="flex items-center gap-0.5">
          <input
            type="date"
            value={dueDate ? dueDate.split('T')[0] : ''}
            onChange={e => save({ due_date: e.target.value || null })}
            onClick={e => e.stopPropagation()}
            className={`text-[10px] border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-0 p-0 ${dueBadge}`}
          />
          {!dueDate && (
            <span className="text-[10px] text-[#c0c0bc]">No date</span>
          )}
        </span>

        {saving && <span className="text-[10px] text-blue-400">Saving…</span>}
      </div>

      {/* AI context subtext — always below, never editable */}
      {aiContext && (
        <p className="text-[11px] text-[#9b9b97] mt-1 leading-relaxed line-clamp-2 italic">
          {aiContext}
        </p>
      )}

      {/* Fulfillment evidence from AI */}
      {item.fulfillment_evidence && (
        <p className="text-[11px] text-green-600 mt-0.5 leading-relaxed line-clamp-1">
          ✓ {item.fulfillment_evidence}
        </p>
      )}

      {/* AI suggests complete */}
      {item.ai_suggests_complete && (
        <p className="text-[11px] text-amber-600 mt-0.5">
          ⚡ AI thinks this may be done
        </p>
      )}
    </div>
  )
}
