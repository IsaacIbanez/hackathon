import { useCallback, useEffect, useState } from 'react'
import type { DocumentMessage, DocumentPayload, ServerMessage, SpeakPayload, StatsPayload } from '../api'
import { Cost } from './Cost'
import { collectDiagnostics, reportDiagnostics, type Diagnostics } from './diagnostics.ts'
import { DocumentText } from './DocumentText'
import { Gestures } from './Gestures'
import { useSocket } from './useSocket'
import { Speaker } from '../input/voice/speaker.ts'

/** Language of the spoken requests and default voice. */
const LANG = 'es-ES'

/** Sample insurance form, to try the app without the scanner (same as api/fixtures/document.json). */
function sampleDocument(): DocumentMessage {
  return {
    type: 'document',
    id: crypto.randomUUID(),
    ts: Date.now(),
    payload: {
      blocks: [
        { id: 'b1', text: 'AXA Seguros — Declaración de siniestro', box: { x: 0.08, y: 0.05, w: 0.84, h: 0.06 }, confidence: 0.97 },
        { id: 'b2', text: 'Nombre y apellidos: ____________', box: { x: 0.08, y: 0.18, w: 0.6, h: 0.04 }, confidence: 0.92 },
        { id: 'b3', text: 'Fecha del siniestro: __/__/____', box: { x: 0.08, y: 0.25, w: 0.5, h: 0.04 }, confidence: 0.88 },
        { id: 'b4', text: 'Firma del asegurado', box: { x: 0.55, y: 0.85, w: 0.35, h: 0.04 }, confidence: 0.61 },
      ],
      quality: { score: 0.9, issues: [] },
      lang: 'es',
    },
  }
}

export default function App() {
  // Role C's speaker: sentence by sentence, so pause/resume continue where they stopped.
  const [voice] = useState(() => new Speaker())
  const [doc, setDoc] = useState<DocumentPayload | null>(null)
  const [last, setLast] = useState<SpeakPayload | null>(null)
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [diag, setDiag] = useState<Diagnostics | null>(null)

  useEffect(() => {
    collectDiagnostics().then((d) => {
      setDiag(d)
      void reportDiagnostics(d)
    })
  }, [])

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'document': // the current document, whoever sent it (scanner or this UI)
          setDoc(msg.payload)
          setLast(null)
          break
        case 'speak':
          setLast(msg.payload)
          voice.speak(msg.payload)
          break
        case 'stats':
          setStats(msg.payload)
          break
      }
    },
    [voice],
  )
  const { status, send, url } = useSocket(onMessage)

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-slate-50">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-4xl font-bold">LauzHack project</h1>
        <p className="text-lg" role="status">
          Server: <strong>{status}</strong> <span className="text-slate-400">({url ?? '…'})</span>
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-label="Explanation">
          <p aria-live="polite" className="text-4xl leading-relaxed">
            {last?.text ?? (doc ? 'Reading the document…' : '')}
          </p>
          <Gestures send={send} voice={voice} lang={LANG} doc={doc} highlight={last?.highlightBlockIds ?? []} />
          <Cost stats={stats} />
        </section>

        <section aria-label="Document view" className="rounded-2xl border border-slate-700 p-6">
          <DocumentText doc={doc} highlight={last?.highlightBlockIds ?? []} />
        </section>
      </div>

      <details className="mt-10 text-lg text-slate-400">
        <summary>Developer tools</summary>
        <button
          type="button"
          className="mt-4 rounded-xl bg-yellow-400 px-6 py-3 text-xl font-bold text-slate-900 disabled:opacity-50"
          disabled={status !== 'connected'}
          onClick={() => send(sampleDocument())}
        >
          Send sample document
        </button>
        {diag && (
          <ul aria-label="Diagnostics" className="mt-4 space-y-1">
            <li>Speech output: {diag.speechSynthesis ? `yes, ${diag.voices} voices` : 'NO'}</li>
            <li>Spanish voices: {diag.spanishVoices.length ? diag.spanishVoices.join(', ') : 'NONE'}</li>
            <li>Speech recognition (dictation): {diag.speechRecognition ? 'yes' : 'NO'}</li>
            <li>Camera: {diag.camera ? `yes, ${diag.videoInputs} found` : 'NO'}</li>
          </ul>
        )}
      </details>
    </main>
  )
}
