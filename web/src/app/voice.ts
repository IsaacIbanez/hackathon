import type { SpeakPayload } from '../api'
import type { VoiceControls } from './bridge.ts'

/** Spoken output (Web Speech API) with the controls the gestures need. */
export class Voice implements VoiceControls {
  private last: SpeakPayload | null = null
  private volume = 1

  speak(p: SpeakPayload): void {
    this.last = p
    this.say(p)
  }

  pause(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  repeat(): void {
    if (this.last) this.say(this.last)
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value))
  }

  private say({ text, lang }: SpeakPayload): void {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.volume = this.volume
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }
}
