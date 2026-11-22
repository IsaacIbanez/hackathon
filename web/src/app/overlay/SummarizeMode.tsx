import { useEffect, useRef, useState } from 'react'
import { Speaker } from '../../input/voice/speaker.ts'
import { desktop, errorText, inDesktopApp, type SummaryResult } from './desktop.ts'

// Option 4 (Didac, B2): summarize the text selected in another program. Go copies the selection
// (the program that was in front when the overlay opened), summarizes it with the cheap model
// (locally without a key), copies the summary and shrinks this window to a bubble next to the
// pointer. Here it is said aloud and shown. R repeats it; Esc (or the shortcut) closes the bubble
// and gives the focus back to the program.

const SAY_NO_SELECTION: Record<string, string> = {
  'es-ES': 'No hay texto seleccionado. Selecciona un texto, abre esta ventana y pulsa 4.',
}

type State =
  | { phase: 'working' }
  | { phase: 'done'; result: SummaryResult }
  | { phase: 'error'; message: string; noSelection: boolean }

export function SummarizeMode({ onClose }: { onClose: () => void }) {
  const [speaker] = useState(() => new Speaker())
  const [state, setState] = useState<State>({ phase: 'working' })
  const started = useRef(false)

  // Runs once when the option opens (also under React's StrictMode).
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!inDesktopApp()) {
      queueMicrotask(() =>
        setState({ phase: 'error', message: 'Only available in the desktop app.', noSelection: false }),
      )
      return
    }
    desktop()
      .SummarizeSelection()
      .then((result) => {
        setState({ phase: 'done', result })
        speaker.speak({ text: result.summary, lang: result.lang || 'es-ES' })
      })
      .catch((e) => {
        const text = errorText(e)
        const noSelection = text.startsWith('no_selection')
        setState({ phase: 'error', message: noSelection ? text.replace(/^no_selection:\s*/, '') : text, noSelection })
        speaker.speak({ text: noSelection ? SAY_NO_SELECTION['es-ES'] : 'No he podido resumir el texto.', lang: 'es-ES' })
      })
  }, [speaker])

  useEffect(() => () => speaker.stop(), [speaker])

  // Esc closes the bubble (before the menu's own Esc, which would only go back to the menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.code === 'Escape') {
        e.preventDefault()
        speaker.stop()
        onClose()
        if (inDesktopApp()) void desktop().CloseSummary()
      } else if (e.code === 'KeyR' && state.phase === 'done') {
        e.preventDefault()
        speaker.speak({ text: state.result.summary, lang: state.result.lang || 'es-ES' })
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [speaker, onClose, state])

  return (
    <section aria-label="Summary" className="flex h-full flex-col gap-3">
      {state.phase === 'working' && (
        <p role="status" aria-live="polite" className="text-2xl">
          Summarizing the selected text…
        </p>
      )}
      {state.phase === 'done' && (
        <>
          <p role="status" aria-live="polite" className="overflow-auto text-xl leading-snug font-semibold">
            {state.result.summary}
          </p>
          <p className="text-sm text-slate-400">{details(state.result)}</p>
        </>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="text-xl text-amber-300">
          {state.message}
        </p>
      )}
      <p className="mt-auto text-sm text-slate-500">{state.phase === 'done' ? 'Esc closes · R repeats' : 'Esc closes'}</p>
    </section>
  )
}

function details(r: SummaryResult): string {
  const parts = [r.copied ? '✓ Copied' : 'Not copied']
  if (r.source === 'cloud') {
    parts.push(`summarized in the cloud${r.model ? ` (${r.model})` : ''}`)
    parts.push(r.cached ? 'cached, 0 $' : `${r.costUsd.toFixed(5)} $`)
    parts.push(`${(r.latencyMs / 1000).toFixed(1)} s`)
  } else if (r.source === 'local') {
    parts.push('summarized on this computer, 0 $')
  } else {
    parts.push('short text, read as it is')
  }
  if (r.truncated) parts.push(`only the first part of ${r.chars} characters`)
  return parts.join(' · ')
}
