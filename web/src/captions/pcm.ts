// Audio for GET /captions: signed 16-bit PCM, 16 kHz, mono (what the speech service expects).
// Pure code (no DOM) so it can be tested with node --test.

export const TARGET_RATE = 16000

/**
 * Converts a stream of float samples at `inputRate` to 16 kHz. Each output sample is the mean
 * of the input samples it covers (a box filter, enough against aliasing for speech). It keeps
 * its position between calls, so chunks of any size give the same result as one long buffer.
 * Usually the AudioContext already runs at 16 kHz and this is a plain copy.
 */
export class Downsampler {
  private readonly ratio: number
  private pos = 0 // fractional input position of the next output sample, relative to `carry`
  private carry: Float32Array = new Float32Array(0)

  constructor(inputRate: number) {
    if (inputRate < TARGET_RATE) throw new Error(`Downsampler: input rate ${inputRate} is below ${TARGET_RATE}`)
    this.ratio = inputRate / TARGET_RATE
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input
    const data = new Float32Array(this.carry.length + input.length)
    data.set(this.carry)
    data.set(input, this.carry.length)
    const out: number[] = []
    let pos = this.pos
    while (pos + this.ratio <= data.length) {
      const from = Math.floor(pos)
      const to = Math.floor(pos + this.ratio)
      let sum = 0
      for (let i = from; i < to; i++) sum += data[i]
      out.push(sum / Math.max(1, to - from))
      pos += this.ratio
    }
    const keep = Math.floor(pos)
    this.carry = data.slice(keep)
    this.pos = pos - keep
    return Float32Array.from(out)
  }
}

/** Float samples in [-1, 1] to signed 16-bit (clipped). */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/**
 * The AudioWorklet that taps the mixed audio: it posts mono float blocks of ~100 ms to the
 * page. Kept as a string so it needs no extra build step (loaded from a Blob URL).
 */
export const TAP_WORKLET = `
class CaptionsTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('captions-tap', CaptionsTap);
`
