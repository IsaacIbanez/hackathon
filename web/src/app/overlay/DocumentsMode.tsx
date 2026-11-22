import { useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { captureStill, openCamera, startFramingGuide, type FramingGuide } from '../../camera/index.ts'
import { GuidedReader } from '../../document/index.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { blobToDataURL, desktop, errorText } from './desktop.ts'
import { Status } from './ui.tsx'

// Option 2 (Pau B1 + Didac B2): the camera with the spoken framing guide takes the photo on its own
// when the paper is still (Enter takes it now), the reading service reads it and the guided reader
// reads it aloud. Local and free: no model is called.

const LANG = 'es-ES'
const SAY = {
  start: 'Pon el papel delante de la cámara y no lo muevas.',
  reading: 'Un momento, estoy leyendo el documento.',
  noPage: 'No encuentro la hoja. Ponla entera delante de la cámara, plana, y pulsa Intro para repetir.',
  failed: 'No he podido leer el documento.',
}

type Phase = 'starting' | 'framing' | 'reading' | 'done' | 'error'

export function DocumentsMode() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const guideRef = useRef<FramingGuide | null>(null)
  const [speaker] = useState(() => new Speaker())
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState('Starting the camera…')
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [attempt, setAttempt] = useState(0)

  const stopCamera = () => {
    guideRef.current?.stop()
    guideRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const read = async (photo: Blob) => {
    stopCamera()
    setPhase('reading')
    setMessage('Reading the document…')
    speaker.speak({ text: SAY.reading, lang: LANG })
    try {
      const result = await desktop().ReadPhoto(await blobToDataURL(photo))
      speaker.stop()
      setDoc(result)
      setPhase('done')
      setMessage(`Done: ${result.blocks.length} lines. Listen below, or read another paper.`)
    } catch (e) {
      const text = errorText(e)
      const noPage = text.startsWith('no_page')
      setPhase('error')
      setMessage(noPage ? 'No sheet found. Hold the whole page flat in front of the camera, then try again.' : `The paper could not be read (${text}). Try again.`)
      speaker.speak({ text: noPage ? SAY.noPage : SAY.failed, lang: LANG })
    }
  }
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })

  // Each attempt: start the reading service, open the camera and let the framing guide take the
  // photo. (Gesture Control runs in option 1 of this same window and stops when leaving it, so the
  // camera is free here.)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const service = desktop().EnsureReadingService().catch((e) => errorText(e))
      try {
        const stream = await openCamera()
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        setPhase('framing')
        setMessage('Hold the paper still in front of the camera. The photo is taken on its own.')
        speaker.speak({ text: SAY.start, lang: LANG })
        guideRef.current = startFramingGuide(video, {
          lang: LANG,
          onHint: (_hint, text) => speaker.speak({ text, lang: LANG }),
          onCapture: (still) => void readRef.current(still),
          onError: (err) => setMessage(`The automatic photo stopped (${errorText(err)}). Take the photo with the button.`),
        })
      } catch (e) {
        setPhase('error')
        setMessage(`No camera found (${errorText(e)}). Connect one and try again.`)
      }
      const problem = await service
      if (problem && !cancelled) setMessage((m) => `${m} The reading service did not start: ${problem}`)
    })()
    return () => {
      cancelled = true
      stopCamera()
      speaker.stop()
    }
  }, [attempt, speaker])

  // Take the photo now (while framing) or start again (after an error or a read paper).
  const takeNow = async () => {
    if (phase !== 'framing' || !videoRef.current) return
    guideRef.current?.stop()
    void readRef.current(await captureStill(videoRef.current))
  }
  const again = () => {
    setDoc(null)
    setPhase('starting')
    setMessage('Starting the camera…')
    setAttempt((a) => a + 1)
  }
  const actions = useRef({ takeNow, again })
  useEffect(() => {
    actions.current = { takeNow, again }
  })

  // Enter does the same as the button on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return
      e.preventDefault()
      if (phase === 'framing') void actions.current.takeNow()
      else if (phase === 'error' || phase === 'done') actions.current.again()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  return (
    <div className="flex h-full flex-col gap-4">
      <Status tone={phase === 'error' ? 'warn' : 'info'}>{message}</Status>
      {(phase === 'starting' || phase === 'framing') && (
        <div className="relative min-h-[18rem] flex-1 overflow-hidden rounded-[1.5rem] border border-[var(--color-line)] bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          {phase === 'framing' && (
            <button type="button" onClick={() => void takeNow()} className="btn btn-primary absolute bottom-5 left-1/2 -translate-x-1/2 text-xl">
              Take the photo now <span className="kbd">Enter</span>
            </button>
          )}
        </div>
      )}
      {phase === 'error' && (
        <div>
          <button type="button" onClick={again} className="btn btn-primary text-xl">
            Try again <span className="kbd">Enter</span>
          </button>
        </div>
      )}
      {phase === 'done' && (
        <>
          <div>
            <button type="button" onClick={again} className="btn">
              Read another paper <span className="kbd">Enter</span>
            </button>
          </div>
          <GuidedReader doc={doc} autoPlay />
        </>
      )}
    </div>
  )
}
