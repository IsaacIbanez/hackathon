import type { CSSProperties, ReactNode } from 'react'

// Shared pieces of the "Halo" design system (docs/DISENO.md): the tool icons, the panel every
// tool opens in, and the round back button. Colours and buttons live in web/src/index.css.

export type IconName = 'hand' | 'scan' | 'read' | 'ai' | 'voice' | 'back' | 'power' | 'keypad' | 'mic'

const PATHS: Record<IconName, ReactNode> = {
  // An open hand.
  hand: (
    <>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5" />
      <path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.5L4.3 15a1.6 1.6 0 0 1 2.5-2L8 14.5" />
    </>
  ),
  // A page with a scanning line across it.
  scan: (
    <>
      <path d="M7 3h7l4 4v4" />
      <path d="M18 17v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2" />
      <path d="M6 11V5a2 2 0 0 1 1-2" />
      <path d="M3 14h18" />
    </>
  ),
  // Lines of text with sound coming out.
  read: (
    <>
      <path d="M4 6h10M4 10h10M4 14h6" />
      <path d="M17 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M19.5 7a7 7 0 0 1 0 10" />
    </>
  ),
  // Two sparkles.
  ai: (
    <>
      <path d="M10 3l1.8 4.7L16.5 9.5l-4.7 1.8L10 16l-1.8-4.7L3.5 9.5l4.7-1.8z" />
      <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
    </>
  ),
  // A speech bubble with a sound wave.
  voice: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M9 10v2M12 8.5v5M15 10v2" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 7.5a8 8 0 1 0 11.4 0" />
    </>
  ),
  keypad: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
}

export function Icon({ name, size = 24, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  )
}

/** The round back button of every panel. */
export function BackButton({ onBack, label = 'Back' }: { onBack: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={`${label} (Esc)`}
      title={`${label} (Esc)`}
      className="grid size-12 shrink-0 place-items-center rounded-full border border-[var(--color-line)] bg-white/5 transition hover:bg-white/15"
      style={{ '--wails-draggable': 'no-drag' } as CSSProperties}
    >
      <Icon name="back" size={26} />
    </button>
  )
}

/**
 * The panel a tool opens in: a glass sheet over the layer (or filling the window, `fill`), with the
 * back button, the tool's icon in its colour, its name and a one-line hint. `accent` colours the
 * primary buttons inside (--accent).
 */
export function Panel({
  title,
  hint,
  icon,
  accent,
  onBack,
  fill = false,
  gutterLeft = 0,
  actions,
  children,
}: {
  title: string
  hint?: string
  icon: IconName
  accent: string
  onBack: () => void
  fill?: boolean
  /** Room kept free on the left (the camera panel in the top-left corner, N1), in CSS pixels. */
  gutterLeft?: number
  actions?: ReactNode
  children: ReactNode
}) {
  const style = { '--accent': accent } as CSSProperties
  const sheet = (
    <section
      aria-label={title}
      // Filling a normal window there is no layer behind it: the panel is solid, not see-through.
      style={fill ? { ...style, background: '#101832' } : style}
      className={`glass flex flex-col overflow-hidden ${fill ? 'h-screen w-screen rounded-none' : 'h-full w-full max-w-6xl rounded-[2rem]'}`}
    >
      <header
        className="flex items-center gap-4 border-b border-[var(--color-line)] px-6 py-4"
        style={{ '--wails-draggable': 'drag' } as CSSProperties}
      >
        <BackButton onBack={onBack} />
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in oklab, ${accent} 22%, transparent)`, color: accent }}
        >
          <Icon name={icon} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-tight font-bold">{title}</h1>
          {hint && <p className="truncate text-base text-[var(--color-mist)]">{hint}</p>}
        </div>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-6 py-5">{children}</div>
    </section>
  )
  if (fill) return sheet
  return (
    <div className="halo-layer flex items-center justify-center p-8" style={{ animation: 'rise .25s ease-out', paddingLeft: gutterLeft ? gutterLeft + 16 : undefined }}>
      {sheet}
    </div>
  )
}

/** A short status line inside a panel (what is happening, or what went wrong and what to do). */
export function Status({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-2xl leading-snug ${tone === 'warn' ? 'text-[var(--color-scan)]' : 'text-[var(--color-snow)]'}`}
    >
      {children}
    </p>
  )
}
