import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import App from '../App.tsx'
import { DocumentsMode } from './DocumentsMode.tsx'
import { GesturesMode } from './GesturesMode.tsx'
import { ReadFileMode } from './ReadFileMode.tsx'
import { SummarizeMode } from './SummarizeMode.tsx'
import { desktop, inDesktopApp, onDesktopEvent, type OverlayInfo } from './desktop.ts'
import { MENU_PANELS, TOOLBAR, type OverlayContext, type OverlayView } from './extensions.ts'
import { GestureSlot } from './GestureSlot.tsx'
import { pauseCamera, resumeCamera } from './gestureHost.ts'
import { keypadCommand, pressKey, type KeypadAction } from './keypad.ts'
import { MODES, modeForKey, type ModeId } from './modes.ts'
import { useVoiceCommand, VoiceBanner } from './useVoiceCommand.tsx'

// The overlay (docs/OVERLAY.md): a menu with the team's features. Ctrl+Alt+Space (or an MX Keypad
// key mapped to it) shows and hides the window from any program. Keys: 1–4 (or Num 1–4) choose,
// Esc goes back to the menu and, from the menu, hides the overlay. D opens the old developer screen,
// Q quits the app (and the helper programs it started).

type View = OverlayView

/** Screens that open the camera themselves: the gestures give it back meanwhile (one camera). */
const NEEDS_CAMERA: View[] = ['documents', 'developer']

/** Remembered between runs: whether the person hid the camera panel. */
function cameraPanelHidden(): boolean {
  try {
    return localStorage.getItem('overlay.cameraPanel') === 'hidden'
  } catch {
    return false
  }
}

export function Overlay() {
  const [view, setView] = useState<View>('menu')
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  // Each summary request mounts option 4 afresh (it summarizes once, when it opens).
  const [summaryRun, setSummaryRun] = useState(0)
  const [cameraHidden, setCameraHidden] = useState(cameraPanelHidden)

  // One camera: option 2 and the developer screen open it themselves.
  useEffect(() => {
    if (!NEEDS_CAMERA.includes(view)) return
    pauseCamera()
    return () => resumeCamera()
  }, [view])

  const toggleCameraPanel = () =>
    setCameraHidden((hidden) => {
      try {
        localStorage.setItem('overlay.cameraPanel', hidden ? 'shown' : 'hidden')
      } catch {
        // Without storage it is only remembered while the app runs.
      }
      return !hidden
    })

  useEffect(() => {
    if (inDesktopApp()) desktop().OverlayInfo().then(setInfo).catch(() => {})
  }, [])

  // Back on screen: focus the window content so the keys work right away.
  useEffect(() => onDesktopEvent('overlay:shown', () => window.focus()), [])

  // The keypad can be plugged in or out while the app runs.
  useEffect(
    () => onDesktopEvent('overlay:keypad-connected', (on) => setInfo((i) => (i ? { ...i, keypadConnected: on === true } : i))),
    [],
  )

  // One way to run an action, for the keypad and for voice commands (docs/KEYPAD.md).
  const voice = useVoiceCommand((action) => runAction.current(action))
  const runAction = useRef<(action: KeypadAction) => void>(() => {})
  const run = useCallback(
    (action: KeypadAction) => {
      if (action === 'toggle') {
        // From a key Go toggles the window itself; from the voice it means "hide".
        if (inDesktopApp()) void desktop().HideOverlay()
        return
      }
      const cmd = keypadCommand(action)
      if (!cmd) return
      if ('voice' in cmd) {
        void (cmd.voice === 'start' ? voice.start() : voice.stop())
      } else if ('view' in cmd) {
        if (cmd.view === 'summarize') setSummaryRun((n) => n + 1) // summarizes again each time
        setView(cmd.view)
      } else pressKey(cmd.key)
    },
    [voice],
  )
  useEffect(() => {
    runAction.current = run
  })

  // MX Keypad (docs/KEYPAD.md): Go shows the window and sends the action, even from another program.
  useEffect(
    () =>
      onDesktopEvent('overlay:keypad', (action) => {
        if (typeof action === 'string' && action !== 'toggle') runAction.current(action as KeypadAction)
      }),
    [],
  )

  // Option 4 asked from outside the menu (TriggerSummary in Go; prepared for Gesture Control's
  // hand cursor, see docs/OVERLAY.md).
  useEffect(
    () =>
      onDesktopEvent('overlay:summarize', () => {
        setSummaryRun((n) => n + 1)
        setView('summarize')
      }),
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.code === 'Escape') {
        e.preventDefault()
        if (view !== 'menu') setView('menu')
        else if (inDesktopApp()) void desktop().HideOverlay()
        return
      }
      if (view !== 'menu') return
      const mode = modeForKey(e.code)
      if (mode?.ready) {
        e.preventDefault()
        if (mode.id === 'summarize') setSummaryRun((n) => n + 1)
        setView(mode.id)
      } else if (e.code === 'KeyD') {
        setView('developer')
      } else if (e.code === 'KeyQ' && inDesktopApp()) {
        void desktop().Quit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const ctx: OverlayContext = { view, setView }
  if (view === 'developer') {
    return (
      <div>
        <Toolbar ctx={ctx} />
        <BackBar onBack={() => setView('menu')} title="Developer screen" />
        <App />
      </div>
    )
  }

  const current = MODES.find((m) => m.id === view)
  const views: Record<ModeId, ReactNode> = {
    gestures: <GesturesMode />,
    documents: <DocumentsMode />,
    'read-file': <ReadFileMode onCancel={() => setView('menu')} />,
    summarize: <SummarizeMode key={summaryRun} onClose={() => setView('menu')} />,
  }

  // Option 4 lives in a small bubble next to the pointer: no menu bar.
  if (view === 'summarize') {
    return (
      <main className="h-screen bg-slate-900 p-4 text-slate-50">
        <VoiceBanner status={voice.status} />
        {views.summarize}
      </main>
    )
  }

  // The camera panel (top left) shows on every screen but option 1, which shows the whole page.
  const panel = inDesktopApp() && view !== 'gestures'
  return (
    <main
      className="min-h-screen bg-slate-900 p-6 pt-16 text-slate-50"
      style={panel && !cameraHidden ? { paddingLeft: CAMERA_PANEL_WIDTH + 36 } : undefined}
    >
      <Toolbar ctx={ctx} />
      {panel && <CameraPanel hidden={cameraHidden} onToggle={toggleCameraPanel} />}
      <VoiceBanner status={voice.status} />
      {current ? (
        <>
          <BackBar onBack={() => setView('menu')} title={`${current.key}. ${current.title}`} />
          {views[current.id]}
        </>
      ) : (
        <Menu info={info} onChoose={setView} />
      )}
    </main>
  )
}

function Menu({ info, onChoose }: { info: OverlayInfo | null; onChoose: (id: ModeId) => void }) {
  return (
    <section aria-label="Options" className="space-y-4">
      <h1 className="text-3xl font-bold">What do you want to do?</h1>
      <ol className="grid gap-4 md:grid-cols-2">
        {MODES.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={!m.ready}
              onClick={() => onChoose(m.id)}
              aria-keyshortcuts={m.key}
              className="h-full w-full rounded-2xl border-2 border-yellow-300 p-5 text-left disabled:opacity-40"
            >
              <span className="block text-5xl font-bold text-yellow-300">{m.key}</span>
              <span className="mt-2 block text-2xl font-bold">{m.title}</span>
              <span className="mt-2 block text-lg text-slate-300">{m.ready ? m.description : 'Coming soon.'}</span>
              <span className="mt-3 block text-sm text-slate-500">{m.owner}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-lg text-slate-400">
        Press 1–4 (also on the numeric keypad). Esc hides this window
        {info?.hotkeyOk ? `; ${info.hotkey} brings it back from any program.` : '.'}
        {info && !info.hotkeyOk && ` The shortcut ${info.hotkey} could not be registered: the window stays available.`}
      </p>
      <KeypadStatus info={info} />
      {MENU_PANELS.map(({ id, title, Component }) => (
        <section key={id} aria-label={title} className="rounded-2xl border border-slate-700 p-4">
          <h2 className="mb-2 text-xl font-bold">{title}</h2>
          <Component />
        </section>
      ))}
    </section>
  )
}

const CAMERA_PANEL_WIDTH = 288

/**
 * The camera in the top-left corner (N1): the hand's points live, on every screen. The gesture
 * engine behind it is the one of option 1 (gestureHost.ts). Hiding it only hides the view.
 */
function CameraPanel({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <div className="fixed left-3 top-3 z-30" style={{ width: hidden ? undefined : CAMERA_PANEL_WIDTH }}>
      <GestureSlot variant="panel" className={hidden ? 'hidden' : 'overflow-hidden rounded-xl ring-1 ring-slate-600'} />
      <button
        type="button"
        onClick={onToggle}
        className="mt-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-0.5 text-sm text-slate-200"
      >
        {hidden ? '📷 Show camera' : 'Hide camera'}
      </button>
    </div>
  )
}

/** Buttons for what the keys do (extensions.ts), top right: the overlay works with the mouse only. */
function Toolbar({ ctx }: { ctx: OverlayContext }) {
  const buttons = TOOLBAR.filter((b) => b.show?.(ctx) ?? true)
  if (buttons.length === 0) return null
  return (
    <nav aria-label="Window" className="fixed right-3 top-3 z-30 flex gap-2">
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => b.run(ctx)}
          aria-keyshortcuts={b.key}
          title={b.key ? `${b.label} (${b.key})` : b.label}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-base text-slate-100"
        >
          {b.label}
          {b.key && <span className="ml-1 text-sm text-slate-400">({b.key})</span>}
        </button>
      ))}
    </nav>
  )
}

/** MX Keypad (docs/KEYPAD.md): whether it is plugged in, and any fallback shortcut that failed. */
function KeypadStatus({ info }: { info: OverlayInfo | null }) {
  const failed = (info?.keypad ?? []).filter((k) => !k.ok)
  return (
    <>
      {info?.keypadConnected && (
        <p role="status" className="text-lg text-emerald-300">
          MX Keypad connected: keys 1–9 work from any program.
        </p>
      )}
      {failed.length > 0 && (
        <p role="status" className="text-lg text-amber-300">
          Keypad shortcuts {failed.map((k) => k.shortcut).join(', ')} could not be registered (another program uses
          them).
        </p>
      )}
    </>
  )
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-4">
      <button type="button" onClick={onBack} className="rounded-lg border border-slate-500 px-3 py-1 text-lg">
        ← Menu (Esc)
      </button>
      <h1 className="text-3xl font-bold">{title}</h1>
    </div>
  )
}
