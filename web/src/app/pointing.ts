// Which block a pointer is on. Same rule as backend/session (blockAt) so the screen shows
// exactly the block Go will read: inside several boxes → the smallest; inside none → the
// nearest within POINTER_REACH. Pure logic (runs under node --test).

import type { TextBlock } from '../api/index.ts'
import type { Corners, Point } from '../input/types.ts'

/** Keep in sync with PointerReach in backend/session/session.go. */
export const POINTER_REACH = 0.05

export function blockAt(blocks: readonly TextBlock[], p: Point): TextBlock | null {
  let inside: TextBlock | null = null
  let insideArea = Infinity
  let near: TextBlock | null = null
  let nearDist = POINTER_REACH
  for (const b of blocks) {
    const { x, y, w, h } = b.box
    const dx = Math.max(x - p.x, 0, p.x - (x + w))
    const dy = Math.max(y - p.y, 0, p.y - (y + h))
    if (dx === 0 && dy === 0) {
      if (w * h < insideArea) {
        inside = b
        insideArea = w * h
      }
      continue
    }
    const d = Math.hypot(dx, dy)
    if (d <= nearDist) {
      near = b
      nearDist = d
    }
  }
  return inside ?? near
}

/**
 * The whole camera frame as the document, AS THE USER SEES IT: the preview is a mirror, so the
 * document's top-left is the camera image's top-RIGHT. Pointing at the left of what you see
 * points at the left of the document. (The hand module's image coordinates are unmirrored.)
 */
export const WHOLE_FRAME_AS_SEEN: Corners = [
  { x: 1, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]
