// MX Keypad (docs/KEYPAD.md, brief docs/briefs/N2.md). Each keypad key sends a system-wide
// Ctrl+Alt+Shift shortcut that Go registers (backend/overlay/keypad.go). Go shows the overlay and
// emits "overlay:keypad" with the action; this file turns the action into what the overlay already
// understands: open an option, go back to the menu, or press the key the guided reader listens to.
// That way the reader (web/src/document) and the other options need no changes.

import type { ModeId } from './modes.ts'

export type KeypadAction =
  | 'toggle'
  | 'gestures'
  | 'documents'
  | 'read-file'
  | 'menu'
  | 'play'
  | 'previous'
  | 'next'
  | 'repeat'

/** What the overlay does for an action: change the view, or press a key in the window. */
export type KeypadCommand = { view: ModeId | 'menu' } | { key: { code: string; key: string } }

const READER_KEYS: Partial<Record<KeypadAction, { code: string; key: string }>> = {
  play: { code: 'Space', key: ' ' },
  previous: { code: 'ArrowLeft', key: 'ArrowLeft' },
  next: { code: 'ArrowRight', key: 'ArrowRight' },
  repeat: { code: 'KeyR', key: 'r' },
}

/** The command for an action from Go, or null (unknown, or 'toggle', which Go handles itself). */
export function keypadCommand(action: unknown): KeypadCommand | null {
  switch (action) {
    case 'gestures':
    case 'documents':
    case 'read-file':
    case 'menu':
      return { view: action }
  }
  const key = typeof action === 'string' ? READER_KEYS[action as KeypadAction] : undefined
  return key ? { key } : null
}

/** Presses a key in the window, as if typed: the guided reader listens on window for keydown. */
export function pressKey(key: { code: string; key: string }, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true }))
}
