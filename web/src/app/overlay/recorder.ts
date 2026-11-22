// Microphone recorder for voice commands (keypad key 7, docs/KEYPAD.md): records until
// stop() (or MAX_SECONDS) and returns the raw samples, which transcribeRemote() sends to Go.

/** Safety limit: a forgotten recording stops on its own. */
export const MAX_SECONDS = 30

export interface Recording {
  samples: Float32Array
  sampleRate: number
}

export class MicRecorder {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  get recording(): boolean {
    return this.stream !== null
  }

  /** Starts recording; onLimit is called if MAX_SECONDS pass without stop(). */
  async start(onLimit?: () => void): Promise<void> {
    if (this.stream) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    // ScriptProcessorNode is deprecated but works everywhere (WebView2 included) without a worklet file.
    const node = ctx.createScriptProcessor(4096, 1, 1)
    this.chunks = []
    node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    source.connect(node)
    node.connect(ctx.destination)
    this.stream = stream
    this.ctx = ctx
    this.node = node
    this.timer = setTimeout(() => onLimit?.(), MAX_SECONDS * 1000)
  }

  /** Stops and returns what was recorded (empty if nothing was being recorded). */
  async stop(): Promise<Recording> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const sampleRate = this.ctx?.sampleRate ?? 16000
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.stream = this.ctx = this.node = null
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
