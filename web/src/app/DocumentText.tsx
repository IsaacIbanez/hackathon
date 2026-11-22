import { useEffect, useRef } from 'react'
import type { DocumentPayload } from '../api'
import { writeValue } from '../input/voice/formFields.ts'

// Minimal accessible document view: the document's lines in large text, in reading order,
// with the lines the voice is talking about highlighted (and marked for screen readers).
// Role B2 can replace it with a richer view in web/src/document.

/** OCR confidence under which a line is marked as possibly misread. */
const UNCLEAR = 0.6

export function DocumentText({
  doc,
  highlight,
  values = {},
  draft = null,
}: {
  doc: DocumentPayload | null
  highlight: string[]
  /** Values filled in by voice, by block id (written into the field's blank). */
  values?: Record<string, string>
  /** The field being dictated right now (not saved yet). */
  draft?: { id: string; value: string } | null
}) {
  const firstHighlighted = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    firstHighlighted.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight])

  if (!doc) {
    return <p className="text-title text-fg-muted">Hold a document in front of the camera.</p>
  }

  // Reading order: top to bottom, then left to right (boxes are normalized to [0, 1]).
  const blocks = [...doc.blocks].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  const marked = new Set(highlight)
  const firstId = blocks.find((b) => marked.has(b.id))?.id

  return (
    <ol aria-label="Document" className="space-y-3 text-display leading-snug">
      {blocks.map((b) => {
        const on = marked.has(b.id)
        const drafting = draft?.id === b.id
        const saved = values[b.id]
        if (drafting || saved) {
          return (
            <li
              key={b.id}
              aria-current={drafting ? 'step' : undefined}
              className={
                drafting
                  ? 'rounded-chip border-4 border-dashed border-accent px-3 py-2'
                  : 'rounded-chip border border-accent bg-surface-solid px-3 py-2'
              }
            >
              {writeValue(b.text, drafting ? draft!.value || '…' : saved)}
              <span className="ml-3 text-lead font-normal italic">{drafting ? '(draft, not saved)' : '✓ saved'}</span>
            </li>
          )
        }
        return (
          <li
            key={b.id}
            ref={b.id === firstId ? firstHighlighted : undefined}
            aria-current={on ? 'true' : undefined}
            className={
              on
                ? 'rounded-chip bg-accent px-3 py-2 font-bold text-on-accent'
                : 'rounded-chip px-3 py-2'
            }
          >
            {b.text}
            {b.confidence < UNCLEAR && <span className="ml-3 text-lead font-normal italic opacity-80">(unclear)</span>}
          </li>
        )
      })}
    </ol>
  )
}
