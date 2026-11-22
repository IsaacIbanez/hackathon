import { useState, type CSSProperties, type ReactNode } from 'react'
import type { OverlayInfo } from './desktop.ts'
import type { KeypadAction } from './keypad.ts'
import { MODES, type ModeId } from './modes.ts'
import { Icon, type IconName } from './ui.tsx'

// The layer's home (docs/DESIGN.md): a page of large print over the dimmed desktop. Every key of
// the MX Keypad is a line, in key order (1 to 8; 9 is this menu), with its number in a fixed column.
// Every line is the same size. The line under the
// pointer, the hand or the focus gets the highlighter, the same mark as the line being read. Under
// the list, one sentence says what that line does.

type Line = { n: string; name: string; icon: IconName; says: string; press: () => void }

export function Hub({
  info,
  onChoose,
  onHide,
  onKey,
  onQuit,
  gutterLeft = 0,
  extras,
}: {
  info: OverlayInfo | null
  onChoose: (id: ModeId) => void
  onHide: () => void
  /** Keys that are not a tool: the voice command and read/pause (keypad.ts). */
  onKey?: (action: KeypadAction) => void
  onQuit?: () => void
  /** Room kept free on the left for the camera panel (top-left corner), in CSS pixels. */
  gutterLeft?: number
  /** Extra panels of the menu (extensions.ts, MENU_PANELS), in the bottom-left corner. */
  extras?: ReactNode
}) {
  const [hint, setHint] = useState<string | null>(null)
  const failedKeys = (info?.keypad ?? []).filter((k) => !k.ok)

  const lines: Line[] = [
    { n: '1', name: 'Hide', icon: 'hide' as const, says: 'Hide this layer. Key 1 brings it back.', press: onHide },
    ...MODES.filter((m) => m.ready).map((m) => ({ n: m.key, name: m.title, icon: m.icon, says: m.description, press: () => onChoose(m.id) })),
    { n: '7', name: 'Voice command', icon: 'mic' as const, says: 'Press 7, say what you want, press 7 again.', press: () => onKey?.('record-toggle') },
    { n: '8', name: 'Read or pause', icon: 'play' as const, says: 'Start or pause the reading that is open.', press: () => onKey?.('play') },
  ].sort((a, b) => Number(a.n) - Number(b.n))
  const hover = (l: Line) => ({
    onMouseEnter: () => setHint(l.says),
    onMouseLeave: () => setHint(null),
    onFocus: () => setHint(l.says),
    onBlur: () => setHint(null),
  })

  return (
    // A click on the empty layer hides it, like a click outside a menu.
    <div className="halo-layer" onClick={(e) => e.target === e.currentTarget && onHide()}>
      <main
        className="absolute top-1/2 w-[min(40rem,80vw)] -translate-y-1/2"
        // Right of the camera panel, so it never covers the first line.
        style={{ left: `max(3rem, 9vw, ${gutterLeft + 32}px)` }}
      >
        {(info?.problems?.length ?? 0) > 0 && (
          // What a tool needs and is missing on this computer (app_checks.go), with what to do.
          <ul role="alert" aria-label="Missing on this computer" className="mb-6 space-y-2">
            {info!.problems!.map((p) => (
              <li key={p} className="flex items-start gap-3 text-body text-warn">
                <Icon name="alert" size={22} className="mt-0.5 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
        <nav aria-label="Tools" className="print-list">
          {lines.map((l, i) => (
            <button
              key={l.n}
              type="button"
              className="print-line"
              style={{ animation: `line-in var(--duration-base) var(--ease-soft) ${i * 35}ms backwards` } as CSSProperties}
              aria-keyshortcuts={l.n}
              aria-describedby="hub-caption"
              onClick={l.press}
              {...hover(l)}
            >
              <span className="print-num">{l.n}</span>
              <span>{l.name}</span>
              <Icon name={l.icon} size={34} className="print-icon justify-self-end" />
            </button>
          ))}
        </nav>

        <p id="hub-caption" aria-live="polite" className="mt-6 min-h-[2.8em] max-w-[32rem] pl-[3.3rem] text-lead text-fg-muted">
          {hint ?? 'Point at a line, press its number, or click it.'}
        </p>

      </main>

      {extras && <div className="absolute right-8 bottom-28 w-[22rem] space-y-3">{extras}</div>}

      <footer className="absolute right-8 bottom-8 left-[max(3rem,9vw)] flex flex-wrap items-center gap-x-8 gap-y-3 text-body text-fg-muted">
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
          <span className="flex items-center gap-2">
            <Icon name="keypad" size={20} /> MX Keypad connected
          </span>
        )}
        {failedKeys.length > 0 && <span className="text-warn">Keypad shortcuts {failedKeys.map((k) => k.shortcut).join(', ')} are taken</span>}
        {info?.version && (
          <span className="ml-auto text-meta" title="The build that is running: commit and date of the .exe">
            {info.version.commit}
            {info.version.modified ? '+' : ''}
            {info.version.built ? `, built ${info.version.built}` : ''}
          </span>
        )}
        {onQuit && (
          <button type="button" onClick={onQuit} className="btn btn-quiet min-h-0 py-1.5 text-body">
            <Icon name="power" size={18} /> Quit <span className="kbd">Q</span>
          </button>
        )}
      </footer>
    </div>
  )
}
