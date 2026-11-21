// Voice activity detection by energy, with an adaptive noise floor. Used by the local Whisper
// listener to know when the user starts and stops talking. Pure logic, so it is testable.

export interface VadOptions {
  /** Speech must be this many times louder than the background noise. */
  ratio: number;
  /** Absolute minimum RMS to count as speech (quiet rooms). */
  minLevel: number;
  /** Speech must last this long to start a phrase (ignores clicks). */
  startMs: number;
  /** Silence this long ends the phrase. */
  endMs: number;
  /**
   * The first frames only measure the background noise (the user starts after the beep), so a
   * noisy room isn't mistaken for speech that never ends.
   */
  calibrateMs: number;
}

export const VAD_DEFAULTS: VadOptions = { ratio: 2.5, minLevel: 0.01, startMs: 150, endMs: 900, calibrateMs: 300 };

export type VadEvent = "start" | "end" | null;

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export class EnergyVad {
  private options: VadOptions;
  private noise = 0.005;
  private speaking = false;
  private loudMs = 0;
  private quietMs = 0;
  private calibratedMs = 0;
  private calibrationSum = 0;

  constructor(options: Partial<VadOptions> = {}) {
    this.options = { ...VAD_DEFAULTS, ...options };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Feeds one audio frame lasting `ms` milliseconds. Returns "start", "end" or null. */
  feed(samples: Float32Array, ms: number): VadEvent {
    const level = rms(samples);
    if (this.calibratedMs < this.options.calibrateMs) {
      this.calibrationSum += level * ms;
      this.calibratedMs += ms;
      if (this.calibratedMs >= this.options.calibrateMs) this.noise = this.calibrationSum / this.calibratedMs;
      return null;
    }
    const threshold = Math.max(this.options.minLevel, this.noise * this.options.ratio);
    const loud = level > threshold;
    if (!this.speaking) {
      // Learn the background noise only while nobody is talking.
      if (!loud) this.noise = 0.95 * this.noise + 0.05 * level;
      this.loudMs = loud ? this.loudMs + ms : 0;
      if (this.loudMs >= this.options.startMs) {
        this.speaking = true;
        this.quietMs = 0;
        return "start";
      }
      return null;
    }
    this.quietMs = loud ? 0 : this.quietMs + ms;
    if (this.quietMs >= this.options.endMs) {
      this.speaking = false;
      this.loudMs = 0;
      return "end";
    }
    return null;
  }
}

/** Linear resampling to 16 kHz (what Whisper expects). */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return input;
  const ratio = fromRate / 16000;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}
