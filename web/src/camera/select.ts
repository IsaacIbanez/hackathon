// Which camera to open: the Logitech one (MX Brio) if it is connected, by its label.
// Pure function (no DOM) so it can be tested with node --test.

export interface CameraInfo {
  deviceId: string
  label: string
  kind?: string
}

// Virtual cameras that carry the Logitech name but are not the physical webcam.
const VIRTUAL = /virtual|capture|obs|snap|droid/i

/** Score of a label: higher = more preferred; 0 = not a Logitech camera. */
export function logitechScore(label: string): number {
  if (VIRTUAL.test(label)) return 0
  if (/brio/i.test(label)) return 3
  if (/logitech/i.test(label)) return 2
  if (/\blogi\b|^logi/i.test(label)) return 1
  return 0
}

/**
 * The preferred camera among `devices` (only `videoinput`), or null if there is none.
 * With `prefer`, the first camera whose label matches it; otherwise the best Logitech one.
 */
export function pickCamera(devices: readonly CameraInfo[], prefer?: RegExp): CameraInfo | null {
  const cameras = devices.filter((d) => (d.kind ?? 'videoinput') === 'videoinput')
  if (prefer) return cameras.find((d) => prefer.test(d.label)) ?? null
  let best: CameraInfo | null = null
  let bestScore = 0
  for (const d of cameras) {
    const s = logitechScore(d.label)
    if (s > bestScore) {
      best = d
      bestScore = s
    }
  }
  return best
}
