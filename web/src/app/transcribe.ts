// Cloud backup of the voice recognizer (T18): send a recording to Go (POST /transcribe),
// which transcribes it with an audio model (docs/VOZ.md). Role C calls transcribeRemote()
// only when the on-device recognizer fails or returns nothing.
//
// encodeWav and apiBaseFromWs are pure (tested with node --test).

/** 16-bit PCM mono WAV from float samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2))
  const v = new DataView(bytes.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** HTTP base of the app's API from its WebSocket URL: ws://127.0.0.1:8765/ws → http://127.0.0.1:8765 */
export function apiBaseFromWs(wsUrl: string): string {
  const u = new URL(wsUrl)
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
  return u.origin
}

export interface RemoteTranscription {
  text: string
  model: string
  costUsd: number
  latencyMs: number
}

/**
 * Transcribes a recording in the cloud through Go. `wsUrl` is the app's WebSocket URL
 * (resolveWsUrl() in useSocket.ts). Throws on HTTP errors; an empty text means nobody spoke.
 */
export async function transcribeRemote(
  samples: Float32Array,
  sampleRate: number,
  lang: string,
  wsUrl: string,
): Promise<RemoteTranscription> {
  const wav = encodeWav(samples, sampleRate)
  const res = await fetch(`${apiBaseFromWs(wsUrl)}/transcribe?lang=${encodeURIComponent(lang)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Blob([wav], { type: 'audio/wav' }),
  })
  if (!res.ok) throw new Error(`transcribe: HTTP ${res.status}: ${await res.text()}`)
  return (await res.json()) as RemoteTranscription
}
