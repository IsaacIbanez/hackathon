// Example menu panel (N1, docs/OVERLAY.md «Añadir un botón o un panel»): registered in extensions.ts.
export function GestureTipsPanel() {
  return (
    <ul className="list-disc space-y-1 pl-6 text-base text-[var(--color-mist)]">
      <li>✋ Open palm, fingers spread, held still: wakes the gestures up.</li>
      <li>✊ Fist: the gesture menu (volume, brightness, microphone, apps, cursor mode…).</li>
      <li>☝️ Point and tap the middle finger on the thumb: choose an option, or click in cursor mode.</li>
      <li>The camera in the corner can be hidden with its button; option 1 has all the controls.</li>
    </ul>
  )
}
