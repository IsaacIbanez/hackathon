import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analysisSize, frameMetrics, laplacianVariance, mean, toGray } from '../sharpness.ts'

// Synthetic "text": black strokes 2 px wide on white, like small print.
function strokes(width: number, height: number): Float32Array {
  const g = new Float32Array(width * height).fill(255)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x % 6 < 2 || y % 9 < 2) g[y * width + x] = 0
  return g
}

function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const yy = Math.min(height - 1, Math.max(0, y + dy))
          sum += src[yy * width + xx]
          n++
        }
      }
      out[y * width + x] = sum / n
    }
  }
  return out
}

function toRgba(gray: Float32Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.length * 4)
  gray.forEach((v, i) => rgba.set([v, v, v, 255], i * 4))
  return rgba
}

test('a flat image has zero sharpness', () => {
  assert.equal(laplacianVariance(new Float32Array(40 * 30).fill(128), 40, 30), 0)
})

test('the sharp image scores higher than its blurred versions, and more blur scores lower', () => {
  const w = 120
  const h = 90
  const sharp = strokes(w, h)
  const s0 = laplacianVariance(sharp, w, h)
  const s1 = laplacianVariance(boxBlur(sharp, w, h, 1), w, h)
  const s2 = laplacianVariance(boxBlur(sharp, w, h, 2), w, h)
  assert.ok(s0 > s1 && s1 > s2, `${s0} > ${s1} > ${s2}`)
  assert.ok(s0 > 3 * s2)
})

test('gray uses the OpenCV BT.601 weights', () => {
  const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1)
  assert.deepEqual([...g].map((v) => Math.round(v * 1000) / 1000), [76.245, 149.685, 29.07])
})

test('frameMetrics gives brightness and sharpness from RGBA', () => {
  const w = 60
  const h = 45
  const gray = strokes(w, h)
  const m = frameMetrics(toRgba(gray), w, h)
  assert.ok(Math.abs(m.brightness - mean(gray)) < 1e-6)
  assert.ok(Math.abs(m.sharpness - laplacianVariance(gray, w, h)) < 1e-6)
})

test('toGray rejects a buffer that is too short', () => {
  assert.throws(() => toGray(new Uint8ClampedArray(8), 3, 1))
})

test('analysis copy: 960 wide keeping the aspect ratio, never upscaled', () => {
  assert.deepEqual(analysisSize(3840, 2160), { width: 960, height: 540 })
  assert.deepEqual(analysisSize(1280, 720, 640), { width: 640, height: 360 })
  assert.deepEqual(analysisSize(640, 480), { width: 640, height: 480 })
})
