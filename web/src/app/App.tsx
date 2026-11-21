import { useCallback, useState } from 'react'
import type { DocumentMessage, ServerMessage, SpeakPayload } from '../api'
import { useSocket } from './useSocket'

// Esqueleto (T2): conecta con el WebSocket y prueba el bucle document -> speak.
// Las pantallas reales llegan con T4–T8.

function hablar({ text, lang }: SpeakPayload) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

function documentoDeEjemplo(): DocumentMessage {
  return {
    type: 'document',
    id: crypto.randomUUID(),
    ts: Date.now(),
    payload: {
      blocks: [
        { id: 'b1', text: 'Declaración de siniestro', box: { x: 0.1, y: 0.05, w: 0.8, h: 0.06 }, confidence: 0.95 },
      ],
      quality: { score: 0.9, issues: [] },
      lang: 'es',
    },
  }
}

export default function App() {
  const [ultimo, setUltimo] = useState<SpeakPayload | null>(null)

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'speak') {
      setUltimo(msg.payload)
      hablar(msg.payload)
    }
  }, [])
  const { status, send, url } = useSocket(onMessage)

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-slate-50">
      <h1 className="text-4xl font-bold">Proyecto LauzHack</h1>

      <p className="mt-4 text-xl" role="status">
        Servidor: <strong>{status}</strong> <span className="text-slate-400">({url ?? '…'})</span>
      </p>

      <button
        type="button"
        className="mt-8 rounded-xl bg-yellow-400 px-6 py-4 text-2xl font-bold text-slate-900 disabled:opacity-50"
        disabled={status !== 'conectado'}
        onClick={() => send(documentoDeEjemplo())}
      >
        Enviar documento de ejemplo
      </button>

      <section aria-live="polite" className="mt-8 text-3xl leading-relaxed">
        {ultimo?.text}
      </section>
    </main>
  )
}
