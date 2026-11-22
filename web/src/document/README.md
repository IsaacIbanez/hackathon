# Guided reading (role B2, Didac)

Reads the scanned document aloud **line by line**, without anyone's help:
- The line being spoken is highlighted in large type and kept centred on the screen.
- Reading is **local and free**: it uses the system's voice (Web Speech API) and no model. It sends nothing to Go.

Brief: `docs/historial/briefs/didac.md`.

## Usage
```tsx
import { GuidedReader } from '../document'

<GuidedReader doc={doc} />
```
- `doc`: the current `DocumentPayload`. When a new one arrives, the reader goes back to the first line and does not speak until asked.
- `voice`: optional. If it is not passed, it uses the system's voice; without speech synthesis, it only moves the highlight.
- `autoPlay`: starts reading as soon as the document arrives (the overlay options use it). Off by default.
- `keyboard`: global shortcuts. On by default and ignored while typing in a field.

| Action | Keys | Button |
|---|---|---|
| Read / pause | Space · Num 5 | ▶ Read / ⏸ Pause |
| Previous | ← · Num 4 | ⏮ Previous |
| Next | → · Num 6 | Next ⏭ |
| Repeat | R · Num 8 | ↻ Repeat |

Also, clicking a line reads it and carries on from there. The numeric keypad keys are the ones the Logitech keypad will be able to send later on.

## Behaviour
- **Reading order:** top to bottom and left to right, just like `DocumentText`. Empty lines are skipped.
- **Doubtful lines** (`confidence` < 0.6): they are read anyway, preceded by «Unclear:», and marked with «(unclear)».
- **End:** when done, the reader says «End of the document.». Pressing «Read» again starts over from the beginning.
- **Another voice:** if the app speaks meanwhile (for example, Go's `speak` with the answer), the reader pauses on its line and does not speak at the same time. To carry on, press «Read».
- **Language:** the reader's phrases are in the document's language (`lang`: es, ca or en; in Spanish, for example, «No se lee bien:» and «Fin del documento.»). If there is no voice for that language, it uses the default voice and says so on screen.

## Test page (without Go)
From `web/`:
```
npx vite src/document --config vite.config.ts
```
Open http://localhost:5173/demo/. It loads the made-up letter from `scanner/pdf/samples/print/01-carta-renovacion.pdf`, read with the scanner's pipeline (20 lines). The checkbox turns line 11 into a doubtful one, to hear how it is announced.

Measured in Chrome with the Microsoft Helena voice (es-ES):
- each key changes line in under 20 ms;
- the letter is read all the way to «Fin del documento.»;
- an interrupting voice leaves the reader paused;
- reading it calls no model.

## PDF viewer: read the whole PDF (N4)
`PdfViewer` (`PdfViewer.tsx`) and its logic `PdfPageReader` (`pdfReader.ts`). Brief: `docs/briefs/N4.md`.

```tsx
<PdfViewer pdf={{ id, name, pages, lang }} loadPage={(n) => desktop().PDFPage(id, n)} />
```

**What it does:**
- **Pages:** shows each page of the PDF (the reading service provides the image) with a yellow box over the line being spoken. That same line appears below in very large type, like a subtitle.
- **«Read the whole PDF» button** (or Space): reads from start to end with the local voice, at $0. At the start of each page it says «Page N of M» and asks for the next page while the current one plays.
- **No page limit.**
  - If a scanned page is not ready yet (it goes through OCR), it says «Preparing page N».
  - Empty pages are announced.
  - Doubtful lines are preceded by «Unclear:».
- **Keys:**

  | Action | Keys |
  |---|---|
  | Read / pause | Space · Num 5 |
  | Previous / next line | ← → · Num 4 / Num 6 |
  | Repeat | R · Num 8 |
  | Stop (back to the start) | X |
  | Speed 0.75× to 1.5× | + / − · Num + / Num − |
  | Previous / next page | PgUp / PgDn |
  | Go to a page | G |

- **Language:** the phrases and the voice are in es, ca or en, depending on the language detected in the PDF.

## Files
| File | Contents |
|---|---|
| `reader.ts` | Pure logic, no interface: `LineReader`, the reading order, the shortcuts and the phrases |
| `voice.ts` | The system's voice (`webSpeechVoice`) and the alternative without speech synthesis (`silentVoice`) |
| `GuidedReader.tsx` | The view |
| `pdfReader.ts` | Pure logic of the PDF viewer (`PdfPageReader`): pages, controls, notices and keys |
| `PdfViewer.tsx` | The PDF viewer |
| `demo/` | The test page |
| `test/` | The tests (`npm test`) |

## Mounting it in the app (for Isaac, `web/src/app/App.tsx`)
```diff
+import { GuidedReader } from '../document'
 ...
         <section aria-label="Document view" className="rounded-2xl border border-slate-700 p-6">
-          <DocumentText doc={doc} highlight={last?.highlightBlockIds ?? []} values={values} draft={draft} />
+          <GuidedReader doc={doc} />
         </section>
```
If `DocumentText` is kept for form dictation (`values` and `draft`), the two views can coexist, for example with a «Read» tab and a «Fill in» one. That decision is Isaac's.
