// Framing guide logic (no DOM, testable with node --test): from per-frame measurements to a hint
// ("it is too dark", "hold it still"…) and the moment to take the photo.
//
// Only what the browser can judge cheaply and locally: light, motion and sharpness. What depends on
// the page itself (cropped, too far, tilted) comes from Go with the document the scanner returns.

export type FramingHint = 'dark' | 'blurry' | 'moving' | 'hold_still' | 'ready'

export interface FramingThresholds {
  /** Mean gray level (0-255) below which the image is too dark. A lit white page is well above 100. */
  darkBrightness: number
  /** Mean frame-to-frame difference above which the paper is moving (still MX Brio: ~1.4, p95 2.8). */
  motion: number
  /** Variance of the Laplacian below which there is no usable detail (badly out of focus). */
  minSharpness: number
  /** How long the paper must stay still before the photo is taken. */
  holdMs: number
  /** The last N still frames must have similar sharpness (autofocus settled)… */
  stableFrames: number
  /** …within this fraction of the highest of them. */
  sharpnessTolerance: number
}

export const DEFAULT_THRESHOLDS: FramingThresholds = {
  darkBrightness: 50,
  motion: 4.5,
  minSharpness: 15,
  holdMs: 700,
  stableFrames: 4,
  sharpnessTolerance: 0.15,
}

export interface FrameSample {
  /** Milliseconds (performance.now()). */
  t: number
  brightness: number
  sharpness: number
  /** Difference with the previous frame; null for the first one. */
  motion: number | null
}

export interface Verdict {
  hint: FramingHint
  /** How long the paper has been still, in ms (0 while it moves). */
  stillMs: number
  /** The frame differs from the previous one more than the motion threshold. */
  moving: boolean
  ready: boolean
}

/** Decides, frame by frame, what is wrong with the image (if anything) and when it is good enough. */
export class FramingJudge {
  private readonly th: FramingThresholds
  private stillSince: number | null = null
  private recent: number[] = []

  constructor(thresholds: Partial<FramingThresholds> = {}) {
    this.th = { ...DEFAULT_THRESHOLDS, ...thresholds }
  }

  update(s: FrameSample): Verdict {
    const moving = s.motion !== null && s.motion > this.th.motion
    if (moving) {
      this.stillSince = null
      this.recent = []
    } else {
      this.stillSince ??= s.t
      this.recent.push(s.sharpness)
      if (this.recent.length > this.th.stableFrames) this.recent.shift()
    }
    const stillMs = this.stillSince === null ? 0 : s.t - this.stillSince

    let hint: FramingHint
    if (s.brightness < this.th.darkBrightness) hint = 'dark'
    else if (moving) hint = 'moving'
    else if (s.sharpness < this.th.minSharpness) hint = 'blurry'
    else if (stillMs < this.th.holdMs || !this.sharpnessStable()) hint = 'hold_still'
    else hint = 'ready'
    return { hint, stillMs, moving, ready: hint === 'ready' }
  }

  private sharpnessStable(): boolean {
    if (this.recent.length < this.th.stableFrames) return false
    const max = Math.max(...this.recent)
    return max - Math.min(...this.recent) <= this.th.sharpnessTolerance * max
  }
}

/**
 * Decides which hints are worth saying: a hint must last `debounceMs` (so a single odd frame does not
 * talk), is not repeated while it stays the same, and is repeated after `repeatMs` if the problem persists.
 */
export class HintGate {
  private candidate: FramingHint | null = null
  private candidateSince = 0
  private lastSaid: FramingHint | null = null
  private lastSaidAt = 0
  private readonly debounceMs: number
  private readonly repeatMs: number

  constructor(debounceMs = 300, repeatMs = 5000) {
    this.debounceMs = debounceMs
    this.repeatMs = repeatMs
  }

  /** The hint to say now, or null. 'ready' is never returned: the guide says it when it takes the photo. */
  offer(hint: FramingHint, t: number): FramingHint | null {
    if (hint !== this.candidate) {
      this.candidate = hint
      this.candidateSince = t
    }
    if (hint === 'ready' || t - this.candidateSince < this.debounceMs) return null
    if (hint === this.lastSaid && t - this.lastSaidAt < this.repeatMs) return null
    this.lastSaid = hint
    this.lastSaidAt = t
    return hint
  }
}

const TEXTS: Record<string, Record<FramingHint, string>> = {
  es: {
    dark: 'Hay poca luz. Enciende una luz o acércate a una ventana.',
    blurry: 'La imagen sale borrosa. Aleja un poco el papel de la cámara.',
    moving: 'El papel se mueve. Sujétalo quieto.',
    hold_still: 'Así. No lo muevas.',
    ready: 'Foto hecha.',
  },
  ca: {
    dark: "Hi ha poca llum. Encén un llum o apropa't a una finestra.",
    blurry: 'La imatge surt borrosa. Allunya una mica el paper de la càmera.',
    moving: "El paper es mou. Aguanta'l quiet.",
    hold_still: 'Així. No el moguis.',
    ready: 'Foto feta.',
  },
  en: {
    dark: 'It is too dark. Turn on a light or move closer to a window.',
    blurry: 'The image is blurry. Move the paper a little further from the camera.',
    moving: 'The paper is moving. Hold it still.',
    hold_still: 'Good. Keep it still.',
    ready: 'Photo taken.',
  },
}

/** Text of a hint in the user's language (BCP-47, e.g. "es-ES"); English if the language is not available. */
export function hintText(hint: FramingHint, lang: string): string {
  return (TEXTS[lang.slice(0, 2).toLowerCase()] ?? TEXTS.en)[hint]
}
