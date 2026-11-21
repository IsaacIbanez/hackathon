// Test page for the camera module: npx vite web/src/camera, then open /demo/.
import { captureStillDetailed, describeStream, openCamera } from '../index.ts'

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
  } catch (err) {
    status.textContent = `Camera error: ${err instanceof Error ? err.message : String(err)}`
  }
}

stillBtn.onclick = async () => {
  stillBtn.disabled = true
  status.textContent = 'Hold the paper still…'
  try {
    const r = await captureStillDetailed(video, {
      durationMs: Number($<HTMLInputElement>('duration').value) || 0,
      type: $<HTMLSelectElement>('type').value as 'image/png' | 'image/jpeg',
    })
    if (lastUrl) URL.revokeObjectURL(lastUrl)
    lastUrl = URL.createObjectURL(r.blob)
    photo.src = lastUrl
    const mb = (r.blob.size / 1e6).toFixed(1)
    const info = `${r.width}x${r.height} ${r.blob.type} ${mb} MB · sharpness ${r.sharpness.toFixed(1)} · ${r.frames} frames · ${r.elapsedMs} ms`
    $('photoInfo').innerHTML = `${info} · <a href="${lastUrl}" download="still.${r.blob.type === 'image/png' ? 'png' : 'jpg'}">download</a>`
    status.textContent = 'Photo taken.'
    note(`still: ${info}`)
  } catch (err) {
    status.textContent = `Capture error: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    stillBtn.disabled = false
  }
}
