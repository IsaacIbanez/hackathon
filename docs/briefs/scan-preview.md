# Brief: PDF Scanner with a PDF preview (Didac)
Confirmed by Didac on 2026-11-22. Branch `feature/didac-scan-preview`.

## Status (2026-11-22)
**⚠ It does not work well yet.** The code is in `main` (tests green), but the scan is still not like the first version we made: a searchable PDF and a digital PDF from the photo. The new preview **has not been tested with the camera in the `.exe`**. Pending:
- test it end to end with the `.exe` and the camera (first close any old `scanner/service.py` on port 8770, or the app reuses it and does not find the new routes);
- bring it back to how the first version was.

## Goal
That PDF Scanner's result is **the PDF** again: after the photo, the app shows the preview of the generated PDF and a button to read it aloud. Today it skips the PDF and reads the text aloud right after scanning (`GuidedReader` with `autoPlay` in `DocumentsMode.tsx`).

## Current status (read in the repo)
- The reading service still makes the searchable PDF (`scan-….pdf`) in `scanner/pdf/output/<scan>/`. Since N3 it answers as soon as the OCR is done and finishes the PDFs in the background, so the app does not find out when they are ready.
- The digital PDF (paid vision model, ~$0.002 per page) is off by default since R3 (`SCANNER_DIGITAL=1` to turn it on).
- The N4 viewer (`web/src/document/PdfViewer.tsx`) already shows the page and reads the whole PDF with a button (it does not start on its own).

## What the demo will show
The person holds the paper, the voice guide tells them when it is still, the app takes the photo and says «Done». The PDF appears in the viewer; with **Space** or the button it reads it aloud. With **Make digital PDF** the digital version comes out, which can also be seen and read.

## Scope
- Reading service: an identifier per scan (`X-Scan-Id`), `GET /scan/<id>/pdf?kind=searchable|digital` (waits until the PDF is ready and opens it like N4's) and `POST /scan/<id>/digital` (makes the digital PDF only when asked).
- Go: the client (`backend/scanner`) and three new bindings in their own file (`app_scanpdf.go`): `ScanPaper`, `ScanPDF` and `MakeDigitalPDF`.
- PDF Scanner (`DocumentsMode.tsx`): after the photo, it waits for the PDF and opens it in `PdfViewer`, with «Scanned PDF» / «Digital PDF» tabs and the «Make digital PDF» button. No automatic reading.
- The voice framing guide and the notices («one moment…», «I can't find the page») stay. When done it says: «Done. Press Space to listen to it».
- If there is no PDF (for example, with `SCANNER_URL=fixture`), the text is shown with the guided reader, without autoPlay.

## Out of scope
- Moving the Developer screen or Transcribe to Halo (R1, parked).
- Changing the contract (`api/`): the new routes belong to the reading service and to the bindings, not to the message contract.
- Turning the digital PDF back on by default.

## «Done» criteria
- [ ] Scanning a paper with the `.exe` shows the PDF in the viewer and the content is not spoken until Space or the button is pressed.
- [ ] «Make digital PDF» generates the digital one and it can be seen and read in its tab.
- [ ] Service tests (`scanner/test_service*.py`) and `task check` green.

## Folders it touches
- Own: `scanner/service.py`, its tests, `docs/briefs/scan-preview.md`.
- Isaac's (noted in the PR): `backend/scanner/` (client), `app_scanpdf.go` (new file in the root), `web/src/app/overlay/DocumentsMode.tsx` and `desktop.ts`.

## Risks
- The digital PDF with the model takes ~15-30 s and costs money: only with the button, and the notice says so.
- Waiting for the PDF adds ~1 s after the OCR (the text layer and the validation).
