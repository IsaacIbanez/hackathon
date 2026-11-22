import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { GuidedReader, PdfViewer, type PdfSource } from '../../document/index.ts'
import { desktop, errorText } from './desktop.ts'

// Option 3 (Didac, B2): choose a file on the computer and listen to it. A PDF opens in the PDF
// viewer, which shows the real pages and reads the whole PDF with one button, page by page (task N4,
// docs/briefs/N4.md). Text files and images are read line by line with the guided reader. Scanned
// pages and images go through the OCR of the reading service. No model is called. O opens another file.
export function ReadFileMode({ onCancel }: { onCancel: () => void }) {
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [pdf, setPdf] = useState<PdfSource | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(true)
  const hasDoc = useRef(false)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  })

  const open = useCallback(async () => {
    setBusy(true)
    try {
      const res = await desktop().OpenFileForReading()
      if (res.cancelled) {
        if (!hasDoc.current) onCancelRef.current()
        return
      }
      hasDoc.current = true
      if (res.kind === 'pdf') {
        setDoc(null)
        setPdf(res.pdf)
        setMessage(`${res.name}: ${res.pdf.pages} ${res.pdf.pages === 1 ? 'page' : 'pages'}. Space reads the whole PDF.`)
        return
      }
      const document = res.lines.document
      setPdf(null)
      setDoc(document)
      setMessage(
        document.blocks.length > 0 ? `${res.name}: ${document.blocks.length} lines.` : `${res.name}: no text found in it.`,
      )
    } catch (e) {
      setMessage(`Could not read the file: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }, [])

  // The file dialog opens as soon as the option is chosen (once, also under React's StrictMode).
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void open()
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyO' && !busy && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        void open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, open])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <p role="status" aria-live="polite" className="text-2xl">
          {busy ? 'Choose a document… (a scanned PDF or an image takes a few seconds per page)' : message}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void open()}
          className="rounded-xl border-2 border-yellow-300 px-4 py-2 text-xl font-bold disabled:opacity-50"
        >
          Open another file <span className="text-base font-normal opacity-80">(O)</span>
        </button>
      </div>
      {pdf && <PdfViewer key={pdf.id} pdf={pdf} loadPage={(n) => desktop().PDFPage(pdf.id, n)} />}
      {doc && <GuidedReader doc={doc} autoPlay />}
    </div>
  )
}
