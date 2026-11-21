// startFramingGuide: watches the video while "read the document" is running, gives spoken hints
// ("it is too dark", "hold it still"…) and takes the photo by itself when the paper is still,
// sharp and lit. All local, no AI.

import { FramingJudge, HintGate, hintText, type FrameSample, type FramingHint, type FramingThresholds, type Verdict } from './framing.ts'
import { eachFrame, makeCanvas, toBlob, waitForVideo, type Canvas2D } from './frames.ts'
import { analysisSize, downsample, laplacianVariance, mean, meanAbsDiff, toGray } from './sharpness.ts'
import { shutterBeep } from './shutter.ts'

export interface CaptureInfo {
  /** 'ready': still, sharp and lit. 'timeout': the time ran out and the best frame seen was used. */
  reason: 'ready' | 'timeout'
  width: number
  height: number
  sharpness: number
  brightness: number
  /** From the call to the photo being ready. */
  elapsedMs: number
}

export interface FramingGuideOptions {
  /** BCP-47 language of the hints, e.g. "es-ES". */
  lang: string
  /** A hint to say out loud. Not repeated while it stays the same (it is repeated after 5 s if it persists). */
  onHint: (hint: FramingHint, text: string) => void
  /** The photo (sharpest frame of the still moment, full resolution). Called once; the guide then stops. */
  onCapture: (still: Blob, info: CaptureInfo) => void
  /** Called if the guide fails (no frames, canvas unavailable…). The guide stops. */
  onError?: (error: Error) => void
  /** If no good photo comes in this time, the best frame seen is used. Default 8000 ms. */
  timeoutMs?: number
  thresholds?: Partial<FramingThresholds>
  /** Output format. PNG (default, lossless) or JPEG 0.95. */
  type?: 'image/png' | 'image/jpeg'
  /** Play a short sound when the photo is taken. Default true. */
  beep?: boolean
  /** Every measured frame, for the test page and diagnostics. */
  onFrame?: (sample: FrameSample, verdict: Verdict) => void
}

export interface FramingGuide {
  stop(): void
}

interface Kept {
  frame: Canvas2D
  sharpness: number
  brightness: number
}

export function startFramingGuide(video: HTMLVideoElement, opts: FramingGuideOptions): FramingGuide {
  const start = performance.now()
  const timeoutMs = opts.timeoutMs ?? 8000
  const judge = new FramingJudge(opts.thresholds)
  const gate = new HintGate()
  let stopped = false // no more frames are analysed
  let cancelled = false // stop() was called: no more callbacks either

  const fail = (err: unknown) => {
    if (stopped || cancelled) return
    stopped = true
    opts.onError?.(err instanceof Error ? err : new Error(String(err)))
  }

  const finish = async (kept: Kept, reason: CaptureInfo['reason'], width: number, height: number) => {
    stopped = true
    try {
      const blob = await toBlob(kept.frame.canvas, opts.type ?? 'image/png', 0.95)
      if (cancelled) return
      if (opts.beep ?? true) shutterBeep()
      opts.onHint('ready', hintText('ready', opts.lang))
      opts.onCapture(blob, {
        reason,
        width,
        height,
        sharpness: kept.sharpness,
        brightness: kept.brightness,
        elapsedMs: Math.round(performance.now() - start),
      })
    } catch (err) {
      if (!cancelled) opts.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  waitForVideo(video)
    .then(() => {
      if (stopped) return
      const width = video.videoWidth
      const height = video.videoHeight
      const small = analysisSize(width, height)
      const probe = makeCanvas(small.width, small.height, true)
      // Two full-resolution copies: the sharpest frame of the current still moment, and the sharpest overall
      // (for the timeout). They are only redrawn when a sharper frame shows up.
      const still: Kept = { frame: makeCanvas(width, height, false), sharpness: -1, brightness: 0 }
      const any: Kept = { frame: makeCanvas(width, height, false), sharpness: -1, brightness: 0 }
      let previous: Float32Array | null = null

      eachFrame(video, () => {
        if (stopped) return false
        try {
          probe.ctx.drawImage(video, 0, 0, small.width, small.height)
          const gray = toGray(probe.ctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height)
          const tiny = downsample(gray, small.width, small.height).data
          const t = performance.now()
          const sample: FrameSample = {
            t,
            brightness: mean(gray),
            sharpness: laplacianVariance(gray, small.width, small.height),
            motion: previous ? meanAbsDiff(previous, tiny) : null,
          }
          previous = tiny
          const verdict = judge.update(sample)
          opts.onFrame?.(sample, verdict)

          if (verdict.moving) still.sharpness = -1 // the still moment is over; the next one starts from scratch
          for (const kept of verdict.moving ? [any] : [still, any]) {
            if (sample.sharpness > kept.sharpness) {
              kept.frame.ctx.drawImage(video, 0, 0, width, height)
              kept.sharpness = sample.sharpness
              kept.brightness = sample.brightness
            }
          }

          if (verdict.ready) {
            void finish(still, 'ready', width, height)
            return false
          }
          if (t - start >= timeoutMs) {
            void finish(still.sharpness >= 0 ? still : any, 'timeout', width, height)
            return false
          }
          const say = gate.offer(verdict.hint, t)
          if (say) opts.onHint(say, hintText(say, opts.lang))
          return true
        } catch (err) {
          fail(err)
          return false
        }
      })
    })
    .catch(fail)

  return {
    stop() {
      stopped = true
      cancelled = true
    },
  }
}
