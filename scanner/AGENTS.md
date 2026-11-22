# scanner/ — document reading (Python)

General context: `AGENTS.md` and `docs/ESTADO.md` in the root. Owner: **Didac** (pipeline and service); **Pau**'s: `capturar.py` and `benchmark/`. Technical details: `scanner/README.md`, `scanner/pdf/README.md` and `scanner/ENTREGA.md`.

## What it does
Photo (or file) → detects the page → straightens and orients it → improves the lighting → local OCR with Tesseract (Spanish, Catalan, English) → the contract's `document` (lines with a box, `pageCorners`) and a searchable PDF.

| Piece | What it is |
|---|---|
| `service.py` | **Reading service** on 127.0.0.1:8770: `POST /scan` (photo → `document`), `POST /document` (PC file → lines), `GET /health`. Go calls it (`backend/scanner`) |
| `pdf/src/scanner_pdf/` | The pipeline (`convert`): `geometry.py` (page), `ocr.py` (orientation and OCR), `image.py`, `pdf.py`, `digital.py` and `vision.py` (digital PDF with AI) |
| `documents.py` | Reading files (PDF with or without text, images) |
| `capturar.py` | MX Brio capture at 4K (Pau) |
| `benchmark/` | Measuring the scan with real photos, before and after each change (Pau) |
| `scan.py`, `demo_app/` | Command-line connector and test app (8780), off the demo route |

## Agreed behaviour (do not change without telling the team)
- **It answers as soon as the `document` is ready**; the searchable PDF and the digital one are finished in the background (`X-Scan-Folder` header).
- **422 «no sheet found»** only if there is no page **and** no text on paper; with text and without a page, a `document` without `pageCorners`.
- **Digital PDF with AI, off** by default (it is paid): `?digital=1` or `SCANNER_DIGITAL=1`.
- Everything else is **local and free**. The photos and the results are real documents: **never into the repository** (`capturas/`, `pdf/output/`, `benchmark/results/` are ignored).

## Install and test
```powershell
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1   # .venv, Tesseract and languages (once)
scanner\pdf\.venv\Scripts\python -m pip install pypdfium2              # not in requirements.txt yet
cd scanner\pdf; .venv\Scripts\python -m pytest -q                       # pipeline
cd scanner;     pdf\.venv\Scripts\python -m unittest test_service test_scan test_capturar
scanner\pdf\.venv\Scripts\python scanner\service.py                     # the service, by hand
```
If you change the detection, the orientation or the OCR, **measure it** with `benchmark/` (the same photos before and after) and write it down in `docs/medidas/`.

## Rules of this directory
- Small, local changes; do not touch Go or the web from here (if another interface is needed, ask its owner).
- No repo-wide searches: read the files of this folder that you need.
- Paid models only when the user turns them on.
