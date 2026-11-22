// Buttons and panels of the overlay, as lists: to add one, add an entry (docs/OVERLAY.md,
// «Añadir un botón o un panel»). Overlay.tsx draws them; nothing else needs changing.
import type { ComponentType } from 'react'
import { GestureTipsPanel } from './GestureTipsPanel.tsx'
import { desktop, inDesktopApp } from './desktop.ts'
import type { ModeId } from './modes.ts'

export type OverlayView = ModeId | 'menu' | 'developer'

/** What a button can do in the overlay. */
export interface OverlayContext {
  view: OverlayView
  setView(view: OverlayView): void
}

/** A button of the toolbar (top right, on every screen): usable with the mouse only. */
export interface ToolbarButton {
  id: string
  label: string
  /** Key that does the same, shown in the label and the tooltip (optional). */
  key?: string
  /** Shown only when it returns true (default: always). */
  show?: (ctx: OverlayContext) => boolean
  run: (ctx: OverlayContext) => void
}

export const TOOLBAR: ToolbarButton[] = [
  {
    id: 'developer',
    label: '🛠 Developer screen',
    key: 'D',
    show: (ctx) => ctx.view === 'menu',
    run: (ctx) => ctx.setView('developer'),
  },
  {
    id: 'hide',
    label: '↘ Hide',
    key: 'Esc',
    // With the gestures running, Go shrinks the window to the camera bubble instead of hiding it.
    show: () => inDesktopApp(),
    run: () => void desktop().HideOverlay(),
  },
  {
    id: 'quit',
    label: '✕ Quit',
    key: 'Q',
    show: () => inDesktopApp(),
    run: () => void desktop().Quit(),
  },
]

/** A panel shown below the options in the menu. */
export interface MenuPanel {
  id: string
  title: string
  Component: ComponentType
}

export const MENU_PANELS: MenuPanel[] = [
  // Example panel (N1): how the hand works with the camera in the top-left corner.
  { id: 'gesture-tips', title: 'Hand gestures, anywhere in the overlay', Component: GestureTipsPanel },
]
