import { useEffect, useRef, useState } from 'react'
import { bindingFetch, HelperClient } from '../../input/desktop/client.ts'
import { mountGestureControl, type GestureControlHandle } from '../../input/desktop/gestureControl.ts'
import { desktop, errorText, inDesktopApp, onDesktopEvent } from './desktop.ts'

// Option 1 (Nil, role C): Gesture Control inside the overlay. The camera page (web/src/input/desktop)
// runs in this window and its actions go to Go through the GestureCall binding — no separate
// program. While it is open, hiding the overlay (the shortcut, or M) shrinks the window to a camera
// bubble in a corner instead, so the camera keeps following the hand; the shortcut or a double
// click on the bubble brings the full overlay back. From the bubble, opening the gesture menu (✊)
// or adjusting the volume/brightness spreads a see-through window over the whole screen with the
// options on top of what is open; it goes back to the bubble when done. Esc goes back to the menu
// and stops the camera.
export function GesturesMode() {
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(
    inDesktopApp() ? null : 'Only available in the desktop app (task overlay → build/bin/lauzhack.exe).',
  )

  useEffect(() => {
    if (!root.current || !inDesktopApp()) return
    const app = desktop()
    let compact = false
    let tMoved = -Infinity
    const helper = new HelperClient('', bindingFetch((m, p, b) => app.GestureCall(m, p, b)))
    let handle: GestureControlHandle | null = mountGestureControl(root.current, helper, {
      unreachable: 'Gesture Control did not answer inside the app (see build/bin/lauzhack.log).',
      // From the bubble, the menu and the volume/brightness control take the whole screen.
      onScreenOverlay: (need) => void app.SetScreenOverlay(need).catch(() => {}),
      // Cursor mode: get out of the way (the bubble) so the whole screen can be used with the mouse.
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
    void app.SetGesturesActive(true).catch((e) => setError(errorText(e)))
    const offCompact = onDesktopEvent('overlay:compact', () => {
      compact = true
      handle?.setScreen(false)
      handle?.setCompact(true)
    })
    const offScreen = onDesktopEvent('overlay:screen', () => handle?.setScreen(true))
    const offExpanded = onDesktopEvent('overlay:expanded', () => {
      compact = false
      handle?.setScreen(false)
      handle?.setCompact(false)
    })
    const el = root.current
    const expand = () => void app.SetCompact(false)
    el.addEventListener('dblclick', expand)
    return () => {
      offCompact()
      offScreen()
      offExpanded()
      el.removeEventListener('dblclick', expand)
      handle?.stop()
      handle = null
      void app.SetGesturesActive(false).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && inDesktopApp()) {
        e.preventDefault()
        void desktop().SetCompact(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="space-y-3">
      {error && <p className="text-2xl text-[var(--color-scan)]">{error}</p>}
      {inDesktopApp() && (
        <p className="flex flex-wrap items-center gap-3 text-lg text-[var(--color-mist)]">
          <button type="button" onClick={() => void desktop().SetCompact(true)} className="btn btn-primary">
            Shrink to a camera bubble <span className="kbd">M</span>
          </button>
          Gestures keep working while it is small. The shortcut or a double click brings this window back.
        </p>
      )}
      <div ref={root} />
    </div>
  )
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
