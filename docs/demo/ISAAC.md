# Demo · Isaac: startup, overlay, voice and integration

Owner: **Isaac**. Common plan and rules: `docs/demo/README.md`. Isaac also runs the **dress rehearsal**. Each agent merges its own PR into `main` (`docs/demo/README.md`).

## What you review
| Piece | Where |
|---|---|
| Startup: `.env`, helper services, shortcuts, USB keypad | `main.go`, `app.go`, `app_overlay.go`, `backend/overlay/` (`procs.go`, `keypad*.go`, `hotkey*.go`) |
| Local server and models | `backend/session/`, `backend/llm/`, `backend/ws/` |
| Overlay: menu, panels, keypad and voice commands | `web/src/app/overlay/` (`Overlay.tsx`, `Hub.tsx`, `keypad.ts`, `useVoiceCommand.tsx`, `recorder.ts`, `voiceCommand.ts`) |
| AI Summary (Didac's: tell them) | `backend/summary/`, `app_summary.go`, `SummarizeMode.tsx` |
| Read Text and the PDF viewer (Didac's: tell them) | `ReadFileMode.tsx`, `web/src/document/`, `app_pdf.go`, `scanner/pdf_pages.py` |
| Demo script | `docs/PITCH.md`, `docs/COMO_PROBAR.md` |

## What has to work in the demo
1. **Startup:**
   - with the `.exe` and the demo laptop's `.env`, the log says `MX Keypad read directly: connected=true` and there are no errors;
   - if something is missing (keys, the scanner's environment, Tesseract), the menu **warns about it at startup**.
2. **Key 1:** opens and closes the menu from any program. Lines 1–8 of the menu do the same as the keys.
3. **Voice commands (key 7):** «sube el volumen» (volume up), «baja el volumen» (volume down) and «borra el texto» (delete the text), the last one only with text selected. The tool ones, like «lee el papel» (read the paper) or «resume» (summarise), too.
4. **AI Summary (key 4):** summarises the text selected in another program, in the bubble next to the cursor.
5. **Read Text (key 3):** opens a PDF or an image and reads it line by line; key 8 reads and pauses.
6. **The demo script** is up to date with what the app does today, and each step has its plan B.

## Known bugs and risks
- **PR #54 unmerged:** deleting by voice, volume by voice, recording with `MediaRecorder` and the muted-mic warning.
  - Test it with a real voice and merge it.
  - Each attempt leaves `ui: voice:` and `transcribe:` lines in the log.
- **Warnings at startup** (with Pau):
  - if there is no `TOGETHER_API_KEY`, Transcribe cannot work;
  - if `scanner\pdf\.venv` does not exist, `pythonCommand` (`backend/overlay/procs.go`) falls back to the system Python and the service dies without the screen saying what to do. Warn with the exact command (`install.ps1`).
- **A single copy of the app:** if it is opened twice, the second one does not get port 8765 nor the shortcuts. It has to warn about it (pending in R4).
- **Visible version:** the commit and the date in the log and in the menu, to know which `.exe` is open (R4).
- **`LLM_PROFILE=dev`** uses free models that can return 429. It is not used in the demo (`docs/PITCH.md`).
- **`docs/PITCH.md` is out of date:** it promises steps marked ⏳ (dictation, pointing at a field). It has to be rewritten with the real tools (1–8) and the plan B for each.
- **Developer screen** (key D): out of the demo.

## How to test
- **App:** `task overlay` → `build/bin/lauzhack.exe`. Log: `build/bin/lauzhack.log`.
- **Tests:** `task check`. Without a window: `task server` (real logic on 8765) or `task mock`.

## Done when
- [x] PR #54 tested with a real voice and in `main`.
- [x] The menu warns at startup about everything missing, with what to do.
- [x] The second copy of the app warns instead of failing silently.
- [ ] `docs/PITCH.md` rewritten and rehearsed twice in a row with the `.exe` from `main`.

## Prompt for your agent
```
Read AGENTS.md, docs/demo/README.md and docs/demo/ISAAC.md. You work for Isaac in the demo polish phase:
do not add features, make what exists robust. Review startup (main.go, app*.go, backend/overlay,
backend/session), the overlay and the voice commands (web/src/app/overlay), AI Summary and Read Text,
against the points in «What has to work» and «Known bugs and risks». Start with the startup warnings
(missing keys, the scanner's environment) and with the second copy of the app. Reproduce with the .exe
and the log before changing anything. One fix = one commit on a demo/isaac-<topic> branch, with its line
in the Log of docs/demo/ISAAC.md. Didac's, Nil's or Pau's folders: ask me before touching them.
For each fix write or update its tests, run task check (and the tests of your part) and
test it with the .exe; open a PR and, with green CI, merge it yourself into main
(gh pr merge <n> --merge). Nobody reviews other people's work.
```

## Log (filled in by the agent)
For each bug: symptom → how to reproduce it → cause → fix → how it was checked (with the `.exe`).
- 2026-11-22, startup warnings: if a key, the scanner's environment or Tesseract was missing, the app did not say so until the tool failed (Transcribe retried every second; the service died with `No module named cv2`) → reproduced with the `.exe` and a `.env` without `TOGETHER_API_KEY` → `backend/overlay/checks.go` (`StartupProblems`, a pure function with tests) and `app_checks.go`: each problem shows up in the log (`startup:`) and in the menu, in the warning colour, with what to do (for example, the exact `install.ps1` command). Checked with the `.exe`: it warns about `TOGETHER_API_KEY`.
- 2026-11-22, second copy: with two copies open, the second one silently moved to another port and both fought over the keypad and the camera → reproduced by opening two `.exe` → Windows mutex `Local\LauzHackOverlay` (`instance_windows.go`): the second copy says so in the log and in the menu. Checked with two `.exe` at once.
- 2026-11-22, voice commands: «baja el volumen» works with Isaac's voice. The «Heard: …» notice covered the whole camera bubble and did not go away until the next command → reproduced by Isaac with the small camera → the notice goes away on its own (4 s; errors, 7 s), in a small window it is a thin strip at the bottom and it never blocks clicks (`useVoiceCommand.tsx`).
- 2026-11-22, visible version and `task setup` (brought over from PR #51, which clashed with `main` and repeated what #57 did): `task overlay` stamps the commit into the `.exe` (`overlay.StampedCommit`), and the log (`version:`) and the menu footer show it; `task setup` installs the scanner and the web dependencies. Checked with the `.exe`: `version: 54f0589+ (built 2026-11-22 09:13)`.
- 2026-11-22, PDF Scanner «Download PDF»: the scanned PDF and the AI version were only shown in the viewer, with no way to keep them → a «Download PDF» button saves a copy of the PDF on screen with a «Save as» dialog opened in Downloads, and the status line says where it went. Go copies the file the reading service leaves on disk (`scanner.ScanPDFFile`, tested; `SaveScanPDF` in `app_scanpdf.go`), so `scanner/service.py` is untouched. Tested by Isaac with the `.exe`: both PDFs download and open.

**Note from Pau (2026-11-22):** I have touched `backend/overlay/selection*.go`, `app_overlay.go` (one line, `overlay.WatchTarget(ctx)`) and `app_summary.go` (one log line). AI Summary now remembers the last other program in front all the time, not only on the shortcut or the keypad. Details in the Log of `docs/demo/PAU.md`.

**Note from Nil (2026-11-22):** I have touched `web/src/app/overlay/gestureHost.ts` and `Overlay.tsx`. «Close gestures» becomes «Main menu»: the host fires the `gestures:main-menu` event (`MAIN_MENU_EVENT`), `Overlay.tsx` listens to it and goes back to `view = "menu"`, and from the bubble `SetCompact(false)` is called. The gestures stay active. `turnGesturesOn()` now wakes the gestures with `handle.wakeGestures()`. Details in the Log of `docs/demo/NIL.md`.
