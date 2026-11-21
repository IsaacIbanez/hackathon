import { useEffect, useState } from 'react'
import { desktop, errorText } from './desktop.ts'

// Option 1 (Nil, role C): Gesture Control is a separate program with its own camera window
// (adapters/desktop). The overlay only starts and stops it; Enter toggles.
export function GesturesMode() {
  const [running, setRunning] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    desktop()
      .GesturesRunning()
      .then(setRunning)
      .catch((e) => setError(errorText(e)))

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      if (running) await desktop().StopGestures()
      else await desktop().StartGestures()
    } catch (e) {
      setError(errorText(e))
    }
    await refresh()
    setBusy(false)
  }

  // Opening the option starts the gestures; the status is polled (the program may exit on its own).
  useEffect(() => {
    let first = true
    const tick = async () => {
      try {
        const on = await desktop().GesturesRunning()
        if (first && !on) {
          first = false
          await desktop().StartGestures()
          setRunning(await desktop().GesturesRunning())
          return
        }
        first = false
        setRunning(on)
      } catch (e) {
        first = false
        setError(errorText(e))
      }
    }
    void tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault()
        if (!busy) void toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="space-y-4 text-2xl">
      <p role="status" aria-live="polite">
        {running === null ? 'Checking…' : running ? '✋ Gestures are ON: a small camera window follows your hand.' : 'Gestures are OFF.'}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="rounded-xl border-2 border-yellow-300 px-5 py-3 font-bold disabled:opacity-50"
      >
        {running ? 'Stop gestures' : 'Start gestures'} <span className="text-base font-normal opacity-80">(Enter)</span>
      </button>
      {error && <p className="text-amber-300">{error}</p>}
      <p className="text-lg text-slate-400">
        Gesture Control keeps running when the overlay is hidden. It uses the camera: the «Read a paper document» option stops it
        while it takes the photo.
      </p>
    </div>
  )
}
