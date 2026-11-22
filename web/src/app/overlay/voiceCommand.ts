// Voice commands for the overlay (keypad key 7: press to record, again to stop, docs/KEYPAD.md).
// The recording is transcribed by Go (POST /transcribe) and this turns the text into one of the
// actions the keypad already has. Spanish, Catalan and English; pure, tested without a browser.

import type { KeypadAction } from './keypad.ts'

/** Lower case, no accents, no punctuation, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Checked in order: the first pattern that matches wins (more specific ones first). The volume and
// deleting go first, so "borra el texto del archivo" deletes and does not open a file.
const RULES: { action: KeypadAction; pattern: RegExp }[] = [
  { action: 'volume-up', pattern: /\b(sube|subir|subelo|aumenta|aumentar|apuja|puja|mas alto|mes alt|louder|volume up|turn it up|turn up)\b/ },
  { action: 'volume-down', pattern: /\b(baja|bajar|bajalo|disminuye|reduce|baixa|baixar|mas bajo|mes baix|quieter|softer|volume down|turn it down|turn down)\b/ },
  { action: 'delete-selection', pattern: /\b(borra|borrar|borralo|borrala|elimina|eliminar|suprime|suprimir|esborra|esborrar|suprimeix|delete|erase)\b/ },
  { action: 'summarize', pattern: /\b(resum\w*|summar\w*)\b/ },
  { action: 'read-file', pattern: /\b(archivo|fichero|fitxer|file|pdf)\b/ },
  { action: 'documents', pattern: /\b(papel|paper|documento|document|hoja|carta|escane\w*|scan\w*|camara|camera)\b/ },
  { action: 'gestures', pattern: /\b(gestos?|gestures?|manos?|hands?)\b/ },
  { action: 'menu', pattern: /\b(menu|volver|vuelve|atras|inicio|tornar|enrere|back|home)\b/ },
  { action: 'previous', pattern: /\b(anterior|previous|atras una|antes)\b/ },
  { action: 'next', pattern: /\b(siguiente|seguent|next|adelante)\b/ },
  { action: 'repeat', pattern: /\b(repite|repetir|repeteix|otra vez|repeat|again)\b/ },
  { action: 'toggle', pattern: /\b(oculta\w*|esconde\w*|cierra|cerrar|amaga\w*|tanca|hide|close)\b/ },
  { action: 'play', pattern: /\b(pausa|para|parar|detente|stop|pause|lee|leer|llegeix|continua|sigue|play|read|resume)\b/ },
]

/** The action a spoken sentence asks for, or null if it is not a command we know. */
export function voiceAction(text: string): KeypadAction | null {
  const t = normalize(text)
  if (!t) return null
  return RULES.find((r) => r.pattern.test(t))?.action ?? null
}

/** What the app says after a command, in Spanish (the overlay's language, LANG es-ES). */
export const DONE_SPEECH: Partial<Record<KeypadAction, string>> = {
  summarize: 'Resumiendo el texto seleccionado.',
  'read-file': 'Elige un archivo.',
  documents: 'Vamos a leer un papel.',
  gestures: 'Gestos.',
  menu: 'Menú.',
}
