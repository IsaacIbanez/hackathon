// The Go side of the overlay (bindings in app_overlay.go), reached through window.go so this file
// does not depend on the generated wailsjs/ (and the overlay still loads in a plain browser, where
// every call fails with a clear message).
import type { DocumentPayload } from '../../api'

export interface OverlayInfo {
  hotkey: string
  hotkeyOk: boolean
}

export interface FileDocument {
  name: string
  cancelled: boolean
  document: DocumentPayload
}

/** The bindings as Go exposes them (structures travel as JSON text, see app_overlay.go). */
interface GoBindings {
  OverlayInfo(): Promise<string>
  HideOverlay(): Promise<void>
  Quit(): Promise<void>
  EnsureReadingService(): Promise<string>
  ReadPhoto(photo: string): Promise<string>
  OpenAndReadFile(): Promise<string>
  /** Gesture Control's API in-process: {"status", "body"} as JSON text. */
  GestureCall(method: string, path: string, body: string): Promise<string>
  SetGesturesActive(on: boolean): Promise<void>
  SetCompact(on: boolean): Promise<void>
  SetScreenOverlay(on: boolean): Promise<void>
  MoveBubble(): Promise<void>
}

interface GoApp extends Omit<GoBindings, 'OverlayInfo' | 'ReadPhoto' | 'OpenAndReadFile'> {
  OverlayInfo(): Promise<OverlayInfo>
  ReadPhoto(photo: string): Promise<DocumentPayload>
  OpenAndReadFile(): Promise<FileDocument>
}

type WailsWindow = Window & {
  go?: { main?: { App?: GoBindings } }
  runtime?: { EventsOn?: (name: string, cb: (...args: unknown[]) => void) => () => void }
}

export const inDesktopApp = () => typeof (window as WailsWindow).go?.main?.App === 'object'

/** The Go bindings (JSON answers already parsed); throws outside the desktop app. */
export function desktop(): GoApp {
  const app = (window as WailsWindow).go?.main?.App
  if (!app) throw new Error('Only available in the desktop app (task overlay → build/bin/lauzhack.exe).')
  return {
    ...app,
    OverlayInfo: async () => JSON.parse(await app.OverlayInfo()) as OverlayInfo,
    ReadPhoto: async (photo) => JSON.parse(await app.ReadPhoto(photo)) as DocumentPayload,
    OpenAndReadFile: async () => JSON.parse(await app.OpenAndReadFile()) as FileDocument,
  }
}

/** Subscribes to an event from Go (overlay:shown, overlay:hidden); a no-op outside the app. */
export function onDesktopEvent(name: string, cb: () => void): () => void {
  const on = (window as WailsWindow).runtime?.EventsOn
  return on ? on(name, cb) : () => {}
}

/** Go errors arrive as strings or Error objects. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return String(e)
}

/** A Blob as a data: URL (how a photo crosses the binding). */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
