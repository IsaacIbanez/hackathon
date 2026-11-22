import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import App from '../App.tsx'
import { LiveCaptions } from '../../captions'
import { DocumentsMode } from './DocumentsMode.tsx'
import { GesturesMode } from './GesturesMode.tsx'
import { ReadFileMode } from './ReadFileMode.tsx'
import { SummarizeMode } from './SummarizeMode.tsx'
import { desktop, inDesktopApp, onDesktopEvent, type OverlayInfo } from './desktop.ts'
import { MENU_PANELS, TOOLBAR, type OverlayContext, type OverlayView } from './extensions.ts'
import { GestureSlot } from './GestureSlot.tsx'
import { pauseCamera, resumeCamera } from './gestureHost.ts'
import { keypadCommand, pressKey, type KeypadAction } from './keypad.ts'
import { Hub } from './Hub.tsx'
import { MODES, modeForKey, type ModeId } from './modes.ts'
import { Icon, Panel } from './ui.tsx'
import { useVoiceCommand, VoiceBanner } from './useVoiceCommand.tsx'

// The overlay (docs/OVERLAY.md, design in docs/DESIGN.md): a see-through layer over the screen with
// the team's tools around Gesture Control. Ctrl+Alt+Space (or an MX Keypad key mapped to it) shows
// and hides it from any program. Keys: 1–4 (or Num 1–4) choose,
// Esc goes back to the menu and, from the menu, hides the overlay. D opens the old developer screen,
// Q quits the app (and the helper programs it started).

type View = OverlayView

/** Screens that open the camera themselves: the gestures give it back meanwhile (one camera, N1). */
const NEEDS_CAMERA: View[] = ['documents', 'developer']

/** Width of the camera panel in the top-left corner (N1), in CSS pixels. */
const CAMERA_PANEL_WIDTH = 288

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

  // One camera: option 2 and the developer screen open it themselves (N1).
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

  // The see-through layer over the whole screen for the menu and the reading tools; a normal window
  // for Gesture Control (its clicks must reach the programs below). The summary bubble sizes itself.
  useEffect(() => {
    if (!inDesktopApp() || view === 'summarize') return
    void desktop()
      .SetLayer(view !== 'gestures')
      .catch(() => {})
  }, [view])

  const back = () => setView('menu')
  const ctx: OverlayContext = { view, setView }
  // The camera panel (top left, N1) on every screen but Gesture Control, which shows the whole
  // camera page, and the summary bubble. The toolbar (top right) on every screen but the bubble.
  // In the camera bubble (Gesture Control's compact mode) the camera page covers the window itself.
  const cameraShown = inDesktopApp() && view !== 'gestures' && view !== 'summarize'
  const gutter = cameraShown && !cameraHidden ? CAMERA_PANEL_WIDTH + 24 : 0
  const banner = (
    <>
      <VoiceBanner status={voice.status} />
      {view !== 'summarize' && <Toolbar ctx={ctx} />}
      {cameraShown && <CameraPanel hidden={cameraHidden} onToggle={toggleCameraPanel} />}
    </>
  )

  if (view === 'menu') {
    return (
      <>
        <Hub
          info={info}
          onChoose={(id) => {
            if (id === 'summarize') setSummaryRun((n) => n + 1)
            setView(id)
          }}
          onHide={() => inDesktopApp() && void desktop().HideOverlay()}
          extras={MENU_PANELS.map(({ id, title, Component }) => (
            <section key={id} aria-label={title} className="glass rounded-card p-5">
              <h2 className="mb-2 text-body font-bold">{title}</h2>
              <Component />
            </section>
          ))}
        />
        {banner}
      </>
    )
  }

  if (view === 'developer') {
    return (
      <>
        <Panel
          title="Developer screen"
          hint="The first version of the app, with its tools for testing."
          icon="keypad"
          accent="var(--color-mark)"
          onBack={back}
          gutterLeft={gutter}
        >
          <App />
        </Panel>
        {banner}
      </>
    )
  }

  // AI Summary lives in a small bubble next to the pointer.
  if (view === 'summarize') {
    return (
      <>
        <SummarizeMode key={summaryRun} onClose={back} />
        {banner}
      </>
    )
  }

  const mode = MODES.find((m) => m.id === view)!
  const content: Record<Exclude<ModeId, 'summarize'>, ReactNode> = {
    gestures: <GesturesMode />,
    documents: <DocumentsMode />,
    'read-file': <ReadFileMode onCancel={back} />,
    transcribe: <LiveCaptions onClose={back} />,
  }
  return (
    <>
      <Panel
        title={mode.title}
        hint={mode.description}
        icon={mode.icon}
        accent={mode.accent}
        onBack={back}
        fill={view === 'gestures'}
        gutterLeft={gutter}
      >
        {content[view]}
      </Panel>
      {banner}
    </>
  )
}

/**
 * The camera in the top-left corner (N1, Nil): the hand's points live, on every screen. The gesture
 * engine behind it is the one of option 1 (gestureHost.ts). Hiding it only hides the view.
 */
function CameraPanel({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <div className="fixed top-5 left-5 z-30 flex flex-col items-start gap-2" style={{ width: hidden ? undefined : CAMERA_PANEL_WIDTH }}>
      <GestureSlot
        variant="panel"
        className={hidden ? 'hidden' : 'w-full overflow-hidden rounded-card border border-edge shadow-edge'}
      />
      <button type="button" onClick={onToggle} className="btn glass min-h-0 py-1.5 text-meta">
        <Icon name="hand" size={18} /> {hidden ? 'Show camera' : 'Hide camera'}
      </button>
    </div>
  )
}

/** Buttons for what the keys do (extensions.ts, N1), top right: the overlay works with the mouse only. */
function Toolbar({ ctx }: { ctx: OverlayContext }) {
  const buttons = TOOLBAR.filter((b) => b.show?.(ctx) ?? true)
  if (buttons.length === 0) return null
  return (
    <nav aria-label="Window" className="glass fixed top-5 right-5 z-30 flex gap-1 rounded-full p-1.5">
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => b.run(ctx)}
          aria-keyshortcuts={b.key}
          title={b.key ? `${b.label} (${b.key})` : b.label}
          className="btn min-h-0 border-transparent bg-transparent py-1.5 text-body"
        >
          {b.label}
          {b.key && <span className="kbd">{b.key}</span>}
        </button>
      ))}
    </nav>
  )
}
