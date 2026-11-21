import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiBaseFromWs, encodeWav } from '../transcribe.ts'

test('encodeWav writes a valid 16-bit mono PCM header and clamps samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
  const v = new DataView(wav.buffer)
  const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n))
  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 4), 'WAVE')
  assert.equal(v.getUint16(22, true), 1) // mono
  assert.equal(v.getUint32(24, true), 16000)
  assert.equal(v.getUint32(40, true), 8) // 4 samples × 2 bytes
  assert.equal(wav.length, 44 + 8)
  assert.equal(v.getInt16(46, true), 32767) // 1
  assert.equal(v.getInt16(48, true), -32768) // -1
  assert.equal(v.getInt16(50, true), 32767) // 2 is clamped to 1
})

test('apiBaseFromWs turns the WebSocket URL into the HTTP API base', () => {
  assert.equal(apiBaseFromWs('ws://127.0.0.1:8765/ws'), 'http://127.0.0.1:8765')
  assert.equal(apiBaseFromWs('wss://example.org/ws'), 'https://example.org')
})
