# Preparing the demo: three reviews in parallel

**Demo polish** phase (2026-11-22, decided by Isaac). No features are added: each person reviews their part of the code so that the demo does not fail. The goal is for everything to be **very robust**: if something fails, the app says so clearly and you can carry on.

| Person | Sheet | What they review |
|---|---|---|
| **Nil** | [`NIL.md`](NIL.md) | Gestures: camera, fist menu, cursor mode, bubble, reading the selection with three fingers and the shared camera |
| **Pau** | [`PAU.md`](PAU.md) | Reading paper and Transcribe: PDF Scanner end to end (Python service, OCR, the two PDFs), Transcribe and the window (R5) |
| **Isaac** | [`ISAAC.md`](ISAAC.md) | Startup and the overlay: keys and warnings at startup, menu, keypad, voice commands, AI Summary, Read Text and the PDF viewer, the demo script and the final integration |

Didac is not in this split. Their folders (`scanner/`, `web/src/document`, `backend/summary`) are reviewed by Pau and Isaac. Before touching something of theirs, tell them.

## What we already know fails (2026-11-22)
- **Transcribe does not work:** `TOGETHER_API_KEY` is missing from the `.env` (Pau). Also, the app retries it every second and floods the log.
- **The scanner needs its install** on every machine: `scanner\pdf\scripts\install.ps1`. Without it, the service dies with `No module named cv2` and no PDF comes out (Pau and Isaac).
- **PDF Scanner** does not find the page edges with the webcam (`page_not_detected`). It still works, but crops worse (Pau).
- **Voice commands:** PR #54 (delete the selection and turn the volume up or down) is unmerged and untested with a real voice. If the Windows mic is muted, the app already says so (Isaac).
- **The «Microphone» button of the fist menu** mutes the **Windows** mic, not the call's. If it stays muted, voice commands stop hearing (Nil).
- **Ctrl+Alt+Space** is taken on Isaac's laptop. In the demo it is opened with keypad **key 1**.

## How to work (all three sheets)
1. `git pull` and a `demo/<person>-<topic>` branch. One fix = one commit, with its line in your sheet's «Log».
2. **Reproduce the bug with the real `.exe` before fixing it** (`task overlay` → `build/bin/lauzhack.exe`). Close any other copy first. Look at `build/bin/lauzhack.log` and `build/bin/reading-service.log`.
3. **Robust means:**
   - no error without a message;
   - no retry loop without a pause;
   - nothing left hanging with no time limit;
   - if something is missing (key, camera, mic, service), the app says so on screen together with what to do.
4. **Each agent tests and merges its own work; nobody reviews other people's** (decided by Isaac):
   - write or update the tests for what you fix;
   - run `task check` and the tests of your part (Python: the scanner's);
   - test it with the real `.exe`;
   - open a small PR and, **with green CI, merge it yourself into `main`** (`gh pr merge <n> --merge`);
   - before merging, `git pull` and run the tests again if `main` has changed.
5. Do not touch another person's folders (`docs/MAPA.md`): note it in their sheet and tell them.
6. Spend few tokens: read by ranges, filter the output and do not launch subagents.

## Dress rehearsal (when all three sheets are «done»)
Isaac, with the `.exe` from `main` on the demo laptop, follows the script in `docs/PITCH.md` twice in a row without restarting the app. Each failure goes to the sheet of whoever owns it.
