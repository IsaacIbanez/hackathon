# Demo · Pau: reading paper and Transcribe

Owner: **Pau**. Common plan and rules: `docs/demo/README.md`. Part of the code is Didac's (`scanner/`, `web/src/document`): tell them before changing it.

## What you review
| Piece | Where |
|---|---|
| Reading service (Python, port 8770): photo → page → OCR → scanned PDF and AI version | `scanner/service.py`, `scanner/pdf/src/scanner_pdf/` |
| Go client of the service and PDF Scanner bindings | `backend/scanner/`, `app_scanpdf.go` (Isaac's: tell them) |
| PDF Scanner screen | `web/src/app/overlay/DocumentsMode.tsx` (Isaac's: tell them) |
| Camera | `web/src/camera/` |
| Transcribe | `backend/captions/`, `web/src/captions/` |
| The window's shape (R5) | `app_window.go` |

## What has to work in the demo
1. **PDF Scanner (key 2):**
   1. The camera is visible.
   2. The photo is taken **only** when you press «Take photo», with Enter or with the hand cursor.
   3. The **scanned PDF** comes out first and, some 15–30 s later, the **AI version**.
   4. You switch between the two with «Scanned PDF» and «AI version», and Space reads them.
2. **Five scans in a row** with the MX Brio without restarting the app, with «Read another paper».
3. **Transcribe (key 5):** live captions of the mic, who is speaking and the saved `.txt`.
4. **The window** is not left in an odd shape when going from one tool to another.

## Known bugs and risks
- **Transcribe does not work: `TOGETHER_API_KEY` is missing** from the demo laptop's `.env`. Add it (never in the repo nor in a chat). Also:
  - **Without a key**, the log repeats `captions: no_key` **every second**: the client retries without a pause. It has to say so once on screen and stop retrying.
  - **If Together fails or there is no network**, it has to say so and not hang.
- **The reading service needs its environment** (`scanner\pdf\scripts\install.ps1`, once per machine). Without it, the app starts the system Python and the service dies with `No module named cv2`. The screen only says «The reading service did not start». It should say what to do (coordinate with Isaac, who looks at the startup warning).
- **Page edges:** with the webcam it does not find them (`page_not_detected` in `result.json`). It works anyway, but without correcting the lighting.
  - Didac has `60070a2` unpushed and changes in `service.py` that look for the corners with AI (`ai_corners`). Ask them to push them and review them before the demo.
- **AI version:** it takes 15–30 s and costs ~$0.03 (team budget: €10).
  - The «light paper» threshold is already 150 (it was 200, which rejected webcam photos).
  - Check what happens if OpenRouter fails: the scanned PDF has to remain, with a message.
- **Timeouts:** `ScanPDF` has 75 s and `MakeDigitalPDF` 160 s. No wait may be left without a limit, and «Read another paper» must cut off the previous one.
- **Camera shared with the gestures** (with Nil): PDF Scanner pauses the gestures. Check that the camera does not end up at 640×360 when Gesture Control had it open.
- **Port 8770 taken** by an old `service.py`: the app reuses it without the new routes. Detect it or document it in `docs/COMO_PROBAR.md`.

## How to test
- **App:** `task overlay` → `build/bin/lauzhack.exe`. Logs: `build/bin/lauzhack.log` and `build/bin/reading-service.log`. Results of each scan: `scanner/pdf/output/scan-*/` (`result.json`, `original.png`).
- **Tests:**
  - `cd scanner/pdf && .venv/Scripts/python -m pytest -q` (81);
  - `cd scanner && pdf/.venv/Scripts/python -m unittest discover -s .`;
  - `task check`.

## Done when
- [ ] Five scans in a row with the MX Brio, each one with both PDFs.
- [ ] Transcribe works with the key and, without it, says so once and does not retry in a loop.
- [ ] Without the scanner's environment, the screen says exactly which command to run.
- [ ] No wait without a limit and no error without a message.

## Prompt for your agent
```
Read AGENTS.md, docs/demo/README.md and docs/demo/PAU.md. You work for Pau in the demo polish phase:
do not add features, make what exists robust. Review PDF Scanner (scanner/, backend/scanner,
DocumentsMode.tsx, web/src/camera), Transcribe (backend/captions, web/src/captions) and app_window.go,
against the points in «What has to work» and «Known bugs and risks». Start with Transcribe's retry loop
without TOGETHER_API_KEY. Reproduce each bug with the .exe and the logs before changing anything. One
fix = one commit on a demo/pau-<topic> branch, with its line in the Log of docs/demo/PAU.md. Didac's
folders (scanner/, web/src/document) and Isaac's files: ask me before touching them.
Never print or push keys.
For each fix write or update its tests, run task check (and the tests of your part) and
test it with the .exe; open a PR and, with green CI, merge it yourself into main
(gh pr merge <n> --merge). Nobody reviews other people's work.
```

## Log (filled in by the agent)
For each bug: symptom → how to reproduce it → cause → fix → how it was checked (with the `.exe`).

- **Transcribe without a key retried in a loop.**
  - **Symptom:** without `TOGETHER_API_KEY`, the log repeated `captions: no_key` every second.
  - **Reproduce:** a server without a `.env` (`backend/cmd/server` from an empty folder) and two connections to `/captions`: each one gets `no_key` (`retryable: false`) and is closed.
  - **Cause:** the client (`LiveCaptions.tsx`) took that close for a drop and reconnected after 1 s, and it reset the retry counter to 0 on every connection, so it never reached the limit of 3.
  - **Fix:** `web/src/captions/reconnect.ts` (a pure function, with tests).
    - A final error (`no_key`, key rejected, cost cap) is not retried: the mic stops, Go closes the session and saves the `.txt`, and it says once what to do.
    - The counter only goes back to 0 on `ready`: 3 retries (1, 2 and 4 s) and then local Whisper is offered.
  - **Checked:**
    - tests of `reconnect.ts` (200 green);
    - with the `.exe` and an invalid key: **a single** `captions:` in the log in 10 s (before, one per second), the notice «Together AI refused the key. Check TOGETHER_API_KEY…» and the «Use local Whisper» button;
    - the no-key case cannot be set up with the `.exe` (Windows does not allow an empty variable and the app reads the `.env`), so it was checked with the server and the tests.
- **The reading service did not say what to do** (Isaac's files, `backend/overlay/procs.go`, and Didac's, `scanner/service.py`, with Pau's permission).
  - **Symptoms:**
    - without `scanner/pdf/.venv`, the app started the system Python, which died with `No module named cv2`, and the screen only said «exited on start (see …log)»;
    - an old `service.py` on 8770 was taken as good, even though it lacked the new routes.
  - **Reproduce:** a test server on 8770 that answers `/health` without a version (like an old one) → `.exe` → key 2.
  - **Cause:** `Healthy` accepted any service that answered `/health`, and `Ensure` looked at neither the environment nor the log.
  - **Fix:**
    - `/health` states its route version (`"api": 3`), and the app rejects an older service, explaining how to close it; it never kills it, because it is not its own;
    - without `scanner/pdf/.venv` (and without `LAUZHACK_PYTHON`), it does not start the system Python and gives the install command;
    - if the service dies at startup, it reads the end of `reading-service.log`: `No module named …` → the install command; port taken → close it.
  - **Checked:**
    - Go tests (`procs_test.go`: good version, old service, reasons for the crash, environment) and Python tests (`/health` with `api`), 42 green;
    - with the `.exe` and the fake service on 8770: PDF Scanner shows «an older reading service is answering on port 8770… Close it… then try again».
- **Everything in English** (2026-11-22, asked for by Pau): `README.md` rewritten in English, every live `*.md` (all but `docs/historial/`) translated keeping its file name, and Spanish comments, logs and interface text in the code translated. Spanish data that is there on purpose (test sentences, language detection, prompts) stays. The language rule in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` now says everything in the repo is in English.

- **AI Summary did not find the selected text** (Isaac's `backend/overlay` and Didac's `app_summary.go`, with Pau's permission).
  - **Symptom:** «Summarize» always said that nothing was selected; the log had no `summary: N chars` line at all.
  - **Reproduce:** select text in another program, open the overlay without the shortcut or the keypad (it opens at startup, or by clicking the camera bubble, or from the fist menu) and press 4.
  - **Cause:**
    - the program to copy from was only remembered when the shortcut or a keypad key was pressed; opened any other way, there was no target;
    - Windows 11 Notepad puts a hidden `#32770` window of its own in front for a moment, and that one was taken as the target;
    - the taskbar or quick settings could be taken as the target too.
  - **Fix:** `overlay.WatchTarget` remembers the last other program in front 4 times a second. A dialog counts as its program's main window (`GA_ROOTOWNER`). Invisible windows, the taskbar, the desktop, Alt+Tab, Start and quick settings are skipped (`isShellWindowClass`, with a test). If nothing was seen since startup, the other program's window highest on screen is used. The log now says which window it copied from and where the Ctrl+C went (`summary: no text copied from …`, `overlay: selection target -> …`).
  - **Checked:**
    - `task check` and `go vet` (Windows and Linux);
    - with the `.exe`: the target is now the right Notepad window in both cases (before: `none`, or Notepad's `#32770`);
    - **still to test by hand:** the summary coming out. The automatic test could not get past this point: a modal «Open» dialog, left open by an earlier test run, blocked Notepad, and then the screen stopped refreshing (locked or asleep), so the simulated keys reached no window.
- **Seen in passing (pending):**
  - On a 1536 px screen **the overlay's panels** (Transcribe, PDF Scanner…) overflow on the right and cut off text and buttons: it belongs to the overlay's design (Isaac).
  - An old `server.exe` (`go run ./backend/cmd/server`) was holding 8765: the app uses another port, but the manual tests against 8765 were talking to the old code.
