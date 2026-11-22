import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DocumentPayload } from '../../api/index.ts'
import { LineReader, keyAction, readingOrder, speechLang, spokenText, type ReaderVoice } from '../reader.ts'

/** A voice that records what it was asked to say and lets the test finish or interrupt it. */
class FakeVoice implements ReaderVoice {
  said: string[] = []
  cancels = 0
  private events: { onEnd(): void; onInterrupt(): void } | null = null
  say(text: string, _lang: string, events: { onEnd(): void; onInterrupt(): void }) {
    this.said.push(text)
    this.events = events
  }
  cancel() {
    this.cancels++
    // Like the browser: cancelling reports an interruption of what was being said.
    const e = this.events
    this.events = null
    e?.onInterrupt()
  }
  end() {
    const e = this.events
    this.events = null
    e?.onEnd()
  }
  interrupt() {
    const e = this.events
    this.events = null
    e?.onInterrupt()
  }
}

const block = (id: string, text: string, y: number, x = 0.1, confidence = 0.92) => ({
  id,
  text,
  confidence,
  box: { x, y, w: 0.5, h: 0.02 },
})

// Blocks deliberately out of order: reading order is by position.
const doc: DocumentPayload = {
  blocks: [
    block('b3', 'La prima anual será de 284,60 euros.', 0.5),
    block('b1', 'Asunto: Renovación de su póliza', 0.2),
    block('b2', 'Vence el 31 de diciembre de 2026.', 0.3, 0.1, 0.41),
    block('b0', '   ', 0.1),
  ],
  quality: { score: 0.9, issues: [] },
  lang: 'es',
}

function setup(d: DocumentPayload | null = doc) {
  const voice = new FakeVoice()
  const reader = new LineReader(voice)
  reader.load(d)
  return { voice, reader }
}

test('lines come in reading order, without empty ones, with unclear lines marked', () => {
  const lines = readingOrder(doc)
  assert.deepEqual(lines.map((l) => l.id), ['b1', 'b2', 'b3'])
  assert.deepEqual(lines.map((l) => l.unclear), [false, true, false])
  assert.deepEqual(readingOrder(null), [])
})

test('loading does not speak; play reads every line on its own and then says the end', () => {
  const { voice, reader } = setup()
  assert.equal(reader.state.status, 'idle')
  assert.deepEqual(voice.said, [])
  reader.play()
  assert.equal(reader.state.status, 'playing')
  voice.end()
  voice.end()
  assert.equal(reader.state.index, 2)
  voice.end()
  assert.equal(reader.state.status, 'finished')
  assert.deepEqual(voice.said, [
    'Asunto: Renovación de su póliza',
    'No se lee bien: Vence el 31 de diciembre de 2026.',
    'La prima anual será de 284,60 euros.',
    'Fin del documento.',
  ])
})

test('pause stops at the same line and play resumes it from its start', () => {
  const { voice, reader } = setup()
  reader.play()
  voice.end()
  reader.pause()
  assert.equal(reader.state.status, 'paused')
  assert.equal(reader.state.index, 1)
  const before = voice.said.length
  voice.end() // a late end of the cancelled line must not move the reader
  assert.equal(reader.state.index, 1)
  reader.toggle()
  assert.equal(reader.state.status, 'playing')
  assert.equal(voice.said.length, before + 1)
  assert.match(voice.said.at(-1)!, /Vence el 31/)
})

test('previous and next read that line and go on from there; the edges are safe', () => {
  const { voice, reader } = setup()
  reader.previous() // at the first line: reads it again
  assert.equal(reader.state.index, 0)
  reader.next()
  reader.next()
  assert.equal(reader.state.index, 2)
  reader.next() // past the last line: the document ends
  assert.equal(reader.state.status, 'finished')
  assert.equal(voice.said.at(-1), 'Fin del documento.')
  reader.previous() // after the end: the last line
  assert.equal(reader.state.index, 2)
  assert.equal(reader.state.status, 'playing')
  voice.end()
  assert.equal(reader.state.status, 'finished')
  reader.play() // after the end, play starts over
  assert.equal(reader.state.index, 0)
})

test('repeat says the current line again', () => {
  const { voice, reader } = setup()
  reader.play()
  reader.repeat()
  assert.deepEqual(voice.said, ['Asunto: Renovación de su póliza', 'Asunto: Renovación de su póliza'])
  assert.equal(reader.state.status, 'playing')
})

test('another voice cutting in pauses the reader on its line', () => {
  const { voice, reader } = setup()
  reader.play()
  voice.end()
  voice.interrupt()
  assert.equal(reader.state.status, 'paused')
  assert.equal(reader.state.index, 1)
  voice.end() // nothing pending: no change
  assert.equal(reader.state.index, 1)
})

test('goTo jumps by index or block id', () => {
  const { voice, reader } = setup()
  reader.goTo('b3')
  assert.equal(reader.state.index, 2)
  reader.goTo(0)
  assert.equal(reader.state.index, 0)
  reader.goTo('missing')
  assert.equal(reader.state.index, 0)
  assert.equal(voice.said.length, 2)
})

test('a new document stops reading and starts again at the top', () => {
  const { voice, reader } = setup()
  reader.play()
  voice.end()
  reader.load({ ...doc, blocks: [block('n1', 'Otro documento', 0.1)] })
  assert.equal(reader.state.status, 'idle')
  assert.equal(reader.state.index, 0)
  assert.equal(reader.state.lines.length, 1)
  voice.end()
  assert.equal(reader.state.status, 'idle')
})

test('without lines nothing happens', () => {
  const { voice, reader } = setup(null)
  reader.play()
  reader.next()
  reader.previous()
  reader.repeat()
  assert.deepEqual(voice.said, [])
  assert.equal(reader.state.status, 'idle')
})

test('listeners see every change', () => {
  const { voice, reader } = setup()
  const seen: string[] = []
  const off = reader.onChange((s) => seen.push(`${s.status}:${s.index}`))
  reader.play()
  voice.end()
  reader.pause()
  off()
  reader.play()
  assert.deepEqual(seen, ['playing:0', 'playing:1', 'paused:1'])
})

test('keys: arrows, letters and the numeric keypad', () => {
  assert.equal(keyAction('Space'), 'toggle')
  assert.equal(keyAction('Numpad5'), 'toggle')
  assert.equal(keyAction('ArrowLeft'), 'previous')
  assert.equal(keyAction('Numpad4'), 'previous')
  assert.equal(keyAction('ArrowRight'), 'next')
  assert.equal(keyAction('Numpad6'), 'next')
  assert.equal(keyAction('KeyR'), 'repeat')
  assert.equal(keyAction('Numpad8'), 'repeat')
  assert.equal(keyAction('KeyE'), null)
  assert.equal(keyAction('KeyA'), null)
})

test('language: phrases and speech tags follow the document', () => {
  const line = { id: 'x', text: 'Total a pagar', unclear: true }
  assert.equal(spokenText(line, 'ca-ES'), 'No es llegeix bé: Total a pagar')
  assert.equal(spokenText({ ...line, unclear: false }, 'ca-ES'), 'Total a pagar')
  assert.equal(spokenText(line, 'en-GB'), 'Unclear: Total a pagar')
  assert.equal(speechLang('ca'), 'ca-ES')
  assert.equal(speechLang(undefined), 'es-ES')
  assert.equal(speechLang('fr-FR'), 'fr-FR')
})
