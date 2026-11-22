# Project status: where we are and where we are going

Last update: **2026-11-22** (Pau). **Keep it up to date:** if you close a fix or change something that affects everyone, change its line here. The details go in the sheet, not here.

## The app today
The **overlay** (`task overlay` → `build/bin/lauzhack.exe`): Ctrl+Alt+Space or keypad key 1 dims the screen and shows the tools.

| Tool | What it does | Status |
|---|---|---|
| **Gesture Control** (centre, key 8) | Hand gestures → PC and video-call actions; fist menu, volume and brightness with the pinch; camera bubble | In Halo and safe (power actions disabled, pinch without jumps). Checked by Pau with the `.exe` and the hand |
| **PDF Scanner** (key 2) | Paper in front of the camera → photo **only on «Take photo»** (or Enter; in cursor mode, with the hand) → OCR → **always two PDFs**: the scanned one (the photo, with searchable text) and the **AI version** (the document rebuilt by the vision model, ~30 s more and ~$0.03). They are shown in the viewer, which only reads when you press Space | Fixed on 2026-11-22: without `scanner\pdf\.venv` or with an old service on 8770, the screen now says what to do; `scanner\pdf\scripts\install.ps1` must be run once per machine |
| **Read Text** (key 5) | Opens a PDF, an image or a text file and reads it line by line | Tested |
| **PDF viewer** | Reads the whole PDF aloud, page by page (N4) | Done; some parts still in the old style (R1) |
| **AI Summary** (key 7) | Summarises the text selected in any program, in a bubble next to the cursor | Tested (cheap model) |
| **Transcribe** | Live captions of the mic or a call: who is speaking, language, barbarisms in quotes, translation, `.txt` | In `main` (`GET /captions`, Together AI). Without a valid key it says so once and stops retrying (tested with the `.exe`); **still to test with the real key** |
| **MX Keypad** | Keys 1–9 → actions (`docs/KEYPAD.md`) | Done; keys remapped by Isaac (`docs/KEYPAD.md`); **the voice command (key 7) with a mic is still to test** (R4) |

## Now: polishing for the demo
Split in **`docs/demo/README.md`**: Nil (gestures), Pau (reading paper and Transcribe) and Isaac (startup, overlay, voice and integration). Each sheet has what to review, the known bugs and a prompt for its agent. **`TOGETHER_API_KEY` is missing** from the demo laptop's `.env`: without it, Transcribe does not work.

**Language:** since 2026-11-22 everything in the repo (code and docs) is in English; the team still talks in Spanish (`AGENTS.md`).

## Fix phase (comes before any new feature)
| ID | Fix | Person | Status |
|---|---|---|---|
| R1 | A single interface (Halo) on every screen | Didac | Gesture Control already in Halo. **Missing:** the Developer screen (`App.tsx`, `DocumentText.tsx`, `Cost.tsx`) and the PDF viewer (`PdfViewer.tsx`), or take them out of the demo route |
| R2 | Safe and stable Gesture Control | Nil | Power disabled and stable pinch, in `main`. **Missing:** 5 min of use with the `.exe` without unintended actions; sharing the camera with PDF Scanner |
| R3 | PDF Scanner end to end (and Transcribe) | Pau | Paid digital PDF **disabled** by default and Transcribe connected, in `main`. **Missing:** 5 scans in a row with the Brio from the `.exe`; voice warning if the service or Tesseract is missing |
| R5 | Window flow: the overlay rules and the gestures coexist (`docs/VENTANA.md`) | Pau | A single controller of the window's shape, tested with the `.exe` and the log. **Missing:** Pau testing it with the hand (fist menu, cursor mode, AI Summary) |
| R4 | Startup: visible version, install, keypad and voice | Isaac | Visible version and `task setup` in `main` (from PR #51). **Missing:** voice with a mic |

Sheets with their «Done when» and log: `docs/arreglos/R1.md` … `R4.md`.

## After the fixes (board `TAREAS.md`)
- **N5** cursor mode (partial) → **N6** select text with the cursor (partial) → **N7** summarise the whole document (missing; the selection already works) → **N8** show that it is efficient (pending).
- **N9** volume by voice (partial).
- Parked ideas: `docs/historial/ideas/`.

## For the demo
- Script: `docs/PITCH.md`. Smoke tests: `docs/COMO_PROBAR.md`.
- Needed: a `.env` with `OPENROUTER_API_KEY` (and `TOGETHER_API_KEY` for Transcribe); the scanner installed (`scanner\pdf\scripts\install.ps1`); the MX Brio and the MX Keypad connected.

## Current decisions (the why, in `docs/DECISIONES.md`)
- **Overlay design system** (`docs/DESIGN.md`): replaces Halo (in `docs/historial/`); every screen migrated, a single yellow accent. Gesture Control lives inside the app (a single executable).
- **Keypad** read over USB, without Options+; fallback shortcuts Ctrl+Alt+Shift+N.
- **Models:** `cheap` Haiku 5.5, `expensive` Sonnet 5.5 (OpenRouter); fallback transcription with Gemini Flash Lite; Transcribe with Together AI (Parakeet + Qwen3.5-9B). **Team budget: €10**; `LLM_PROFILE=dev` while developing.
- **Scanner:** answers with the `document` as soon as the OCR is done and makes the PDFs in the background; the digital (paid) PDF only with `SCANNER_DIGITAL=1`. With no page found but with text, it returns the text without `pageCorners`.
- **Window:** a single shape at a time, decided by `app_window.go` with a fixed hierarchy; the gestures never open, close or shrink the overlay (`docs/VENTANA.md`).
- **Local API** only for 127.0.0.1 and the app's origins (`ws.Guard`).
- **Language:** everything in the repo in English, except `docs/historial/` and Spanish data that is there on purpose.

## Known problems
- A gesture once suspended the PC (fixed in R2; watch the `did:` log).
- Ctrl+Alt+Space may be taken by another program: use keypad key 1.
- Blurry photos: the scanner cannot read them (normal); the app's framing guide waits for focus.
- The reading service needs its environment (`scanner\pdf\scripts\install.ps1`, once per machine). Without it, the app no longer starts the system Python: PDF Scanner gives the install command.
