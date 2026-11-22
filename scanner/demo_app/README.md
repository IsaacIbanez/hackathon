# demo_app/ — PROVISIONAL APP (for testing only)

**It is not part of the product.** It is used to test capture + PDF from the browser while the real
integration in the app (Wails) does not exist. This whole folder can be deleted without affecting anything:
it uses `scan.scan()`, `scan.scan_live()`, `scan.convert_png()` and `capturar.CamaraViva`
(for the preview it reads its last frame, an internal attribute: acceptable only here).

## Starting it
```
scanner\pdf\.venv\Scripts\python scanner\demo_app\server.py      # Windows
scanner/pdf/.venv/bin/python scanner/demo_app/server.py             # Linux/macOS
```
Open http://localhost:8780 (it only listens on 127.0.0.1; `--port` to change it, `--no-browser` to not
open the browser). It does not use 8765 (Wails app) or 8766 (`capturar.py --servidor`). Requirements: those of
`scanner/pdf` (`scanner/pdf/scripts/install.*`) and, on Windows, `ffmpeg` to see the cameras' names.

## What it allows
- Choosing a camera (by default the MX Brio if it is there), **Open camera** (it uses Pau's `capturar.CamaraViva`: the preview
  and the capture share the camera, ~0.4 s per capture) and **Scan**. With the camera closed it makes a single capture.
- **Live outline** over the preview (green = document detected) with framing hints:
  better on a dark background, the whole document and at 30–40 cm (closer, the camera does not focus).
- **Digital PDF** («Also create a digital PDF» checkbox): the document rebuilt with real text, and the list of
  words worth reviewing.
- **Send to the app**: sends the `document` to the Go app (`POST /message`, port 8765).
- **Adjust corners**: after scanning, drag the 4 corners over the capture and regenerate the PDF.
- Dragging an image in (PNG; also a phone JPG, which is converted to PNG only here).
- Viewing the PDF (try Ctrl+F and copying), the page with the boxes of the `document` message, the detection,
  the text with its confidence and the full JSON.

Captures in `scanner/capturas/` and PDFs in `scanner/pdf/output/`; both folders are in `.gitignore`.
The interface is in English (the «Language» rule of `AGENTS.md`); the keys that come from `capturar.py`
(`nitidez`, `resolucion_entregada`...) stay in Spanish because they are Pau's data format.
