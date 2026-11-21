// captureStill: the sharpest full-resolution frame of the video during a short window (~0.5 s).
// Same criterion as scanner/capturar.py: variance of the Laplacian on a reduced copy.

import { analysisSize, frameMetrics } from './sharpness.ts'

export interface StillOptions {
  /** How long to look for the sharpest frame. Default 500 ms. */
  durationMs?: number
  /** Output format. PNG (default) is lossless; JPEG is smaller and faster to encode. */
  type?: 'image/png' | 'image/jpeg'
  /** JPEG quality, 0-1. Default 0.95. */
  quality?: number
  /** Width of the copy used to measure sharpness. Default 960 (~5 ms per 4K frame). */
  analysisWidth?: number
}

export interface StillResult {
  blob: Blob
  width: number
  height: number
  sharpness: number
  brightness: number
  /** Frames measured in the window. */
  frames: number
  /** Time from the call to the blob being ready. */
  elapsedMs: number
}

type Canvas2D = { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D }

function makeCanvas(width: number, height: number, readBack: boolean): Canvas2D {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: readBack }) as Canvas2D['ctx'] | null
  if (!ctx) throw new Error('captureStill: 2D canvas not available')
  return { canvas, ctx }
}

function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('captureStill: could not encode the image'))), type, quality),
  )
}

function waitForVideo(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('loadeddata', onData)
      reject(new Error('captureStill: the video has no frames'))
    }, timeoutMs)
    const onData = () => {
      clearTimeout(timer)
      resolve()
    }
    video.addEventListener('loadeddata', onData, { once: true })
  })
}

/** Calls `fn` once per new video frame (requestVideoFrameCallback, or every animation frame as a fallback). */
function eachFrame(video: HTMLVideoElement, fn: () => boolean): void {
  const step = () => {
    if (fn()) schedule()
  }
  const schedule = () => {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step)
    else requestAnimationFrame(step)
  }
  schedule()
}

/**
 * Looks at the frames of `video` for `durationMs` and returns the sharpest one, at full resolution.
 * The frame is the raw camera image (not mirrored, not cropped).
 */
export async function captureStillDetailed(video: HTMLVideoElement, opts: StillOptions = {}): Promise<StillResult> {
  const start = performance.now()
  const durationMs = opts.durationMs ?? 500
  await waitForVideo(video)

  const width = video.videoWidth
  const height = video.videoHeight
  const small = analysisSize(width, height, opts.analysisWidth ?? 960)
  const probe = makeCanvas(small.width, small.height, true)
  const best = makeCanvas(width, height, false)

  const found = await new Promise<{ sharpness: number; brightness: number; frames: number }>((resolve, reject) => {
    let frames = 0
    let bestSharpness = -1
    let bestBrightness = 0
    // Everything happens inside the frame callback, so the measured frame and the kept frame are the same one.
    eachFrame(video, () => {
      try {
        probe.ctx.drawImage(video, 0, 0, small.width, small.height)
        const m = frameMetrics(probe.ctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height)
        frames++
        if (m.sharpness > bestSharpness) {
          bestSharpness = m.sharpness
          bestBrightness = m.brightness
          best.ctx.drawImage(video, 0, 0, width, height)
        }
        if (performance.now() - start < durationMs) return true
        resolve({ sharpness: bestSharpness, brightness: bestBrightness, frames })
      } catch (err) {
        reject(err)
      }
      return false
    })
  })

  const blob = await toBlob(best.canvas, opts.type ?? 'image/png', opts.quality ?? 0.95)
  return { blob, width, height, ...found, elapsedMs: Math.round(performance.now() - start) }
}

/** The sharpest frame of the last ~0.5 s as an image (PNG by default), ready for `POST /scan`. */
export async function captureStill(video: HTMLVideoElement, opts: StillOptions = {}): Promise<Blob> {
  return (await captureStillDetailed(video, opts)).blob
}
