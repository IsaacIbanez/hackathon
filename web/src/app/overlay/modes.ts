// The overlay's options. To add one (docs/OVERLAY.md, «Añadir una opción»): add an entry here and a
// component in Overlay.tsx's MODE_VIEWS. `ready: false` shows it as "coming soon" without breaking.

export type ModeId = 'gestures' | 'documents' | 'read-file'

export interface Mode {
  id: ModeId
  /** Digit that opens it (also on the numeric keypad, so the MX Keypad can send it). */
  key: string
  title: string
  description: string
  /** Owner (person and role), for whoever maintains it. */
  owner: string
  ready: boolean
}

export const MODES: Mode[] = [
  {
    id: 'gestures',
    key: '1',
    title: 'Hand gestures',
    description: 'Control the computer with your hands through the camera (Gesture Control).',
    owner: 'Nil (C)',
    ready: true,
  },
  {
    id: 'documents',
    key: '2',
    title: 'Read a paper document',
    description: 'Hold the paper in front of the camera: it is photographed on its own and read aloud.',
    owner: 'Pau (B1) and Didac (B2)',
    ready: true,
  },
  {
    id: 'read-file',
    key: '3',
    title: 'Read a file aloud',
    description: 'Choose a PDF, text file or image from the computer and listen to it line by line.',
    owner: 'Didac (B2)',
    ready: true,
  },
]

/** The mode for a KeyboardEvent.code (Digit1 / Numpad1 …), or undefined. */
export function modeForKey(code: string): Mode | undefined {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code)
  return m ? MODES.find((mode) => mode.key === m[1]) : undefined
}
