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
    return <p className="text-2xl text-amber-300">Only available in the desktop app (task overlay → build/bin/lauzhack.exe).</p>
  }
  return (
    <div className="space-y-3">
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
      <GestureSlot variant="full" />
    </div>
  )
}
