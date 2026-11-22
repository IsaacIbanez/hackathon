# scanner/pdf/ — the `scanner_pdf` package

Technical reference of the package. **To integrate it into the app, start with [`../ENTREGA.md`](../ENTREGA.md)**.
Owner: Didac (P2-C). Rules of the subproject: `../AGENTS.md`.

It receives the **PNG** of a page and produces:
- a **searchable scanned PDF**: the page with its real look (cropped, straightened, rotated, with the
  lighting evened out and dark text on white paper) + an invisible, aligned OCR text layer;
- optionally, a **digital PDF**: a blank page with the text truly written and the images
  (signature, logo, stamp) in place, as if the document had been made on the computer;
- the payload of the contract's **`document`** message (`api/openapi.yaml`), ready to send to the app.

## Installation
```
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1     # Windows
bash scanner/pdf/scripts/install.sh                                          # Linux / macOS
```
They create `scanner/pdf/.venv`, install Tesseract (+ spa, cat, eng) and, on Windows, ffmpeg; they end by running
the tests. A single environment for the whole of `scanner/` (*headless* OpenCV also captures from the camera).

## Usage
```
.venv\Scripts\python -m scanner_pdf capture.png -o output [--digital] [--json]
```
Options: `--mode gray|bw`, `--paper-size A4|Letter|image`, `--corners x1,y1,...,x4,y4` (manual crop),
`--no-crop`, `--no-lighting`, `--no-enhance`, `--no-orient`, `--no-ocr`, `--jpeg`, `--digital`.
Exit code: 0 ok · 2 PDF generated but partial (e.g. without OCR) · 1 error.

```python
from scanner_pdf import convert, Options
r = convert("capture.png", "output/", Options(digital=True))   # also accepts the PNG's bytes
r.status, r.pdf, r.digital_pdf, r.warnings, r.error, r.document()
```
`convert` does not raise exceptions for expected errors: it always returns a `Result`.

## Modules (`src/scanner_pdf/`)
| Module | What it does |
|--------|----------|
| `input_image.py` | Validates the PNG (signature, size, 8/16 bits, alpha over white, DPI) and keeps the original bytes. |
| `geometry.py` | Detects the page (contours, threshold and long Hough lines; filters for edge support, per-side contrast, content, angles, aspect ratio, frame), refines the corners, real proportion (Zhang and He), fit to A4/Letter/A5/Legal. If it is not sure, it does not crop. |
| `image.py` | Lighting and **document enhancement** only on light paper (locally normalised paper, ink to almost black, no colour casts, soft sharpening); color/gray/bw modes; quality with `FrameIssue`; letter mask. |
| `ocr.py` | Tesseract: orientation (OSD over the area with the most letters + a check reading), OCR with psm 3 and 6 passes **in parallel** (+ psm 11 if it barely reads), an invisible "sandwich" layer + words with box and confidence. |
| `pdf.py` | Image without re-encoding (img2pdf) at the exact physical size, exact overlay of the layer (pikepdf), validation. |
| `vision.py` | OpenRouter client (standard library): the page's layout with a vision model. |
| `digital.py` | Digital PDF: with the model's layout (`digitalize_layout`) or only with the local OCR (`digitalize`). ReportLab writes the text. |
| `pipeline.py` | `convert()`: joins everything, measures times, saves intermediates and `result.json`. |
| `errors.py` | `ScannerError(code, message)`: expected errors with a stable code. |

Details of each decision, measurements and costs: `../ENTREGA.md`.

## Tests
```
.venv\Scripts\python -m pytest -q          # 77 tests, ~37 s; no network (the vision model is simulated)
```
Synthetic images (`tests/synthetic.py`): no real document in the repository. The sample texts
imitate a form in Spanish and stay in Spanish (they test the Spanish OCR).
