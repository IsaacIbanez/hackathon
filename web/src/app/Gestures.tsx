import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientMessage, DocumentPayload } from '../api'
import { actionFor, createTracker, HandInteraction, type Point, type Tracker } from '../input/index.ts'
import { AutoListener, beep, DEFAULT_QUESTION, VoiceInput, type Speaker, type VoiceState } from '../input/voice/index.ts'
import { GestureBridge } from './bridge.ts'
import { blockAt, WHOLE_FRAME_AS_SEEN } from './pointing.ts'

// Until the document's corners come from the camera (B1), the whole camera frame is the
// document, mapped AS THE USER SEES IT (the preview is a mirror). The document's blocks are
// drawn over the preview so the user can see where each field is and where their finger points.

/** Without a pointer event for this long, the hand is no longer pointing. */
const POINTER_TIMEOUT_MS = 300
/** Preview aspect ratio (the camera is asked for 1280x720). */
const ASPECT = 16 / 9

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

interface GesturesProps {
  send: (m: ClientMessage) => void
  voice: Speaker
  lang: string
  /** Current document, to draw its fields over the preview. */
  doc: DocumentPayload | null
  /** Blocks the voice is talking about. */
  highlight: string[]
}

export function Gestures({ send, voice, lang, doc, highlight }: GesturesProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  // Where the fingertip points, in document coordinates (null = not pointing).
  const [pointer, setPointer] = useState<Point | null>(null)
  const lastPointerAt = useRef(0)
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
    interaction.setDocument(WHOLE_FRAME_AS_SEEN)
    const question = DEFAULT_QUESTION[lang.split('-')[0]] ?? DEFAULT_QUESTION.en
    const bridge = new GestureBridge(send, voice, {
      lang,
      onStartVolume: () => interaction.startLevel(),
      onDictate: () => void voiceInput.ask(),
    })
    const off = interaction.on((e) => {
      if (e.type === 'pointer') {
        lastPointerAt.current = performance.now()
        setPointer(e.document)
      }
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

    // The hand module only emits pointer events while pointing: clear the dot when they stop.
    const staleTimer = setInterval(() => {
      if (performance.now() - lastPointerAt.current > POINTER_TIMEOUT_MS) setPointer(null)
    }, 100)

    return () => {
      stopped = true
      clearInterval(staleTimer)
      setPointer(null)
      off()
      tracker?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on, send, voice, lang, voiceInput])

  const hovered = pointer && doc ? blockAt(doc.blocks, pointer) : null

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
          <PointingStatus pointer={pointer} hovered={hovered} />
          {/* The video is mirrored (it feels like a mirror); the overlay is drawn in document
              coordinates, which match what the user sees (WHOLE_FRAME_AS_SEEN). */}
          <div className="relative mt-4 w-full max-w-2xl overflow-hidden rounded-xl" style={{ aspectRatio: ASPECT }}>
            <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
            <svg aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              {doc?.blocks.map((b) => {
                const isHovered = hovered?.id === b.id
                const isSpoken = highlight.includes(b.id)
                return (
                  <rect
                    key={b.id}
                    x={b.box.x}
                    y={b.box.y}
                    width={b.box.w}
                    height={b.box.h}
                    fill={isHovered ? 'rgba(250, 204, 21, 0.55)' : isSpoken ? 'rgba(250, 204, 21, 0.25)' : 'rgba(255, 255, 255, 0.12)'}
                    stroke={isHovered ? '#facc15' : 'white'}
                    strokeWidth={isHovered ? 0.006 : 0.003}
                  />
                )
              })}
              {pointer && (
                <ellipse cx={pointer.x} cy={pointer.y} rx={0.018 / ASPECT} ry={0.018} fill="#38bdf8" stroke="white" strokeWidth={0.004} />
              )}
            </svg>
          </div>
        </>
      )}
    </section>
  )
}

/** Big, plain feedback for testing and for low vision: is the hand pointing, and at what. */
function PointingStatus({ pointer, hovered }: { pointer: Point | null; hovered: ReturnType<typeof blockAt> }) {
  let text = 'Point with your index finger (other fingers closed).'
  if (pointer && !hovered) text = '☝️ Pointing — move onto a box.'
  if (hovered) text = `☝️ ${hovered.text} — hold still to ask.`
  return <p className="mt-3 text-2xl font-semibold text-sky-200">{text}</p>
}
