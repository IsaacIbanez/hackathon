import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PdfPageReader, pdfKeyAction, type PageLoader, type PdfAction, type PdfState } from './pdfReader.ts'
import type { ReaderVoice } from './reader.ts'
import { defaultVoice } from './voice.ts'

// PDF viewer that reads the whole PDF aloud (task N4, docs/briefs/N4.md): the real page, a yellow
// box on the line being read, the same line very large at the bottom (like a subtitle), one big
// "Read the whole PDF" button and one-key controls. Pages are asked for one by one (no page limit).

export interface PdfSource {
  id: string
  name: string
  pages: number
  lang: string
}

const KEY_HINT: Record<PdfAction, string> = {
  toggle: 'Space',
  previous: '←',
  next: '→',
  repeat: 'R',
  stop: 'S',
  faster: '+',
  slower: '−',
  previousPage: 'PgUp',
  nextPage: 'PgDn',
  goToPage: 'G',
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.tagName && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export function PdfViewer({ pdf, loadPage, voice }: { pdf: PdfSource; loadPage: PageLoader; voice?: ReaderVoice }) {
  const [reader] = useState(() => new PdfPageReader(voice ?? defaultVoice(), loadPage, pdf.pages, pdf.lang))
  const [state, setState] = useState<PdfState>(reader.state)
  const [goTo, setGoTo] = useState('')
  const goToRef = useRef<HTMLInputElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => reader.onChange(setState), [reader])
  useEffect(() => {
    void reader.show(0)
    return () => reader.stop()
  }, [reader])

  // Keep the highlighted line in view on long pages.
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [state.page, state.line])

  const run = (action: PdfAction) => {
    switch (action) {
      case 'toggle':
        return reader.toggle()
      case 'previous':
        return reader.previous()
      case 'next':
        return reader.next()
      case 'repeat':
        return reader.repeat()
      case 'stop':
        return reader.stop()
      case 'faster':
        return reader.faster()
      case 'slower':
        return reader.slower()
      case 'previousPage':
        return reader.previousPage()
      case 'nextPage':
        return reader.nextPage()
      case 'goToPage':
        return goToRef.current?.focus()
    }
  }
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return
      const action = pdfKeyAction(e.code, e.key)
      if (!action) return
      e.preventDefault()
      if (!e.repeat || action !== 'toggle') runRef.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submitGoTo = (e: FormEvent) => {
    e.preventDefault()
    const n = Number.parseInt(goTo, 10)
    if (n >= 1 && n <= pdf.pages) void reader.goToPage(n - 1)
    setGoTo('')
    goToRef.current?.blur()
  }

  const { status, page, line, data, rate } = state
  const current = data && line >= 0 ? data.lines[line] : null
  const busy = status === 'playing' || status === 'loading'
  const main = busy ? '⏸ Pause' : status === 'paused' ? '▶ Continue' : status === 'finished' ? '↺ Read it again' : '▶ Read the whole PDF'
  const statusText =
    state.preparing !== null
      ? `Preparing page ${state.preparing + 1}… (a scanned page is read with OCR: a few seconds)`
      : status === 'loading'
        ? 'Loading…'
        : status === 'error'
        ? `Could not read page ${page + 1}: ${state.error}`
        : { idle: 'Ready', playing: 'Reading', paused: 'Paused', finished: 'Finished' }[status]
  const position = `Page ${page + 1} of ${pdf.pages}${data && data.lines.length ? ` · line ${Math.max(line, 0) + 1} of ${data.lines.length}` : ''}`

  const button = (action: PdfAction, label: string) => (
    <button
      type="button"
      onClick={() => run(action)}
      className="rounded-lg border border-slate-500 px-3 py-2 text-lg"
      aria-keyshortcuts={KEY_HINT[action]}
    >
      {label} <span className="text-sm opacity-70">{KEY_HINT[action]}</span>
    </button>
  )

  return (
    <section aria-label={`PDF ${pdf.name}`} className="space-y-3 pb-40">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-slate-900/95 py-2">
        <button
          type="button"
          onClick={() => run('toggle')}
          aria-keyshortcuts="Space"
          className="rounded-xl bg-yellow-300 px-5 py-3 text-2xl font-bold text-slate-900"
        >
          {main} <span className="text-base font-normal">Space</span>
        </button>
        {button('stop', '⏹ Stop')}
        {button('previous', '⏮ Line')}
        {button('next', 'Line ⏭')}
        {button('repeat', '↻ Repeat')}
        {button('previousPage', '⇞ Page')}
        {button('nextPage', 'Page ⇟')}
        <form onSubmit={submitGoTo} className="flex items-center gap-1 text-lg">
          <label htmlFor="pdf-go-to">Go to page (G)</label>
          <input
            id="pdf-go-to"
            ref={goToRef}
            inputMode="numeric"
            value={goTo}
            onChange={(e) => setGoTo(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), e.preventDefault())}
            className="w-20 rounded border border-slate-500 bg-slate-800 px-2 py-1"
            placeholder={`1–${pdf.pages}`}
          />
        </form>
        <span className="flex items-center gap-1 text-lg">
          {button('slower', '−')}
          <span aria-label="Speed">{rate.toFixed(2).replace(/0$/, '')}×</span>
          {button('faster', '+')}
        </span>
      </div>
      <p className="text-lg text-slate-300">
        {pdf.name} · {position} · {statusText}
        {data?.ocr ? ' · read with OCR' : ''}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {statusText}. {position}.
      </p>

      <div className="relative mx-auto max-w-3xl bg-white shadow-lg">
        {data ? (
          <img src={data.image} alt={`Page ${page + 1} of ${pdf.name}`} className="block w-full" />
        ) : (
          <div className="flex aspect-[210/297] items-center justify-center p-8 text-center text-2xl text-slate-600">{statusText}</div>
        )}
        {data && current && (
          <div
            ref={boxRef}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-sm bg-yellow-300/40 ring-4 ring-yellow-400"
            style={{
              left: `${current.box.x * 100 - 0.5}%`,
              top: `${current.box.y * 100 - 0.4}%`,
              width: `${current.box.w * 100 + 1}%`,
              height: `${current.box.h * 100 + 0.8}%`,
            }}
          />
        )}
      </div>

      {current && (
        <p
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 z-20 bg-black/90 px-6 py-4 text-center text-4xl leading-tight font-bold text-yellow-300"
        >
          {current.text}
        </p>
      )}
    </section>
  )
}
