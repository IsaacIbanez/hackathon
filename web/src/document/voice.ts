// Voices for the guided reader: the system's speech synthesis (Web Speech API, local and free)
// and a silent fallback that only moves the highlight when there is no speech synthesis.

import { chooseVoice } from '../input/voice/speaker.ts'
import type { ReaderVoice } from './reader.ts'

/** Slightly slower than the default: easier to follow (same as the app's Speaker). */
const RATE = 0.95

/** The parts of SpeechSynthesis the reader uses (injected in tests). */
export interface SynthLike {
  speak(u: SpeechSynthesisUtterance): void
  cancel(): void
  getVoices(): SpeechSynthesisVoice[]
  readonly speaking: boolean
  readonly pending: boolean
}

export interface WebSpeechVoice extends ReaderVoice {
  /** false when no voice matches the document's language (the default voice is used). */
  hasVoiceFor(lang: string): boolean
}

/**
 * The browser's speech synthesis. The app's Speaker shares it: when it starts speaking, it cancels
 * the reader's line. Some browsers report that as a normal end, so an end while something else is
 * already speaking or queued counts as an interruption: the reader pauses instead of talking over it.
 */
export function webSpeechVoice(synth: SynthLike = window.speechSynthesis): WebSpeechVoice {
  let current: SpeechSynthesisUtterance | null = null
  return {
    say(text, lang, events) {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = RATE
      const voice = chooseVoice(synth.getVoices(), lang)
      if (voice) u.voice = voice as SpeechSynthesisVoice
      u.onend = () => {
        if (current !== u) return
        current = null
        if (synth.speaking || synth.pending) events.onInterrupt()
        else events.onEnd()
      }
      u.onerror = () => {
        if (current !== u) return
        current = null
        events.onInterrupt()
      }
      current = u
      synth.cancel()
      synth.speak(u)
    },
    cancel() {
      current = null
      synth.cancel()
    },
    hasVoiceFor(lang) {
      return chooseVoice(synth.getVoices(), lang) !== null
    },
  }
}

/** No speech synthesis: each line stays highlighted for about as long as it would take to say it. */
export function silentVoice(msPerChar = 55, minMs = 1200): ReaderVoice {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return {
    say(text, _lang, events) {
      clear()
      timer = setTimeout(() => {
        timer = null
        events.onEnd()
      }, Math.max(minMs, text.length * msPerChar))
    },
    cancel: clear,
  }
}

/** The system voice if there is speech synthesis, otherwise the silent fallback. */
export function defaultVoice(): ReaderVoice & { spoken: boolean } {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return Object.assign(webSpeechVoice(), { spoken: true })
  }
  return Object.assign(silentVoice(), { spoken: false })
}
