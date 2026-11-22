import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import App from '../App.tsx'
import { DocumentsMode } from './DocumentsMode.tsx'
import { GesturesMode } from './GesturesMode.tsx'
import { ReadFileMode } from './ReadFileMode.tsx'
import { SummarizeMode } from './SummarizeMode.tsx'
import { desktop, inDesktopApp, onDesktopEvent, type OverlayInfo } from './desktop.ts'
import { keypadCommand, pressKey, type KeypadAction } from './keypad.ts'
import { Hub } from './Hub.tsx'
import { MODES, modeForKey, type ModeId } from './modes.ts'
import { Panel } from './ui.tsx'
import { useVoiceCommand, VoiceBanner } from './useVoiceCommand.tsx'

// The overlay (docs/OVERLAY.md, design in docs/DISENO.md): a see-through layer over the screen with
// the team's tools around Gesture Control. Ctrl+Alt+Space (or an MX Keypad key mapped to it) shows
// and hides it from any program. Keys: 1–4 (or Num 1–4) choose,
// Esc goes back to the menu and, from the menu, hides the overlay. D opens the old developer screen,
// Q quits the app (and the helper programs it started).

type View = ModeId | 'menu' | 'developer'

export function Overlay() {
  const [view, setView] = useState<View>('menu')
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  // Each summary request mounts option 4 afresh (it summarizes once, when it opens).
  const [summaryRun, setSummaryRun] = useState(0)

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

  // Gesture Control's camera bubble (Nil): while small, its view has no panel around it.
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const offs = [
      onDesktopEvent('overlay:compact', () => setCompact(true)),
      onDesktopEvent('overlay:screen', () => setCompact(true)),
      onDesktopEvent('overlay:expanded', () => setCompact(false)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const back = () => setView('menu')
  const banner = <VoiceBanner status={voice.status} />

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
          onQuit={inDesktopApp() ? () => void desktop().Quit() : undefined}
        />
        {banner}
      </>
    )
  }

  if (view === 'developer') {
    return (
      <Panel title="Developer screen" hint="The first version of the app, with its tools for testing." icon="keypad" accent="var(--color-mark)" onBack={back}>
        <App />
      </Panel>
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
  if (view === 'gestures' && compact) {
    return <GesturesMode />
  }
  const content: Record<Exclude<ModeId, 'summarize'>, ReactNode> = {
    gestures: <GesturesMode />,
    documents: <DocumentsMode />,
    'read-file': <ReadFileMode onCancel={back} />,
    transcribe: <ComingSoon />,
  }
  return (
    <>
      <Panel title={mode.title} hint={mode.description} icon={mode.icon} accent={mode.accent} onBack={back} fill={view === 'gestures'}>
        {content[view]}
      </Panel>
      {banner}
    </>
  )
}

/** Transcribe (Pau's live captions) is not in the app yet. */
function ComingSoon() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="max-w-xl space-y-3">
        <p className="text-3xl font-bold">Transcribe is not ready yet.</p>
        <p className="text-xl text-[var(--color-mist)]">
          It will show live captions of what people around you say. Press Esc to go back and use another tool.
        </p>
      </div>
    </div>
  )
}
