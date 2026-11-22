// Colour palettes of the overlay (docs/DESIGN.md, web/src/index.css). The five modes people with low
// vision already use on magnifiers and readers. The choice is remembered on this computer.

export type ThemeId = 'night' | 'day' | 'magnifier' | 'contrast' | 'warm'

export const THEMES: { id: ThemeId; name: string; bg: string; mark: string }[] = [
  { id: 'night', name: 'Night', bg: '#101a1f', mark: '#f2c94c' },
  { id: 'day', name: 'Day', bg: '#f5f6f3', mark: '#1e4fd8' },
  { id: 'magnifier', name: 'Magnifier', bg: '#0a35b8', mark: '#ffe14a' },
  { id: 'contrast', name: 'Contrast', bg: '#000000', mark: '#ffff00' },
  { id: 'warm', name: 'Warm', bg: '#2a1810', mark: '#ffb347' },
]

const KEY = 'overlay-theme'

export function savedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY)
    if (THEMES.some((x) => x.id === t)) return t as ThemeId
  } catch {
    // storage can be unavailable; the default theme is fine
  }
  return 'night'
}

/** Applies a palette to the whole page (and the gesture page inside it), and remembers it. */
export function applyTheme(id: ThemeId): void {
  if (id === 'night') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // not remembered this time
  }
}
