import { useState, type CSSProperties, type ReactNode } from 'react'
import type { OverlayInfo } from './desktop.ts'
import type { KeypadAction } from './keypad.ts'
import { MODES, type ModeId } from './modes.ts'
import { applyTheme, savedTheme, THEMES, type ThemeId } from './theme.ts'
import { Icon, type IconName } from './ui.tsx'

// The layer's home (docs/DESIGN.md): a page of large print over the dimmed desktop. Each tool is a
// line of type with its key number (the MX Keypad key and the keyboard digit) in a fixed column;
// the line under the pointer, the hand or the focus gets the highlighter, the same mark as the line
// being read. Under the list, one sentence says what that line does.

type Line = { n: string; name: string; icon: IconName; says: string; press: () => void }

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
  const [hint, setHint] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeId>(savedTheme)
  const failedKeys = (info?.keypad ?? []).filter((k) => !k.ok)

  const tools: Line[] = MODES.filter((m) => m.ready)
    .map((m) => ({ n: m.key, name: m.title, icon: m.icon, says: m.description, press: () => onChoose(m.id) }))
    .sort((a, b) => Number(a.n) - Number(b.n))
  const more: Line[] = [
    { n: '7', name: 'Voice command', icon: 'mic', says: 'Press 7, say what you want, press 7 again.', press: () => onKey?.('record-toggle') },
    { n: '8', name: 'Read or pause', icon: 'play', says: 'Start or pause the reading that is open.', press: () => onKey?.('play') },
    { n: '1', name: 'Hide', icon: 'hide', says: 'Hide this layer. Key 1 brings it back.', press: onHide },
  ]
  const hover = (l: Line) => ({
    onMouseEnter: () => setHint(l.says),
    onMouseLeave: () => setHint(null),
    onFocus: () => setHint(l.says),
    onBlur: () => setHint(null),
  })

  return (
    // A click on the empty layer hides it, like a click outside a menu.
    <div className="halo-layer" onClick={(e) => e.target === e.currentTarget && onHide()}>
      <main className="absolute top-1/2 left-[max(3rem,9vw)] w-[min(40rem,80vw)] -translate-y-1/2">
        <nav aria-label="Tools" className="print-list">
          {tools.map((l, i) => (
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

        <p id="hub-caption" aria-live="polite" className="mt-6 min-h-[2.8em] max-w-[32rem] pl-[calc(2.2ch*1.3+0.9rem)] text-lead text-fg-muted">
          {hint ?? 'Point at a line, press its number, or click it.'}
        </p>

        <div className="mt-4 flex flex-wrap gap-3 pl-[calc(2.2ch*1.3+0.9rem)]">
          {more.map((l) => (
            <button key={l.n} type="button" className="btn text-body" aria-keyshortcuts={l.n} onClick={l.press} {...hover(l)}>
              <span className="kbd">{l.n}</span>
              <Icon name={l.icon} size={20} />
              {l.name}
            </button>
          ))}
        </div>
      </main>

      {extras && <div className="absolute right-8 bottom-28 w-[22rem] space-y-3">{extras}</div>}

      <footer className="absolute right-8 bottom-8 left-[max(3rem,9vw)] flex flex-wrap items-center gap-x-8 gap-y-3 text-body text-fg-muted">
        <div role="group" aria-label="Colours" className="flex items-center gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="swatch"
              style={{ background: t.bg }}
              aria-pressed={theme === t.id}
              aria-label={`${t.name} colours`}
              title={`${t.name} colours`}
              onClick={() => {
                applyTheme(t.id)
                setTheme(t.id)
              }}
            >
              <span style={{ background: t.mark }} />
            </button>
          ))}
          <span className="ml-2 text-fg">{THEMES.find((t) => t.id === theme)?.name}</span>
        </div>
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
        {onQuit && (
          <button type="button" onClick={onQuit} className="btn btn-quiet ml-auto min-h-0 py-1.5 text-body">
            <Icon name="power" size={18} /> Quit <span className="kbd">Q</span>
          </button>
        )}
      </footer>
    </div>
  )
}
