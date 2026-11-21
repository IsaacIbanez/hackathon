import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ClientMessage } from '../../api/index.ts'
import { GestureBridge, type VoiceControls } from '../bridge.ts'

function setup(lang = 'es-ES') {
  const sent: ClientMessage[] = []
  const calls: string[] = []
  const voice: VoiceControls = {
    pause: () => calls.push('pause'),
    repeat: () => calls.push('repeat'),
    setVolume: (v) => calls.push(`volume:${v}`),
  }
  let now = 0
  const bridge = new GestureBridge((m) => sent.push(m), voice, {
    lang,
    now: () => now,
    onStartVolume: () => calls.push('startVolume'),
    onDictate: () => calls.push('dictate'),
  })
  return { bridge, sent, calls, advance: (ms: number) => (now += ms) }
}

test('pointing sends throttled pointer messages with document coordinates only', () => {
  const { bridge, sent, advance } = setup()
  bridge.handle({ type: 'pointer', image: { x: 0, y: 0 }, document: { x: 0.3, y: 0.27 }, t: 0 })
  bridge.handle({ type: 'pointer', image: { x: 0, y: 0 }, document: { x: 0.5, y: 0.5 }, t: 0 }) // too soon
  advance(250)
  bridge.handle({ type: 'pointer', image: { x: 0, y: 0 }, document: { x: 0.305, y: 0.27 }, t: 0 }) // barely moved
  bridge.handle({ type: 'pointer', image: { x: 0, y: 0 }, document: { x: 0.5, y: 0.5 }, t: 0 })
  bridge.handle({ type: 'pointer', image: { x: 0, y: 0 }, document: null, t: 0 }) // outside the document

  assert.equal(sent.length, 2)
  assert.equal(sent[0].type, 'pointer')
  assert.deepEqual(sent[0].payload, { x: 0.3, y: 0.27 })
  assert.deepEqual(sent[1].payload, { x: 0.5, y: 0.5 })
})

test('select (explain here) sends the pointer and then a final utterance', () => {
  const { bridge, sent } = setup()
  const action = bridge.handle({ type: 'select', image: { x: 0, y: 0 }, document: { x: 0.3, y: 0.27 }, t: 0 })
  assert.equal(action, 'explain_here')
  assert.deepEqual(sent.map((m) => m.type), ['pointer', 'utterance'])
  const u = sent[1]
  assert.ok(u.type === 'utterance' && u.payload.isFinal && u.payload.text.startsWith('¿Qué pone aquí'))
})

test('thumbs up asks to read; requests follow the language', () => {
  const { bridge, sent } = setup('en-US')
  assert.equal(bridge.handle({ type: 'gesture', gesture: 'thumbs_up', t: 0 }), 'read')
  const u = sent[0]
  assert.ok(u.type === 'utterance' && u.payload.text === 'Read me the document.' && u.payload.lang === 'en-US')
})

test('palm, menu and pinch control the voice locally without messages', () => {
  const { bridge, sent, calls } = setup()
  bridge.handle({ type: 'gesture', gesture: 'palm', t: 0 })
  bridge.handle({ type: 'menu', phase: 'choose', sector: 'down', center: { x: 0.5, y: 0.5 }, hand: null, t: 0 })
  bridge.handle({ type: 'menu', phase: 'choose', sector: 'up', center: { x: 0.5, y: 0.5 }, hand: null, t: 0 })
  bridge.handle({ type: 'level', phase: 'move', value: 0.4, t: 0 })
  bridge.handle({ type: 'menu', phase: 'choose', sector: 'right', center: { x: 0.5, y: 0.5 }, hand: null, t: 0 })
  assert.deepEqual(calls, ['pause', 'repeat', 'startVolume', 'volume:0.4', 'dictate'])
  assert.equal(sent.length, 0)
})

test('ask for help from the menu becomes an utterance', () => {
  const { bridge, sent } = setup()
  bridge.handle({ type: 'menu', phase: 'choose', sector: 'left', center: { x: 0.5, y: 0.5 }, hand: null, t: 0 })
  const u = sent[0]
  assert.ok(u.type === 'utterance' && u.payload.text.includes('ayuda'))
})

test('events without an action do nothing', () => {
  const { bridge, sent, calls } = setup()
  assert.equal(bridge.handle({ type: 'hand', present: true, t: 0 }), null)
  assert.equal(bridge.handle({ type: 'gesture', gesture: 'victory', t: 0 }), null)
  assert.equal(sent.length + calls.length, 0)
})
