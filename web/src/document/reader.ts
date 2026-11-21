// Guided reading (role B2): reads the document aloud line by line, on its own, with pause, previous,
// next and repeat. Pure logic, no DOM: the view (GuidedReader.tsx) shows the state and the voice
// is injected, so it is tested without a browser. Reading uses no model at all (0 $).

import type { DocumentPayload } from '../api'

/** OCR confidence under which a line is read with a warning (same threshold as DocumentText). */
export const UNCLEAR = 0.6

export interface ReaderLine {
  id: string
  text: string
  unclear: boolean
}

/** What the reader needs from a text-to-speech engine. */
export interface ReaderVoice {
  /**
   * Says a text, replacing whatever this voice was saying. Calls onEnd when it finishes on its own
   * and onInterrupt when something else cut it off (another voice, an error).
   */
  say(text: string, lang: string, events: { onEnd(): void; onInterrupt(): void }): void
  /** Stops speaking. It may still call onInterrupt for the cancelled text (the reader ignores it). */
  cancel(): void
}

export type ReaderStatus = 'idle' | 'playing' | 'paused' | 'finished'

export interface ReaderState {
  status: ReaderStatus
  /** Index of the current line in `lines`. */
  index: number
  lines: ReaderLine[]
  lang: string
}

export type ReaderAction = 'toggle' | 'previous' | 'next' | 'repeat'

/** Keyboard shortcuts. The numeric keypad keys let a hardware keypad drive the reader later. */
const KEYS: Record<string, ReaderAction> = {
  Space: 'toggle',
  Numpad5: 'toggle',
  ArrowLeft: 'previous',
  Numpad4: 'previous',
  ArrowRight: 'next',
  Numpad6: 'next',
  KeyR: 'repeat',
  Numpad8: 'repeat',
}

/** The action for a KeyboardEvent.code, or null. */
export function keyAction(code: string): ReaderAction | null {
  return KEYS[code] ?? null
}

/** The document's lines in reading order: top to bottom, then left to right; empty lines skipped. */
export function readingOrder(doc: DocumentPayload | null): ReaderLine[] {
  if (!doc) return []
  return [...doc.blocks]
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
    .map((b) => ({ id: b.id, text: b.text.replace(/\s+/g, ' ').trim(), unclear: b.confidence < UNCLEAR }))
    .filter((l) => l.text !== '')
}

/** Spoken phrases, in the document's language (the reading itself is in that language). */
const PHRASES: Record<string, { unclear: string; end: string }> = {
  es: {
    unclear: 'No se lee bien:',
    end: 'Fin del documento.',
  },
  ca: {
    unclear: 'No es llegeix bé:',
    end: 'Final del document.',
  },
  en: {
    unclear: 'Unclear:',
    end: 'End of the document.',
  },
}

function phrases(lang: string) {
  return PHRASES[lang.split('-')[0].toLowerCase()] ?? PHRASES.es
}

/** What is said for a line: unclear lines are announced first. */
export function spokenText(line: ReaderLine, lang: string): string {
  return line.unclear ? `${phrases(lang).unclear} ${line.text}` : line.text
}

/** Speech language for a document: its `lang` (es, ca, en…) as a BCP 47 tag; Spanish by default. */
export function speechLang(lang: string | undefined | null): string {
  const base = (lang ?? '').split('-')[0].toLowerCase()
  return { es: 'es-ES', ca: 'ca-ES', en: 'en-GB' }[base] ?? (lang || 'es-ES')
}

export class LineReader {
  private voice: ReaderVoice
  private listeners = new Set<(s: ReaderState) => void>()
  private lines: ReaderLine[] = []
  private index = 0
  private status: ReaderStatus = 'idle'
  private lang = 'es-ES'
  /** Increases on every new utterance so callbacks from older ones are ignored. */
  private run = 0

  constructor(voice: ReaderVoice) {
    this.voice = voice
  }

  get state(): ReaderState {
    return { status: this.status, index: this.index, lines: this.lines, lang: this.lang }
  }

  get current(): ReaderLine | null {
    return this.lines[this.index] ?? null
  }

  onChange(listener: (s: ReaderState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Loads a document (or clears it with null) and goes back to the first line, without speaking. */
  load(doc: DocumentPayload | null): void {
    this.silence()
    this.lines = readingOrder(doc)
    this.lang = speechLang(doc?.lang)
    this.index = 0
    this.status = 'idle'
    this.emit()
  }

  /** Starts or resumes reading at the current line (from the start if it had finished). */
  play(): void {
    if (this.lines.length === 0) return
    if (this.status === 'finished') this.index = 0
    this.speakCurrent()
  }

  /** Stops speaking; play() resumes at the start of the same line. */
  pause(): void {
    if (this.status !== 'playing') return
    this.silence()
    this.status = 'paused'
    this.emit()
  }

  toggle(): void {
    if (this.status === 'playing') this.pause()
    else this.play()
  }

  /** Reads the next line and goes on from there; past the last line, the document ends. */
  next(): void {
    if (this.lines.length === 0) return
    if (this.index >= this.lines.length - 1) return this.finish()
    this.index++
    this.speakCurrent()
  }

  /** Reads the previous line (the first one again at the start) and goes on from there. */
  previous(): void {
    if (this.lines.length === 0) return
    if (this.status === 'finished') this.index = this.lines.length - 1
    else this.index = Math.max(0, this.index - 1)
    this.speakCurrent()
  }

  /** Reads the current line again (the last one if the document had finished). */
  repeat(): void {
    if (this.lines.length === 0) return
    this.speakCurrent()
  }

  /** Jumps to a line by index or block id and reads from there. */
  goTo(target: number | string): void {
    const i = typeof target === 'number' ? target : this.lines.findIndex((l) => l.id === target)
    if (i < 0 || i >= this.lines.length) return
    this.index = i
    this.speakCurrent()
  }

  /** Stops and forgets the position (the document stays loaded). */
  stop(): void {
    this.silence()
    this.index = 0
    this.status = 'idle'
    this.emit()
  }

  private speakCurrent(): void {
    const line = this.current
    if (!line) return
    const run = ++this.run
    this.status = 'playing'
    this.emit()
    this.voice.say(spokenText(line, this.lang), this.lang, {
      onEnd: () => {
        if (run !== this.run || this.status !== 'playing') return
        if (this.index >= this.lines.length - 1) this.finish()
        else {
          this.index++
          this.speakCurrent()
        }
      },
      // Another voice cut in (the assistant answering, for example): stay on this line, paused.
      onInterrupt: () => {
        if (run !== this.run || this.status !== 'playing') return
        this.run++
        this.status = 'paused'
        this.emit()
      },
    })
  }

  private finish(): void {
    this.index = this.lines.length - 1
    this.run++
    this.status = 'finished'
    this.emit()
    const noop = () => {}
    this.voice.say(phrases(this.lang).end, this.lang, { onEnd: noop, onInterrupt: noop })
  }

  /** Cancels speech; callbacks of what was being said are ignored. */
  private silence(): void {
    this.run++
    this.voice.cancel()
  }

  private emit(): void {
    const s = this.state
    for (const l of this.listeners) l(s)
  }
}
