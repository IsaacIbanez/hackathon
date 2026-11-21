// Canvas and video-frame helpers shared by captureStill and the framing guide.

export type Canvas2D = {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
}

export function makeCanvas(width: number, height: number, readBack: boolean): Canvas2D {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: readBack }) as Canvas2D['ctx'] | null
  if (!ctx) throw new Error('camera: 2D canvas not available')
  return { canvas, ctx }
}

export function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('camera: could not encode the image'))), type, quality),
  )
}

export function waitForVideo(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('loadeddata', onData)
      reject(new Error('camera: the video has no frames'))
    }, timeoutMs)
    const onData = () => {
      clearTimeout(timer)
      resolve()
    }
    video.addEventListener('loadeddata', onData, { once: true })
  })
}

/**
 * Calls `fn` once per new video frame (requestVideoFrameCallback, or every animation frame as a
 * fallback) while it returns true. Work done inside `fn` sees the same frame it was called for.
 */
export function eachFrame(video: HTMLVideoElement, fn: () => boolean): void {
  const step = () => {
    if (fn()) schedule()
  }
  const schedule = () => {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step)
    else requestAnimationFrame(step)
  }
  schedule()
}
