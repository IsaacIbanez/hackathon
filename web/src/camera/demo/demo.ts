// Test page for the camera module: npx vite web/src/camera, then open /demo/.
import { captureStillDetailed, describeStream, openCamera, startFramingGuide, type FramingGuide } from '../index.ts'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const video = $<HTMLVideoElement>('video')
const openBtn = $<HTMLButtonElement>('open')
const stillBtn = $<HTMLButtonElement>('still')
const status = $<HTMLParagraphElement>('status')
const photo = $<HTMLImageElement>('photo')
const log = $<HTMLDivElement>('log')

let stream: MediaStream | null = null
let lastUrl = ''

const note = (line: string) => {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent}`
}

openBtn.onclick = async () => {
  try {
    status.textContent = 'Opening camera…'
    stream?.getTracks().forEach((t) => t.stop())
    const t = performance.now()
    stream = await openCamera()
    video.srcObject = stream
    await video.play()
    const info = describeStream(stream)
    $('videoInfo').textContent = info
    status.textContent = 'Camera ready. Hold the paper still and press “Capture still”.'
    note(`open: ${info} (${Math.round(performance.now() - t)} ms)`)
    stillBtn.disabled = false
    guideBtn.disabled = false
  } catch (err) {
    status.textContent = `Camera error: ${err instanceof Error ? err.message : String(err)}`
  }
}

const showPhoto = (blob: Blob, info: string) => {
  if (lastUrl) URL.revokeObjectURL(lastUrl)
  lastUrl = URL.createObjectURL(blob)
  photo.src = lastUrl
  $('photoInfo').innerHTML = `${info} · <a href="${lastUrl}" download="still.${blob.type === 'image/png' ? 'png' : 'jpg'}">download</a>`
}

const guideBtn = $<HTMLButtonElement>('guide')
const live = $<HTMLParagraphElement>('live')
let guide: FramingGuide | null = null

const say = (text: string, lang: string) => {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel() // the newest hint replaces the previous one
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  speechSynthesis.speak(u)
}

const stopGuide = () => {
  guide?.stop()
  guide = null
  guideBtn.textContent = 'Start framing guide'
}

guideBtn.onclick = () => {
  if (guide) return stopGuide()
  const lang = $<HTMLSelectElement>('lang').value
  guideBtn.textContent = 'Stop framing guide'
  status.textContent = 'Framing guide running…'
  guide = startFramingGuide(video, {
    lang,
    type: $<HTMLSelectElement>('type').value as 'image/png' | 'image/jpeg',
    onHint: (hint, text) => {
      status.textContent = `${hint}: ${text}`
      note(`hint: ${hint} — ${text}`)
      say(text, lang)
    },
    onFrame: (s, v) => {
      live.textContent =
        `brightness ${s.brightness.toFixed(0)} · sharpness ${s.sharpness.toFixed(0)} · ` +
        `motion ${s.motion === null ? '—' : s.motion.toFixed(2)} · still ${(v.stillMs / 1000).toFixed(2)} s · ${v.hint}`
    },
    onCapture: (blob, info) => {
      const mb = (blob.size / 1e6).toFixed(1)
      const text = `${info.reason} · ${info.width}x${info.height} ${blob.type} ${mb} MB · sharpness ${info.sharpness.toFixed(1)} · ${info.elapsedMs} ms`
      showPhoto(blob, text)
      note(`guide capture: ${text}`)
      stopGuide()
    },
    onError: (err) => {
      status.textContent = `Guide error: ${err.message}`
      stopGuide()
    },
  })
}

stillBtn.onclick = async () => {
  stillBtn.disabled = true
  status.textContent = 'Hold the paper still…'
  try {
    const r = await captureStillDetailed(video, {
      durationMs: Number($<HTMLInputElement>('duration').value) || 0,
      type: $<HTMLSelectElement>('type').value as 'image/png' | 'image/jpeg',
    })
    const mb = (r.blob.size / 1e6).toFixed(1)
    const info = `${r.width}x${r.height} ${r.blob.type} ${mb} MB · sharpness ${r.sharpness.toFixed(1)} · ${r.frames} frames · ${r.elapsedMs} ms`
    showPhoto(r.blob, info)
    status.textContent = 'Photo taken.'
    note(`still: ${info}`)
  } catch (err) {
    status.textContent = `Capture error: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    stillBtn.disabled = false
  }
}
