// MeetingSummary — renders structured meeting summary text (Plaud, Otter, or AI-generated)
// Handles: ## headings, **bold**, - bullets, • bullets, 1. numbered lists,
//          inline **Label:** content sections, ALL CAPS Plaud-style, plain paragraphs

// Convert ALL CAPS string to sentence case (leave mixed-case strings alone)
function toSentenceCase(text) {
  if (!text) return text
  // Only transform if the majority of alpha chars are upper-case (Plaud style)
  const alpha = text.replace(/[^a-zA-Z]/g, '')
  if (alpha.length < 4) return text
  const upperCount = (text.match(/[A-Z]/g) || []).length
  if (upperCount / alpha.length < 0.7) return text
  // Sentence-case: first char upper, rest lower, but preserve acronyms? Keep it simple.
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

function renderInline(text) {
  // Split on **bold** markers and render spans
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-[#1a1a18]">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

// Parse a single-line paragraph that may be formatted as:
//   **Label:** content **Label2:** content2 - **Label3:** content3
// Returns an array of { label, content } objects, or null if no structure found.
function parseInlineSections(text) {
  // Match patterns like **Something:** text (possibly followed by more)
  // Also split on " - **" separator between labeled sections
  const sectionPattern = /\*\*([^*]+?)\*\*\s*:?\s*(.*?)(?=\s+-\s+\*\*|\s*\*\*[^*]+?\*\*\s*:|\s*$)/g
  const sections = []
  let match
  // First split on " - " separators between bold-labeled sections
  // to handle: "**A:** foo - **B:** bar"
  const parts = text.split(/\s+-\s+(?=\*\*)/)
  for (const part of parts) {
    const m = part.match(/^\*\*([^*]+?)\*\*:?\s*(.*)/)
    if (m) {
      sections.push({ label: m[1].replace(/:$/, ''), content: m[2].trim() })
    } else if (part.trim()) {
      sections.push({ label: null, content: part.trim() })
    }
  }
  // Only return structured result if we found at least one labeled section
  if (sections.some(s => s.label)) return sections
  return null
}

export default function MeetingSummary({ text, compact = false }) {
  if (!text || !text.trim()) return null

  // Pre-process: if the text has no newlines but contains " - " separators between
  // bold sections (wall-of-text format), split them into lines first.
  let processedText = text
  if (!text.includes('\n') && /\*\*[^*]+\*\*.*\s+-\s+\*\*/.test(text)) {
    processedText = text.replace(/\s+-\s+(?=\*\*)/g, '\n')
  }

  const lines = processedText.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trimEnd()
    const trimmed = line.trim()

    // Skip empty lines — handled as spacing between blocks
    if (!trimmed) {
      i++
      continue
    }

    // Convert ALL CAPS lines (Plaud legacy format) to sentence case
    const displayLine = toSentenceCase(trimmed)

    // ## or ### Section heading
    if (displayLine.startsWith('##')) {
      const heading = displayLine.replace(/^#{2,3}\s*/, '')
      elements.push(
        <div key={i} className={`${elements.length > 0 ? 'mt-4' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">
            {heading}
          </p>
        </div>
      )
      i++
      continue
    }

    // # Top-level heading (treat same as ##)
    if (displayLine.startsWith('#')) {
      const heading = displayLine.replace(/^#+\s*/, '')
      elements.push(
        <div key={i} className={`${elements.length > 0 ? 'mt-4' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b6b67] mb-1.5">
            {heading}
          </p>
        </div>
      )
      i++
      continue
    }

    // Bullet: - item or • item
    if (displayLine.startsWith('- ') || displayLine.startsWith('• ') || displayLine.startsWith('* ')) {
      // Collect consecutive bullets into a list
      const bullets = []
      while (i < lines.length) {
        const bl = toSentenceCase(lines[i].trim())
        if (bl.startsWith('- ') || bl.startsWith('• ') || bl.startsWith('* ')) {
          bullets.push(bl.replace(/^[-•*]\s+/, ''))
          i++
        } else {
          break
        }
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1 mb-1">
          {bullets.map((b, j) => (
            <li key={j} className="flex items-start gap-2">
              <span className="text-[#C9A84C] shrink-0 mt-0.5 text-xs">▸</span>
              <span className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed`}>
                {renderInline(b)}
              </span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Numbered list: 1. item
    if (/^\d+\.\s/.test(displayLine)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(toSentenceCase(lines[i].trim()))) {
        items.push(toSentenceCase(lines[i].trim()).replace(/^\d+\.\s+/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-1 mb-1 list-none">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2">
              <span className="text-[#6b6b67] shrink-0 text-xs font-medium mt-0.5 w-4">{j + 1}.</span>
              <span className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed`}>
                {renderInline(item)}
              </span>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Line that is entirely bold (e.g. **Ryan Hankins:**) — person label
    if (displayLine.startsWith('**') && (displayLine.endsWith('**') || displayLine.endsWith(':**'))) {
      elements.push(
        <p key={i} className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-[#1B2A4A] mt-2 mb-0.5`}>
          {displayLine.replace(/\*\*/g, '')}
        </p>
      )
      i++
      continue
    }

    // Inline labeled sections: **Label:** content (possibly multiple per line separated by " - ")
    // e.g. "**The Core Topic:** foo bar - **Compensation Details:** baz"
    if (displayLine.startsWith('**') && displayLine.includes(':**')) {
      const sections = parseInlineSections(displayLine)
      if (sections) {
        elements.push(
          <div key={i} className={`space-y-1 ${elements.length > 0 ? 'mt-1' : ''}`}>
            {sections.map((sec, j) => (
              <div key={j} className="flex items-start gap-1.5">
                {sec.label && (
                  <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-[#1B2A4A] shrink-0 mt-0.5`}>
                    {sec.label}:
                  </span>
                )}
                <span className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed`}>
                  {renderInline(sec.content)}
                </span>
              </div>
            ))}
          </div>
        )
        i++
        continue
      }
    }

    // Plain text paragraph — also handle ALL CAPS " - " separated Plaud format
    // e.g. "TOPIC ONE - TOPIC TWO - TOPIC THREE"
    if (!displayLine.startsWith('**') && displayLine.includes(' - ')) {
      const subParts = displayLine.split(' - ').map(s => s.trim()).filter(Boolean)
      if (subParts.length > 1) {
        elements.push(
          <ul key={i} className="space-y-1 mb-1">
            {subParts.map((b, j) => (
              <li key={j} className="flex items-start gap-2">
                <span className="text-[#C9A84C] shrink-0 mt-0.5 text-xs">▸</span>
                <span className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed`}>
                  {renderInline(b)}
                </span>
              </li>
            ))}
          </ul>
        )
        i++
        continue
      }
    }

    // Plain text paragraph
    elements.push(
      <p key={i} className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed mb-1`}>
        {renderInline(displayLine)}
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}
