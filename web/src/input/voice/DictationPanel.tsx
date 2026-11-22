// On-screen view of the field being filled by voice: the draft in big letters, what was heard,
// what to say, and buttons for everything the voice and gestures can do.

import type { DictationState } from './fieldDictation.ts'

export interface DictationPanelProps {
  state: DictationState
  /** Fields already confirmed in this session. */
  filled: { label: string | null; value: string }[]
  onConfirm: () => void
  onUndo: () => void
  onResume: () => void
  onCancel: () => void
  onDoneTalking: () => void
  onNewField: () => void
}

const PHASE: Record<DictationState['phase'], string> = {
  idle: '',
  listening: '🎙️ Listening… speak or spell',
  speaking: '🔊 Reading it back',
  paused: '⏸️ Paused',
  confirmed: '✅ Saved',
  cancelled: 'Cancelled',
}

const button = 'rounded-field border px-5 py-3 text-lead font-bold focus-visible:outline focus-visible:outline-4'

export function DictationPanel(p: DictationPanelProps) {
  const { state } = p
  const active = state.phase === 'listening' || state.phase === 'speaking' || state.phase === 'paused'
  return (
    <section aria-label="Fill in a field" className="mt-4 rounded-card border border-accent bg-surface-solid p-5">
      <h3 className="text-title font-bold text-fg">
        {state.label ? `Field: ${state.label}` : 'Field'} <span className="ml-2 text-body font-normal">{PHASE[state.phase]}</span>
      </h3>

      {/* The draft, letter by letter: big, high contrast, spaces made visible. */}
      <div aria-live="polite" aria-label={`Draft: ${state.value || 'empty'}`} className="mt-3 flex min-h-20 flex-wrap gap-1">
        {state.value ? (
          [...state.value].map((ch, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`flex h-16 min-w-12 items-center justify-center rounded-chip px-2 font-mono text-display font-bold ${
                ch === ' ' ? 'bg-transparent text-on-accent' : 'bg-paper text-on-accent'
              }`}
            >
              {ch === ' ' ? '␣' : ch}
            </span>
          ))
        ) : (
          <span className="text-display text-fg">(empty)</span>
        )}
      </div>

      {state.heard && <p className="mt-3 text-lead text-fg">Heard: «{state.heard}»</p>}
      {state.message && <p className="mt-2 text-lead text-fg">{state.message}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        {active && (
          <>
            <button type="button" className={`${button} border-accent bg-fill-strong text-fg`} onClick={p.onConfirm}>
              👍 Save
            </button>
            <button type="button" className={`${button} border-accent text-warn`} onClick={p.onUndo} disabled={!state.canUndo}>
              👎 Undo
            </button>
            {state.phase === 'listening' && (
              <button type="button" className={`${button} border-accent text-fg`} onClick={p.onDoneTalking}>
                ✋ I'm done talking
              </button>
            )}
            {state.phase === 'paused' && (
              <button type="button" className={`${button} border-accent text-fg`} onClick={p.onResume}>
                ▶️ Continue
              </button>
            )}
            <button type="button" className={`${button} border-edge text-fg`} onClick={p.onCancel}>
              Cancel
            </button>
          </>
        )}
        {!active && (
          <button type="button" className={`${button} border-accent text-fg`} onClick={p.onNewField}>
            ☝️ {p.filled.length ? 'Next field' : 'Fill in a field'}
          </button>
        )}
      </div>

      <details className="mt-4 text-body text-fg">
        <summary className="cursor-pointer font-bold">What can I say?</summary>
        <ul className="mt-2 list-disc pl-6">
          <li>The answer: «Nil March», «me llamo Nil»</li>
          <li>Spell it: «ene, i, ele» · «N de Navarra» · «be alta», «uve», «doble ele», «i griega»</li>
          <li>Accents and symbols: «e con tilde», «espacio», «arroba», «punto», «guion»</li>
          <li>Fix it: «borra la última letra», «borra la última palabra», «borra todo», «añade …», «con tilde»</li>
          <li>Check it: «¿cómo está?» (reads it letter by letter)</li>
          <li>Finish: «sí» / 👍 to save · «cancelar» to leave without saving</li>
        </ul>
      </details>

      {p.filled.length > 0 && (
        <div className="mt-4">
          <h4 className="text-lead font-bold text-fg">Saved fields</h4>
          <ul className="mt-1 text-lead">
            {p.filled.map((f, i) => (
              <li key={i}>
                {f.label ? `${f.label}: ` : `Field ${i + 1}: `}
                <strong>{f.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
