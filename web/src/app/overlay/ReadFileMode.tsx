import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { GuidedReader } from '../../document/index.ts'
import { desktop, errorText } from './desktop.ts'
import { SummaryPanel } from './SummaryPanel.tsx'

// Option 3 (Didac, B2): choose a file on the computer (PDF, text, image) and listen to it line by
// line with the guided reader. Text and PDFs with text are instant; scanned PDFs and images go
// through the OCR of the reading service. No model is called. O opens another file.
export function ReadFileMode({ onCancel }: { onCancel: () => void }) {
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
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
      const res = await desktop().OpenAndReadFile()
      if (res.cancelled) {
        if (!hasDoc.current) onCancelRef.current()
        return
      }
      hasDoc.current = true
      setDoc(res.document)
      setMessage(
        res.document.blocks.length > 0
          ? `${res.name}: ${res.document.blocks.length} lines.`
          : `${res.name}: no text found in it.`,
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
      {doc && <GuidedReader doc={doc} autoPlay />}
      <SummaryPanel doc={doc} />
    </div>
  )
}
