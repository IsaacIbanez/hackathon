import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PdfPageReader, PREPARING_AFTER_MS, pdfKeyAction, type PdfPageData } from '../pdfReader.ts'
import type { ReaderVoice } from '../reader.ts'

class FakeVoice implements ReaderVoice {
  said: string[] = []
  rates: number[] = []
  private events: { onEnd(): void; onInterrupt(): void } | null = null
  say(text: string, _lang: string, events: { onEnd(): void; onInterrupt(): void }, opts?: { rate?: number }) {
    this.said.push(text)
    this.rates.push(opts?.rate ?? 1)
    this.events = events
  }
  cancel() {
    const e = this.events
    this.events = null
    e?.onInterrupt()
  }
  end() {
    const e = this.events
    this.events = null
    e?.onEnd()
  }
  interrupt() {
    const e = this.events
    this.events = null
    e?.onInterrupt()
  }
}

const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.02 }
const page = (n: number, texts: string[], confidence = 0.95): PdfPageData => ({
  page: n,
  ocr: false,
  image: `img${n}`,
  lines: texts.map((text, i) => ({ id: `p${n + 1}-l${i + 1}`, text, box: { ...box, y: 0.1 * (i + 1) }, confidence })),
})

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(pages: PdfPageData[], opts: { delay?: (n: number) => number; fail?: number } = {}) {
  const voice = new FakeVoice()
  const asked: number[] = []
  const loader = (n: number) => {
    asked.push(n)
    if (n === opts.fail) return Promise.reject(new Error('reading service: HTTP 500'))
    const ms = opts.delay?.(n) ?? 0
    return new Promise<PdfPageData>((resolve) => setTimeout(() => resolve(pages[n]), ms))
  }
  const reader = new PdfPageReader(voice, loader, pages.length, 'es-ES')
  return { voice, reader, asked }
}

const doc = [page(0, ['Carta de renovación', 'Vence el 31 de diciembre']), page(1, ['Importe: 284,60 euros']), page(2, ['Atentamente'])]

/** Ends the current utterance and lets the next page load. */
async function endAndFlush(voice: FakeVoice) {
  voice.end()
  await flush()
  await flush()
}

test('show() loads the first page without speaking; play reads the whole PDF page by page', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  assert.equal(reader.state.data?.page, 0)
  assert.deepEqual(voice.said, [])
  reader.play()
  for (let i = 0; i < 7; i++) await endAndFlush(voice)
  assert.deepEqual(voice.said, [
    'Página 1 de 3.',
    'Carta de renovación',
    'Vence el 31 de diciembre',
    'Página 2 de 3.',
    'Importe: 284,60 euros',
    'Página 3 de 3.',
    'Atentamente',
    'Fin del documento.',
  ])
  assert.equal(reader.state.status, 'finished')
})

test('the next page is asked for while the current one sounds', async () => {
  const { voice, reader, asked } = setup(doc)
  await reader.show()
  assert.deepEqual(asked, [0, 1])
  reader.play()
  await endAndFlush(voice) // page announcement
  await endAndFlush(voice)
  await endAndFlush(voice) // → page 2, already loaded
  assert.deepEqual(asked, [0, 1, 2])
})

test('a slow page is announced as being prepared', async () => {
  const { voice, reader } = setup(doc, { delay: (n) => (n === 1 ? PREPARING_AFTER_MS + 200 : 0) })
  await reader.show()
  reader.play()
  voice.end()
  voice.end()
  voice.end() // end of page 1: page 2 is still loading (prefetch started earlier, but slow)
  await new Promise((r) => setTimeout(r, PREPARING_AFTER_MS + 50))
  assert.equal(reader.state.status, 'loading')
  assert.equal(reader.state.preparing, 1)
  assert.equal(voice.said.at(-1), 'Preparando la página 2.')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(voice.said.at(-1), 'Página 2 de 3.')
  assert.equal(reader.state.preparing, null)
})

test('a slow first page is shown as being prepared, without speaking', async () => {
  const { voice, reader } = setup(doc, { delay: (n) => (n === 0 ? PREPARING_AFTER_MS + 200 : 0) })
  const shown = reader.show()
  await new Promise((r) => setTimeout(r, PREPARING_AFTER_MS + 50))
  assert.equal(reader.state.preparing, 0)
  assert.deepEqual(voice.said, [])
  await shown
  assert.equal(reader.state.preparing, null)
  assert.equal(reader.state.data?.page, 0)
})

test('pause keeps the place, play resumes the same line; another voice pauses it', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  reader.play()
  voice.end()
  reader.pause()
  assert.equal(reader.state.status, 'paused')
  assert.equal(reader.state.line, 0)
  reader.toggle()
  assert.equal(voice.said.at(-1), 'Carta de renovación')
  voice.interrupt()
  assert.equal(reader.state.status, 'paused')
})

test('lines: next and previous cross pages', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  reader.play()
  voice.end()
  reader.next() // line 2 of page 1
  assert.equal(voice.said.at(-1), 'Vence el 31 de diciembre')
  reader.next() // → page 2
  await flush()
  await flush()
  assert.equal(reader.state.page, 1)
  assert.equal(voice.said.at(-1), 'Página 2 de 3.')
  reader.previous() // line -1 → previous page, its last line
  await flush()
  await flush()
  assert.equal(reader.state.page, 0)
  assert.equal(voice.said.at(-1), 'Vence el 31 de diciembre')
})

test('pages: next, previous and go to a page', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  await reader.goToPage(2)
  assert.equal(voice.said.at(-1), 'Página 3 de 3.')
  reader.previousPage()
  await flush()
  assert.equal(reader.state.page, 1)
  reader.nextPage()
  await flush()
  reader.nextPage() // past the last page: the end
  assert.equal(reader.state.status, 'finished')
  await reader.goToPage(7) // out of range: nothing
  assert.equal(reader.state.page, 2)
})

test('stop goes back to the first page without speaking', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  await reader.goToPage(2)
  const said = voice.said.length
  reader.stop()
  await flush()
  assert.equal(reader.state.status, 'idle')
  assert.equal(reader.state.page, 0)
  assert.equal(reader.state.line, -1)
  assert.equal(voice.said.length, said)
})

test('speed goes from 0.75 to 1.5 and restarts the current line at once', async () => {
  const { voice, reader } = setup(doc)
  await reader.show()
  reader.play()
  voice.end()
  reader.faster()
  assert.equal(reader.state.rate, 1.25)
  assert.equal(voice.said.at(-1), 'Carta de renovación')
  assert.equal(voice.rates.at(-1), 1.25)
  reader.faster()
  reader.faster()
  assert.equal(reader.state.rate, 1.5)
  for (let i = 0; i < 5; i++) reader.slower()
  assert.equal(reader.state.rate, 0.75)
})

test('empty pages and unclear lines are said; a failed page is reported', async () => {
  const pages = [page(0, []), page(1, ['Ilegible'], 0.3)]
  const { voice, reader } = setup(pages)
  await reader.show()
  reader.play()
  assert.equal(voice.said.at(-1), 'La página 1 no tiene texto.')
  await endAndFlush(voice)
  await endAndFlush(voice)
  assert.equal(voice.said.at(-1), 'No se lee bien: Ilegible')

  const broken = setup(doc, { fail: 1 })
  await broken.reader.show()
  await broken.reader.goToPage(1)
  assert.equal(broken.reader.state.status, 'error')
  assert.equal(broken.voice.said.at(-1), 'No he podido leer la página 2.')
})

test('one page: no page announcement', async () => {
  const { voice, reader } = setup([page(0, ['Solo una línea'])])
  await reader.show()
  reader.play()
  assert.equal(voice.said[0], 'Solo una línea')
})

test('keys', () => {
  assert.equal(pdfKeyAction('Space'), 'toggle')
  assert.equal(pdfKeyAction('KeyX'), 'stop')
  assert.equal(pdfKeyAction('KeyS'), null)
  assert.equal(pdfKeyAction('PageDown'), 'nextPage')
  assert.equal(pdfKeyAction('PageUp'), 'previousPage')
  assert.equal(pdfKeyAction('KeyG'), 'goToPage')
  assert.equal(pdfKeyAction('NumpadAdd'), 'faster')
  assert.equal(pdfKeyAction('BracketRight', '+'), 'faster') // Spanish layout: + is not on Equal
  assert.equal(pdfKeyAction('Slash', '-'), 'slower')
  assert.equal(pdfKeyAction('KeyQ'), null)
})
