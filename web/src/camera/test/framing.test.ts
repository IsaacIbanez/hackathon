import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_THRESHOLDS, FramingJudge, HintGate, hintText, type FrameSample, type FramingHint } from '../framing.ts'
import { downsample, meanAbsDiff } from '../sharpness.ts'

// ~30 fps frames: a lit page (brightness 140), sharp (300), still (motion 1.4 = MX Brio sensor noise).
const FRAME_MS = 33
const good = (i: number, over: Partial<FrameSample> = {}): FrameSample => ({
  t: i * FRAME_MS,
  brightness: 140,
  sharpness: 300,
  motion: i === 0 ? null : 1.4,
  ...over,
})

function run(judge: FramingJudge, frames: FrameSample[]): FramingHint[] {
  return frames.map((f) => judge.update(f).hint)
}

test('a still, sharp and lit page becomes ready after holdMs, not before', () => {
  const judge = new FramingJudge()
  const hints = run(judge, Array.from({ length: 30 }, (_, i) => good(i)))
  const firstReady = hints.indexOf('ready')
  assert.ok(firstReady > 0)
  assert.ok(firstReady * FRAME_MS >= DEFAULT_THRESHOLDS.holdMs, `ready at ${firstReady * FRAME_MS} ms`)
  assert.ok(firstReady * FRAME_MS < DEFAULT_THRESHOLDS.holdMs + 2 * FRAME_MS)
  assert.ok(hints.slice(0, firstReady).every((h) => h === 'hold_still'))
})

test('movement restarts the countdown', () => {
  const judge = new FramingJudge()
  const frames = Array.from({ length: 50 }, (_, i) => good(i, i === 15 ? { motion: 12 } : {}))
  const hints = run(judge, frames)
  assert.equal(hints[15], 'moving')
  const firstReady = hints.indexOf('ready')
  assert.ok((firstReady - 15) * FRAME_MS >= DEFAULT_THRESHOLDS.holdMs, `ready ${(firstReady - 15) * FRAME_MS} ms after moving`)
})

test('too dark wins over everything else, and never becomes ready', () => {
  const judge = new FramingJudge()
  const hints = run(judge, Array.from({ length: 60 }, (_, i) => good(i, { brightness: 30, motion: i % 2 ? 10 : 1 })))
  assert.ok(hints.every((h) => h === 'dark'))
})

test('no usable detail is blurry; a moving image is reported as moving first', () => {
  const judge = new FramingJudge()
  assert.equal(judge.update(good(0, { sharpness: 5 })).hint, 'blurry')
  assert.equal(judge.update(good(1, { sharpness: 5, motion: 9 })).hint, 'moving')
})

test('waits while the autofocus is still changing the sharpness', () => {
  const judge = new FramingJudge()
  // Still the whole time, but the sharpness swings for the first second (autofocus hunting).
  const frames = Array.from({ length: 60 }, (_, i) => good(i, { sharpness: i < 30 ? (i % 2 ? 150 : 300) : 320 }))
  const hints = run(judge, frames)
  const firstReady = hints.indexOf('ready')
  assert.ok(firstReady >= 30 + DEFAULT_THRESHOLDS.stableFrames - 1, `ready at frame ${firstReady}`)
})

test('the verdict says whether the frame moved, even when the hint is "dark"', () => {
  const judge = new FramingJudge()
  judge.update(good(0))
  const v = judge.update(good(1, { brightness: 20, motion: 15 }))
  assert.equal(v.hint, 'dark')
  assert.equal(v.moving, true)
  assert.equal(v.stillMs, 0)
})

test('hint gate: waits debounceMs, does not repeat, repeats after repeatMs, never says ready', () => {
  const gate = new HintGate(300, 5000)
  assert.equal(gate.offer('moving', 0), null)
  assert.equal(gate.offer('moving', 200), null)
  assert.equal(gate.offer('moving', 320), 'moving')
  assert.equal(gate.offer('moving', 1000), null)
  assert.equal(gate.offer('moving', 5400), 'moving')
  assert.equal(gate.offer('hold_still', 5500), null)
  assert.equal(gate.offer('hold_still', 5850), 'hold_still')
  assert.equal(gate.offer('ready', 6000), null)
})

test('hint gate: a single odd frame does not talk', () => {
  const gate = new HintGate(300, 5000)
  const said: (FramingHint | null)[] = []
  for (let t = 0; t <= 1000; t += 33) said.push(gate.offer(t === 495 ? 'blurry' : 'hold_still', t))
  assert.deepEqual(said.filter(Boolean), ['hold_still'])
})

test('hint texts in Spanish, Catalan and English; English for other languages', () => {
  assert.equal(hintText('moving', 'es-ES'), 'El papel se mueve. Sujétalo quieto.')
  assert.equal(hintText('ready', 'ca'), 'Foto feta.')
  assert.equal(hintText('dark', 'fr-FR'), hintText('dark', 'en-US'))
})

test('motion: sensor noise stays under the threshold, a 2 px shift of text does not', () => {
  const w = 240
  const h = 136
  const page = (shift: number, noise: number) => {
    const g = new Float32Array(w * h)
    let seed = 7 + shift * 13 + noise
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        const ink = (x + shift) % 8 < 2 || y % 12 < 2
        g[y * w + x] = (ink ? 30 : 230) + ((seed / 2 ** 31) * 2 - 1) * noise
      }
    }
    return g
  }
  const a = downsample(page(0, 0), w, h, 1).data
  const noisy = downsample(page(0, 6), w, h, 1).data
  const shifted = downsample(page(2, 0), w, h, 1).data
  assert.ok(meanAbsDiff(a, noisy) < DEFAULT_THRESHOLDS.motion, `noise ${meanAbsDiff(a, noisy)}`)
  assert.ok(meanAbsDiff(a, shifted) > 5 * DEFAULT_THRESHOLDS.motion, `shift ${meanAbsDiff(a, shifted)}`)
})

test('downsample averages blocks and drops the remainder', () => {
  const g = new Float32Array([1, 3, 5, 7, 9, 2, 4, 6, 8, 10])
  const r = downsample(g, 5, 2, 2)
  assert.deepEqual([r.width, r.height], [2, 1])
  assert.deepEqual([...r.data], [(1 + 3 + 2 + 4) / 4, (5 + 7 + 6 + 8) / 4])
})
