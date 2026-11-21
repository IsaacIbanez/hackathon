import { useEffect, useRef, useState } from 'react'
import type { ClientMessage } from '../api'
import { createTracker, HandInteraction, type Corners, type Tracker } from '../input/index.ts'
import { GestureBridge } from './bridge.ts'
import type { Voice } from './voice.ts'

// PROVISIONAL until the team decides who owns the camera (see estado/P1-C.md): the whole
// camera frame is treated as the document, so pointing is mapped over the full image.
const WHOLE_FRAME: Corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

/** Short spoken-friendly labels for the on-screen (aria-live) confirmation of each action. */
const LABELS: Record<string, string> = {
  explain_here: 'Explain here',
  read: 'Read',
  ask_for_help: 'Help',
  pause: 'Pause',
  repeat: 'Repeat',
  adjust_volume: 'Volume',
  volume: 'Volume',
  dictate: 'Dictate',
}

export function Gestures({ send, voice, lang }: { send: (m: ClientMessage) => void; voice: Voice; lang: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  const [status, setStatus] = useState('')
  const [lastAction, setLastAction] = useState('')

  useEffect(() => {
    if (!on) return
    let tracker: Tracker | null = null
    let stream: MediaStream | null = null
    let stopped = false

    const interaction = new HandInteraction()
    interaction.setDocument(WHOLE_FRAME)
    const bridge = new GestureBridge(send, voice, {
      lang,
      onStartVolume: () => interaction.startLevel(),
    })
    const off = interaction.on((e) => {
      const action = bridge.handle(e)
      if (action) setLastAction(LABELS[action] ?? action)
    })

    ;(async () => {
      try {
        setStatus('Starting camera…')
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        const video = videoRef.current
        if (!video || stopped) return
        video.srcObject = stream
        await video.play()
        setStatus('Loading hand model…')
        tracker = await createTracker(video, (f) => interaction.process(f))
        if (stopped) tracker.stop()
        else setStatus('Ready: show your hand to the camera.')
      } catch (err) {
        setStatus(`Gestures unavailable: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()

    return () => {
      stopped = true
      off()
      tracker?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on, send, voice, lang])

  return (
    <section aria-label="Hand gestures" className="mt-8">
      <button
        type="button"
        className="rounded-xl border-2 border-yellow-400 px-6 py-3 text-xl font-bold"
        aria-pressed={on}
        onClick={() => setOn((v) => !v)}
      >
        {on ? 'Turn off hand gestures' : 'Turn on hand gestures'}
      </button>
      {on && (
        <>
          <p className="mt-2 text-lg text-slate-300">{status}</p>
          <p aria-live="assertive" className="mt-2 text-2xl font-bold text-yellow-300">
            {lastAction}
          </p>
          {/* Mirrored so it feels like a mirror; coordinates are taken from the unmirrored frame. */}
          <video ref={videoRef} muted playsInline className="mt-4 w-80 -scale-x-100 rounded-xl" />
        </>
      )}
    </section>
  )
}
