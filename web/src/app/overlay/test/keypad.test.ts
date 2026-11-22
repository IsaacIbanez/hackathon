import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyAction } from '../../../document/reader.ts'
import { keypadCommand } from '../keypad.ts'
import { MODES } from '../modes.ts'

test('keypad: option keys open the option and "menu" goes back', () => {
  for (const m of MODES) assert.deepEqual(keypadCommand(m.id), { view: m.id })
  assert.deepEqual(keypadCommand('menu'), { view: 'menu' })
})

test('keypad: reading keys press the key the guided reader already understands', () => {
  const want = { play: 'toggle', previous: 'previous', next: 'next', repeat: 'repeat' } as const
  for (const [action, readerAction] of Object.entries(want)) {
    const cmd = keypadCommand(action)
    assert.ok(cmd && 'key' in cmd, action)
    assert.equal(keyAction(cmd.key.code), readerAction, action)
  }
})

test('keypad: toggle (done by Go) and unknown actions do nothing here', () => {
  for (const a of ['toggle', 'volume-up', '', 42, null, undefined]) assert.equal(keypadCommand(a), null)
})

test('keypad: keys 2 and 3 start and stop recording a voice command', () => {
  assert.deepEqual(keypadCommand('record-start'), { voice: 'start' })
  assert.deepEqual(keypadCommand('record-stop'), { voice: 'stop' })
})
