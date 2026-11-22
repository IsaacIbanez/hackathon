import { useEffect, useState, type ReactNode } from 'react'
import App from '../App.tsx'
import { DocumentsMode } from './DocumentsMode.tsx'
import { GesturesMode } from './GesturesMode.tsx'
import { ReadFileMode } from './ReadFileMode.tsx'
import { desktop, inDesktopApp, onDesktopEvent, type OverlayInfo } from './desktop.ts'
import { keypadCommand, pressKey } from './keypad.ts'
import { MODES, modeForKey, type ModeId } from './modes.ts'

// The overlay (docs/OVERLAY.md): a menu with the team's features. Ctrl+Alt+Space (or an MX Keypad
// key mapped to it) shows and hides the window from any program. Keys: 1–3 (or Num 1–3) choose,
// Esc goes back to the menu and, from the menu, hides the overlay. D opens the old developer screen,
// Q quits the app (and the helper programs it started).

type View = ModeId | 'menu' | 'developer'

export function Overlay() {
  const [view, setView] = useState<View>('menu')
  const [info, setInfo] = useState<OverlayInfo | null>(null)

  useEffect(() => {
    if (inDesktopApp()) desktop().OverlayInfo().then(setInfo).catch(() => {})
  }, [])

  // Back on screen: focus the window content so the keys work right away.
  useEffect(() => onDesktopEvent('overlay:shown', () => window.focus()), [])

  // MX Keypad (docs/KEYPAD.md): Go shows the window and sends the action, even from another program.
  useEffect(
    () =>
      onDesktopEvent('overlay:keypad', (action) => {
        const cmd = keypadCommand(action)
        if (!cmd) return
        if ('view' in cmd) setView(cmd.view)
        else pressKey(cmd.key)
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

  if (view === 'developer') {
    return (
      <div>
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
  }

  return (
    <main className="min-h-screen bg-slate-900 p-6 text-slate-50">
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
      <ol className="grid gap-4 md:grid-cols-3">
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
        Press 1, 2 or 3 (also on the numeric keypad). Esc hides this window
        {info?.hotkeyOk ? `; ${info.hotkey} brings it back from any program.` : '.'}
        {info && !info.hotkeyOk && ` The shortcut ${info.hotkey} could not be registered: the window stays available.`}
      </p>
      <KeypadStatus info={info} />
      {inDesktopApp() && (
        <button type="button" onClick={() => void desktop().Quit()} className="text-base text-slate-500 underline">
          Quit the app (Q)
        </button>
      )}
    </section>
  )
}

/** MX Keypad shortcuts (docs/KEYPAD.md): only says something when one could not be registered. */
function KeypadStatus({ info }: { info: OverlayInfo | null }) {
  const keys = info?.keypad ?? []
  const failed = keys.filter((k) => !k.ok)
  if (failed.length === 0) return null
  return (
    <p role="status" className="text-lg text-amber-300">
      Keypad: {failed.map((k) => k.shortcut).join(', ')} could not be registered (another program uses them).
    </p>
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
