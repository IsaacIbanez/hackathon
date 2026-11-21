import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientMessage, DocumentPayload } from '../api'
import {
  actionFor,
  createTracker,
  drawHandOverlay,
  HandInteraction,
  type HandFrame,
  type Point,
  type Tracker,
} from '../input/index.ts'
import {
  AutoListener,
  beep,
  DEFAULT_QUESTION,
  FieldDictation,
  findFields,
  nextEmptyField,
  VoiceInput,
  watchMicLevel,
  type DictationState,
  type FormField,
  type Speaker,
  type VoiceState,
} from '../input/voice/index.ts'
import { DictationPanel } from '../input/voice/DictationPanel.tsx'
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

/** How a confirmed field value is told to Go (free text until the contract has a `fill` message). */
const CONFIRMED_VALUE: Record<string, (value: string, label: string | null) => string> = {
  es: (v, l) => (l ? `En el campo «${l}», mi respuesta confirmada es: «${v}».` : `Mi respuesta confirmada es: «${v}».`),
  en: (v, l) => (l ? `For the field "${l}", my confirmed answer is: "${v}".` : `My confirmed answer is: "${v}".`),
}

/** Said after saving: which field comes next. The user starts it; it never starts on its own. */
const NEXT_FIELD: Record<string, { next: (label: string) => string; done: string }> = {
  es: { next: (l) => `El siguiente es: ${l}. Señálalo o pulsa «Next field» cuando quieras.`, done: 'Ya están todos los campos.' },
  en: { next: (l) => `Next one: ${l}. Point at it or press "Next field" when you're ready.`, done: 'All the fields are done.' },
}

interface GesturesProps {
  send: (m: ClientMessage) => void
  voice: Speaker
  lang: string
  /** Current document, to draw its fields over the preview. */
  doc: DocumentPayload | null
  /** Blocks the voice is talking about. */
  highlight: string[]
  /** Saved field values, by block id. */
  values?: Record<string, string>
  /** A field value was confirmed by the user. */
  onFill?: (blockId: string, value: string) => void
  /** The field being dictated and its draft (null when not dictating). */
  onDraft?: (draft: { id: string; value: string } | null) => void
}

const NO_VALUES: Record<string, string> = {}

export function Gestures({ send, voice, lang, doc, highlight, values = NO_VALUES, onFill, onDraft }: GesturesProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  const listener = useMemo(() => new AutoListener(), [])
  const voiceInput = useMemo(
    () => new VoiceInput({ lang, listener, speaker: voice, send, beep, onState: setHeard }),
    [lang, listener, voice, send],
  )

  // Filling in a form: point at a field and hold, then say or spell the value. Nothing is saved
  // and nothing moves on until the user confirms ("sí" or 👍).
  const [fillMode, setFillMode] = useState(false)
  const fillModeRef = useRef(fillMode)
  useEffect(() => {
    fillModeRef.current = fillMode
  }, [fillMode])
  const [draft, setDraft] = useState<DictationState | null>(null)
  // Values saved without a document (no field to write them in), only listed in the panel.
  const [loose, setLoose] = useState<string[]>([])
  const fields = useMemo(() => findFields(doc?.blocks ?? []), [doc])
  // Read through refs inside the gesture and dictation callbacks (no camera restart on change).
  const fieldsRef = useRef(fields)
  const docRef = useRef(doc)
  const valuesRef = useRef(values)
  const onFillRef = useRef(onFill)
  const onDraftRef = useRef(onDraft)
  useEffect(() => {
    fieldsRef.current = fields
    docRef.current = doc
    valuesRef.current = values
    onFillRef.current = onFill
    onDraftRef.current = onDraft
  }, [fields, doc, values, onFill, onDraft])
  /** Field being filled right now. */
  const fieldRef = useRef<FormField | null>(null)
  const base = lang.split('-')[0]
  // The refs are only read inside the dictation's callbacks, never during render.
  const dictation = useMemo(
    () =>
      // oxlint-disable-next-line react/refs -- the refs are read in the callbacks, not during render
      new FieldDictation({
        lang,
        listener,
        speaker: voice,
        beep,
        onState: (s) => {
          setDraft(s)
          const f = fieldRef.current
          const active = s.phase === 'listening' || s.phase === 'speaking' || s.phase === 'paused'
          onDraftRef.current?.(active && f ? { id: f.id, value: s.value } : null)
        },
        onConfirm: (value, label) => {
          const f = fieldRef.current
          if (f) onFillRef.current?.(f.id, value)
          else setLoose((l) => [...l, value])
          const text = (CONFIRMED_VALUE[base] ?? CONFIRMED_VALUE.en)(value, label)
          send({ type: 'utterance', id: `utt-fill-${Date.now()}`, ts: Date.now(), payload: { text, isFinal: true, lang } })
          if (!f) return
          const t = NEXT_FIELD[base] ?? NEXT_FIELD.en
          const next = nextEmptyField(fieldsRef.current, { ...valuesRef.current, [f.id]: value }, f.id)
          return next ? t.next(next.label) : t.done
        },
      }),
    [lang, base, listener, voice, send],
  )
  useEffect(() => () => dictation.cancel(), [dictation])

  /** The field under the finger (same rule as the yellow box on screen), if it is a field. */
  const fieldUnder = useCallback((at: Point | null): FormField | null => {
    const d = docRef.current
    const b = at && d ? blockAt(d.blocks, at) : null
    return b ? (fieldsRef.current.find((f) => f.id === b.id) ?? null) : null
  }, [])

  /**
   * Starts filling a field: the one under the finger if there is one, otherwise the next empty
   * one. A field already saved can be pointed at again to correct it (it starts from its value).
   */
  const startField = useCallback(
    (at: Point | null) => {
      const fs = fieldsRef.current
      const f = fieldUnder(at) ?? nextEmptyField(fs, valuesRef.current, fieldRef.current?.id ?? null) ?? fs[0] ?? null
      fieldRef.current = f
      dictation.start(f?.label ?? null, f ? (valuesRef.current[f.id] ?? '') : '')
    },
    [dictation, fieldUnder],
  )

  // Microphone level while listening, so the user can see that they are being heard.
  const dictating = draft?.phase === 'listening'
  const listening = heard?.phase === 'listening' || dictating
  const [micLevel, setMicLevel] = useState(0)
  useEffect(() => {
    if (!listening) return
    let stop: (() => void) | null = null
    let cancelled = false
    watchMicLevel(setMicLevel)
      .then((s) => (cancelled ? s() : (stop = s)))
      .catch(() => setMicLevel(-1))
    return () => {
      cancelled = true
      stop?.()
      setMicLevel(0)
    }
  }, [listening])
  const [status, setStatus] = useState('')
  const [lastAction, setLastAction] = useState('')

  useEffect(() => {
    if (!on) return
    let tracker: Tracker | null = null
    let stream: MediaStream | null = null
    let stopped = false
    let frame: HandFrame | null = null
    let raf = 0

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
      // Form mode: point and hold starts (or switches to) a field; while filling it, 👍 saves,
      // 👎 undoes the last change and ✋ ends the current turn of talking.
      if (fillModeRef.current) {
        if (e.type === 'select') {
          const other = fieldUnder(e.document)
          if (!dictation.active || (other && other.id !== fieldRef.current?.id)) {
            setLastAction('Fill in this field')
            startField(e.document)
          } else if (dictation.state.phase === 'paused') {
            dictation.start()
          }
          return
        }
        if (dictation.active && e.type === 'gesture') {
          if (e.gesture === 'thumbs_up') {
            dictation.confirm()
            setLastAction('Save')
            return
          }
          if (e.gesture === 'thumbs_down') {
            dictation.undo()
            setLastAction('Undo')
            return
          }
          if (e.gesture === 'palm') {
            dictation.finishListening()
            setLastAction('Done')
            return
          }
        }
      }
      // ✋ while listening: "I'm done talking" (in a noisy room the silence never comes).
      if (local === 'pause' && voiceInput.listening) {
        voiceInput.finish()
        setLastAction('Done')
        return
      }
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
        // Skeleton, detected pose, quick menu and volume, drawn over the preview (role C).
        const paint = () => {
          if (stopped) return
          if (canvasRef.current) drawHandOverlay(canvasRef.current, video, frame, interaction, { drawVideo: false, drawPointer: false })
          raf = requestAnimationFrame(paint)
        }
        paint()
        setStatus('Loading hand model…')
        tracker = await createTracker(video, (f) => {
          frame = f
          interaction.process(f)
        })
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
      cancelAnimationFrame(raf)
      clearInterval(staleTimer)
      setPointer(null)
      off()
      tracker?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on, send, voice, lang, voiceInput, dictation, startField, fieldUnder])

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
      <label className="ml-4 inline-flex items-center gap-2 text-xl">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={fillMode}
          onChange={(e) => {
            setFillMode(e.target.checked)
            if (!e.target.checked) dictation.cancel()
          }}
        />
        Fill in a form
      </label>
      {fillMode && draft === null && (
        <p className="mt-2 text-lg text-emerald-200">
          {fields.length
            ? `${fields.length} fields found. Point at one and hold, or press the button, then say or spell the answer.`
            : 'No form fields yet: show a form to the camera (or Developer tools → Send sample document).'}
        </p>
      )}
      {fillMode && (
        <DictationPanel
          state={draft ?? { phase: 'idle', label: null, value: '', heard: '', message: '', canUndo: false }}
          filled={[
            ...fields.filter((f) => values[f.id]).map((f) => ({ label: f.label, value: values[f.id] })),
            ...loose.map((value) => ({ label: null, value })),
          ]}
          onConfirm={() => dictation.confirm()}
          onUndo={() => dictation.undo()}
          onResume={() => dictation.start()}
          onCancel={() => dictation.cancel()}
          onDoneTalking={() => dictation.finishListening()}
          onNewField={() => startField(null)}
        />
      )}
      {on && (
        <>
          <p className="mt-2 text-lg text-slate-300">{status}</p>
          {listening && (
            <div role="status" className="mt-3 rounded-xl border-2 border-sky-400 bg-sky-950 p-4">
              <p className="text-3xl font-bold text-sky-200">🎙️ Listening… speak now</p>
              <p className="mt-1 text-lg text-sky-300">Using {listener.name}</p>
              {micLevel >= 0 ? (
                <div aria-hidden="true" className="mt-3 h-5 w-full max-w-md overflow-hidden rounded-full bg-slate-700">
                  <div className="h-full bg-sky-400 transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
                </div>
              ) : (
                <p className="mt-2 text-lg text-red-300">Can't read the microphone level.</p>
              )}
              {/* While filling a field, the field panel shows the text and the buttons. */}
              {!dictating && heard?.text && <p className="mt-3 text-2xl text-white">{heard.text}</p>}
              {!dictating && (
                <>
                  <p className="mt-3 text-lg text-sky-300">Done? Show an open palm ✋ or press the button.</p>
                  <button
                    type="button"
                    className="mt-2 rounded-xl border-2 border-sky-300 px-5 py-2 text-xl font-bold text-sky-100"
                    onClick={() => voiceInput.finish()}
                  >
                    I'm done talking
                  </button>
                </>
              )}
            </div>
          )}
          {heard && !listening && heard.text && (
            <p aria-live="polite" className={`mt-2 text-2xl ${heard.phase === 'error' ? 'text-red-300' : 'text-sky-300'}`}>
              {heard.phase === 'heard' ? '✅ ' : ''}
              {heard.text}
            </p>
          )}
          <p aria-live="assertive" className="mt-2 text-2xl font-bold text-yellow-300">
            {lastAction}
          </p>
          <PointingStatus pointer={pointer} hovered={hovered} />
          {/* The video is mirrored (it feels like a mirror); the boxes are drawn in document
              coordinates, which match what the user sees (WHOLE_FRAME_AS_SEEN). The canvas on top
              draws the hand skeleton, the detected pose and the quick menu. */}
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
            </svg>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Detected hand and gesture"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            {/* The pointer goes on top of the menu, so it can be seen while choosing an option. */}
            <svg aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
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
