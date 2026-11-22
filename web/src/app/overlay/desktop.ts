// The Go side of the overlay (bindings in app_overlay.go), reached through window.go so this file
// does not depend on the generated wailsjs/ (and the overlay still loads in a plain browser, where
// every call fails with a clear message).
import type { DocumentPayload } from '../../api'
import type { PdfPageData, PdfSource } from '../../document/index.ts'

export interface OverlayInfo {
  hotkey: string
  hotkeyOk: boolean
  /** MX Keypad shortcuts (docs/KEYPAD.md) and whether each could be registered. */
  keypad?: { shortcut: string; action: string; ok: boolean }[] | null
  /** The MX Keypad is plugged in and read directly over USB (no Logi Options+ needed). */
  keypadConnected?: boolean
  /** What a tool needs and is missing on this computer, each with what to do (app_checks.go). */
  problems?: string[]
}

/** What option 3 opened (app_pdf.go): a PDF for the viewer, or the lines of another file. */
export type OpenedFile =
  | { cancelled: true; name?: string }
  | { cancelled: false; name: string; kind: 'pdf'; pdf: PdfSource }
  | { cancelled: false; name: string; kind: 'lines'; lines: FileDocument }

/** Option 4's answer (app_summary.go, backend/summary). */
export interface SummaryResult {
  summary: string
  lang: string
  chars: number
  truncated: boolean
  source: 'cloud' | 'local' | 'short'
  note?: string
  model?: string
  costUsd: number
  latencyMs: number
  cached: boolean
  copied: boolean
}

/** A camera photo read by the reading service (app_scanpdf.go). No scanId: there is no PDF to show. */
export interface ScannedPaper {
  scanId: string
  document: DocumentPayload
}

/** The PDFs of a scan: the searchable one (always) and the digital one (only on request, paid model). */
export type ScanPdfKind = 'searchable' | 'digital'

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
  ScanPaper(photo: string): Promise<string>
  ScanPDF(scanId: string, kind: ScanPdfKind): Promise<string>
  MakeDigitalPDF(scanId: string): Promise<string>
  OpenAndReadFile(): Promise<string>
  /** Gesture Control's API in-process: {"status", "body"} as JSON text. */
  GestureCall(method: string, path: string, body: string): Promise<string>
  SetGesturesActive(on: boolean): Promise<void>
  SetCompact(on: boolean): Promise<void>
  SetScreenOverlay(on: boolean): Promise<void>
  /** The see-through layer over the whole screen (true) or a normal window (false). */
  SetLayer(on: boolean): Promise<void>
  MoveBubble(): Promise<void>
  /** The text selected in the program in front (errors start with "no_selection:"). */
  ReadSelection(): Promise<string>
  /** Deletes the text selected in the program in front (only if there is a selection). */
  DeleteSelection(): Promise<number>
  /** Whether the default microphone is muted in Windows. */
  MicMuted(): Promise<boolean>
  /** Writes a line from the page in lauzhack.log. */
  UILog(msg: string): Promise<void>
  /** Raises (true) or lowers the system volume by 10 %. */
  ChangeVolume(up: boolean): Promise<void>
  OpenFileForReading(): Promise<string>
  PDFPage(id: string, page: number): Promise<string>
  SummarizeSelection(): Promise<string>
  CloseSummary(): Promise<void>
  TriggerSummary(): Promise<void>
  /** The app's WebSocket URL (app.go); its http origin serves POST /transcribe. */
  WsURL(): Promise<string>
}

interface GoApp
  extends Omit<
    GoBindings,
    | 'OverlayInfo'
    | 'ReadPhoto'
    | 'ScanPaper'
    | 'ScanPDF'
    | 'MakeDigitalPDF'
    | 'OpenAndReadFile'
    | 'OpenFileForReading'
    | 'PDFPage'
    | 'SummarizeSelection'
  > {
  OpenFileForReading(): Promise<OpenedFile>
  PDFPage(id: string, page: number): Promise<PdfPageData>
  OverlayInfo(): Promise<OverlayInfo>
  SummarizeSelection(): Promise<SummaryResult>
  ReadPhoto(photo: string): Promise<DocumentPayload>
  ScanPaper(photo: string): Promise<ScannedPaper>
  ScanPDF(scanId: string, kind: ScanPdfKind): Promise<PdfSource>
  MakeDigitalPDF(scanId: string): Promise<PdfSource>
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
    ScanPaper: async (photo) => JSON.parse(await app.ScanPaper(photo)) as ScannedPaper,
    ScanPDF: async (scanId, kind) => JSON.parse(await app.ScanPDF(scanId, kind)) as PdfSource,
    MakeDigitalPDF: async (scanId) => JSON.parse(await app.MakeDigitalPDF(scanId)) as PdfSource,
    OpenAndReadFile: async () => JSON.parse(await app.OpenAndReadFile()) as FileDocument,
    OpenFileForReading: async () => JSON.parse(await app.OpenFileForReading()) as OpenedFile,
    PDFPage: async (id, page) => JSON.parse(await app.PDFPage(id, page)) as PdfPageData,
    SummarizeSelection: async () => JSON.parse(await app.SummarizeSelection()) as SummaryResult,
  }
}

/** Subscribes to an event from Go (overlay:shown, overlay:hidden, overlay:keypad); a no-op outside the app. */
export function onDesktopEvent(name: string, cb: (...data: unknown[]) => void): () => void {
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
