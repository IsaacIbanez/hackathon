# Scanner handover (role B): from the camera to a PDF and to the app

A document for whoever integrates the general code. It explains what `scanner/` does, how it is installed and used,
how it connects to the app (Go/Wails), how much it costs and how long it takes, which decisions were made (with measurements) and
what remains pending. Authors: Pau (capture, P4) and Didac (PDF and digital document, P2). Date: 2026-11-21.

Didac's code (`scan.py`, `scanner/pdf`, `demo_app`) is in English (the «Language» rule of `AGENTS.md`);
`capturar.py` is Pau's and its identifiers are still in Spanish, so its names (`CamaraViva`, `ErrorCaptura`…) appear as they are.

---

## 1. What it does, in one sentence
A person holds a paper document in front of the **MX Brio**; the scanner photographs it at 4K,
crops, straightens, rotates and cleans it, **reads it (local OCR)** and delivers three things:

| Output | What for | Cost |
|--------|----------|-------|
| **Searchable scanned PDF** (`<name>.pdf`) | A faithful copy of the paper with selectable, searchable text | $0 (local) |
| **Digital PDF** (`<name>-digital.pdf`, optional) | The document rebuilt "as on the computer": real text, signature and logos as images | ~$0.002 per page (Haiku) |
| The contract's **`document` message** | What the app needs to explain, highlight and answer | $0 (local) |

## 2. Pieces and flow
```
 MX Brio ──► capturar.py (Pau)  ──4K PNG──►  scanner_pdf.convert() (Didac)  ──►  scanned PDF + document
             · picks the camera              · detects and crops the page       └─► (optional) digital PDF
             · waits for focus               · perspective, rotation, light, enhancement   with a vision model
             · the sharpest frame            · local OCR (Tesseract)
                    ▲                                     │
                    └────────── scan.py (connector) ──────┴──► POST /message ──► Go app (127.0.0.1:8765)
                                                                                 explains, highlights, voice
```

| Path | Owner | What it is |
|------|-------|--------|
| `scanner/capturar.py` | Pau | MX Brio capture: single (≈2.7 s) or server mode with the camera open (≈0.4 s/capture, port 8766). See `scanner/README.md`. |
| `scanner/scan.py` | Didac | **Connector**: capture → PDF → (optional) send to the app. It is what has to be called from outside. |
| `scanner/service.py` | Didac | **Reading service** (T13): `POST /scan` on 8770, photo → `document` + `pageCorners` (§5.1). Go calls it. Also `POST /document`: a file from the PC (PDF with or without text, PNG, JPEG) → its lines (`documents.py`, the overlay's «Read a file» option, `docs/OVERLAY.md`). And, for the viewer that reads a whole PDF (N4), `POST /pdf` plus `GET /pdf/<id>/page/<n>/lines` and `.jpg`: the PDF page by page, without a limit (`pdf_pages.py`). |
| `scanner/pdf/` | Didac | The `scanner_pdf` package (PNG → PDF). Technical reference: `scanner/pdf/README.md`. |
| `scanner/demo_app/` | Didac | **Provisional**: a browser app (localhost:8780) for testing. Not part of the product. |
| `scanner/capturas/`, `scanner/pdf/output/` | — | Local results (in `.gitignore`: they are real documents). |

## 3. Installation (once per computer)
```
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1     # Windows
bash scanner/pdf/scripts/install.sh                                          # Linux / macOS
```
- Creates `scanner/pdf/.venv` (Python 3.10+; tested with 3.14) with everything: *headless* OpenCV, img2pdf,
  pikepdf, pdfminer, pytesseract, ReportLab.
- Installs **Tesseract 5** with Spanish, Catalan and English (on Windows, the languages go to
  `scanner/pdf/tessdata/`, without touching `Program Files`) and, on Windows, **ffmpeg** (`capturar.py` uses it
  to learn each camera's name).
- Ends by running the tests.
- **Digital PDF with a model** (optional): the OpenRouter key in the environment (`OPENROUTER_API_KEY`) or in
  `scanner/.env` (it is in `.gitignore`; the key is passed by chat, **never** through git):
  `OPENROUTER_API_KEY=sk-or-v1-...`. The models are changed with `LLM_CHEAP_MODEL` and `LLM_EXPENSIVE_MODEL`
  (the same names as `backend/llm`).

## 4. How to use it

### 4.1 Command line (the simplest way to integrate)
```
scanner\pdf\.venv\Scripts\python scanner\scan.py [options]
```
| Option | What it does |
|--------|----------|
| *(none)* | Captures with the MX Brio (or whichever camera there is if it is not there) → scanned PDF |
| `--camera 0` / `--camera acer` | A specific camera (index or part of the name) |
| `--png photo.png` | No camera: converts an already captured PNG |
| `--digital` | Also the digital PDF (with the model if there is a key; otherwise, local) |
| `--send` | Sends the `document` to the app (`POST http://127.0.0.1:8765/message`; another URL with `LAUZHACK_MESSAGE_URL`) |
| `--json` | Prints the full result as JSON (to read it from another process) |
| `--mode gray\|bw`, `--languages spa+cat+eng`, `--focus-wait 1.4`, `--output folder` | Settings |

Exit code: `0` ok · `1` PDF error · `5` PDF generated but partial (e.g. without text) ·
`2/3/4` camera errors (`capturar.py`: not found / cannot open / no frame).

The package alone, without a camera: `python -m scanner_pdf photo.png -o output [--digital] [--json]` (see `scanner/pdf/README.md`).

### 4.2 From Python
```python
import sys; sys.path.insert(0, "scanner")
import capturar, scan
from scanner_pdf import Options

sr = scan.scan(options=Options(digital=True))             # single capture
# or, with the camera always open (≈0.4 s per capture):
live = capturar.CamaraViva(capturar.elegir_camara(capturar.listar_camaras(), None), 3840, 2160, 1.4)
sr = scan.scan_live(live, options=Options())              # ...and when done: live.cerrar()

r = sr.result                         # None if the camera failed (see sr.capture_error)
r.status, r.pdf, r.digital_pdf, r.warnings
scan.send_to_app(r)                   # POST /message -> True if the app accepted it (202)
```
Without a camera: `scan.convert_png(Path("photo.png"))` or `scanner_pdf.convert(png, folder, Options())`.
None of these functions raises exceptions for expected errors: the error goes in the result.

### 4.3 `Options` (all have a default value)
| Field | Default | What it does |
|-------|---------|----------|
| `languages` | `"spa+cat+eng"` | Tesseract languages |
| `mode` | `"color"` | `color`, `gray` or `bw` (black and white: only if asked for, it is destructive) |
| `crop` / `corners` | `True` / `None` | Detect the page / manual crop with 4 points in px of the original |
| `lighting` / `enhance` | `True` / `True` | Even out the light and give a scanner look (only on light paper) |
| `orient` | `True` | Rotate 90/180/270 if needed |
| `paper_size` | `"auto"` | `auto` (A4/Letter/A5/Legal if it matches), `image`, or a fixed paper |
| `fov_diagonal` | `78` | The camera's field of view (degrees) for the proportion in perspective |
| `dpi` | `None` | Forces the DPI when it does not fit a standard paper |
| `digital` / `digital_ai` | `False` / `True` | Digital PDF / use the vision model if there is a key |
| `image_format` / `jpeg_quality` | `"png"` / `92` | `png` (lossless) or `jpeg` (lighter) |
| `block_level` | `"line"` | Blocks of the `document` per line (`line`) or per paragraph (`paragraph`) |
| `ocr` | `True` | OCR text layer |
| `save_intermediates` | `True` | Save the page, base PDF, detection, layout |
| `title` | `None` | The PDF's title (by default, the name) |

### 4.4 `Result` (and `result.json` in the output folder)
| Field | Contents |
|-------|-----------|
| `status` | `ok` · `partial` (there is a PDF but without text or it does not validate) · `error` |
| `pdf`, `digital_pdf`, `folder` | Paths |
| `warnings`, `error` | See §7 (`error` = `{"code", "message"}`) |
| `page` | `width_px`, `height_px`, `dpi`, `paper`, `size_mm`, `rotation_degrees`, `lighting_corrected`, `enhancement` |
| `quality` | `score` 0-1, `issues` (`FrameIssue` vocabulary), `measures` |
| `ocr` | `engine`, `psm`, `passes`, `words`, `mean_confidence`, `blocks` |
| `digital` | `method` (`model`/`local_ocr`), `model_calls` with **cost and tokens**, `ai_cost_usd`, `ocr_agreement`, `to_review` |
| `validation` | pages, size, full-resolution image, extractable text, alignment, PSNR |
| `timings_ms` | per stage |
| `document()` | **payload of the contract's `document` message** |

## 5. Integration with the app (for the general code)
Agreed in `AGENTS.md` and documented by Isaac in `docs/INTEGRACION_SCANNER.md`: the scanner is a
**separate Python process** that sends `document` to the app with **`POST /message`** to `127.0.0.1:8765`.
The contract does not change. It is already implemented: `scan.send_to_app()` and the `--send` option.

**The message** (already validated by Isaac against the contract):
- `blocks`: one block **per line**, box **normalised to [0, 1] over the cropped page** (origin at the
  top left), `confidence` in [0, 1], stable ids `b1`, `b2`…
- `quality`: `score` in [0, 1] and `issues` from `blurry`, `dark`, `glare`, `cropped`, `tilted`, `too_far`
  (if `score` < 0.5 the app does not spend AI and gives framing advice).
- `imageWidth`, `imageHeight`; `lang` if a single language was asked for.

### 5.1 Reading service `POST /scan` (T13, current plan)
With the single-camera plan (`AGENTS.md`, «Current plan»), the app takes the photo and Go passes it to the
**reading service**, which answers with the `document`:
```
scanner\pdf\.venv\Scripts\python scanner\service.py                 # 127.0.0.1:8770 (--port or SCANNER_SERVICE_PORT)
curl --data-binary @photo.png http://127.0.0.1:8770/scan
```
| Request / response | Details |
|---|---|
| `POST /scan` | Body: the photo, PNG or JPEG (the type is recognised from the bytes). Optional query: `languages=spa+cat+eng`, `digital=1` |
| `200` | `DocumentPayload` (`blocks`, `quality`, `imageWidth`, `imageHeight`, `lang`) + **`pageCorners`**. Headers `X-Scan-Pdf` (path of the searchable PDF), `X-Scan-Digital-Pdf` and `X-Scan-Ms` |
| `422` | `{"error": "page_not_detected", "message", "quality"}`: there is no reliable page. It answers in ≈ 0.2 s (no OCR); `quality.issues` says why if it can (`blurry`, `dark`, `glare`…) |
| `400` / `413` / `503` / `500` | Invalid photo (`input_*`) / more than 40 MB / Tesseract missing (`ocr_unavailable`) / internal error |
| `GET /health` | `{"ok": true, "tesseract": "5.x", "busy": false}` |

**`pageCorners`** (proposal for contract 0.5; Isaac defines it in T11): `[{x, y}, {x, y}, {x, y}, {x, y}]`,
normalised to [0, 1] over the **received photo**, in the order **top-left, top-right,
bottom-right and bottom-left of the document** (not of the photo): if the page was rotated, the order rotates with
it, so corner 0 is always where the first line starts. The homography from the unit square to
those 4 points takes any block `box` to the photo (finger pointer, boxes over the paper):
```js
// box in [0,1] over the page -> pixels of the photo (OpenCV.js / any 4-point homography)
H = getPerspectiveTransform([[0,0],[1,0],[1,1],[0,1]], pageCorners.map(p => [p.x*w, p.y*h]))
```
Measured with the real letter (4K, page rotated 90°): 200 in 8.0 s, 36 blocks, corners and the title projected
over its line in the photo. One request at a time (the OCR already uses the CPU in parallel); the others wait.
`scan.py --send` also sends `pageCorners` already (Go ignores the fields it does not know yet).

**Other ways to call it** (from simplest to most integrated):
1. **One process per scan**: the app launches `python scanner/scan.py --send --json` when the user asks
   to scan, and reads the JSON from the standard output (PDF paths, warnings). The explanation reaches the
   interface through the `POST /message`. It takes ≈ 2.7 s of capture + ≈ 8 s of PDF on a 4K letter.
2. **Camera always open**: a Python process with `CamaraViva` + `scan_live()` (like
   `scanner/demo_app/server.py` does) for captures in ≈ 0.4 s. A command has to be exposed to it (local HTTP).
3. **Only the PDF**: if the image comes from somewhere else (e.g. the browser), `scan.py --png photo.png`.

**To be decided as a team** (it does not depend on the scanner):
- **What triggers the scan** in the demo: a button in the app, a key, a gesture (it would need a new message in the
  contract) or automatic when the page is still.
- **Single camera**: if the scanner uses the MX Brio, the gestures (browser) cannot open it at the same time.
- The cost of the **digital PDF** (OpenRouter from Python) **does not show up in the app's meter** (`stats`):
  it goes in `result.digital["ai_cost_usd"]`. If it is wanted on screen, it has to be passed to Go.

## 6. How it works inside
### 6.1 Capture (Pau, `capturar.py`)
4K MJPG (3840×2160; the settings are passed when opening the camera, otherwise it stays in YUY2 at ~5 fps), waits for
the MX Brio's autofocus to readjust (≈1.1–1.25 s) and saves the **sharpest** frame (variance of the
Laplacian), a lossless PNG + JSON with metadata. Without an MX Brio, `scan.py` uses the first real camera.

### 6.2 Scanned PDF (`scanner_pdf.convert`)
1. **Input** (`input_image.py`): validates the PNG; the original is always kept, byte for byte.
2. **Page** (`geometry.py`): three sources of candidates (contours, threshold, long Hough lines —it copes with
   fingers over the edge—) and filters measured with real captures: edge support, contrast **across
   each side** (it tells the paper's edge apart from a row of text), letter-shaped content (it discards the
   empty table), angles, aspect ratio, at most one side on the frame. The largest of the reliable ones wins. If there
   is no reliable one it **does not crop** (`page_not_detected` warning): better the whole photo than a wrong crop.
3. **Perspective**: corners refined at full resolution (< 1 px of error in tests), the real proportion
   with Zhang and He's camera model, fit to A4/Letter/A5/Legal if it matches (±3.5 %).
4. **Light and enhancement** (`image.py`, only light paper): the paper's white normalised locally (no light patches
   or camera compression blotches), ink to almost black, no colour casts, soft sharpening. Dark
   posters or scene photos are not touched (before, it left them washed out).
5. **Orientation** (`ocr.py`): Tesseract's OSD over the area with the most letters at native resolution (8-15
   confidence in ≈0.5 s) and, if in doubt, each orientation is read. 12/12 on real captures (a portrait page in
   landscape, letters and posters upside down).
6. **OCR**: Tesseract psm 3 and psm 6 **in parallel** (6 rescues letters with non-straight lines: 205 → 282
   reliable words) and psm 11 only if it barely reads (posters, screens: from 0 to reading the text). A single
   read gives the invisible layer and the words with box and confidence.
7. **PDF** (`pdf.py`): image **without re-encoding** (lossless PNG, PSNR 99 dB) at the exact physical size +
   the text layer overlaid at the exact scale + **validation** (extractable text, alignment, fidelity).

### 6.3 Digital PDF (`Options(digital=True)`, `vision.py` + `digital.py`)
- **With a model** (by default if there is a key): Haiku 5.5 through OpenRouter transcribes the page by blocks in
  reading order (exact lines in their original language, alignment, bold; signatures/logos/stamps/photos/QR
  as images). The call starts **in parallel with the local OCR**. Then:
  - each block is placed with the OCR words that match its text (precise geometry);
  - uniform typography: body size deduced from the **width** of the justified paragraphs (the height of the
    letters comes out inflated in blurry photos), titles only larger (bold or centred), a common line spacing;
  - **images as images**: the rectangle with its light strokes and its colour, without the neighbouring text;
  - a vertical flow in reading order: uniform gaps between paragraphs, large jumps respected,
    nothing overlaps;
  - **check**: agreement with the local OCR; if it is < 60 % or the JSON fails, it is repeated with Sonnet 5.5.
- **Without a key or without a connection**: a rebuild with the local OCR only (worse on imperfect photos) and the
  `digital_ai_unavailable:<code>` warning. If the model fails, **the scanned PDF is not affected**.
- Only on **light paper**: on posters or coloured cards it is not created (`digital_not_applicable` warning).
- **Privacy**: with the model, the page's image goes out to OpenRouter. With real documents with
  personal data, consider `digital_ai=False`.

## 7. Warnings and errors
**Warnings** (`result.warnings`; the PDF is generated anyway):
| Warning | Meaning |
|-------|-------------|
| `page_not_detected` | The page was not found with certainty: the whole image is used |
| `ocr_no_text`, `ocr_sparse_text`, `ocr_low_coverage` | No text / read in sparse mode / letters were left unread |
| `no_ocr_layer:<code>` | No Tesseract or it failed: an image-only PDF (status `partial`) |
| `language_not_installed:<language>` | That language is ignored |
| `validation_failed` | The PDF did not pass some check (see `result.validation`) |
| `digital_no_text`, `digital_not_applicable` | Digital PDF not created: no text / background not light |
| `digital_ai_unavailable:<code>` | No model (`ai_no_key`, `ai_no_connection`, `ai_failed`, `ai_invalid_response`): the local OCR was used |

**Errors** (`result.error["code"]`, status `error`): `input_not_found`, `input_not_png`,
`input_unreadable`, `input_too_small`, `input_too_large`, `input_unsupported_format`,
`options_invalid`, `ocr_unavailable`, `ocr_no_languages`, `ocr_timeout`, `ocr_failed`, `pdf_failed`,
`output_unavailable`, `internal`. Camera errors in `ScanResult.capture_error` (`{"code", "message"}`)
with `capturar.py`'s codes.

## 8. Costs and times (measured on 2026-11-21, a real A4 letter, MX Brio 4K, a 16-core Windows laptop)
| Step | Time | Cost |
|------|--------|-------|
| Single capture (open, focus, sharpest frame) | ≈ 2.7 s | $0 |
| Capture with the camera open (`CamaraViva`) | ≈ 0.4 s | $0 |
| Scanned PDF (the whole pipeline) | **≈ 8 s** (OCR 5.2 s, enhancement 1.1 s, rotation 0.6 s) | $0 |
| + digital PDF with the model (in parallel with the OCR) | **≈ 15-17.5 s in total** | **≈ $0.002** (Haiku) |
| If it escalates to Sonnet (low agreement) | +≈ 11 s | ≈ +$0.02 |

OpenRouter prices checked the same day: Haiku 5.5 $0.10/M input and $0.50/M output; Sonnet 5.5
$2/$10. With the team's $10, about 4,000 digital pages with Haiku. Scanning and sending to the app
are local ($0). After the code was translated (prompt in English) it was repeated with the real letter:
15.3 s, Haiku only, agreement with the OCR 0.992, $0.0018.

## 9. Quality and tests
- **Tests**: `scanner/pdf` 81 (`pytest`) and `scanner/` 29 (`unittest`, including those of `capturar.py` and the service), without
  a camera and **without a network** (the model is simulated). Synthetic images: no real document in the repository.
  ```
  cd scanner/pdf && .venv\Scripts\python -m pytest -q
  cd scanner && pdf\.venv\Scripts\python -m unittest discover -s .
  ```
- **With real captures** (21/11): an A4 letter on paper → a searchable scanned PDF with 378 words and a digital PDF
  with 343-344/344 words, the full signature and no overlaps; posters, cards and phone screens
  cropped right and with their colour; orientation 12/12.

## 10. History of changes and improvements (summary)
| Change | Why (measured) |
|--------|------------------|
| Tesseract directly instead of OCRmyPDF | The same text in half the time (1.06 s against 2.07 s) and it gives the contract's boxes with confidence |
| Detection with long lines, per-side contrast and content | With real captures the empty table, the scene or a piece of the poster was cropped |
| Light and enhancement only on light paper; paper normalised locally | Washed-out posters and mottled grey paper |
| A second psm 11 / psm 6 pass | Cards and screens: 0 words; photographed letters: whole paragraphs unread (128 → 378 words) |
| Orientation with OSD over the text area + a reading | A portrait page in landscape was not rotated (OSD of the whole page: confidence 0.3-0.6) |
| Validation with the embedded image (not a render) | The viewer's render shifts fractions of a pixel and gave false failures |
| Digital PDF with a vision model + the OCR's geometry | With the local OCR alone there were errors and overlaps on real photos |
| Typography by width, a reading-order flow, full images | Uneven sizes, irregular gaps, signatures cropped or out of place |
| OCR in parallel and the model in parallel with the OCR | Scan 10.5 → 8 s; with digital 24.6 → 17.5 s |
| Connector: `--send` (POST /message) and an available camera without the MX Brio | Integration agreed with Isaac and a team decision about the camera |
| Code translated into English (`escanear.py` → `scan.py`, `escaner_pdf` → `scanner_pdf`, `app_prueba` → `demo_app`) | The «Language» rule of `AGENTS.md`; the same tests and the same output |

## 11. Known limitations and capture tips
- **For it to come out well**: the **whole** page inside the frame, **flat**, at **30-40 cm** (closer the
  MX Brio does not focus) and, if the paper is white, on a **dark background**.
- A white page on a white table: the edge cannot be told apart and it is not cropped (the whole image is used).
  The test app lets you adjust the corners by hand (`Options.corners`).
- A **blurry** photo cannot be fixed afterwards: it can neither be read nor oriented.
- One page per call. Handwriting: the model transcribes it better than Tesseract, but it has not been measured.
- The digital PDF is a rebuild: the **scanned one is the faithful reference**. Words that the local OCR does not
  confirm: `result.digital["to_review"]`.

## 12. Pending
- `scanner/demo_app/` is provisional: decide whether it goes into `main` or is removed when merging.
- `capturar.py` (Pau) still has Spanish identifiers; if Pau renames them, the calls in `scan.py`
  and `demo_app/server.py` have to be updated (`elegir_camara`, `listar_camaras`, `capturar`, `guardar`, `CamaraViva`, `ErrorCaptura`).
- The OpenRouter key was shared by chat: **revoke it after the hackathon**.
- The team decisions of §5 (what triggers the scan, single camera, the digital PDF's cost in the meter).
