// Gesture Control for the whole overlay (N1, Nil): one camera and one gesture engine for the app.
// The camera page (web/src/input/desktop) is built once and moved where it is shown:
// - "panel": a small camera view in the top-left corner of every screen (only the hand's points);
// - "full": the whole Gesture Control page in option 1 (controls, guide, log).
// It talks to Go through the GestureCall binding. While it runs, hiding the overlay shrinks it to a
// camera bubble instead (a hidden page would pause the camera), and the gesture menu opened from
// the bubble spreads over the whole screen. Option 2 (reading a paper) borrows the camera: it is
// paused meanwhile (pauseCamera / resumeCamera).
import { bindingFetch, HelperClient } from '../../input/desktop/client.ts'
import { mountGestureControl, type GestureControlHandle } from '../../input/desktop/gestureControl.ts'
import { desktop, inDesktopApp, onDesktopEvent } from './desktop.ts'

export type GestureVariant = 'panel' | 'full'

let root: HTMLDivElement | null = null
let handle: GestureControlHandle | null = null
let compact = false
let tMoved = -Infinity
let paused = false

/** The page's root, built and started the first time (null outside the desktop app). */
export function gestureRoot(): HTMLDivElement | null {
  if (root) return root
  if (!inDesktopApp()) return null
  const app = desktop()
  root = document.createElement('div')
  const helper = new HelperClient('', bindingFetch((m, p, b) => app.GestureCall(m, p, b)))
  handle = mountGestureControl(root, helper, {
    unreachable: 'Gesture Control did not answer inside the app (see build/bin/lauzhack.log).',
    // The gesture menu and the volume/brightness control need room: from the bubble Go spreads the
    // window over the screen; in the small panel the camera view grows over the window.
    onScreenOverlay: (need) => {
      root?.classList.toggle('expanded', need)
      void app.SetScreenOverlay(need).catch(() => {})
    },
    // Cursor mode on: the window becomes the bubble, out of the way; off: it comes back.
    onCursorMode: (on) => void app.SetCompact(on).catch(() => {}),
    // The bubble dodges the gesture cursor: clicks on it would go to this window, not to the
    // program below. It jumps to the other bottom corner when the cursor comes near.
    onPointer: (p) => {
      if (!compact || performance.now() - tMoved < 800 || !nearThisWindow(p)) return
      tMoved = performance.now()
      void app.MoveBubble().catch(() => {})
    },
  })
  void app.SetGesturesActive(true).catch(() => {})
  onDesktopEvent('overlay:compact', () => {
    compact = true
    handle?.setScreen(false)
    handle?.setCompact(true)
  })
  onDesktopEvent('overlay:screen', () => handle?.setScreen(true))
  onDesktopEvent('overlay:expanded', () => {
    compact = false
    handle?.setScreen(false)
    handle?.setCompact(false)
  })
  // A double click on the bubble brings the full window back.
  root.addEventListener('dblclick', () => {
    if (compact) void app.SetCompact(false)
  })
  return root
}

/** Shows the page as the small top-left panel or as the full Gesture Control page. */
export function setGestureVariant(variant: GestureVariant): void {
  if (!root) return
  root.classList.toggle('gc-panel', variant === 'panel')
  root.classList.toggle('gc-full', variant === 'full')
  handle?.resume()
}

/** Option 2 needs the camera: give it back until resumeCamera. */
export function pauseCamera(): void {
  if (!handle || paused) return
  paused = true
  handle.setCamera(false)
  // While paused there is no camera to keep alive: hiding the overlay may hide it again.
  void desktop().SetGesturesActive(false).catch(() => {})
}

export function resumeCamera(): void {
  if (!handle || !paused) return
  paused = false
  handle.setCamera(true)
  void desktop().SetGesturesActive(true).catch(() => {})
}

/** Whether a screen point ([0, 1] over the screen) is on this window or within ~15 % of it. */
function nearThisWindow(p: { x: number; y: number }): boolean {
  const sw = window.screen.width || 1
  const sh = window.screen.height || 1
  const m = 0.15
  const left = window.screenX / sw - m
  const right = (window.screenX + window.outerWidth) / sw + m
  const top = window.screenY / sh - m
  const bottom = (window.screenY + window.outerHeight) / sh + m
  return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom
}
