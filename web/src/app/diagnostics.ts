import { ReportDiagnostics } from '../../wailsjs/go/main/App'

/** What the embedded browser (WebView2 in the desktop app) supports. */
export interface Diagnostics {
  speechSynthesis: boolean
  voices: number
  spanishVoices: string[]
  /** Needed for voice dictation (role C). WebView2 may not provide it. */
  speechRecognition: boolean
  camera: boolean
  videoInputs: number
  userAgent: string
}

/** Voices load asynchronously: wait for them, at most 2 s. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    const now = synth.getVoices()
    if (now.length > 0) return resolve(now)
    const done = () => resolve(synth.getVoices())
    synth.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 2000)
  })
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  const hasSynth = 'speechSynthesis' in window
  const voices = hasSynth ? await loadVoices() : []
  const w = window as unknown as Record<string, unknown>
  let videoInputs = 0
  try {
    const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? []
    videoInputs = devices.filter((d) => d.kind === 'videoinput').length
  } catch {
    // No permission or no mediaDevices: leave it at 0.
  }
  return {
    speechSynthesis: hasSynth,
    voices: voices.length,
    spanishVoices: voices.filter((v) => v.lang.toLowerCase().startsWith('es')).map((v) => `${v.name} (${v.lang})`),
    speechRecognition: 'SpeechRecognition' in w || 'webkitSpeechRecognition' in w,
    camera: typeof navigator.mediaDevices?.getUserMedia === 'function',
    videoInputs,
    userAgent: navigator.userAgent,
  }
}

/** Writes the diagnostics to the app log (lauzhack.log). Does nothing outside Wails. */
export async function reportDiagnostics(d: Diagnostics): Promise<void> {
  try {
    await ReportDiagnostics(JSON.stringify(d))
  } catch {
    // Not running inside Wails.
  }
}
