// The overlay's tools (docs/OVERLAY.md and the design, docs/DISENO.md). The hub in the middle is
// Gesture Control; the others sit on an arc above it. To add one: add an entry here (with its icon,
// colour and place on the arc) and its view in Overlay.tsx. `ready: false` shows it as "Coming soon".

import type { IconName } from './ui.tsx'

export type ModeId = 'gestures' | 'documents' | 'read-file' | 'summarize' | 'transcribe'

export interface Mode {
  id: ModeId
  /** Digit that opens it (also on the numeric keypad, so the MX Keypad can send it). */
  key: string
  /** Name on the hub and on the panel. */
  title: string
  /** What it does, in a few words, from the person's point of view. */
  description: string
  icon: IconName
  /** CSS colour of the tool (index.css). */
  accent: string
  /** 'hub' is the big circle in the middle; 'arc' tools go on the arc above it, left to right. */
  place: 'hub' | 'arc'
  /** Owner (person and role), for whoever maintains it. */
  owner: string
  ready: boolean
}

export const MODES: Mode[] = [
  {
    id: 'gestures',
    key: '1',
    title: 'Gesture Control',
    description: 'Use the computer with your hands, through the camera.',
    icon: 'hand',
    accent: 'var(--color-hand)',
    place: 'hub',
    owner: 'Nil (C)',
    ready: true,
  },
  {
    id: 'documents',
    key: '2',
    title: 'PDF Scanner',
    description: 'Hold a paper in front of the camera. It is photographed and read to you.',
    icon: 'scan',
    accent: 'var(--color-scan)',
    place: 'arc',
    owner: 'Pau (B1) and Didac (B2)',
    ready: true,
  },
  {
    id: 'read-file',
    key: '3',
    title: 'Read Text',
    description: 'Open a PDF, text file or image and listen to it, line by line.',
    icon: 'read',
    accent: 'var(--color-read)',
    place: 'arc',
    owner: 'Didac (B2)',
    ready: true,
  },
  {
    id: 'summarize',
    key: '4',
    title: 'AI Summary',
    description: 'Select text in any program, then press 4. You hear a short summary.',
    icon: 'ai',
    accent: 'var(--color-ai)',
    place: 'arc',
    owner: 'Didac (B2)',
    ready: true,
  },
  {
    id: 'transcribe',
    key: '5',
    title: 'Transcribe',
    description: 'Live captions of what people around you say.',
    icon: 'voice',
    accent: 'var(--color-voice)',
    place: 'arc',
    owner: 'Pau (B1)',
    ready: false,
  },
]

/** The mode for a KeyboardEvent.code (Digit1 / Numpad1 …), or undefined. */
export function modeForKey(code: string): Mode | undefined {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code)
  return m ? MODES.find((mode) => mode.key === m[1]) : undefined
}
