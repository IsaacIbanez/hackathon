import { useState, type CSSProperties } from 'react'
import type { OverlayInfo } from './desktop.ts'
import { MODES, type Mode, type ModeId } from './modes.ts'
import { Icon } from './ui.tsx'

// The layer's home (docs/DISENO.md): the desktop dimmed behind, Gesture Control as the big circle
// in the middle and the other tools fanned out on an arc above it, like a radial menu: every tool
// is the same distance from the centre and keeps its direction, so it can be found without
// looking. Under the hub, one line says what the tool under the pointer (or focus) does.

/** Angles of the arc, in degrees (0 = right, 270 = straight up), left to right. */
function arcAngles(n: number): number[] {
  if (n === 1) return [270]
  const from = 205
  const to = 335
  return Array.from({ length: n }, (_, i) => from + (i * (to - from)) / (n - 1))
}

export function Hub({
  info,
  onChoose,
  onHide,
  onQuit,
}: {
  info: OverlayInfo | null
  onChoose: (id: ModeId) => void
  onHide: () => void
  onQuit?: () => void
}) {
  const [hint, setHint] = useState<Mode | null>(null)
  const hub = MODES.find((m) => m.place === 'hub')!
  const arc = MODES.filter((m) => m.place === 'arc')
  const angles = arcAngles(arc.length)
  const failedKeys = (info?.keypad ?? []).filter((k) => !k.ok)

  const caption = hint
    ? hint.ready
      ? hint.description
      : `${hint.title} is coming soon.`
    : `Choose a tool with the mouse or press ${MODES.filter((m) => m.ready).map((m) => m.key).join(', ')}.`

  return (
    // A click on the empty layer hides it, like a click outside a menu.
    <div className="halo-layer" onClick={(e) => e.target === e.currentTarget && onHide()}>
      <nav
        aria-label="Tools"
        className="absolute top-[58%] left-1/2"
        style={{ '--r': 'min(44vmin, 26rem)' } as CSSProperties}
        onClick={(e) => e.target === e.currentTarget && onHide()}
      >
        {arc.map((m, i) => (
          <div
            key={m.id}
            className="absolute"
            style={
              {
                '--a': `${angles[i]}deg`,
                transform: 'translate(-50%, -50%) translate(calc(cos(var(--a)) * var(--r)), calc(sin(var(--a)) * var(--r)))',
                animation: `orb-out .45s cubic-bezier(.2,.9,.3,1.2) ${0.04 * i}s backwards`,
              } as CSSProperties
            }
          >
            <ToolOrb mode={m} onChoose={onChoose} onHint={setHint} />
          </div>
        ))}

        <div className="absolute" style={{ transform: 'translate(-50%, -50%)' }}>
          <button
            type="button"
            onClick={() => onChoose(hub.id)}
            onMouseEnter={() => setHint(hub)}
            onMouseLeave={() => setHint(null)}
            onFocus={() => setHint(hub)}
            onBlur={() => setHint(null)}
            aria-keyshortcuts={hub.key}
            aria-describedby="hub-caption"
            className="orb hub-orb relative size-[13rem] flex-col gap-1"
          >
            <span className="hub-halo" aria-hidden="true" />
            <Icon name={hub.icon} size={68} className="text-[var(--color-hand)]" />
            <span className="text-xl leading-tight font-bold">{hub.title}</span>
            <span className="kbd">{hub.key}</span>
          </button>
        </div>
      </nav>

      <p
        id="hub-caption"
        aria-live="polite"
        className="pointer-events-none absolute top-[calc(58%+8.5rem)] left-1/2 w-[min(34rem,90vw)] -translate-x-1/2 text-center text-xl leading-snug text-[var(--color-snow)]"
      >
        {caption}
      </p>

      <footer className="glass absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-5 rounded-full px-6 py-3 text-base whitespace-nowrap text-[var(--color-mist)]">
        <span>
          {info?.hotkeyOk ? (
            <>
              <span className="kbd">Ctrl</span> <span className="kbd">Alt</span> <span className="kbd">Space</span> shows or
              hides this layer
            </>
          ) : (
            'Esc hides this layer'
          )}
        </span>
        {info?.keypadConnected && (
          <span className="flex items-center gap-2 text-[var(--color-hand)]">
            <Icon name="keypad" size={20} /> MX Keypad ready
          </span>
        )}
        {failedKeys.length > 0 && (
          <span className="text-[var(--color-scan)]">Keypad shortcuts {failedKeys.map((k) => k.shortcut).join(', ')} are taken</span>
        )}
        {onQuit && (
          <button type="button" onClick={onQuit} className="btn min-h-0 py-1.5 text-base">
            <Icon name="power" size={18} /> Quit <span className="kbd">Q</span>
          </button>
        )}
      </footer>
    </div>
  )
}

function ToolOrb({ mode, onChoose, onHint }: { mode: Mode; onChoose: (id: ModeId) => void; onHint: (m: Mode | null) => void }) {
  return (
    <div className="relative" style={{ '--accent': mode.accent } as CSSProperties}>
      <button
        type="button"
        aria-disabled={!mode.ready}
        aria-keyshortcuts={mode.key}
        aria-describedby="hub-caption"
        onClick={() => mode.ready && onChoose(mode.id)}
        onMouseEnter={() => onHint(mode)}
        onMouseLeave={() => onHint(null)}
        onFocus={() => onHint(mode)}
        onBlur={() => onHint(null)}
        className="orb size-[8rem]"
      >
        <Icon name={mode.icon} size={48} />
        <span className="sr-only">{mode.title}</span>
      </button>
      <span className="pointer-events-none absolute top-[calc(100%+0.6rem)] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-center whitespace-nowrap">
        <span className="text-lg leading-tight font-bold">{mode.title}</span>
        {mode.ready ? (
          <span className="kbd">{mode.key}</span>
        ) : (
          <span className="text-sm text-[var(--color-mist)]">Coming soon</span>
        )}
      </span>
    </div>
  )
}
