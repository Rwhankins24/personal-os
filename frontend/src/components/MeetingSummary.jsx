// MeetingSummary — renders structured meeting summary text (Plaud, Otter, or AI-generated)
// Handles: ## headings, **bold**, - bullets, • bullets, 1. numbered lists, plain paragraphs

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

export default function MeetingSummary({ text, compact = false }) {
  if (!text || !text.trim()) return null

  const lines = text.split('\n')
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

    // ## or ### Section heading
    if (trimmed.startsWith('##')) {
      const heading = trimmed.replace(/^#{2,3}\s*/, '')
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
    if (trimmed.startsWith('#')) {
      const heading = trimmed.replace(/^#+\s*/, '')
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
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      // Collect consecutive bullets into a list
      const bullets = []
      while (i < lines.length) {
        const bl = lines[i].trim()
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
    if (/^\d+\.\s/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
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
    if (trimmed.startsWith('**') && trimmed.endsWith('**') || trimmed.startsWith('**') && trimmed.endsWith(':**')) {
      elements.push(
        <p key={i} className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-[#1B2A4A] mt-2 mb-0.5`}>
          {trimmed.replace(/\*\*/g, '')}
        </p>
      )
      i++
      continue
    }

    // Plain text paragraph
    elements.push(
      <p key={i} className={`${compact ? 'text-xs' : 'text-sm'} text-[#1a1a18] leading-relaxed mb-1`}>
        {renderInline(trimmed)}
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}
