import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Speaker } from '../../input/voice/speaker.ts'
import { desktop, errorText, inDesktopApp, type SummaryResult } from './desktop.ts'
import { Icon } from './ui.tsx'

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

  const close = () => {
    speaker.stop()
    onClose()
    if (inDesktopApp()) void desktop().CloseSummary()
  }

  // While Go copies and summarizes, the window is still the full-screen layer: a card in the middle.
  if (state.phase === 'working') {
    return (
      <div className="halo-layer grid place-items-center" style={{ '--accent': 'var(--color-accent)' } as CSSProperties}>
        <div className="glass flex items-center gap-4 rounded-full px-8 py-5" style={{ animation: 'rise .2s ease-out' }}>
          <span className="grid size-12 place-items-center rounded-full bg-fill-strong text-accent">
            <Icon name="ai" size={26} />
          </span>
          <p role="status" aria-live="polite" className="text-title">
            Summarizing the selected text…
          </p>
        </div>
      </div>
    )
  }

  // The bubble next to the pointer: the whole (small) window.
  return (
    <section
      aria-label="AI Summary"
      className="glass flex h-screen flex-col gap-3 rounded-panel p-5"
      style={{ '--accent': 'var(--color-accent)' } as CSSProperties}
    >
      <header className="flex items-center gap-3" style={{ '--wails-draggable': 'drag' } as CSSProperties}>
        <span className="grid size-10 place-items-center rounded-full bg-fill-strong text-accent">
          <Icon name="ai" size={22} />
        </span>
        <h1 className="flex-1 text-body font-bold text-fg-muted">AI Summary</h1>
        <button type="button" onClick={close} className="btn min-h-0 py-1.5 text-body" style={{ '--wails-draggable': 'no-drag' } as CSSProperties}>
          Close <span className="kbd">Esc</span>
        </button>
      </header>
      {state.phase === 'done' ? (
        <>
          <p role="status" aria-live="polite" className="min-h-0 flex-1 overflow-auto text-lead leading-snug font-bold [text-wrap:pretty]">
            {state.result.summary}
          </p>
          <ul className="flex flex-wrap gap-2 text-meta text-fg-muted" aria-label="About this summary">
            {details(state.result).map((d) => (
              <li key={d} className="rounded-full bg-fill px-3 py-1">
                {d}
              </li>
            ))}
            <li className="rounded-full bg-fill px-3 py-1">
              <span className="kbd">R</span> repeats
            </li>
          </ul>
        </>
      ) : (
        <p role="alert" className="flex-1 text-lead leading-snug text-warn">
          {state.message}
        </p>
      )}
    </section>
  )
}

function details(r: SummaryResult): string[] {
  const parts = [r.copied ? 'Copied to the clipboard' : 'Not copied']
  if (r.source === 'cloud') {
    parts.push(r.cached ? 'From the cache, 0 $' : `Cloud AI, ${r.costUsd.toFixed(5)} $`)
    parts.push(`${(r.latencyMs / 1000).toFixed(1)} s`)
  } else if (r.source === 'local') {
    parts.push('On this computer, 0 $')
  } else {
    parts.push('Short text, read as it is')
  }
  if (r.truncated) parts.push(`Only the start of ${r.chars} characters`)
  return parts
}
