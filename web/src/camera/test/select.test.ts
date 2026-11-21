import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logitechScore, pickCamera, type CameraInfo } from '../select.ts'

const cam = (deviceId: string, label: string, kind = 'videoinput'): CameraInfo => ({ deviceId, label, kind })

test('prefers the MX Brio over other Logitech cameras and the built-in one', () => {
  const devices = [cam('a', 'ACER HD User Facing'), cam('b', 'Logitech HD Pro Webcam C920 (046d:082d)'), cam('c', 'MX Brio (046d:0944)')]
  assert.equal(pickCamera(devices)?.deviceId, 'c')
  assert.equal(pickCamera(devices.slice(0, 2))?.deviceId, 'b')
})

test('without a Logitech camera, returns null (the caller opens the default one)', () => {
  assert.equal(pickCamera([cam('a', 'ACER HD User Facing'), cam('b', 'Integrated Camera')]), null)
  assert.equal(pickCamera([]), null)
})

test('ignores virtual cameras with the Logitech name and devices that are not cameras', () => {
  assert.equal(logitechScore('Logi Capture'), 0)
  assert.equal(logitechScore('Logitech Virtual Camera'), 0)
  assert.equal(pickCamera([cam('m', 'Logitech Brio microphone', 'audioinput'), cam('v', 'Logi Capture')]), null)
})

test('labels are empty before permission: nothing is chosen', () => {
  assert.equal(pickCamera([cam('a', ''), cam('b', '')]), null)
})

test('an explicit preference wins over the Logitech one', () => {
  const devices = [cam('a', 'ACER HD User Facing'), cam('c', 'MX Brio')]
  assert.equal(pickCamera(devices, /acer/i)?.deviceId, 'a')
  assert.equal(pickCamera(devices, /nothing/i), null)
})
