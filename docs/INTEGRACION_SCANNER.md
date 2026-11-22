# Integrating the scanner (role B) with the app

How what the scanner reads (Python, `scanner/`) reaches the app's screen and voice.

## Summary
1. The app (or `task server` without a window) listens on `127.0.0.1:8765`.
2. The scanner, once it has a page read, makes a **`POST /message`** with a `document` message.
3. Go explains the document (cheap model; expensive if in doubt) and sends `speak` + `stats` to the **interface**, which reads it aloud and highlights the blocks.
4. From there on, pointing with the finger and asking by voice work on **that** document (the session is shared).

No library is needed: the standard library's `urllib` is enough.

## The `document` message
```json
{
  "type": "document",
  "id": "doc-<unique>",
  "ts": 1795262400000,
  "payload": {
    "blocks": [
      { "id": "b1", "text": "Nombre y apellidos: ______", "box": { "x": 0.08, "y": 0.18, "w": 0.6, "h": 0.04 }, "confidence": 0.92 }
    ],
    "quality": { "score": 0.85, "issues": [] },
    "imageWidth": 1240, "imageHeight": 1754, "lang": "es"
  }
}
```
- **Blocks:** better per **line** (not per word): the app reads a whole block when it is pointed at.
- **Boxes normalised** to [0, 1] over the **cropped page** (after correcting the perspective), origin at the top left: `x = left / width`, `y = top / height`, etc.
- **`confidence`** of the OCR in [0, 1] (Tesseract gives 0–100: divide by 100).
- **`quality.score`** in [0, 1] and **`issues`** from `blurry`, `dark`, `glare`, `cropped`, `tilted`, `too_far`. If `score` < 0.5, the app **does not spend AI**: it gives framing advice aloud («the image is blurry…»). Use the sharpness that `capturar.py` already measures.
- Block `id`s stable within the document (`b1`, `b2`…).

If a client listens to the WebSocket (not needed for the scanner, which uses `POST`), it will also receive the forwarded `document`: raise its message size limit (in Go, `conn.SetReadLimit(4 << 20)`; the browser has no limit).

## Example
`api/examples/send_message.py` has `document_from_ocr_lines(...)` (from OCR lines in pixels to the message) and `post(...)`:
```
task server                                              # terminal 1 (needs a .env with the key)
python api/examples/send_message.py --demo-ocr           # terminal 2: simulates the scanner
python api/examples/send_message.py my_document.json     # or a ready-made envelope
```
To see what the interface hears: `npm run dev` in `web/` with `VITE_WS_URL=ws://127.0.0.1:8765/ws`.

Tested on 2026-11-21: `--demo-ocr` → the interface hears «Este documento es una declaración de siniestro de AXA Seguros. Debe escribir su nombre y apellidos… También debe escribir su número de póliza…» (This document is an AXA Seguros insurance claim. You must write your full name… You must also write your policy number…), with the 3 blocks highlighted. Cost: $0 (`LLM_PROFILE=dev`).

## `scanner/scan.py` (Didac): sending done
Reviewed on the `feature/B-contexto-scanner` branch (2026-11-21): `Result.document()` **meets the contract** (blocks per line, boxes normalised over the cropped page, `confidence` in [0, 1], `issues` with the contract's values, `lang` in BCP-47). Sending is already implemented in `scan.send_to_app(result)` (POST /message, returns `True` with 202 and `False` if the app is not open) and in the CLI with `--send`:

```
scanner\pdf\.venv\Scripts\python scanner\scan.py --send                  # capture + PDF + send
scanner\pdf\.venv\Scripts\python scanner\scan.py --png capture.png --send
```

Names in English since 2026-11-21 (formerly `escanear.py`, `enviar_a_app`, `Resultado.documento()`, package `escaner_pdf`). Full details in `scanner/ENTREGA.md`. Notes:
- The app **does not spend AI** if `quality.score` < 0.5: it gives framing advice aloud. With your penalties, only «blurry» leaves 0.65 and does get explained; adjust it if you want «blurry» to cut off earlier.
- The envelope's `id` must be unique per scan; the block `id`s (`b1`, `b2`…) only have to be stable within the document.
- The digital document with the vision model (`vision.py`) spends from the same OpenRouter budget, but its cost does not show up in the app's meter; sending to the app only uses the local OCR ($0).
- To be decided as a team: **what triggers the scan** in the demo (a button or key in your app, an automatic scan when the page is still, or a gesture). If you want a gesture, a new message is needed in the contract: let us know.

## Reading service for the app (T13, Didac): what Go expects
Since contract 0.5, the app sends the photo to Go (`POST /scan`) and **Go passes it to your service**:

```
POST http://127.0.0.1:8770/scan        (Go reads it from SCANNER_URL)
Content-Type: image/jpeg | image/png | image/webp
<the photo's bytes, up to 40 MB>

200  application/json   → a DocumentPayload (what Result.document() gives) + pageCorners
422  {"error": "..."}   → there is no page in the photo (Go tells the user «I can't find the page…»)
other                    → error (Go says «I could not read the document»)
```

**`pageCorners`** (new, optional): the 4 corners of the page **in the received photo**, normalised to [0, 1] over that photo (`x / photo_width`, `y / photo_height`), in this order: **top-left, top-right, bottom-right, bottom-left of the page as it reads** (after orienting it). If you rotate the page 90° or 180° to read it, rotate the order of the corners too: the pointer uses them to know which part of the paper the finger points at. If the page was not detected (the whole photo was used), leave it out.

Example: `api/fixtures/document.json` (`"pageCorners": [{"x":0.31,"y":0.07}, {"x":0.70,"y":0.09}, {"x":0.72,"y":0.94}, {"x":0.29,"y":0.92}]`).

**How to test it end to end:** your service on 8770 + `task server` (or `task dev`) + `curl -X POST -H "Content-Type: image/png" --data-binary @photo.png http://127.0.0.1:8765/scan`. The interface hears «One moment, I'm reading the document», receives the document and explains it.

**While the service does not exist**, the rest of the team tests with `SCANNER_URL=fixture`: Go answers each photo with the sample form (with corners).

## Ports
| Port | Who | What for |
|---|---|---|
| 8765 | Go app (`task dev` / `task server`) | `/ws`, `POST /message`, `/health` |
| 8766 | `scanner/capturar.py --servidor` (Pau) | `GET /captura` |
| 8770 | reading service (Didac, T13) | `POST /scan`: photo → `document` with `pageCorners` |
| 8780 | `scanner/demo_app` (Didac, provisional) | preview and scan |
| 8080 | `task mock` | sample answers |

## To be decided (team)
Who uses the camera: if the scanner has the MX Brio, the gestures (browser) must use another camera (the laptop's). See `estado/P1-C.md`.
