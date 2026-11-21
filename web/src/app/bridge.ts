// Gesture bridge: turns the hand module's events (role C, web/src/input) into contract
// messages (api/openapi.yaml) and local voice controls.
//
// Pure logic, no DOM, so it runs under `node --test`. Imports carry the .ts extension for
// the same reason.
//
// Frugality: pointing only sends coordinates (Go finds the block and reads it locally, no
// model); only explicit requests (explain here, read, help) become utterances for the model.

import type { ClientMessage } from '../api/index.ts'
import { actionFor, type Action, type Context } from '../input/actions.ts'
import type { HandEvent, Point } from '../input/types.ts'

/** Local voice controls (implemented by voice.ts in the app, faked in tests). */
export interface VoiceControls {
  pause(): void
  repeat(): void
  /** 0–1. */
  setVolume(value: number): void
}

export interface BridgeOptions {
  /** BCP-47 language of the spoken requests, e.g. "es-ES". */
  lang: string
  /** Minimum time between pointer messages (ms). */
  pointerIntervalMs: number
  /** Minimum movement (document units) to send a new pointer before the interval ends. */
  pointerMinMove: number
  context: Context
  /** Called for "adjust_volume" (the app calls HandInteraction.startLevel()). */
  onStartVolume?: () => void
  /** Called for "dictate" / "dictate_field": voice input belongs to role C. */
  onDictate?: () => void
  now?: () => number
}

export const DEFAULT_BRIDGE_OPTIONS: BridgeOptions = {
  lang: 'es-ES',
  pointerIntervalMs: 200,
  pointerMinMove: 0.02,
  context: 'document',
}

/** Spoken requests sent as utterances. User-facing content: in the user's language. */
const REQUESTS: Record<string, Record<'explain_here' | 'read' | 'ask_for_help', string>> = {
  es: {
    explain_here: '¿Qué pone aquí y qué tengo que hacer?',
    read: 'Léeme el documento.',
    ask_for_help: 'Necesito ayuda con este documento.',
  },
  en: {
    explain_here: 'What does this say and what do I have to do?',
    read: 'Read me the document.',
    ask_for_help: 'I need help with this document.',
  },
}

function requestText(lang: string, key: keyof (typeof REQUESTS)['es']): string {
  const base = lang.split('-')[0].toLowerCase()
  return (REQUESTS[base] ?? REQUESTS.es)[key]
}

let counter = 0
function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export class GestureBridge {
  private readonly send: (msg: ClientMessage) => void
  private readonly voice: VoiceControls
  private readonly o: BridgeOptions
  private lastPointerAt = -Infinity
  private lastPointer: Point | null = null

  constructor(send: (msg: ClientMessage) => void, voice: VoiceControls, options: Partial<BridgeOptions> = {}) {
    this.send = send
    this.voice = voice
    this.o = { ...DEFAULT_BRIDGE_OPTIONS, ...options }
  }

  /** Handles one hand event. Returns the action it triggered (for on-screen feedback), if any. */
  handle(event: HandEvent): Action | null {
    if (event.type === 'pointer') {
      if (event.document) this.pointer(event.document, false)
      return null
    }
    const action = actionFor(event, this.o.context)
    if (!action) return null

    switch (action) {
      case 'explain_here':
        if (event.type === 'select' && event.document) this.pointer(event.document, true)
        this.utterance(requestText(this.o.lang, 'explain_here'))
        break
      case 'read':
        this.utterance(requestText(this.o.lang, 'read'))
        break
      case 'ask_for_help':
        this.utterance(requestText(this.o.lang, 'ask_for_help'))
        break
      case 'pause':
        this.voice.pause()
        break
      case 'repeat':
        this.voice.repeat()
        break
      case 'volume':
        if (event.type === 'level') this.voice.setVolume(event.value)
        break
      case 'adjust_volume':
        this.o.onStartVolume?.()
        break
      case 'dictate':
      case 'dictate_field':
        this.o.onDictate?.()
        break
      default:
        return action // recognized but not wired yet (next/previous, form and pc contexts…)
    }
    return action
  }

  private pointer(p: Point, force: boolean) {
    const now = (this.o.now ?? Date.now)()
    const last = this.lastPointer
    const moved = !last || Math.hypot(p.x - last.x, p.y - last.y) >= this.o.pointerMinMove
    if (!force && (now - this.lastPointerAt < this.o.pointerIntervalMs || !moved)) return
    this.lastPointerAt = now
    this.lastPointer = p
    this.send({ type: 'pointer', id: newId('ptr'), ts: Date.now(), payload: { x: clamp(p.x), y: clamp(p.y) } })
  }

  private utterance(text: string) {
    this.send({ type: 'utterance', id: newId('utt'), ts: Date.now(), payload: { text, isFinal: true, lang: this.o.lang } })
  }
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v))
}
