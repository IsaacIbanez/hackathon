// Live captions screen: microphone (and, optionally, a call's audio) -> Go /captions ->
// subtitles with speakers and translation. The history never disappears and can be
// downloaded. If the online service fails, it offers local Whisper (less accurate).
import { useCallback, useEffect, useRef, useState } from 'react'
import { WhisperListener } from '../input/voice/index.ts'
import { AudioCapture, canCaptureCallAudio, listMicrophones, preferredMicrophone, type Microphone } from './audio.ts'
import { captionsBaseUrl, CaptionsConnection } from './client.ts'
import { addLocalLine, applyEvent, clock, emptyState, transcriptFileName, transcriptText, type CaptionsEvent, type CaptionsState } from './transcript.ts'

const SPOKEN = [
  ['auto', 'Detect automatically'],
  ['es', 'Spanish'],
  ['en', 'English'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ca', 'Catalan'],
] as const

const TARGETS = [
  ['none', 'Do not translate'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ca', 'Catalan'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ar', 'Arabic'],
] as const

/** Client-side retries when Go itself is not reachable (Go retries the speech service). */
const GO_RETRY_MS = [1000, 2000, 4000]

type Phase = 'idle' | 'connecting' | 'live' | 'local' | 'finishing' | 'ended'
type Banner = { kind: 'info' | 'warn' | 'error'; text: string } | null

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`captions.${key}`) ?? fallback
  } catch {
    return fallback
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(`captions.${key}`, value)
  } catch {
    // per-viewer convenience only
  }
}

export interface LiveCaptionsProps {
  /** Shows a "Close" button (when embedded in the app). */
  onClose?: () => void
}

export function LiveCaptions({ onClose }: LiveCaptionsProps) {
  const [mics, setMics] = useState<Microphone[]>([])
  const [micId, setMicId] = useState<string>('')
  const [lang, setLang] = useState(() => load('lang', 'auto'))
  const [target, setTarget] = useState(() => load('target', 'none'))
  const [fontPx, setFontPx] = useState(() => Number(load('font', '36')) || 36)
  const [phase, setPhase] = useState<Phase>('idle')
  const [captions, setCaptions] = useState<CaptionsState>(emptyState)
  const [banner, setBanner] = useState<Banner>(null)
  const [notice, setNotice] = useState<string>('')
  const [offerLocal, setOfferLocal] = useState(false)
  const [level, setLevel] = useState(0)
  const [callAudio, setCallAudio] = useState(false)
  const [atBottom, setAtBottom] = useState(true)

  // Set when Start is pressed; the epoch is only a placeholder before that.
  const startedAt = useRef<Date>(new Date(0))
  const capture = useRef<AudioCapture | null>(null)
  const conn = useRef<CaptionsConnection | null>(null)
  const connIndex = useRef(0)
  const connOffset = useRef(0)
  const goRetries = useRef(0)
  const userStopped = useRef(false)
  const whisper = useRef<WhisperListener | null>(null)
  const localOn = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const langRef = useRef(lang)
  const targetRef = useRef(target)
  useEffect(() => {
    langRef.current = lang
    targetRef.current = target
  }, [lang, target])

  const refreshMics = useCallback(async () => {
    const list = await listMicrophones()
    setMics(list)
    setMicId((current) => current || preferredMicrophone(list) || '')
  }, [])

  useEffect(() => {
    void refreshMics()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMics)
  }, [refreshMics])

  // Keep the newest line in view unless the user scrolled up to read.
  useEffect(() => {
    const el = listRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [captions.lines, captions.partial])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    atBottomRef.current = bottom
    setAtBottom(bottom)
  }

  const jumpToLatest = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }

  const releaseAudio = () => {
    capture.current?.stop()
    capture.current = null
    setCallAudio(false)
    setLevel(0)
  }

  const handleEvent = useCallback((raw: CaptionsEvent) => {
    // Ids and times are per Go session; after a reconnection to Go they start again.
    const ev: CaptionsEvent = { ...raw }
    if (ev.id) ev.id = `c${connIndex.current}-${ev.id}`
    if (ev.type === 'final' && ev.start !== undefined) ev.start += connOffset.current
    switch (ev.type) {
      case 'ready':
        setPhase('live')
        setBanner(null)
        setOfferLocal(false)
        break
      case 'error': {
        const msg = ev.message ?? 'Unknown error'
        if (ev.code === 'translation' || ev.code === 'diarization') {
          setNotice(msg)
        } else if (ev.code === 'limit_reached') {
          setBanner({ kind: 'warn', text: msg })
        } else if (ev.retryable) {
          setBanner({ kind: 'warn', text: msg })
        } else {
          setBanner({ kind: 'error', text: msg })
          setOfferLocal(true)
        }
        break
      }
    }
    setCaptions((s) => applyEvent(s, ev))
  }, [])

  const connect = useCallback(async () => {
    const base = await captionsBaseUrl()
    connIndex.current += 1
    connOffset.current = (Date.now() - startedAt.current.getTime()) / 1000
    conn.current = new CaptionsConnection(base, langRef.current, targetRef.current, {
      onOpen: () => {
        goRetries.current = 0
      },
      onEvent: handleEvent,
      onClose: (opened) => {
        conn.current = null
        if (userStopped.current || localOn.current) {
          setPhase((p) => (p === 'local' ? p : 'ended'))
          return
        }
        if (!opened && goRetries.current >= GO_RETRY_MS.length) {
          releaseAudio()
          setPhase('ended')
          setBanner({ kind: 'error', text: `Cannot reach the captions server (${base}). Is the app's server running?` })
          setOfferLocal(true)
          return
        }
        if (!opened || capture.current) {
          const wait = GO_RETRY_MS[Math.min(goRetries.current, GO_RETRY_MS.length - 1)]
          goRetries.current += 1
          setBanner({ kind: 'warn', text: `Lost the captions server, retrying (${goRetries.current}/${GO_RETRY_MS.length})…` })
          setTimeout(() => {
            if (!userStopped.current && !localOn.current) void reconnect.current()
          }, wait)
          return
        }
        setPhase('ended')
      },
    })
  }, [handleEvent])
  const reconnect = useRef(connect)
  useEffect(() => {
    reconnect.current = connect
  }, [connect])

  const start = async () => {
    userStopped.current = false
    localOn.current = false
    goRetries.current = 0
    startedAt.current = new Date()
    setCaptions(emptyState())
    setBanner(null)
    setNotice('')
    setOfferLocal(false)
    atBottomRef.current = true
    setAtBottom(true)
    setPhase('connecting')
    try {
      capture.current = await AudioCapture.start({
        micId: micId || undefined,
        onChunk: (pcm) => conn.current?.sendAudio(pcm),
        onLevel: setLevel,
        onCallEnded: () => setCallAudio(false),
      })
      void refreshMics() // labels appear after the first permission
    } catch (err) {
      setPhase('idle')
      setBanner({ kind: 'error', text: `Cannot use the microphone: ${(err as Error).message}` })
      return
    }
    await connect()
  }

  const stop = () => {
    userStopped.current = true
    releaseAudio()
    if (localOn.current) {
      localOn.current = false
      whisper.current?.cancel()
      setPhase('ended')
      return
    }
    if (conn.current) {
      setPhase('finishing')
      setBanner({ kind: 'info', text: 'Finishing the transcript (speakers of the whole recording)…' })
      conn.current.stop()
      const c = conn.current
      setTimeout(() => c.close(), 60000)
    } else {
      setPhase('ended')
    }
  }

  // Leaving the screen ends the session (Go still saves the transcript).
  useEffect(
    () => () => {
      userStopped.current = true
      localOn.current = false
      whisper.current?.cancel()
      conn.current?.stop()
      capture.current?.stop()
    },
    [],
  )

  const toggleCallAudio = async () => {
    const cap = capture.current
    if (!cap) return
    if (cap.hasCallAudio) {
      cap.removeCallAudio()
      setCallAudio(false)
      return
    }
    try {
      await cap.addCallAudio()
      setCallAudio(true)
    } catch (err) {
      setNotice(`Call audio not added: ${(err as Error).message}`)
    }
  }

  const changeTarget = (t: string) => {
    setTarget(t)
    keep('target', t)
    conn.current?.setTarget(t)
  }

  const startLocalWhisper = async () => {
    userStopped.current = false
    conn.current?.close()
    conn.current = null
    releaseAudio()
    localOn.current = true
    setOfferLocal(false)
    setPhase('local')
    setBanner({
      kind: 'warn',
      text: 'Local mode: Whisper on this computer. It may be less accurate than the online model, and it has no speakers or translation.',
    })
    const w = (whisper.current ??= new WhisperListener())
    const bcp47 = lang === 'auto' ? navigator.language || 'es-ES' : lang
    while (localOn.current) {
      const began = (Date.now() - startedAt.current.getTime()) / 1000
      try {
        const text = await w.listen({
          lang: bcp47,
          onPartial: (t) => setCaptions((s) => ({ ...s, partial: t })),
          onStatus: (t) => setNotice(t),
          maxMs: 20000,
          startTimeoutMs: 60000,
        })
        if (localOn.current) setCaptions((s) => addLocalLine(s, text, began))
      } catch (err) {
        if (!localOn.current) break
        const code = (err as { code?: string }).code
        if (code === 'no-speech' || code === 'aborted') continue
        setBanner({ kind: 'error', text: `Local Whisper failed: ${(err as Error).message}` })
        localOn.current = false
        setPhase('ended')
      }
    }
  }

  const download = () => {
    const text = transcriptText(captions, startedAt.current, lang)
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: transcriptFileName(startedAt.current) })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const zoom = (delta: number) => {
    const next = Math.max(24, Math.min(96, fontPx + delta))
    setFontPx(next)
    keep('font', String(next))
  }

  const running = phase === 'connecting' || phase === 'live' || phase === 'local'
  const busy = running || phase === 'finishing'
  const bannerColor = banner?.kind === 'error' ? 'bg-red-700' : banner?.kind === 'warn' ? 'bg-amber-500 text-black' : 'bg-sky-800'
  const select = 'rounded-lg border-2 border-white bg-black px-3 py-2 text-lg text-white disabled:opacity-50'
  const button = 'rounded-lg border-2 border-white px-4 py-2 text-lg font-semibold disabled:opacity-40'

  return (
    <section className="flex h-full min-h-0 flex-col bg-black text-white" aria-label="Live captions">
      <header className="flex flex-wrap items-end gap-3 border-b-2 border-white/30 p-3">
        <h1 className="mr-2 text-2xl font-bold">Live captions</h1>
        <label className="flex flex-col text-sm">
          Microphone
          <select className={select} value={micId} disabled={busy} onChange={(e) => setMicId(e.target.value)}>
            <option value="">Default microphone</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Spoken language
          <select
            className={select}
            value={lang}
            disabled={busy}
            onChange={(e) => {
              setLang(e.target.value)
              keep('lang', e.target.value)
            }}
          >
            {SPOKEN.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Translate to
          <select className={select} value={target} disabled={phase === 'local' || phase === 'finishing'} onChange={(e) => changeTarget(e.target.value)}>
            {TARGETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className={`${button} bg-red-600`} onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className={`${button} bg-green-700`} disabled={phase === 'finishing'} onClick={() => void start()}>
            Start
          </button>
        )}
        <button
          type="button"
          className={`${button} ${callAudio ? 'bg-sky-700' : ''}`}
          disabled={phase !== 'live' || !canCaptureCallAudio()}
          title={canCaptureCallAudio() ? 'Also caption a tab or screen with sound (a call, a video)' : 'This window cannot capture other audio; use Chrome'}
          aria-pressed={callAudio}
          onClick={() => void toggleCallAudio()}
        >
          {callAudio ? 'Remove call audio' : 'Add call audio'}
        </button>
        <button type="button" className={button} disabled={captions.lines.length === 0} onClick={download}>
          Download transcript
        </button>
        <span className="flex gap-1" role="group" aria-label="Text size">
          <button type="button" className={button} onClick={() => zoom(-6)} aria-label="Smaller text">
            A−
          </button>
          <button type="button" className={button} onClick={() => zoom(6)} aria-label="Larger text">
            A+
          </button>
        </span>
        {onClose && (
          <button type="button" className={`${button} ml-auto`} onClick={onClose}>
            Close
          </button>
        )}
      </header>

      {banner && (
        <div role="alert" className={`flex flex-wrap items-center gap-3 px-4 py-3 text-xl font-semibold ${bannerColor}`}>
          <span>{banner.text}</span>
          {offerLocal && (
            <button type="button" className={`${button} bg-black text-white`} onClick={() => void startLocalWhisper()}>
              Use local Whisper (less accurate)
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={listRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3" style={{ fontSize: fontPx, lineHeight: 1.3 }}>
          {captions.lines.length === 0 && !captions.partial && (
            <p className="text-white/60" style={{ fontSize: Math.max(20, fontPx * 0.6) }}>
              {phase === 'idle' || phase === 'ended' ? 'Press Start and speak: the captions appear here.' : 'Listening…'}
            </p>
          )}
          <ol aria-live="polite" aria-relevant="additions" className="space-y-4">
            {captions.lines.map((l) => (
              <li key={l.id}>
                <div className="text-white/60" style={{ fontSize: Math.max(16, fontPx * 0.45) }}>
                  {clock(l.start)}
                  {l.speaker && <span className="ml-3 font-bold text-cyan-300">{l.speaker}</span>}
                </div>
                <p className="font-semibold">{l.text}</p>
                {Object.entries(l.translations).map(([tl, tx]) => (
                  <p key={tl} className="text-yellow-300" lang={tl}>
                    <span className="sr-only">{`Translation (${tl}): `}</span>
                    {tx}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {captions.partial && <p className="mt-4 italic text-white/80">{captions.partial}</p>}
        </div>
        {!atBottom && (
          <button type="button" className={`${button} absolute bottom-4 right-6 bg-white text-black`} onClick={jumpToLatest}>
            Jump to latest ↓
          </button>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t-2 border-white/30 px-4 py-2 text-lg">
        <span aria-label="Input level" className="inline-block h-3 w-32 overflow-hidden rounded bg-white/20">
          <span className="block h-full bg-green-400" style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        <span>
          {phase === 'local' ? 'Local Whisper · 0 $' : `Cost: ${captions.costUsd.toFixed(4)} $${captions.limitUsd ? ` of ${captions.limitUsd.toFixed(2)} $` : ''}`}
        </span>
        {captions.model && phase !== 'local' && <span className="text-white/60">{captions.model}</span>}
        {captions.savedPath && <span className="text-white/80">Saved: {captions.savedPath}</span>}
        {notice && (
          <span role="status" className="text-amber-300">
            {notice}
          </span>
        )}
      </footer>
    </section>
  )
}
