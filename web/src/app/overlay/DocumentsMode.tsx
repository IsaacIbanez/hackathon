import { useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { captureStill, openCamera, startFramingGuide, type FramingGuide } from '../../camera/index.ts'
import { GuidedReader, PdfViewer, type PdfSource } from '../../document/index.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { blobToDataURL, desktop, errorText, type ScanPdfKind } from './desktop.ts'
import { Status } from './ui.tsx'

// Option 2 (Pau B1 + Didac B2): the camera with the spoken framing guide takes the photo on its own
// when the paper is still (Enter takes it now) and the reading service reads it. The result is the
// scan's PDF, shown in the PDF viewer (N4); it is read aloud only when the person asks (Space or the
// button). The digital PDF is made only on request: it uses the paid vision model (docs/briefs/scan-preview.md).

const LANG = 'es-ES'
const SAY = {
  start: 'Pon el papel delante de la cámara y no lo muevas.',
  reading: 'Un momento, estoy leyendo el documento.',
  noPage: 'No encuentro la hoja. Ponla entera delante de la cámara, plana, y pulsa Intro para repetir.',
  failed: 'No he podido leer el documento.',
  ready: 'Ya está. Pulsa Espacio para escucharlo.',
  digitalReady: 'El PDF digital está listo. Pulsa Espacio para escucharlo.',
}

const PDF_LABEL: Record<ScanPdfKind, string> = { searchable: 'Scanned PDF', digital: 'Digital PDF' }

type Phase = 'starting' | 'framing' | 'reading' | 'pdf' | 'done' | 'error'

export function DocumentsMode() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const guideRef = useRef<FramingGuide | null>(null)
  const [speaker] = useState(() => new Speaker())
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState('Starting the camera…')
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [scanId, setScanId] = useState('')
  const [pdfs, setPdfs] = useState<Partial<Record<ScanPdfKind, PdfSource>>>({})
  const [shown, setShown] = useState<ScanPdfKind>('searchable')
  const [digitalBusy, setDigitalBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Answers that arrive after "Read another paper" belong to the old paper: they are dropped.
  const attemptRef = useRef(attempt)
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

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
    const mine = attemptRef.current
    try {
      const { scanId: id, document } = await desktop().ScanPaper(await blobToDataURL(photo))
      if (mine !== attemptRef.current) return
      setDoc(document)
      setScanId(id)
      if (!id) {
        // No PDF to show (SCANNER_URL=fixture): the lines, read only on request.
        speaker.speak({ text: SAY.ready, lang: LANG })
        setPhase('done')
        setMessage(`Done: ${document.blocks.length} lines. Space reads them aloud.`)
        return
      }
      setPhase('pdf')
      setMessage('Making the PDF…')
      try {
        const pdf = await desktop().ScanPDF(id, 'searchable')
        if (mine !== attemptRef.current) return
        setPdfs({ searchable: pdf })
        setShown('searchable')
        setMessage('Done: this is the PDF of your paper. Space reads it aloud.')
      } catch (e) {
        if (mine !== attemptRef.current) return
        setMessage(`The PDF could not be made (${errorText(e)}). The text is below: Space reads it aloud.`)
      }
      speaker.speak({ text: SAY.ready, lang: LANG })
      setPhase('done')
    } catch (e) {
      if (mine !== attemptRef.current) return
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
  const makeDigital = async () => {
    if (!scanId || digitalBusy) return
    const mine = attemptRef.current
    setDigitalBusy(true)
    setMessage('Making the digital PDF with the AI vision model. This takes up to half a minute…')
    try {
      const pdf = await desktop().MakeDigitalPDF(scanId)
      if (mine !== attemptRef.current) return
      setPdfs((p) => ({ ...p, digital: pdf }))
      setShown('digital')
      setMessage('Done: this is the digital PDF. Space reads it aloud.')
      speaker.speak({ text: SAY.digitalReady, lang: LANG })
    } catch (e) {
      if (mine !== attemptRef.current) return
      setMessage(`The digital PDF could not be made (${errorText(e)}). The scanned PDF is still here.`)
    } finally {
      setDigitalBusy(false)
    }
  }

  const again = () => {
    speaker.stop()
    setDoc(null)
    setScanId('')
    setPdfs({})
    setShown('searchable')
    setDigitalBusy(false)
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
        <div className="relative min-h-[18rem] flex-1 overflow-hidden rounded-card border border-edge bg-ink">
          <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          {phase === 'framing' && (
            <button type="button" onClick={() => void takeNow()} className="btn btn-primary absolute bottom-5 left-1/2 -translate-x-1/2 text-lead">
              Take the photo now <span className="kbd">Enter</span>
            </button>
          )}
        </div>
      )}
      {phase === 'error' && (
        <div>
          <button type="button" onClick={again} className="btn btn-primary text-lead">
            Try again <span className="kbd">Enter</span>
          </button>
        </div>
      )}
      {phase === 'done' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={again} className="btn">
              Read another paper <span className="kbd">Enter</span>
            </button>
            {(Object.keys(pdfs) as ScanPdfKind[]).length > 1 &&
              (['searchable', 'digital'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={shown === kind}
                  onClick={() => setShown(kind)}
                  className={shown === kind ? 'btn btn-primary' : 'btn'}
                >
                  {PDF_LABEL[kind]}
                </button>
              ))}
            {pdfs.searchable && !pdfs.digital && (
              <button type="button" disabled={digitalBusy} onClick={() => void makeDigital()} className="btn">
                {digitalBusy ? 'Making the digital PDF…' : 'Make digital PDF'}
              </button>
            )}
          </div>
          {pdfs[shown] ? (
            <PdfViewer key={pdfs[shown].id} pdf={pdfs[shown]} loadPage={(n) => desktop().PDFPage(pdfs[shown]!.id, n)} />
          ) : (
            <GuidedReader doc={doc} />
          )}
        </>
      )}
    </div>
  )
}
