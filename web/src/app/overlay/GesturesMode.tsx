import { useEffect } from 'react'
import { GestureSlot } from './GestureSlot.tsx'
import { desktop, inDesktopApp } from './desktop.ts'

// Option 1 (Nil, role C): the whole Gesture Control page (controls, guide, log). The camera and the
// gesture engine run for the whole overlay (gestureHost.ts): in the other screens they show as the
// small camera panel in the top-left corner. Hiding the overlay (the shortcut, M or the button)
// shrinks the window to a camera bubble so the gestures keep working; the shortcut or a double
// click on the bubble brings the full window back.
export function GesturesMode() {
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

  if (!inDesktopApp()) {
    return <p className="text-title text-warn">Only available in the desktop app (task overlay → build/bin/lauzhack.exe).</p>
  }
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-3 text-body text-fg-muted">
        <button type="button" onClick={() => void desktop().SetCompact(true)} className="btn btn-primary">
          Shrink to a camera bubble <span className="kbd">M</span>
        </button>
        Gestures keep working while it is small. The shortcut or a double click brings this window back.
      </p>
      <GestureSlot variant="full" />
    </div>
  )
}
