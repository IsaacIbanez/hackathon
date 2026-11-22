// Reading a whole PDF aloud, page by page (task N4, docs/briefs/N4.md). Pure logic, no DOM: the
// pages come from an async loader (Go → reading service), the voice is injected. It announces each
// page ("Página 3 de 10"), reads its lines one after the other and moves to the next page on its
// own, asking for that page while the current one sounds. No page limit and no model (0 $).

import type { Box } from '../api'
import { UNCLEAR, type ReaderVoice } from './reader.ts'

export interface PdfLine {
  id: string
  text: string
  box: Box
  confidence: number
}

/** One page as the reading service gives it: lines in reading order and the page image. */
export interface PdfPageData {
  page: number
  ocr: boolean
  lines: PdfLine[]
  image: string
}

export type PageLoader = (page: number) => Promise<PdfPageData>

export type PdfStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

export interface PdfState {
  status: PdfStatus
  /** Current page, from 0. */
  page: number
  pages: number
  /** Current line on the page; -1 while the page is announced (or before reading it). */
  line: number
  /** The current page, once loaded. */
  data: PdfPageData | null
  rate: number
  lang: string
  /** Set while a page that is not ready yet is being prepared. */
  preparing: number | null
  error: string | null
}

export const RATES = [0.75, 1, 1.25, 1.5]

export type PdfAction =
  | 'toggle'
  | 'previous'
  | 'next'
  | 'repeat'
  | 'stop'
  | 'faster'
  | 'slower'
  | 'previousPage'
  | 'nextPage'
  | 'goToPage'

/** One-key shortcuts of the viewer (KeyboardEvent.code). Numeric keypad keys so a keypad can send them. */
const KEYS: Record<string, PdfAction> = {
  Space: 'toggle',
  Numpad5: 'toggle',
  ArrowLeft: 'previous',
  Numpad4: 'previous',
  ArrowRight: 'next',
  Numpad6: 'next',
  KeyR: 'repeat',
  Numpad8: 'repeat',
  KeyS: 'stop',
  Equal: 'faster',
  NumpadAdd: 'faster',
  Minus: 'slower',
  NumpadSubtract: 'slower',
  PageUp: 'previousPage',
  PageDown: 'nextPage',
  KeyG: 'goToPage',
}

export function pdfKeyAction(code: string, key = ''): PdfAction | null {
  if (key === '+') return 'faster' // the + key differs between keyboard layouts
  if (key === '-') return 'slower'
  return KEYS[code] ?? null
}

const PHRASES: Record<string, { page: (n: number, m: number) => string; preparing: (n: number) => string; empty: (n: number) => string; failed: (n: number) => string; unclear: string; end: string }> = {
  es: {
    page: (n, m) => `Página ${n} de ${m}.`,
    preparing: (n) => `Preparando la página ${n}.`,
    empty: (n) => `La página ${n} no tiene texto.`,
    failed: (n) => `No he podido leer la página ${n}.`,
    unclear: 'No se lee bien:',
    end: 'Fin del documento.',
  },
  ca: {
    page: (n, m) => `Pàgina ${n} de ${m}.`,
    preparing: (n) => `Preparant la pàgina ${n}.`,
    empty: (n) => `La pàgina ${n} no té text.`,
    failed: (n) => `No he pogut llegir la pàgina ${n}.`,
    unclear: 'No es llegeix bé:',
    end: 'Final del document.',
  },
  en: {
    page: (n, m) => `Page ${n} of ${m}.`,
    preparing: (n) => `Preparing page ${n}.`,
    empty: (n) => `Page ${n} has no text.`,
    failed: (n) => `I could not read page ${n}.`,
    unclear: 'Unclear:',
    end: 'End of the document.',
  },
}

export function pdfPhrases(lang: string) {
  return PHRASES[lang.split('-')[0].toLowerCase()] ?? PHRASES.es
}

/** How long a page may take before "Preparing page N" is said (a scanned page needs OCR). */
export const PREPARING_AFTER_MS = 700

export class PdfPageReader {
  private voice: ReaderVoice
  private loader: PageLoader
  private cache = new Map<number, Promise<PdfPageData>>()
  private listeners = new Set<(s: PdfState) => void>()
  private s: PdfState
  /** Increases with every new utterance or page change, so late callbacks are ignored. */
  private run = 0

  constructor(voice: ReaderVoice, loader: PageLoader, pages: number, lang = 'es-ES') {
    this.voice = voice
    this.loader = loader
    this.s = { status: 'idle', page: 0, pages, line: -1, data: null, rate: 1, lang, preparing: null, error: null }
  }

  get state(): PdfState {
    return { ...this.s }
  }

  onChange(listener: (s: PdfState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Shows the first page without speaking (before the "Read the whole PDF" button). */
  async show(page = 0): Promise<void> {
    const run = ++this.run
    await this.enter(page, -1, run, false)
  }

  /** Starts or resumes reading (from the beginning if it had finished). */
  play(): void {
    if (this.s.status === 'playing' || this.s.status === 'loading') return
    if (this.s.status === 'finished') return void this.goToPage(0)
    if (!this.s.data || this.s.data.page !== this.s.page) return void this.goToPage(this.s.page, this.s.line)
    this.speakCurrent()
  }

  pause(): void {
    if (this.s.status !== 'playing' && this.s.status !== 'loading') return
    this.silence()
    this.set({ status: 'paused', preparing: null })
  }

  toggle(): void {
    if (this.s.status === 'playing' || this.s.status === 'loading') this.pause()
    else this.play()
  }

  /** Stops and goes back to the first page, without speaking. */
  stop(): void {
    this.silence()
    this.set({ status: 'idle', preparing: null, error: null })
    void this.show(0)
  }

  next(): void {
    const lines = this.s.data?.lines.length ?? 0
    if (this.s.line < lines - 1) {
      this.silence()
      this.set({ line: this.s.line + 1 })
      this.speakCurrent()
    } else {
      this.nextPage()
    }
  }

  previous(): void {
    if (this.s.line > 0) {
      this.silence()
      this.set({ line: this.s.line - 1 })
      this.speakCurrent()
    } else if (this.s.page > 0) {
      void this.goToPage(this.s.page - 1, 'last')
    } else {
      this.repeat()
    }
  }

  repeat(): void {
    this.silence()
    this.speakCurrent()
  }

  nextPage(): void {
    if (this.s.page >= this.s.pages - 1) return this.finish()
    void this.goToPage(this.s.page + 1)
  }

  previousPage(): void {
    void this.goToPage(Math.max(0, this.s.page - 1))
  }

  /** Reads from the start of a page (from 0), announcing it; `line` = 'last' starts at its last line. */
  async goToPage(page: number, line: number | 'last' = -1): Promise<void> {
    if (page < 0 || page >= this.s.pages) return
    this.silence()
    const run = this.run
    await this.enter(page, line, run, true)
  }

  faster(): void {
    this.setRate(+1)
  }

  slower(): void {
    this.setRate(-1)
  }

  private setRate(step: number): void {
    const i = RATES.indexOf(this.s.rate)
    const rate = RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 1 : i) + step))]
    if (rate === this.s.rate) return
    this.set({ rate })
    // Heard right away: the current line starts again at the new speed.
    if (this.s.status === 'playing') this.repeat()
  }

  /** The page from the loader, once (a failed load is asked again next time). */
  private load(page: number): Promise<PdfPageData> {
    let p = this.cache.get(page)
    if (!p) {
      p = this.loader(page)
      this.cache.set(page, p)
      p.catch(() => this.cache.delete(page))
    }
    return p
  }

  private prefetch(page: number): void {
    if (page < this.s.pages) this.load(page).catch(() => {})
  }

  private async enter(page: number, line: number | 'last', run: number, speak: boolean): Promise<void> {
    const phrases = pdfPhrases(this.s.lang)
    this.set({ page, line: -1, data: this.s.data?.page === page ? this.s.data : null, error: null, ...(speak ? { status: 'loading' } : {}) })
    // A slow page (a scanned one goes through OCR) is shown as being prepared, and said if reading.
    const timer = setTimeout(() => {
      if (run !== this.run) return
      this.set({ preparing: page })
      if (speak) this.voice.say(phrases.preparing(page + 1), this.s.lang, { onEnd() {}, onInterrupt() {} }, { rate: this.s.rate })
    }, PREPARING_AFTER_MS)
    let data: PdfPageData
    try {
      data = await this.load(page)
    } catch (e) {
      clearTimeout(timer)
      if (run !== this.run) return
      this.set({ status: 'error', preparing: null, error: e instanceof Error ? e.message : String(e) })
      if (speak) this.voice.say(phrases.failed(page + 1), this.s.lang, { onEnd() {}, onInterrupt() {} })
      return
    }
    clearTimeout(timer)
    if (run !== this.run) return
    const start = line === 'last' ? data.lines.length - 1 : line
    this.set({ data, line: start, preparing: null })
    this.prefetch(page + 1)
    if (speak) this.speakCurrent()
  }

  private speakCurrent(): void {
    const data = this.s.data
    if (!data) return
    const phrases = pdfPhrases(this.s.lang)
    const run = ++this.run
    this.set({ status: 'playing' })
    let text: string
    if (this.s.line < 0) {
      text = data.lines.length === 0 ? phrases.empty(this.s.page + 1) : this.s.pages > 1 ? phrases.page(this.s.page + 1, this.s.pages) : ''
      if (!text) {
        this.set({ line: 0 })
        return this.speakCurrent()
      }
    } else {
      const line = data.lines[this.s.line]
      text = line.confidence < UNCLEAR ? `${phrases.unclear} ${line.text}` : line.text
    }
    this.voice.say(
      text,
      this.s.lang,
      {
        onEnd: () => {
          if (run !== this.run || this.s.status !== 'playing') return
          this.advance()
        },
        onInterrupt: () => {
          if (run !== this.run || this.s.status !== 'playing') return
          this.run++
          this.set({ status: 'paused' })
        },
      },
      { rate: this.s.rate },
    )
  }

  private advance(): void {
    const lines = this.s.data?.lines.length ?? 0
    if (this.s.line < lines - 1) {
      this.set({ line: this.s.line + 1 })
      this.speakCurrent()
    } else if (this.s.page < this.s.pages - 1) {
      const run = ++this.run
      void this.enter(this.s.page + 1, -1, run, true)
    } else {
      this.finish()
    }
  }

  private finish(): void {
    this.silence()
    this.set({ status: 'finished', preparing: null })
    this.voice.say(pdfPhrases(this.s.lang).end, this.s.lang, { onEnd() {}, onInterrupt() {} }, { rate: this.s.rate })
  }

  private silence(): void {
    this.run++
    this.voice.cancel()
  }

  private set(patch: Partial<PdfState>): void {
    this.s = { ...this.s, ...patch }
    const snapshot = this.state
    for (const l of this.listeners) l(snapshot)
  }
}
