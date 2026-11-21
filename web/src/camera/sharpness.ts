// Image quality metrics, the same ones scanner/capturar.py uses:
// brightness = mean gray level (0-255), sharpness = variance of the Laplacian (higher = sharper).
// Pure functions (no DOM) so they can be tested with node --test.

export interface FrameMetrics {
  brightness: number
  sharpness: number
}

/** RGBA (as in ImageData.data) to gray with the BT.601 weights OpenCV uses for BGR2GRAY. */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const n = width * height
  if (rgba.length < n * 4) throw new Error(`toGray: expected ${n * 4} values, got ${rgba.length}`)
  const gray = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
  }
  return gray
}

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return 0
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

/**
 * Variance of the 4-neighbour Laplacian over the interior pixels
 * (kernel [0 1 0; 1 -4 1; 0 1 0], the OpenCV default with ksize = 1).
 * Blur removes the high frequencies that make this value large, so the sharpest frame wins.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += v
      sumSq += v * v
      count++
    }
  }
  const m = sum / count
  return sumSq / count - m * m
}

export function frameMetrics(rgba: ArrayLike<number>, width: number, height: number): FrameMetrics {
  const gray = toGray(rgba, width, height)
  return { brightness: mean(gray), sharpness: laplacianVariance(gray, width, height) }
}

/** Size used for the analysis copy: `targetWidth` wide, same aspect ratio, never upscaled. */
export function analysisSize(width: number, height: number, targetWidth = 960): { width: number; height: number } {
  if (width <= targetWidth) return { width, height }
  return { width: targetWidth, height: Math.max(1, Math.round((height * targetWidth) / width)) }
}
