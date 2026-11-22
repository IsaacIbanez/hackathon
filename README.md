# LauzHack 2026 — a document reader for people with low vision

A desktop app that reads documents aloud and explains them: paper held up to the camera, or files on the PC. It runs as a full-screen **overlay** and is driven by hand gestures, voice and the Logitech MX Keypad, with the Logitech MX Brio as its camera.

Team: Isaac, Didac, Pau and Nil (`ROSTER.md`), each working with their own AI agent. Challenges: **Logitech**, **IMC** (accessibility) and **AXA** (frugal AI).

## What it does
| Tool | Keypad key | What it does |
|---|---|---|
| **Gesture Control** | 8 | Hand gestures → PC and video-call actions; fist menu, pinch for volume and brightness; camera bubble |
| **PDF Scanner** | 2 | Paper in front of the camera → photo on «Take photo» (Enter, or the hand cursor) → OCR → two PDFs: the scanned one (the photo with searchable text) and an **AI version** rebuilt by a vision model |
| **Read Text** | 5 | Opens a PDF, an image or a text file and reads it line by line |
| **PDF viewer** | — | Reads the whole PDF aloud, page by page |
| **AI Summary** | 7 | Summarises the text selected in any program, in a bubble next to the cursor |
| **Transcribe** | — | Live captions of the microphone or a call: who is speaking, language, translation and a saved `.txt` |

Ctrl+Alt+Space or keypad key 1 dims the screen and shows the tools. Key mapping: `docs/KEYPAD.md`.

## How it is built
- **App:** Go + [Wails](https://wails.io) (`main.go`, `app*.go`, `backend/`), one single executable with Gesture Control inside.
- **Interface:** React + TypeScript in `web/` (overlay, camera, captions, gestures with MediaPipe).
- **Reading service:** Python in `scanner/` (`service.py`, port 8770): photo → page → OCR (Tesseract) → document + PDFs.
- **Models:** OpenRouter (cheap tier Haiku 5.5, expensive tier Sonnet 5.5) and Together AI for Transcribe. Team budget: €10.
- **Contract between modules:** `api/openapi.yaml`; generated types with `task gen`.

Folders, owners, ports and entry points: `docs/MAPA.md`. Architecture: `docs/ARQUITECTURA.md`.

## Run the app (Windows)
1. Create a `.env` in the repo root (it is git-ignored; never commit keys):
   ```
   OPENROUTER_API_KEY=...
   TOGETHER_API_KEY=...   # for Transcribe
   LLM_PROFILE=dev
   ```
2. Once per machine: Go ≥ 1.26, Node, Wails v2 and Task (`go install github.com/go-task/task/v3/cmd/task@latest`), then `task setup` (the reading service's Python environment, Tesseract and its languages, and the web dependencies). The reading service alone: `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1`.
3. `task overlay`, then open `build\bin\lauzhack.exe`. Logs: `build\bin\lauzhack.log` and `build\bin\reading-service.log`.

Other entry points: `task server` (real logic, no window, port 8765), `task mock` (fixed answers, port 8080, no cost), `task dev` (Wails dev mode). Before a PR: `task check`.

## Where to start
- **People and agents:** `AGENTS.md` (short: what it is, where we are, what to read and the rules).
- **Where we are and what is next:** `docs/ESTADO.md`. Board: `TAREAS.md`.
- **How to work** (branches, checks, the `.exe`, PRs, Windows pitfalls): `docs/TRABAJAR.md`.
- **Smoke tests:** `docs/COMO_PROBAR.md`. **Demo script:** `docs/PITCH.md`.
- **Design system for the screens:** `docs/DESIGN.md`.
