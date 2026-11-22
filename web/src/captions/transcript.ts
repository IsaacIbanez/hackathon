// State of the live captions, built from the CaptionsEvent messages of GET /captions (or from
// the local Whisper fallback), and the downloadable transcript. Pure code (no DOM).
import type { components } from '../api/types.ts'

export type CaptionsEvent = components['schemas']['CaptionsEvent']
export type CaptionsClientMessage = components['schemas']['CaptionsClientMessage']

export interface CaptionLine {
  id: string
  /** Seconds since the session began. */
  start: number
  text: string
  speaker?: string
  /** Main language (ISO 639-1), once known. Words from another language come in quotes. */
  lang?: string
  /** Target language -> translation. */
  translations: Record<string, string>
}

export interface CaptionsState {
  /** Everything said so far, in order. Lines are never removed. */
  lines: CaptionLine[]
  /** The sentence being spoken (replaced by each partial, cleared by its final). */
  partial: string
  costUsd: number
  limitUsd: number
  savedPath: string | null
  /** Translation languages, in order of first use. */
  langs: string[]
  model: string | null
}

export const emptyState = (): CaptionsState => ({
  lines: [],
  partial: '',
  costUsd: 0,
  limitUsd: 0,
  savedPath: null,
  langs: [],
  model: null,
})

function updateLine(state: CaptionsState, id: string, change: (l: CaptionLine) => CaptionLine): CaptionsState {
  const i = state.lines.findIndex((l) => l.id === id)
  if (i < 0) return state
  const lines = state.lines.slice()
  lines[i] = change(lines[i])
  return { ...state, lines }
}

/** Applies one server event (returns a new state; errors are handled by the caller). */
export function applyEvent(state: CaptionsState, ev: CaptionsEvent): CaptionsState {
  switch (ev.type) {
    case 'ready':
      return { ...state, model: ev.model ?? null }
    case 'partial':
      return { ...state, partial: ev.text ?? '' }
    case 'final': {
      if (!ev.id || !ev.text) return { ...state, partial: '' }
      if (state.lines.some((l) => l.id === ev.id)) return state
      const line: CaptionLine = { id: ev.id, start: ev.start ?? 0, text: ev.text, ...(ev.lang ? { lang: ev.lang } : {}), translations: {} }
      return { ...state, partial: '', lines: [...state.lines, line] }
    }
    case 'revise':
      return ev.id ? updateLine(state, ev.id, (l) => ({ ...l, text: ev.text ?? l.text, lang: ev.lang ?? l.lang })) : state
    case 'speaker':
      return ev.id ? updateLine(state, ev.id, (l) => ({ ...l, speaker: ev.speaker })) : state
    case 'translation': {
      if (!ev.id || !ev.lang) return state
      const lang = ev.lang
      const next = updateLine(state, ev.id, (l) => ({ ...l, translations: { ...l.translations, [lang]: ev.text ?? '' } }))
      return next.langs.includes(lang) ? next : { ...next, langs: [...next.langs, lang] }
    }
    case 'cost':
      return { ...state, costUsd: ev.costUsd ?? state.costUsd, limitUsd: ev.limitUsd ?? state.limitUsd }
    case 'saved':
      return { ...state, savedPath: ev.path ?? null }
    default:
      return state
  }
}

/** Adds a sentence recognized locally (Whisper fallback: no speakers, no translation). */
export function addLocalLine(state: CaptionsState, text: string, start: number): CaptionsState {
  const t = text.trim()
  if (!t) return { ...state, partial: '' }
  const id = `w${state.lines.length + 1}`
  return { ...state, partial: '', lines: [...state.lines, { id, start, text: t, translations: {} }] }
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** "2026-11-21 23:30" in local time. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** File name of the transcript: captions-2026-11-21-2330.txt (as Go names it). */
export function transcriptFileName(d: Date): string {
  return `captions-${stamp(d).replace(' ', '-').replace(':', '')}.txt`
}

/**
 * The transcript as plain text, the same format Go saves (backend/captions/transcript.go):
 * the original first and then, for each language it was translated to, the translation.
 */
export function transcriptText(state: CaptionsState, started: Date, lang: string): string {
  const line = (l: CaptionLine, text: string, withLang: boolean) => {
    const who = [l.speaker, withLang && l.lang ? `(${l.lang})` : ''].filter(Boolean).join(' ')
    return `[${clock(l.start)}] ${who ? `${who}: ` : ''}${text}\n`
  }
  let out = `Live captions — ${stamp(started)} — spoken: ${lang} — translated to: ${state.langs.length ? state.langs.join(', ') : 'none'}\n`
  out += '== Original ==\n'
  for (const l of state.lines) out += line(l, l.text, true)
  for (const lang of state.langs) {
    out += `\n== Translation (${lang}) ==\n`
    for (const l of state.lines) if (lang in l.translations) out += line(l, l.translations[lang], false)
  }
  return out
}
