// Captures the microphone and, optionally, the audio of a shared tab or screen (a call, a
// video), mixes them and delivers 16 kHz mono PCM16 chunks of ~100 ms for GET /captions.
import { Downsampler, floatToInt16, TAP_WORKLET } from './pcm.ts'

export interface Microphone {
  deviceId: string
  label: string
}

/** Audio inputs; labels are empty until the page has had microphone permission once. */
export async function listMicrophones(): Promise<Microphone[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}

/** The Logitech microphone (MX Brio) if there is one, else the default one. */
export function preferredMicrophone(mics: Microphone[]): string | undefined {
  return (mics.find((m) => /brio/i.test(m.label)) ?? mics.find((m) => /logi/i.test(m.label)))?.deviceId
}

export function canCaptureCallAudio(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
}

export interface CaptureOptions {
  micId?: string
  /** One chunk of PCM16 (16 kHz, mono), ~100 ms. */
  onChunk: (pcm: ArrayBuffer) => void
  /** Input level of each chunk, 0-1 (for a level meter). */
  onLevel?: (level: number) => void
  /** The shared tab or screen stopped sharing (the user clicked "Stop sharing"). */
  onCallEnded?: () => void
}

export class AudioCapture {
  private readonly ctx: AudioContext
  private readonly tap: AudioWorkletNode
  private readonly mic: MediaStream
  private call: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null
  private readonly opts: CaptureOptions

  private constructor(ctx: AudioContext, tap: AudioWorkletNode, mic: MediaStream, opts: CaptureOptions) {
    this.ctx = ctx
    this.tap = tap
    this.mic = mic
    this.opts = opts
  }

  static async start(opts: CaptureOptions): Promise<AudioCapture> {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opts.micId ? { exact: opts.micId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    let ctx: AudioContext
    try {
      // The browser resamples the microphone itself (best quality); Downsampler is the fallback.
      ctx = new AudioContext({ sampleRate: 16000 })
    } catch {
      ctx = new AudioContext()
    }
    try {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const tap = new AudioWorkletNode(ctx, 'captions-tap', { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
      const down = new Downsampler(ctx.sampleRate)
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const block = down.process(e.data)
        let sum = 0
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
        opts.onLevel?.(Math.min(1, Math.sqrt(sum / Math.max(1, block.length)) * 4))
        opts.onChunk(floatToInt16(block).buffer as ArrayBuffer)
      }
      ctx.createMediaStreamSource(mic).connect(tap)
      // The worklet only runs while connected to the output; a muted gain keeps it silent.
      const mute = ctx.createGain()
      mute.gain.value = 0
      tap.connect(mute).connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
      return new AudioCapture(ctx, tap, mic, opts)
    } catch (err) {
      mic.getTracks().forEach((t) => t.stop())
      void ctx.close()
      throw err
    }
  }

  get microphoneLabel(): string {
    return this.mic.getAudioTracks()[0]?.label ?? ''
  }

  get hasCallAudio(): boolean {
    return this.call !== null
  }

  /**
   * Adds the audio of a tab or screen the user picks. Chrome only shares audio if the user
   * ticks "Share audio"; without it this throws.
   */
  async addCallAudio(): Promise<void> {
    if (this.call) return
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome: offer the whole system's audio when a screen is shared.
      systemAudio: 'include',
    } as DisplayMediaStreamOptions)
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('The shared tab or screen has no audio. Share it again and tick "Share audio".')
    }
    const source = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    source.connect(this.tap)
    this.call = { stream, source }
    for (const t of stream.getTracks()) {
      t.addEventListener('ended', () => {
        if (this.call?.stream === stream) {
          this.removeCallAudio()
          this.opts.onCallEnded?.()
        }
      })
    }
  }

  removeCallAudio(): void {
    if (!this.call) return
    this.call.source.disconnect()
    this.call.stream.getTracks().forEach((t) => t.stop())
    this.call = null
  }

  stop(): void {
    this.removeCallAudio()
    this.tap.port.onmessage = null
    this.mic.getTracks().forEach((t) => t.stop())
    void this.ctx.close()
  }
}
