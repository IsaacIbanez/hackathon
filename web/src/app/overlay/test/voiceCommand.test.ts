import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, voiceAction } from '../voiceCommand.ts'

test('voice: normalize drops accents, case and punctuation', () => {
  assert.equal(normalize('  ¡Léeme el DOCUMENTO, por favor!  '), 'leeme el documento por favor')
})

test('voice: sentences become keypad actions', () => {
  const cases: [string, string | null][] = [
    ['Lee el documento', 'documents'],
    ['Escanea este papel', 'documents'],
    ['Abre un archivo', 'read-file'],
    ['Léeme el PDF', 'read-file'],
    ['Resume lo seleccionado', 'summarize'],
    ['Summarize this', 'summarize'],
    ['Activa los gestos', 'gestures'],
    ['Vuelve al menú', 'menu'],
    ['Siguiente', 'next'],
    ['Anterior', 'previous'],
    ['Repite', 'repeat'],
    ['Pausa', 'play'],
    ['Continúa', 'play'],
    ['Oculta la ventana', 'toggle'],
    ['Llegeix el paper', 'documents'],
    ['¿Qué tiempo hace mañana?', null],
    ['', null],
  ]
  for (const [text, want] of cases) assert.equal(voiceAction(text), want, text)
})

test('voice: delete the selected text only when the sentence says so', () => {
  const cases: [string, string | null][] = [
    ['Borra el texto', 'delete-selection'],
    ['Borra lo seleccionado', 'delete-selection'],
    ['Elimina la selección', 'delete-selection'],
    ['Suprime esto', 'delete-selection'],
    ['Esborra el text', 'delete-selection'],
    ['Delete the selected text', 'delete-selection'],
    ['Erase it', 'delete-selection'],
    // Deleting wins over the other words of the sentence.
    ['Borra el texto del archivo', 'delete-selection'],
    // Not a delete command: nothing is deleted.
    ['Lee el borrador', 'play'],
    ['Abre un archivo', 'read-file'],
    ['Selecciona el texto', null],
  ]
  for (const [text, want] of cases) assert.equal(voiceAction(text), want, text)
})
