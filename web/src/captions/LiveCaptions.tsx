// Live captions screen: microphone (and, optionally, a call's audio) -> Go /captions ->
// subtitles with speakers and translation. The history never disappears and can be
// downloaded. If the online service fails, it offers local Whisper (less accurate).
import { useCallback, useEffect, useRef, useState } from 'react'
import { WhisperListener } from '../input/voice/index.ts'
import { AudioCapture, canCaptureCallAudio, listMicrophones, preferredMicrophone, type Microphone } from './audio.ts'
import { captionsBaseUrl, CaptionsConnection } from './client.ts'
import { afterClose, fatalMessage, GO_RETRY_MS, isFatal } from './reconnect.ts'
import { addLocalLine, applyEvent, clock, emptyState, transcriptFileName, transcriptText, type CaptionsEvent, type CaptionsState } from './transcript.ts'

const SPOKEN = [
  ['auto', 'Detect (languages can be mixed)'],
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

const PEOPLE = [
  [0, "Don't know"],
  [1, '1'],
  [2, '2'],
  [3, '3'],
  [4, '4'],
  [5, '5'],
  [6, '6'],
] as const


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
  const [people, setPeople] = useState(() => Number(load('people', '0')) || 0)
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
  const fatal = useRef(false) // Go said it cannot go on: no reconnection
  const live = useRef(false) // this connection got 'ready'
  const userStopped = useRef(false)
  const whisper = useRef<WhisperListener | null>(null)
  const localOn = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const langRef = useRef(lang)
  const targetRef = useRef(target)
  const peopleRef = useRef(people)
  useEffect(() => {
    langRef.current = lang
    targetRef.current = target
    peopleRef.current = people
  }, [lang, target, people])

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
  const stopAudio = useRef(releaseAudio)
  useEffect(() => {
    stopAudio.current = releaseAudio
  })

  const handleEvent = useCallback((raw: CaptionsEvent) => {
    // Ids and times are per Go session; after a reconnection to Go they start again.
    const ev: CaptionsEvent = { ...raw }
    if (ev.id) ev.id = `c${connIndex.current}-${ev.id}`
    if (ev.type === 'final' && ev.start !== undefined) ev.start += connOffset.current
    switch (ev.type) {
      case 'ready':
        live.current = true
        goRetries.current = 0
        setPhase('live')
        setBanner(null)
        setOfferLocal(false)
        break
      case 'error': {
        const msg = ev.message ?? 'Unknown error'
        if (ev.code === 'translation' || ev.code === 'diarization') {
          setNotice(msg)
        } else if (!isFatal(ev.code, ev.retryable)) {
          setBanner({ kind: 'warn', text: msg }) // Go is retrying the speech service
        } else {
          // Shown once, and the session ends: Go saves the transcript; nothing reconnects.
          fatal.current = true
          setBanner({ kind: ev.code === 'limit_reached' ? 'warn' : 'error', text: fatalMessage(ev.code, msg) })
          if (ev.code !== 'limit_reached') setOfferLocal(true)
          stopAudio.current()
          conn.current?.stop()
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
    live.current = false
    conn.current = new CaptionsConnection(base, langRef.current, targetRef.current, peopleRef.current, {
      onOpen: () => {},
      onEvent: handleEvent,
      onClose: () => {
        conn.current = null
        // The retry counter is only reset by 'ready' (reconnect.ts): a server that accepts and then
        // closes at once used to loop forever.
        const next = afterClose({
          stopped: userStopped.current || localOn.current,
          fatal: fatal.current,
          live: live.current,
          retries: goRetries.current,
        })
        if (next.do === 'end') {
          if (fatal.current) releaseAudio()
          setPhase((p) => (p === 'local' ? p : 'ended'))
          return
        }
        if (next.do === 'give-up') {
          releaseAudio()
          setPhase('ended')
          setBanner({ kind: 'error', text: `Cannot reach the captions server (${base}). Restart the app, or use local Whisper.` })
          setOfferLocal(true)
          return
        }
        goRetries.current = next.retries
        setBanner({ kind: 'warn', text: `Lost the captions server, retrying (${next.retries}/${GO_RETRY_MS.length})…` })
        setTimeout(() => {
          if (!userStopped.current && !localOn.current) void reconnect.current()
        }, next.waitMs)
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
    fatal.current = false
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
  const bannerColor = banner?.kind === 'error' ? 'bg-danger text-on-accent' : banner?.kind === 'warn' ? 'bg-warn text-on-accent' : 'bg-surface-solid'
  const select = 'rounded-chip border border-edge bg-ink px-3 py-2 text-body text-fg disabled:opacity-50'
  const button = 'btn disabled:opacity-40'

  return (
    <section className="flex h-full min-h-0 flex-col text-fg" aria-label="Live captions">
      <header className="flex flex-wrap items-end gap-3 border-b border-edge p-3">
        <h1 className="mr-2 text-title font-bold">Live captions</h1>
        <label className="flex flex-col text-meta">
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
        <label className="flex flex-col text-meta">
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
        <label className="flex flex-col text-meta" title="Telling how many people talk helps to know who says what">
          People speaking
          <select
            className={select}
            value={people}
            disabled={busy}
            onChange={(e) => {
              setPeople(Number(e.target.value))
              keep('people', e.target.value)
            }}
          >
            {PEOPLE.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-meta">
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
          <button type="button" className={`${button} btn-danger`} onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className={`${button} btn-primary`} disabled={phase === 'finishing'} onClick={() => void start()}>
            Start
          </button>
        )}
        <button
          type="button"
          className={`${button} ${callAudio ? 'btn-primary' : ''}`}
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
        <div role="alert" className={`flex flex-wrap items-center gap-3 px-4 py-3 text-lead font-bold ${bannerColor}`}>
          <span>{banner.text}</span>
          {offerLocal && (
            <button type="button" className={button} onClick={() => void startLocalWhisper()}>
              Use local Whisper (less accurate)
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={listRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3" style={{ fontSize: fontPx, lineHeight: 1.3 }}>
          {captions.lines.length === 0 && !captions.partial && (
            <p className="text-fg-muted" style={{ fontSize: Math.max(20, fontPx * 0.6) }}>
              {phase === 'idle' || phase === 'ended' ? 'Press Start and speak: the captions appear here.' : 'Listening…'}
            </p>
          )}
          <ol aria-live="polite" aria-relevant="additions" className="space-y-4">
            {captions.lines.map((l) => (
              <li key={l.id}>
                <div className="text-fg-muted" style={{ fontSize: Math.max(16, fontPx * 0.45) }}>
                  {clock(l.start)}
                  {l.lang && <span className="tag ml-3 uppercase">{l.lang}</span>}
                  {l.speaker && <span className="ml-3 font-bold text-accent">{l.speaker}</span>}
                </div>
                <p className="font-bold" lang={l.lang}>
                  {l.text}
                </p>
                {Object.entries(l.translations).map(([tl, tx]) => (
                  <p key={tl} className="text-fg-muted" lang={tl}>
                    <span className="sr-only">{`Translation (${tl}): `}</span>
                    {tx}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {captions.partial && <p className="mt-4 italic text-fg-muted">{captions.partial}</p>}
        </div>
        {!atBottom && (
          <button type="button" className={`${button} btn-primary absolute bottom-4 right-6`} onClick={jumpToLatest}>
            Jump to latest ↓
          </button>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t border-edge px-4 py-2 text-body">
        <span aria-label="Input level" className="inline-block h-3 w-32 overflow-hidden rounded-chip bg-fill-strong">
          <span className="block h-full bg-accent" style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        <span>
          {phase === 'local' ? 'Local Whisper · 0 $' : `Cost: ${captions.costUsd.toFixed(4)} $${captions.limitUsd ? ` of ${captions.limitUsd.toFixed(2)} $` : ''}`}
        </span>
        {captions.model && phase !== 'local' && <span className="text-fg-muted">{captions.model}</span>}
        {captions.savedPath && <span className="text-fg-muted">Saved: {captions.savedPath}</span>}
        {notice && (
          <span role="status" className="text-warn">
            {notice}
          </span>
        )}
      </footer>
    </section>
  )
}
