import { useEffect, useRef, useState } from 'react'
import type { DocumentPayload } from '../api'
import { LineReader, keyAction, type ReaderAction, type ReaderState, type ReaderVoice } from './reader.ts'
import { defaultVoice, type WebSpeechVoice } from './voice.ts'

// Guided reading view (role B2): the whole document in large text, the line being read highlighted
// and kept in the middle of the screen, big buttons and one-key shortcuts (arrows, letters and the
// numeric keypad, so a hardware keypad can drive it later). Reading is local and free: no model.

const STATUS_TEXT: Record<ReaderState['status'], string> = {
  idle: 'Ready',
  playing: 'Reading',
  paused: 'Paused',
  finished: 'Finished',
}

const KEY_HINTS: Record<ReaderAction, string> = {
  previous: '← · Num 4',
  toggle: 'Space · Num 5',
  next: '→ · Num 6',
  repeat: 'R · Num 8',
}

const ARIA_KEYS: Record<ReaderAction, string> = {
  previous: 'ArrowLeft',
  toggle: 'Space',
  next: 'ArrowRight',
  repeat: 'R',
}

/** Typing in a field must not move the reader. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function GuidedReader({
  doc,
  voice,
  keyboard = true,
  autoPlay = false,
}: {
  doc: DocumentPayload | null
  /** Starts reading as soon as a document arrives (the overlay's options do). */
  autoPlay?: boolean
  /** Text-to-speech engine; the system voice by default. */
  voice?: ReaderVoice
  /** Global keyboard shortcuts (on by default). */
  keyboard?: boolean
}) {
  const [engine] = useState(() => voice ?? defaultVoice())
  const [reader] = useState(() => new LineReader(engine))
  const [state, setState] = useState<ReaderState>(reader.state)
  const currentRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => reader.onChange(setState), [reader])
  useEffect(() => {
    reader.load(doc)
    if (autoPlay && doc) reader.play()
  }, [reader, doc, autoPlay])
  useEffect(() => () => reader.stop(), [reader])

  // Keep the line being read in the middle of the screen.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [state.index, state.lines])

  // Tell the person when the voice cannot be the document's language (or there is no voice at all).
  // Checked once reading starts: the browser loads its voices late.
  let note: string | null = null
  if (state.status !== 'idle') {
    if ('spoken' in engine && engine.spoken === false) {
      note = 'No speech on this computer: the lines are only highlighted.'
    } else if ('hasVoiceFor' in engine && !(engine as WebSpeechVoice).hasVoiceFor(state.lang)) {
      note = `No ${state.lang} voice installed: using the default voice.`
    }
  }

  const run = (action: ReaderAction) => {
    switch (action) {
      case 'toggle':
        return reader.toggle()
      case 'previous':
        return reader.previous()
      case 'next':
        return reader.next()
      case 'repeat':
        return reader.repeat()
    }
  }
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return
      const action = keyAction(e.code)
      if (!action) return
      e.preventDefault() // Space must not scroll the page or press the focused button twice
      if (!e.repeat) runRef.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard])

  if (!doc || state.lines.length === 0) {
    return <p className="text-2xl text-[var(--color-mist)]">Scan a document first.</p>
  }

  const { lines, index, status } = state
  const position = `Line ${index + 1} of ${lines.length}`
  const button = (action: ReaderAction, label: string, extra = '') => (
    <button
      type="button"
      onClick={() => run(action)}
      aria-keyshortcuts={ARIA_KEYS[action]}
      className={`btn text-xl ${extra}`}
    >
      {label}
      <span className="kbd">{KEY_HINTS[action]}</span>
    </button>
  )

  return (
    <section aria-label="Guided reading" className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl bg-[rgb(16_24_50/0.96)] p-2">
        {button('previous', 'Previous line')}
        {button('toggle', status === 'playing' ? 'Pause' : 'Read', 'btn-primary')}
        {button('next', 'Next line')}
        {button('repeat', 'Repeat')}
        <p className="ml-2 text-lg text-[var(--color-mist)]">
          <strong className="text-[var(--color-snow)]">{STATUS_TEXT[status]}</strong> {position}
        </p>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {STATUS_TEXT[status]}. {position}.
      </p>
      {note && <p className="text-xl text-[var(--color-scan)]">{note}</p>}
      <ol aria-label="Document" className="space-y-3 text-3xl leading-snug">
        {lines.map((l, i) => {
          const on = i === index
          return (
            <li
              key={l.id}
              ref={on ? currentRef : undefined}
              aria-current={on ? 'true' : undefined}
              onClick={() => reader.goTo(i)}
              className={
                on
                  ? 'reading-mark cursor-pointer rounded-xl px-3 py-2 font-bold'
                  : 'cursor-pointer rounded-xl px-3 py-2 hover:bg-white/8'
              }
            >
              {l.text}
              {l.unclear && <span className="ml-3 text-xl font-normal opacity-75">(unclear)</span>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
