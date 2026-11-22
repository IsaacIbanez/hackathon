import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../../api'
import { Speaker } from '../../input/voice/speaker.ts'
import { desktop, errorText, inDesktopApp } from './desktop.ts'
import { costLine, documentText, type SummaryResult } from './summary.ts'

// "Summarize with AI" (task N7, brief docs/briefs/N7.md): a button under the guided reader. The
// summary is shown in large text and read aloud with the local voice; the app's Speaker pauses the
// reader while it talks. Key S does the same. The cost of each summary is shown (AXA: frugality).

type State =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'done'; result: SummaryResult }
  | { phase: 'error'; message: string }

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function SummaryPanel({ doc }: { doc: DocumentPayload | null }) {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [speaker] = useState(() => new Speaker())
  const lang = doc?.lang || 'es-ES'

  // A new document: forget the old summary.
  useEffect(() => setState({ phase: 'idle' }), [doc])
  useEffect(() => () => speaker.stop(), [speaker])

  const summarize = useCallback(async () => {
    if (!doc) return
    setState({ phase: 'working' })
    speaker.speak({ text: lang.startsWith('es') ? 'Resumiendo el documento…' : 'Summarizing the document…', lang })
    try {
      if (!inDesktopApp()) throw new Error('Summaries only work in the desktop app.')
      const r = await desktop().Summarize(documentText(doc), lang)
      if (r.error) {
        setState({ phase: 'error', message: r.error })
        speaker.speak({ text: r.error, lang: 'en-US' })
        return
      }
      setState({ phase: 'done', result: r })
      speaker.speak({ text: r.speech, lang })
    } catch (e) {
      const message = errorText(e)
      setState({ phase: 'error', message })
      speaker.speak({ text: message, lang: 'en-US' })
    }
  }, [doc, lang, speaker])

  const run = useRef(summarize)
  useEffect(() => {
    run.current = summarize
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyS' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      if (isTyping(e.target)) return
      e.preventDefault()
      void run.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!doc) return null
  const working = state.phase === 'working'
  return (
    <section aria-label="Summary" className="space-y-3 rounded-2xl border-2 border-sky-300 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={working}
          onClick={() => void summarize()}
          aria-keyshortcuts="S"
          className="rounded-xl border-2 border-sky-300 px-4 py-2 text-xl font-bold disabled:opacity-50"
        >
          {working ? 'Summarizing…' : 'Summarize with AI'} <span className="text-base font-normal opacity-80">(S)</span>
        </button>
        {state.phase === 'done' && (
          <button
            type="button"
            onClick={() => speaker.speak({ text: state.result.speech, lang })}
            className="rounded-xl border border-slate-500 px-3 py-2 text-lg"
          >
            Read the summary again
          </button>
        )}
      </div>
      <div role="status" aria-live="polite">
        {state.phase === 'error' && <p className="text-2xl text-amber-300">{state.message}</p>}
        {state.phase === 'done' && (
          <div className="space-y-3">
            <p className="text-3xl leading-snug">{state.result.summary}</p>
            {state.result.actions.length > 0 && (
              <ul className="list-disc space-y-1 pl-8 text-2xl text-yellow-200">
                {state.result.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {state.result.truncated && (
              <p className="text-lg text-slate-400">The document was long: only its beginning was summarized.</p>
            )}
            <p className="text-base text-slate-400">{costLine(state.result)}</p>
          </div>
        )}
      </div>
    </section>
  )
}
