import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientMessage } from '../api'
import { actionFor, createTracker, HandInteraction, type Corners, type Tracker } from '../input/index.ts'
import { AutoListener, beep, DEFAULT_QUESTION, VoiceInput, type Speaker, type VoiceState } from '../input/voice/index.ts'
import { GestureBridge } from './bridge.ts'

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

export function Gestures({ send, voice, lang }: { send: (m: ClientMessage) => void; voice: Speaker; lang: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  // Voice questions (role C): point and hold, or menu → dictate, then speak.
  const [askByVoice, setAskByVoice] = useState(true)
  // Read through a ref so toggling it doesn't restart the camera.
  const askByVoiceRef = useRef(askByVoice)
  useEffect(() => {
    askByVoiceRef.current = askByVoice
  }, [askByVoice])
  const [heard, setHeard] = useState<VoiceState | null>(null)
  const voiceInput = useMemo(
    () => new VoiceInput({ lang, listener: new AutoListener(), speaker: voice, send, beep, onState: setHeard }),
    [lang, voice, send],
  )
  const [status, setStatus] = useState('')
  const [lastAction, setLastAction] = useState('')

  useEffect(() => {
    if (!on) return
    let tracker: Tracker | null = null
    let stream: MediaStream | null = null
    let stopped = false

    const interaction = new HandInteraction()
    interaction.setDocument(WHOLE_FRAME)
    const question = DEFAULT_QUESTION[lang.split('-')[0]] ?? DEFAULT_QUESTION.en
    const bridge = new GestureBridge(send, voice, {
      lang,
      onStartVolume: () => interaction.startLevel(),
      onDictate: () => void voiceInput.ask(),
    })
    const off = interaction.on((e) => {
      const local = actionFor(e, 'document')
      // Point and hold: the pointer is already with Go; listen to the question about that spot
      // (if nothing is said, the default "what does this say?" is sent).
      if (askByVoiceRef.current && e.type === 'select' && voiceInput.available) {
        setLastAction('Listening…')
        void voiceInput.ask({ fallbackQuestion: question })
        return
      }
      // 👍 while the reading is paused: continue it locally instead of asking the model again.
      if (local === 'read' && voice.isPaused) {
        voice.resume()
        setLastAction('Continue')
        return
      }
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
  }, [on, send, voice, lang, voiceInput])

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
      <label className="ml-4 inline-flex items-center gap-2 text-xl">
        <input type="checkbox" className="h-6 w-6" checked={askByVoice} onChange={(e) => setAskByVoice(e.target.checked)} />
        Ask with my voice
      </label>
      {on && (
        <>
          <p className="mt-2 text-lg text-slate-300">{status}</p>
          {heard && heard.text && (
            <p aria-live="polite" className={`mt-2 text-2xl ${heard.phase === 'error' ? 'text-red-300' : 'text-sky-300'}`}>
              {heard.phase === 'listening' ? '🎙️ ' : ''}
              {heard.text}
            </p>
          )}
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
