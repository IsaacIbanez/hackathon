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
    const helper = new HelperClient('', bindingFetch((m, p, b) => app.GestureCall(m, p, b)))
    let handle: GestureControlHandle | null = mountGestureControl(root.current, helper, {
      unreachable: 'Gesture Control did not answer inside the app (see build/bin/lauzhack.log).',
      // From the bubble, the menu and the volume/brightness control take the whole screen.
      onScreenOverlay: (need) => void app.SetScreenOverlay(need).catch(() => {}),
    })
    void app.SetGesturesActive(true).catch((e) => setError(errorText(e)))
    const offCompact = onDesktopEvent('overlay:compact', () => {
      handle?.setScreen(false)
      handle?.setCompact(true)
    })
    const offScreen = onDesktopEvent('overlay:screen', () => handle?.setScreen(true))
    const offExpanded = onDesktopEvent('overlay:expanded', () => {
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
      {error && <p className="text-2xl text-amber-300">{error}</p>}
      {inDesktopApp() && (
        <p className="text-lg text-slate-400">
          <button
            type="button"
            onClick={() => void desktop().SetCompact(true)}
            className="mr-2 rounded-lg border border-slate-500 px-3 py-1 text-slate-100"
          >
            Shrink to a camera bubble (M)
          </button>
          The gestures keep working while it is small; the shortcut or a double click brings this window back.
        </p>
      )}
      <div ref={root} />
    </div>
  )
}
