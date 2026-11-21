import { useEffect, useRef } from 'react'
import type { DocumentPayload } from '../api'

// Minimal accessible document view: the document's lines in large text, in reading order,
// with the lines the voice is talking about highlighted (and marked for screen readers).
// Role B2 can replace it with a richer view in web/src/document.

/** OCR confidence under which a line is marked as possibly misread. */
const UNCLEAR = 0.6

export function DocumentText({ doc, highlight }: { doc: DocumentPayload | null; highlight: string[] }) {
  const firstHighlighted = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    firstHighlighted.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight])

  if (!doc) {
    return <p className="text-2xl text-slate-300">Hold a document in front of the camera.</p>
  }

  // Reading order: top to bottom, then left to right (boxes are normalized to [0, 1]).
  const blocks = [...doc.blocks].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  const marked = new Set(highlight)
  const firstId = blocks.find((b) => marked.has(b.id))?.id

  return (
    <ol aria-label="Document" className="space-y-3 text-3xl leading-snug">
      {blocks.map((b) => {
        const on = marked.has(b.id)
        return (
          <li
            key={b.id}
            ref={b.id === firstId ? firstHighlighted : undefined}
            aria-current={on ? 'true' : undefined}
            className={
              on
                ? 'rounded-lg bg-yellow-300 px-3 py-2 font-bold text-slate-900'
                : 'rounded-lg px-3 py-2'
            }
          >
            {b.text}
            {b.confidence < UNCLEAR && <span className="ml-3 text-xl font-normal italic opacity-80">(unclear)</span>}
          </li>
        )
      })}
    </ol>
  )
}
