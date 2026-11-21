import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TextBlock } from '../../api/index.ts'
import { documentHomography, applyHomography } from '../../input/geometry.ts'
import { blockAt, WHOLE_FRAME_AS_SEEN } from '../pointing.ts'

const block = (id: string, x: number, y: number, w: number, h: number): TextBlock => ({ id, text: id, box: { x, y, w, h }, confidence: 1 })
const blocks = [
  block('section', 0, 0, 1, 0.5),
  block('field', 0.2, 0.2, 0.3, 0.05),
  block('signature', 0.55, 0.85, 0.35, 0.04),
]

test('same rule as Go: smallest box inside, else the nearest within reach', () => {
  const cases: Array<[number, number, string | null]> = [
    [0.3, 0.22, 'field'],
    [0.9, 0.4, 'section'],
    [0.7, 0.82, 'signature'],
    [0.7, 0.91, 'signature'],
    [0.3, 0.7, null],
    [0.5, 0.79, null],
  ]
  for (const [x, y, want] of cases) {
    assert.equal(blockAt(blocks, { x, y })?.id ?? null, want, `(${x}, ${y})`)
  }
})

test('the whole frame is mapped as the user sees it (mirror): left of the preview = left of the document', () => {
  const h = documentHomography(WHOLE_FRAME_AS_SEEN)
  assert.ok(h)
  // The user points at the LEFT of what they see: in the unmirrored camera image that is the RIGHT (x = 0.9).
  const seenLeft = applyHomography(h, { x: 0.9, y: 0.3 })!
  assert.ok(Math.abs(seenLeft.x - 0.1) < 1e-9 && Math.abs(seenLeft.y - 0.3) < 1e-9, JSON.stringify(seenLeft))
})
