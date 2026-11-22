import { useState, type CSSProperties, type ReactNode } from 'react'
import type { OverlayInfo } from './desktop.ts'
import type { KeypadAction } from './keypad.ts'
import { MODES, type ModeId } from './modes.ts'
import { Icon, type IconName } from './ui.tsx'

// The layer's home (docs/DESIGN.md): the MX Keypad drawn on the screen. Nine keys in the order of
// the real ones (docs/KEYPAD.md), each doing what the physical key does, so what you see is what
// you press. Under the pad, one line says what the key under the pointer (or focus) does.

type PadKey = {
  n: string
  name: string
  icon: IconName
  says: string
  /** What a click does; none for the key you are on (9, the menu). */
  press?: () => void
}

export function Hub({
  info,
  onChoose,
  onHide,
  onKey,
  onQuit,
  extras,
}: {
  info: OverlayInfo | null
  onChoose: (id: ModeId) => void
  onHide: () => void
  /** Keys that are not a tool: the voice command and read/pause (keypad.ts). */
  onKey?: (action: KeypadAction) => void
  onQuit?: () => void
  /** Extra panels of the menu (extensions.ts, MENU_PANELS), in the bottom-left corner. */
  extras?: ReactNode
}) {
  const [hint, setHint] = useState<PadKey | null>(null)
  const failedKeys = (info?.keypad ?? []).filter((k) => !k.ok)

  const tools: PadKey[] = MODES.filter((m) => m.ready).map((m) => ({
    n: m.key,
    name: m.title,
    icon: m.icon,
    says: m.description,
    press: () => onChoose(m.id),
  }))
  const keys: PadKey[] = [
    { n: '1', name: 'Hide', icon: 'hide' as const, says: 'Hide this layer. Key 1 brings it back.', press: onHide },
    ...tools,
    {
      n: '7',
      name: 'Voice command',
      icon: 'mic' as const,
      says: 'Press, say what you want (for example “read the paper”), press again.',
      press: () => onKey?.('record-toggle'),
    },
    { n: '8', name: 'Read / pause', icon: 'play' as const, says: 'Start or pause the reading that is open.', press: () => onKey?.('play') },
    { n: '9', name: 'Menu', icon: 'keypad' as const, says: 'You are here.' },
  ].sort((a, b) => Number(a.n) - Number(b.n))

  return (
    // A click on the empty layer hides it, like a click outside a menu.
    <div className="halo-layer grid place-items-center" onClick={(e) => e.target === e.currentTarget && onHide()}>
      <div className="flex flex-col items-center gap-6">
        <nav aria-label="Keypad" className="pad">
          {keys.map((k, i) => (
            <button
              key={k.n}
              type="button"
              className="key"
              style={{ animationDelay: `${i * 25}ms` } as CSSProperties}
              aria-current={k.press ? undefined : 'page'}
              aria-keyshortcuts={k.n}
              aria-describedby="hub-caption"
              onClick={() => k.press?.()}
              onMouseEnter={() => setHint(k)}
              onMouseLeave={() => setHint(null)}
              onFocus={() => setHint(k)}
              onBlur={() => setHint(null)}
            >
              <span className="key-top">
                <span className="key-num" aria-hidden="true">
                  {k.n}
                </span>
                <Icon name={k.icon} size={30} />
              </span>
              <span className="key-name">
                {k.name}
                {!k.press && <span className="key-sub">You are here</span>}
              </span>
            </button>
          ))}
        </nav>

        <p id="hub-caption" aria-live="polite" className="h-[2.7em] max-w-[34rem] text-center text-lead text-fg">
          {hint ? hint.says : 'Press a key on the keypad, a number on the keyboard, or click.'}
        </p>
      </div>

      {extras && <div className="absolute bottom-8 left-8 w-[22rem] space-y-3">{extras}</div>}

      <footer className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-6 text-body whitespace-nowrap text-fg-muted">
        {info?.hotkeyOk ? (
          <span>
            <span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">Space</span> shows or hides
          </span>
        ) : (
          <span>
            <span className="kbd">Esc</span> hides
          </span>
        )}
        {info?.keypadConnected && (
          <span className="flex items-center gap-2 text-fg">
            <Icon name="keypad" size={20} /> MX Keypad connected
          </span>
        )}
        {failedKeys.length > 0 && (
          <span className="text-warn">Keypad shortcuts {failedKeys.map((k) => k.shortcut).join(', ')} are taken</span>
        )}
        {onQuit && (
          <button type="button" onClick={onQuit} className="btn min-h-0 py-1.5 text-body">
            <Icon name="power" size={18} /> Quit <span className="kbd">Q</span>
          </button>
        )}
      </footer>
    </div>
  )
}
