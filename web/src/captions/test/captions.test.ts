import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Downsampler, floatToInt16 } from '../pcm.ts'
import { addLocalLine, applyEvent, clock, emptyState, transcriptFileName, transcriptText, type CaptionsEvent } from '../transcript.ts'

test('downsampler: 48 kHz to 16 kHz averages groups of 3, across chunk boundaries', () => {
  const input = Float32Array.from({ length: 30 }, (_, i) => i)
  const whole = new Downsampler(48000).process(input)
  assert.deepEqual([...whole], [1, 4, 7, 10, 13, 16, 19, 22, 25, 28])
  const d = new Downsampler(48000)
  const parts = [...d.process(input.slice(0, 7)), ...d.process(input.slice(7, 11)), ...d.process(input.slice(11))]
  assert.deepEqual(parts, [...whole])
})

test('downsampler: 44.1 kHz gives 16000 samples per second, and 16 kHz is a copy', () => {
  const d = new Downsampler(44100)
  let n = 0
  for (let i = 0; i < 10; i++) n += d.process(new Float32Array(4410)).length
  assert.ok(Math.abs(n - 16000) <= 1, `got ${n}`)
  const same = new Float32Array([0.1, 0.2])
  assert.equal(new Downsampler(16000).process(same), same)
})

test('float to int16 clips and keeps the sign', () => {
  assert.deepEqual([...floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))], [0, 32767, -32768, 32767, -32768, 16384])
})

const events: CaptionsEvent[] = [
  { type: 'ready', model: 'nvidia/nemotron-3.5-asr-streaming-0.6b' },
  { type: 'partial', text: '¿Cuándo vence' },
  { type: 'final', id: 's1', start: 3.2, text: '¿Cuándo vence el plazo del seguro?' },
  { type: 'partial', text: 'El quince' },
  { type: 'final', id: 's2', start: 7.9, text: 'El quince de diciembre.' },
  { type: 'translation', id: 's1', lang: 'en', text: 'When does the insurance deadline expire?' },
  { type: 'speaker', id: 's1', speaker: 'Speaker 1' },
  { type: 'speaker', id: 's2', speaker: 'Speaker 2' },
  { type: 'translation', id: 's2', lang: 'en', text: 'On the fifteenth of December.' },
  { type: 'cost', costUsd: 0.0012, limitUsd: 1 },
  { type: 'saved', path: 'C:\\Users\\x\\Documents\\LauzHack\\captions-2026-11-21-2330.txt' },
]

test('a partial shows the sentence in progress and stays below the history', () => {
  let s = emptyState()
  for (const ev of events.slice(0, 4)) s = applyEvent(s, ev)
  assert.equal(s.partial, 'El quince')
  assert.deepEqual(s.lines.map((l) => l.id), ['s1'])
})

test('a final clears the partial; speakers and translations attach to their line', () => {
  let s = emptyState()
  for (const ev of events) s = applyEvent(s, ev)
  assert.equal(s.partial, '')
  assert.equal(s.lines.length, 2)
  assert.deepEqual(s.lines[0], {
    id: 's1',
    start: 3.2,
    text: '¿Cuándo vence el plazo del seguro?',
    speaker: 'Speaker 1',
    translations: { en: 'When does the insurance deadline expire?' },
  })
  assert.deepEqual(s.langs, ['en'])
  assert.equal(s.costUsd, 0.0012)
  assert.ok(s.savedPath?.endsWith('captions-2026-11-21-2330.txt'))
  // A repeated final (e.g. after a reconnect) does not duplicate the line.
  assert.equal(applyEvent(s, events[2]).lines.length, 2)
})

test('transcript text has the same format as the file Go saves', () => {
  let s = emptyState()
  for (const ev of events) s = applyEvent(s, ev)
  const started = new Date(2026, 10, 21, 23, 30)
  assert.equal(
    transcriptText(s, started, 'es'),
    'Live captions — 2026-11-21 23:30 — spoken: es — translated to: en\n' +
      '== Original ==\n' +
      '[00:00:03] Speaker 1: ¿Cuándo vence el plazo del seguro?\n' +
      '[00:00:07] Speaker 2: El quince de diciembre.\n' +
      '\n== Translation (en) ==\n' +
      '[00:00:03] Speaker 1: When does the insurance deadline expire?\n' +
      '[00:00:07] Speaker 2: On the fifteenth of December.\n',
  )
  assert.equal(transcriptFileName(started), 'captions-2026-11-21-2330.txt')
})

test('local Whisper lines and clock', () => {
  let s = addLocalLine(emptyState(), '  hola  ', 65)
  s = addLocalLine(s, ' ', 70)
  assert.deepEqual(s.lines.map((l) => [l.id, l.text]), [['w1', 'hola']])
  assert.equal(clock(3725.9), '01:02:05')
  assert.ok(transcriptText(s, new Date(2026, 0, 2, 3, 4), 'auto').includes('translated to: none\n== Original ==\n[00:01:05] hola\n'))
})

test('revise replaces text and language; the transcript shows the language like Go', () => {
  let s = emptyState()
  for (const ev of [
    { type: 'final', id: 's1', start: 0, text: 'Mañana tenemos el meeting.', lang: 'es' },
    { type: 'final', id: 's2', start: 5, text: 'Okay, hasta luego.' },
    { type: 'speaker', id: 's2', speaker: 'Speaker 2' },
    { type: 'revise', id: 's2', text: 'Okay, "hasta luego".', lang: 'en' },
    { type: 'revise', id: 's1', text: 'Mañana tenemos el "meeting".', lang: 'es' },
    { type: 'translation', id: 's1', lang: 'en', text: 'Tomorrow we have the meeting.' },
    { type: 'translation', id: 's2', lang: 'en', text: 'Okay, "hasta luego".' },
  ] as CaptionsEvent[])
    s = applyEvent(s, ev)
  assert.deepEqual(s.lines.map((l) => [l.text, l.lang]), [
    ['Mañana tenemos el "meeting".', 'es'],
    ['Okay, "hasta luego".', 'en'],
  ])
  assert.equal(
    transcriptText(s, new Date(2026, 10, 22, 0, 30), 'auto'),
    'Live captions — 2026-11-22 00:30 — spoken: auto — translated to: en\n' +
      '== Original ==\n' +
      '[00:00:00] (es): Mañana tenemos el "meeting".\n' +
      '[00:00:05] Speaker 2 (en): Okay, "hasta luego".\n' +
      '\n== Translation (en) ==\n' +
      '[00:00:00] Tomorrow we have the meeting.\n' +
      '[00:00:05] Speaker 2: Okay, "hasta luego".\n',
  )
})
