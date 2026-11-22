import { useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { captureStill, openCamera, startFramingGuide, type FramingGuide } from '../../camera/index.ts'
import { GuidedReader } from '../../document/index.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { blobToDataURL, desktop, errorText } from './desktop.ts'
import { SummaryPanel } from './SummaryPanel.tsx'

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
      setMessage(`${result.blocks.length} lines read.`)
    } catch (e) {
      const text = errorText(e)
      const noPage = text.startsWith('no_page')
      setPhase('error')
      setMessage(noPage ? 'No sheet found. Press Enter to try again.' : `Could not read it: ${text}. Press Enter to try again.`)
      speaker.speak({ text: noPage ? SAY.noPage : SAY.failed, lang: LANG })
    }
  }
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })

  // Each attempt: free the camera from Gesture Control, start the reading service, open the
  // camera and let the framing guide take the photo.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (await desktop().GesturesRunning()) await desktop().StopGestures() // one camera at a time
      } catch {
        // Outside the desktop app: the camera still works for trying the guide.
      }
      const service = desktop().EnsureReadingService().catch((e) => errorText(e))
      try {
        const stream = await openCamera()
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        setPhase('framing')
        setMessage('Hold the paper still in front of the camera (Enter = take the photo now).')
        speaker.speak({ text: SAY.start, lang: LANG })
        guideRef.current = startFramingGuide(video, {
          lang: LANG,
          onHint: (_hint, text) => speaker.speak({ text, lang: LANG }),
          onCapture: (still) => void readRef.current(still),
          onError: (err) => setMessage(`Framing guide stopped: ${errorText(err)}. Press Enter to take the photo.`),
        })
      } catch (e) {
        setPhase('error')
        setMessage(`No camera: ${errorText(e)}`)
      }
      const problem = await service
      if (problem && !cancelled) setMessage((m) => `${m} — Reading service: ${problem}`)
    })()
    return () => {
      cancelled = true
      stopCamera()
      speaker.stop()
    }
  }, [attempt, speaker])

  // Enter: take the photo now (framing) or try again (error / done).
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return
      e.preventDefault()
      if (phase === 'framing' && videoRef.current) {
        guideRef.current?.stop()
        void readRef.current(await captureStill(videoRef.current))
      } else if (phase === 'error' || phase === 'done') {
        setDoc(null)
        setPhase('starting')
        setMessage('Starting the camera…')
        setAttempt((a) => a + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-2xl">
        {message}
      </p>
      {(phase === 'starting' || phase === 'framing') && (
        <video ref={videoRef} muted playsInline className="max-h-[50vh] w-full rounded-xl bg-black object-contain" />
      )}
      {phase === 'done' && (
        <>
          <p className="text-lg text-slate-400">Enter = read another paper.</p>
          <GuidedReader doc={doc} autoPlay />
          <SummaryPanel doc={doc} />
        </>
      )}
    </div>
  )
}
