// Gesture Control for the whole overlay (N1, Nil): one camera and one gesture engine for the app.
// The camera page (web/src/input/desktop) is built once and moved where it is shown:
// - "panel": a small camera view in the top-left corner of every screen (only the hand's points);
// - "full": the whole Gesture Control page in option 1 (controls, guide, log).
// It talks to Go through the GestureCall binding. While it runs, hiding the overlay shrinks it to a
// camera bubble instead (a hidden page would pause the camera), and the gesture menu opened from
// the bubble spreads over the whole screen. Option 2 (reading a paper) borrows the camera: it is
// paused meanwhile (pauseCamera / resumeCamera).
import { bindingFetch, HelperClient } from '../../input/desktop/client.ts'
import { mountGestureControl, type GestureControlHandle } from '../../input/desktop/gestureControl.ts'
import { Speaker } from '../../input/voice/speaker.ts'
import { desktop, errorText, inDesktopApp, onDesktopEvent } from './desktop.ts'

export type GestureVariant = 'panel' | 'full'

let root: HTMLDivElement | null = null
let handle: GestureControlHandle | null = null
let compact = false
let tMoved = -Infinity
let paused = false

/** The page's root, built and started the first time (null outside the desktop app). */
export function gestureRoot(): HTMLDivElement | null {
  if (root) return root
  if (!inDesktopApp()) return null
  const app = desktop()
  root = document.createElement('div')
  const helper = new HelperClient('', bindingFetch((m, p, b) => app.GestureCall(m, p, b)))
  handle = mountGestureControl(root, helper, {
    unreachable: 'Gesture Control did not answer inside the app (see build/bin/lauzhack.log).',
    // The gesture menu and the volume/brightness control need room: from the bubble Go spreads the
    // window over the screen; in the small panel the camera view grows over the window.
    // The gesture menu and the volume/brightness control: Go spreads the window over the whole
    // screen, see-through, with the camera small in a corner (from the bubble or the normal window).
    onScreenOverlay: (need) => void app.SetScreenOverlay(need).catch(() => {}),
    // Cursor mode does not touch the window (fix R5, docs/VENTANA.md): with the overlay open the hand
    // cursor can press its buttons; hidden, the bubble stays. It used to shrink and reopen the overlay.
    // Three fingers: read aloud the text selected in the program in front.
    onReadSelection: () => void readSelection(),
    // While reading: swipe back (left) starts again, forward (right) ends it.
    onSwipe: (direction) => {
      if (!reading()) return false
      if (direction === 'left') {
        speaker.stop()
        if (lastText) speaker.speak({ text: lastText, lang: guessLang(lastText) })
      } else {
        speaker.stop()
        lastText = ''
      }
      return true
    },
    // "Close gestures": the gestures sleep (an open palm wakes them) and the overlay comes back, from
    // the bubble or over it; the camera keeps running.
    onCloseGestures: () => void app.SetCompact(false).catch(() => {}),
    // "Close app" in the gesture menu.
    onQuit: () => void app.Quit().catch(() => {}),
    // The bubble dodges the gesture cursor: clicks on it would go to this window, not to the
    // program below. It jumps to the other top corner when the cursor is on it.
    onPointer: (p) => {
      if (!compact || performance.now() - tMoved < 800 || !nearThisWindow(p)) return
      tMoved = performance.now()
      void app.MoveBubble().catch(() => {})
    },
  })
  void app.SetGesturesActive(true).catch(() => {})
  onDesktopEvent('overlay:compact', () => {
    compact = true
    handle?.setScreen(false)
    handle?.setCompact(true)
  })
  onDesktopEvent('overlay:screen', () => handle?.setScreen(true))
  onDesktopEvent('overlay:expanded', () => {
    compact = false
    handle?.setScreen(false)
    handle?.setCompact(false)
  })
  // A double click on the bubble brings the full window back.
  root.addEventListener('dblclick', () => {
    if (compact) void app.SetCompact(false)
  })
  return root
}

/**
 * Wakes the gestures after "Close gestures" in the menu (opening Gesture Control means the person
 * wants them), as an open palm would.
 */
export function turnGesturesOn(): void {
  handle?.wakeGestures()
}

/** Shows the page as the small top-left panel or as the full Gesture Control page. */
export function setGestureVariant(variant: GestureVariant): void {
  if (!root) return
  root.classList.toggle('gc-panel', variant === 'panel')
  root.classList.toggle('gc-full', variant === 'full')
  handle?.resume()
}

/** Option 2 needs the camera: give it back until resumeCamera. */
export function pauseCamera(): void {
  if (!handle || paused) return
  paused = true
  handle.setCamera(false)
  // While paused there is no camera to keep alive: hiding the overlay may hide it again.
  void desktop().SetGesturesActive(false).catch(() => {})
}

export function resumeCamera(): void {
  if (!handle || !paused) return
  paused = false
  handle.setCamera(true)
  void desktop().SetGesturesActive(true).catch(() => {})
}

/** Whether a screen point ([0, 1] over the screen) is on this window (or just at its edge). */
function nearThisWindow(p: { x: number; y: number }): boolean {
  const sw = window.screen.width || 1
  const sh = window.screen.height || 1
  const m = 0.02
  const left = window.screenX / sw - m
  const right = (window.screenX + window.outerWidth) / sw + m
  const top = window.screenY / sh - m
  const bottom = (window.screenY + window.outerHeight) / sh + m
  return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom
}

const speaker = new Speaker()
/** The selection being read (for "start again"). */
let lastText = ''

/** A reading of the selection is going on (speaking or paused). */
const reading = () => lastText !== '' && (speaker.isSpeaking || speaker.isPaused)

/** Copies the selected text of the program in front (Go) and reads it aloud. */
async function readSelection(): Promise<void> {
  // Three fingers again while reading: pause, and once more: go on.
  if (reading()) {
    if (speaker.isPaused) speaker.resume()
    else speaker.pause()
    return
  }
  try {
    const text = await desktop().ReadSelection()
    // WebView2 lists the voices only after a moment: without them the default (often English)
    // voice reads, whatever the language. Wait for them first.
    await voicesReady()
    lastText = text
    if (text) speaker.speak({ text, lang: guessLang(text) })
  } catch (e) {
    const msg = errorText(e)
    speaker.speak({
      text: msg.startsWith('no_selection:') ? 'Primero selecciona un texto.' : 'No he podido leer el texto seleccionado.',
      lang: 'es-ES',
    })
  }
}

/** Spanish unless the text looks clearly English (enough to pick the voice). */
export function guessLang(text: string): string {
  const words = text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? []
  const en = words.filter((w) => ['the', 'and', 'of', 'to', 'is', 'you', 'that', 'for'].includes(w)).length
  const es = words.filter((w) => ['el', 'la', 'de', 'que', 'y', 'los', 'en', 'por', 'es'].includes(w)).length
  return en > es ? 'en-US' : 'es-ES'
}

/** Resolves when the system voices are listed (at most ~1.5 s). */
function voicesReady(): Promise<void> {
  const synth = window.speechSynthesis
  if (!synth || synth.getVoices().length > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done)
      resolve()
    }
    synth.addEventListener('voiceschanged', done)
    setTimeout(done, 1500)
  })
}
