// Connection to GET /captions on the Go server (see api/openapi.yaml).
import { WsURL } from '../../wailsjs/go/main/App'
import type { CaptionsClientMessage, CaptionsEvent } from './transcript.ts'

/** Go's address outside Wails: VITE_WS_URL (its /ws) or, by default, the real server (task server). */
const DEFAULT_URL = 'ws://127.0.0.1:8765/captions'

function fromWs(url: string): string {
  return url.replace(/\/ws\/?$/, '') + '/captions'
}

/** The /captions URL: inside the Wails app Go tells us its address; in a browser, the default. */
export async function captionsBaseUrl(): Promise<string> {
  const env = import.meta.env.VITE_WS_URL as string | undefined
  if (env) return fromWs(env)
  try {
    const url = await WsURL()
    if (url) return fromWs(url)
  } catch {
    // Not running inside Wails.
  }
  return DEFAULT_URL
}

export interface ConnectionHandlers {
  onOpen: () => void
  onEvent: (ev: CaptionsEvent) => void
  /** The socket closed; `opened` says whether it ever connected (false = Go is not reachable). */
  onClose: (opened: boolean) => void
}

export class CaptionsConnection {
  private readonly ws: WebSocket
  private opened = false

  constructor(baseUrl: string, lang: string, target: string, h: ConnectionHandlers) {
    const q = new URLSearchParams({ lang, target })
    this.ws = new WebSocket(`${baseUrl}?${q}`)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => {
      this.opened = true
      h.onOpen()
    }
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try {
        h.onEvent(JSON.parse(e.data) as CaptionsEvent)
      } catch {
        // ignore malformed frames
      }
    }
    this.ws.onclose = () => h.onClose(this.opened)
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  sendAudio(pcm: ArrayBuffer): void {
    // Drop audio if the socket is backed up (more than ~2 s queued) rather than lag behind.
    if (this.open && this.ws.bufferedAmount < 64000) this.ws.send(pcm)
  }

  private send(msg: CaptionsClientMessage): void {
    if (this.open) this.ws.send(JSON.stringify(msg))
  }

  setTarget(target: string): void {
    this.send({ type: 'config', target })
  }

  /** Ends the session: Go finishes the transcript, sends `saved` and closes. */
  stop(): void {
    this.send({ type: 'stop' })
  }

  close(): void {
    this.ws.close()
  }
}
