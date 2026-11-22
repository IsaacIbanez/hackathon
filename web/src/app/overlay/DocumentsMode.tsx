import { useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { captureStill, openCamera } from '../../camera/index.ts'
import { GuidedReader, PdfViewer, type PdfSource } from '../../document/index.ts'
import { blobToDataURL, desktop, errorText, type ScanPdfKind } from './desktop.ts'
import { Status } from './ui.tsx'

// Option 2, PDF Scanner (Pau B1 + Didac B2, docs/briefs/scan-preview.md). The camera shows the paper
// and the photo is taken only when the person presses the button (or Enter); with Gesture Control's
// cursor mode the button is pressed with the hand. No automatic photo and no voice on its own.
// One photo gives two PDFs, always:
// - the scanned PDF: the photo as a searchable PDF (ready right after the text is read);
// - the AI version: the document rebuilt as a clean digital PDF by the vision model (~30 s more,
//   paid: about 0.03 USD a scan).
// Both are shown in the PDF viewer (N4), which reads aloud only when asked; «Download PDF» saves a copy
// of the one on screen.

const PDF_LABEL: Record<ScanPdfKind, string> = { searchable: 'Scanned PDF', digital: 'AI version' }

type Phase = 'starting' | 'framing' | 'reading' | 'done' | 'error'

export function DocumentsMode() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState('Starting the camera…')
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [pdfs, setPdfs] = useState<Partial<Record<ScanPdfKind, PdfSource>>>({})
  const [shown, setShown] = useState<ScanPdfKind>('searchable')
  const [aiState, setAiState] = useState<'idle' | 'making' | 'failed'>('idle')
  const [scanId, setScanId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  // Answers that arrive after "Read another paper" belong to the old paper: they are dropped.
  const attemptRef = useRef(attempt)
  useEffect(() => {
    attemptRef.current = attempt
  }, [attempt])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  /** The AI version, made right after the scanned PDF; the scanned one stays if it fails. */
  const makeAiVersion = async (id: string, mine: number) => {
    setAiState('making')
    try {
      const pdf = await desktop().MakeDigitalPDF(id)
      if (mine !== attemptRef.current) return
      setPdfs((p) => ({ ...p, digital: pdf }))
      setShown('digital')
      setAiState('idle')
      setMessage('Both PDFs are ready. This is the AI version; the scanned PDF is one click away.')
    } catch (e) {
      if (mine !== attemptRef.current) return
      setAiState('failed')
      setMessage(`The AI version could not be made (${errorText(e)}). The scanned PDF is below.`)
    }
  }

  const read = async (photo: Blob) => {
    stopCamera()
    setPhase('reading')
    setMessage('Reading the document…')
    const mine = attemptRef.current
    try {
      const { scanId: id, document } = await desktop().ScanPaper(await blobToDataURL(photo))
      if (mine !== attemptRef.current) return
      setDoc(document)
      if (!id) {
        // No PDF to show (SCANNER_URL=fixture): the lines, read only on request.
        setPhase('done')
        setMessage(`Done: ${document.blocks.length} lines. Space reads them aloud.`)
        return
      }
      setScanId(id)
      setMessage('Making the scanned PDF…')
      try {
        const pdf = await desktop().ScanPDF(id, 'searchable')
        if (mine !== attemptRef.current) return
        setPdfs({ searchable: pdf })
        setShown('searchable')
        setMessage('The scanned PDF is ready. Making the AI version (about half a minute)…')
      } catch (e) {
        if (mine !== attemptRef.current) return
        setMessage(`The scanned PDF could not be made (${errorText(e)}). Making the AI version…`)
      }
      setPhase('done')
      void makeAiVersion(id, mine)
    } catch (e) {
      if (mine !== attemptRef.current) return
      const text = errorText(e)
      setPhase('error')
      setMessage(
        text.startsWith('no_page')
          ? 'No sheet found. Hold the whole page flat in front of the camera, then take the photo again.'
          : `The paper could not be read (${text}). Try again.`,
      )
    }
  }

  // Each attempt: start the reading service and open the camera. The photo waits for the button.
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
        setMessage('Hold the paper in front of the camera, then press “Take photo”.')
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
    }
  }, [attempt])

  const takePhoto = async () => {
    if (phase !== 'framing' || !videoRef.current) return
    void read(await captureStill(videoRef.current))
  }

  /** Saves a copy of the PDF on screen where the person picks («Save as» dialog). */
  const savePdf = async () => {
    if (!scanId || saveState === 'saving') return
    const kind = shown
    setSaveState('saving')
    try {
      const path = await desktop().SaveScanPDF(scanId, kind)
      setSaveState('idle')
      if (path) setMessage(`${PDF_LABEL[kind]} saved in ${path}`)
    } catch (e) {
      setSaveState('failed')
      setMessage(`The PDF could not be saved (${errorText(e)}).`)
    }
  }

  const again = () => {
    setDoc(null)
    setPdfs({})
    setScanId(null)
    setSaveState('idle')
    setShown('searchable')
    setAiState('idle')
    setPhase('starting')
    setMessage('Starting the camera…')
    setAttempt((a) => a + 1)
  }
  const actions = useRef({ takePhoto, again })
  useEffect(() => {
    actions.current = { takePhoto, again }
  })

  // Enter does the same as the button on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return
      e.preventDefault()
      if (phase === 'framing') void actions.current.takePhoto()
      else if (phase === 'error' || phase === 'done') actions.current.again()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  const kinds = (['searchable', 'digital'] as const).filter((k) => pdfs[k])
  return (
    <div className="flex h-full flex-col gap-4">
      <Status tone={phase === 'error' || aiState === 'failed' || saveState === 'failed' ? 'warn' : 'info'}>{message}</Status>
      {(phase === 'starting' || phase === 'framing' || phase === 'reading') && (
        <div className="relative min-h-[18rem] flex-1 overflow-hidden rounded-card border border-edge bg-ink">
          <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          {phase === 'framing' && (
            // Big, so the hand's cursor can press it.
            <button
              type="button"
              onClick={() => void takePhoto()}
              className="btn btn-primary absolute bottom-6 left-1/2 min-h-[4.5rem] -translate-x-1/2 px-10 text-title"
            >
              Take photo <span className="kbd">Enter</span>
            </button>
          )}
        </div>
      )}
      {phase === 'error' && (
        <div>
          <button type="button" onClick={again} className="btn btn-primary min-h-[3.5rem] px-8 text-lead">
            Try again <span className="kbd">Enter</span>
          </button>
        </div>
      )}
      {phase === 'done' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {kinds.length > 1 &&
              kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={shown === kind}
                  onClick={() => setShown(kind)}
                  className={shown === kind ? 'btn btn-primary text-lead' : 'btn text-lead'}
                >
                  {PDF_LABEL[kind]}
                </button>
              ))}
            {scanId && pdfs[shown] && (
              <button
                type="button"
                onClick={() => void savePdf()}
                disabled={saveState === 'saving'}
                className="btn text-lead"
              >
                {saveState === 'saving' ? 'Saving…' : 'Download PDF'}
              </button>
            )}
            {aiState === 'making' && <span className="text-body text-fg-muted">Making the AI version…</span>}
            <button type="button" onClick={again} className="btn ml-auto text-lead">
              Read another paper <span className="kbd">Enter</span>
            </button>
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
