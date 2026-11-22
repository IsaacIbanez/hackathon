// Microphone recorder for voice commands (keypad key 7, docs/KEYPAD.md): records until
// stop() (or MAX_SECONDS) and returns the raw samples, which transcribeRemote() sends to Go.
//
// It records with MediaRecorder, which encodes off the page's main thread. The first version used a
// ScriptProcessorNode, which runs on the main thread: with Gesture Control tracking the hand there,
// it dropped about half the audio (2.5 s kept of 4.5 s, measured in the app on 2026-11-22) and the
// transcription came out wrong. On stop the recording is decoded back to samples (the WAV that Go
// expects does not change). Where MediaRecorder is missing, the ScriptProcessorNode is the fallback.

/** Safety limit: a forgotten recording stops on its own. */
export const MAX_SECONDS = 30

export interface Recording {
  samples: Float32Array
  sampleRate: number
}

/** The first type MediaRecorder can write here ('' lets the browser choose). */
function recorderType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export class MicRecorder {
  private stream: MediaStream | null = null
  private media: MediaRecorder | null = null
  private parts: Blob[] = []
  // Fallback without MediaRecorder.
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  get recording(): boolean {
    return this.stream !== null
  }

  /** How it is recording, for the log ("recorder" when MediaRecorder runs). */
  get state(): string {
    if (this.media) return `recorder ${this.media.state}`
    return this.ctx ? `script ${this.ctx.state}` : 'stopped'
  }

  /** Starts recording; onLimit is called if MAX_SECONDS pass without stop(). */
  async start(onLimit?: () => void): Promise<void> {
    if (this.stream) return
    // No echo cancellation: the app silences its own voice before recording (useVoiceCommand), and
    // Windows' echo canceller also removes sound played on this computer, which cut the words.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    })
    this.stream = stream
    if (typeof MediaRecorder !== 'undefined') {
      const type = recorderType()
      const media = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      this.parts = []
      media.ondataavailable = (e) => {
        if (e.data.size > 0) this.parts.push(e.data)
      }
      media.start(250) // a part every 250 ms: nothing is lost if stop comes early
      this.media = media
    } else {
      const ctx = new AudioContext()
      // A keypad key reaches the page from Go, not as a click: the context may start suspended.
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      const source = ctx.createMediaStreamSource(stream)
      const node = ctx.createScriptProcessor(4096, 1, 1)
      this.chunks = []
      node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      source.connect(node)
      node.connect(ctx.destination)
      this.ctx = ctx
      this.node = node
    }
    this.timer = setTimeout(() => onLimit?.(), MAX_SECONDS * 1000)
  }

  /** Stops and returns what was recorded (empty if nothing was being recorded). */
  async stop(): Promise<Recording> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const media = this.media
    const stream = this.stream
    this.media = null
    this.stream = null
    if (media) {
      // The last part arrives with the stop event; only then is the recording complete.
      if (media.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          media.onstop = () => resolve()
          media.stop()
        })
      }
      stream?.getTracks().forEach((t) => t.stop())
      const blob = new Blob(this.parts, { type: media.mimeType })
      this.parts = []
      return decode(blob)
    }
    const sampleRate = this.ctx?.sampleRate ?? 16000
    this.node?.disconnect()
    stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = this.node = null
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const samples = new Float32Array(total)
    let at = 0
    for (const c of this.chunks) {
      samples.set(c, at)
      at += c.length
    }
    this.chunks = []
    return { samples, sampleRate }
  }
}

/** The recording as mono samples. An offline context decodes it (no autoplay policy applies). */
async function decode(blob: Blob): Promise<Recording> {
  if (blob.size === 0) return { samples: new Float32Array(0), sampleRate: 16000 }
  const ctx = new OfflineAudioContext(1, 1, 48000)
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
  return { samples: audio.getChannelData(0).slice(), sampleRate: audio.sampleRate }
}
