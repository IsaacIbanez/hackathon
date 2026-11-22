import { useCallback, useEffect, useRef, useState } from 'react'
import { beep } from '../../input/voice/earcons.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { transcribeRemote } from '../transcribe.ts'
import { desktop, errorText, inDesktopApp } from './desktop.ts'
import type { KeypadAction } from './keypad.ts'
import { MicRecorder } from './recorder.ts'
import { Icon } from './ui.tsx'
import { DONE_SPEECH, voiceAction } from './voiceCommand.ts'

// Voice commands (docs/KEYPAD.md): keypad key 7 starts recording and the same key stops it. Go transcribes
// the recording (POST /transcribe: a cheap audio model, about 2 s) and the sentence becomes one of
// the keypad's actions ("lee el documento", "abre un archivo", "resume", "siguiente", "menú"…).
// Beeps mark the start and the end, and the result is spoken: it is meant for low vision.

const LANG = 'es-ES'

export type VoiceStatus =
  | { phase: 'idle' }
  | { phase: 'recording' }
  | { phase: 'transcribing' }
  | { phase: 'heard'; text: string; understood: boolean }
  | { phase: 'error'; message: string }

/**
 * Below this peak the recording is silence: a muted or broken microphone (measured: 0.000-0.015,
 * while a voice with the browser's gain control peaks well above 0.1). Silence is never sent to be
 * transcribed: the model then invents words, which could even turn into a command.
 */
export const SILENCE_PEAK = 0.025

/** The loudest sample of a recording (0 to 1). */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}

/** One step of a voice command in lauzhack.log (the desktop build has no console). */
function trace(msg: string): void {
  if (inDesktopApp()) void desktop().UILog(`voice: ${msg}`).catch(() => {})
}

export function useVoiceCommand(run: (action: KeypadAction) => void) {
  const [status, setStatus] = useState<VoiceStatus>({ phase: 'idle' })
  const [recorder] = useState(() => new MicRecorder())
  const [speaker] = useState(() => new Speaker())
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  const fail = useCallback(
    (message: string) => {
      setStatus({ phase: 'error', message })
      beep('error')
      speaker.speak({ text: message, lang: 'en-US' })
    },
    [speaker],
  )

  const stop = useCallback(async () => {
    if (!recorder.recording) return
    beep('end')
    setStatus({ phase: 'transcribing' })
    const { samples, sampleRate } = await recorder.stop()
    const peak = peakOf(samples)
    trace(`stopped: ${(samples.length / sampleRate).toFixed(2)} s at ${sampleRate} Hz, peak ${peak.toFixed(3)}`)
    if (samples.length < sampleRate * 0.3) {
      fail('The recording was too short. Press key 7, speak, then key 7 again.')
      return
    }
    if (peak < SILENCE_PEAK) {
      // Nothing reached the microphone: say why instead of sending silence to be transcribed.
      const muted = inDesktopApp() ? await desktop().MicMuted().catch(() => false) : false
      trace(`silent recording (microphone muted in Windows: ${muted})`)
      fail(
        muted
          ? 'The microphone is muted in Windows. Turn it on (fist menu, Microphone) and try again.'
          : 'No sound reached the microphone. Check that it is connected and on, then try again.',
      )
      return
    }
    try {
      if (!inDesktopApp()) throw new Error('Voice commands only work in the desktop app.')
      const wsUrl = await desktop().WsURL()
      if (!wsUrl) throw new Error('The voice service is not running (no AI key in .env?).')
      const { text } = await transcribeRemote(samples, sampleRate, LANG, wsUrl)
      const action = voiceAction(text)
      trace(`heard "${text}" -> ${action ?? 'no command'}`)
      setStatus({ phase: 'heard', text, understood: action !== null })
      if (!text.trim()) {
        speaker.speak({ text: 'No te he oído.', lang: LANG })
      } else if (!action) {
        speaker.speak({ text: `No sé hacer: ${text}`, lang: LANG })
      } else if (action === 'volume-up' || action === 'volume-down') {
        // The system volume, one step of 10 % (Windows shows its own indicator).
        await desktop().ChangeVolume(action === 'volume-up')
        speaker.speak({ text: action === 'volume-up' ? 'Volumen subido.' : 'Volumen bajado.', lang: LANG })
      } else if (action === 'delete-selection') {
        // Only now, after a command that is clearly "delete", is anything deleted, and only text
        // that is really selected (Go checks it first).
        try {
          const n = await desktop().DeleteSelection()
          speaker.speak({ text: n === 1 ? 'Borrado un carácter.' : `Texto borrado: ${n} caracteres.`, lang: LANG })
        } catch (e) {
          const msg = errorText(e)
          if (msg.includes('no_selection')) speaker.speak({ text: 'No hay texto seleccionado. Selecciona el texto y repite la orden.', lang: LANG })
          else throw e
        }
      } else {
        const done = DONE_SPEECH[action]
        if (done) speaker.speak({ text: done, lang: LANG })
        runRef.current(action)
      }
    } catch (e) {
      trace(`error: ${errorText(e)}`)
      fail(errorText(e))
    }
  }, [recorder, speaker, fail])

  const start = useCallback(async () => {
    if (recorder.recording) return
    speaker.stop() // do not record the app's own voice
    try {
      trace('start')
      await recorder.start(() => void stop())
      trace(`recording (audio ${recorder.state})`)
      beep('start')
      setStatus({ phase: 'recording' })
    } catch (e) {
      trace(`microphone error: ${errorText(e)}`)
      fail(`Cannot open the microphone: ${errorText(e)}`)
    }
  }, [recorder, speaker, stop, fail])

  /** One key for both: starts recording, or stops it and runs the command. */
  const toggle = useCallback(() => (recorder.recording ? stop() : start()), [recorder, start, stop])

  useEffect(() => () => void recorder.stop(), [recorder])

  return { status, start, stop, toggle }
}

/** A banner with what the voice command is doing; nothing when idle. */
export function VoiceBanner({ status }: { status: VoiceStatus }) {
  if (status.phase === 'idle') return null
  const text = {
    recording: 'Recording… press key 7 to stop.',
    transcribing: 'Understanding what you said…',
    heard: status.phase === 'heard' ? `Heard: “${status.text}”${status.understood ? '' : ' (not a command I know)'}` : '',
    error: status.phase === 'error' ? status.message : '',
  }[status.phase]
  const color =
    status.phase === 'recording'
      ? 'var(--color-accent)'
      : status.phase === 'error'
        ? 'var(--color-warn)'
        : 'var(--color-edge)'
  return (
    <p
      role="status"
      aria-live="assertive"
      className="glass fixed top-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-full px-6 py-3 text-lead"
      style={{ borderColor: color, animation: 'rise var(--duration-base) var(--ease-soft)' }}
    >
      {status.phase === 'recording' ? (
        <Icon name="mic" size={26} className="shrink-0 text-accent" />
      ) : (
        <span className="size-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      )}
      {text}
    </p>
  )
}
