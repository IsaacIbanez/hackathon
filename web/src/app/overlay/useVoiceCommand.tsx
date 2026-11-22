import { useCallback, useEffect, useRef, useState } from 'react'
import { beep } from '../../input/voice/earcons.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { transcribeRemote } from '../transcribe.ts'
import { desktop, errorText, inDesktopApp } from './desktop.ts'
import type { KeypadAction } from './keypad.ts'
import { MicRecorder } from './recorder.ts'
import { DONE_SPEECH, voiceAction } from './voiceCommand.ts'

// Voice commands (docs/KEYPAD.md): keypad key 2 starts recording, key 3 stops it. Go transcribes
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
    if (samples.length < sampleRate * 0.3) {
      fail('The recording was too short. Press key 2, speak, then key 3.')
      return
    }
    try {
      if (!inDesktopApp()) throw new Error('Voice commands only work in the desktop app.')
      const wsUrl = await desktop().WsURL()
      if (!wsUrl) throw new Error('The voice service is not running (no AI key in .env?).')
      const { text } = await transcribeRemote(samples, sampleRate, LANG, wsUrl)
      const action = voiceAction(text)
      setStatus({ phase: 'heard', text, understood: action !== null })
      if (!text.trim()) {
        speaker.speak({ text: 'No te he oído.', lang: LANG })
      } else if (!action) {
        speaker.speak({ text: `No sé hacer: ${text}`, lang: LANG })
      } else {
        const done = DONE_SPEECH[action]
        if (done) speaker.speak({ text: done, lang: LANG })
        runRef.current(action)
      }
    } catch (e) {
      fail(errorText(e))
    }
  }, [recorder, speaker, fail])

  const start = useCallback(async () => {
    if (recorder.recording) return
    speaker.stop() // do not record the app's own voice
    try {
      await recorder.start(() => void stop())
      beep('start')
      setStatus({ phase: 'recording' })
    } catch (e) {
      fail(`Cannot open the microphone: ${errorText(e)}`)
    }
  }, [recorder, speaker, stop, fail])

  useEffect(() => () => void recorder.stop(), [recorder])

  return { status, start, stop }
}

/** A banner with what the voice command is doing; nothing when idle. */
export function VoiceBanner({ status }: { status: VoiceStatus }) {
  if (status.phase === 'idle') return null
  const text = {
    recording: '🎙 Recording… press key 3 to stop.',
    transcribing: 'Understanding what you said…',
    heard: status.phase === 'heard' ? `Heard: “${status.text}”${status.understood ? '' : ' (not a command I know)'}` : '',
    error: status.phase === 'error' ? status.message : '',
  }[status.phase]
  const color = status.phase === 'recording' ? 'border-red-400 text-red-200' : status.phase === 'error' ? 'border-amber-300 text-amber-200' : 'border-sky-300 text-sky-100'
  return (
    <p role="status" aria-live="assertive" className={`mb-4 rounded-xl border-2 px-4 py-2 text-2xl ${color}`}>
      {text}
    </p>
  )
}
