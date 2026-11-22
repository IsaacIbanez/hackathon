# Project decisions

Full record, newest first. Moved from `AGENTS.md` on 2026-11-22 to save tokens: `docs/ESTADO.md` summarises the current ones. **If you make a decision that changes an interface or the contract, add it here at the top** (a short entry) and, if it affects day-to-day work, a line in «Current decisions» of `docs/ESTADO.md`.

- 2026-11-22 — **Everything in the repo in English** (Pau, for the whole team):
  - Code, comments, logs, tests, interface text and now also the documentation (`*.md`) are in English. The conversation with the team stays in Spanish.
  - The file names of the existing docs (`ESTADO.md`, `COMO_PROBAR.md`…) are kept so as not to break links and open branches.
  - Exceptions: `docs/historial/` (archive) and the Spanish data that is there on purpose (test sentences, language detection, prompts that handle Spanish text, Spanish voice commands).
  - Replaces the 2026-11-21 rule «documentation in Spanish».
- 2026-11-22 — **Voice command «borra el texto» (delete the text)** (Isaac; `docs/KEYPAD.md`):
  - New binding `DeleteSelection()` (`app_readselection.go`, `backend/overlay/selection_windows.go`): copies the selection of the program in front and, only if there is selected text, presses Delete; restores the previous clipboard.
  - Voice only: it records only when key 7 (or «Voice command») is pressed, transcribes with `POST /transcribe` and deletes only if the sentence is a delete command (a rule that goes first in `voiceCommand.ts`).
  - Reason: deleting with no selection would remove the letter after the cursor; that is why it is checked first.
- 2026-11-22 — **New design system for the overlay** (Isaac; `docs/DESIGN.md`):
  - Replaces Halo (`docs/DISENO.md`): semantic tokens in `web/src/index.css` (text, a single accent, states, transparencies, 5 type sizes, radii, elevation, motion) and base components in `ui.tsx` (`IconButton`, `Switch`, `Tag`, plus `.btn-quiet` and `.backing`).
  - The transparencies keep the same values, now as tokens; contrast was measured over a white and a black desktop.
  - Applied to every screen the same day, appearance only (no logic, props or contract touched): a single yellow accent (the tools are told apart by icon, name and place), a still ring instead of the spinning halo, 1 px borders instead of large shadows, 5 type sizes, no emojis as icons. `DISENO.md` moves to `docs/historial/DISENO_halo.md`. Reason: consistency between screens and a sober overlay look, not an app «made by AI».
- 2026-11-22 — **A single piece decides the window's shape** (R5, Pau; `docs/VENTANA.md`):
  - `app_window.go`: the parts declare what they want (`open`, `layer`, `gestures`, `gestureScreen`, `summary`) and `desiredShape` decides with a fixed hierarchy: summary > fist menu > overlay (layer or window) > camera bubble > hidden.
  - Temporary shapes go back on their own to the previous one. The gestures never open, close or shrink the overlay; cursor mode does not touch the window.
  - Reason: six functions moved the window on their own, and the fist menu, cursor mode or the summary left the overlay at 960×680 or shrank it.
- 2026-11-22 — **Context for the AIs reorganised** (Pau, at the team's request):
  - `AGENTS.md` goes from 12 KB to ~3 KB: what it is, where we are, what to read depending on the task, and 10 rules. It is loaded on every request.
  - Three new documents: `docs/ESTADO.md` (where we are and where we are going; keep it up to date), `docs/MAPA.md` (folders, owners, ports and flows) and `docs/TRABAJAR.md` (work cycle, `.exe`, Windows pitfalls, saving tokens).
  - `scanner/AGENTS.md` goes from 15.6 KB to ~2.5 KB and its copy `AGENTS_B.md` is deleted.
  - Moved to history: `ESTADO_PROYECTO.md`, `INSTRUCCIONES_ARRANQUE.md`, `arranque/`, `ideas/`, `PRUEBA_WAILS.md` and the per-person briefs of Didac and Isaac; the captions one moves to `docs/briefs/subtitulos.md`.
- 2026-11-22 — **Scan measured and improved (N3, Pau; `docs/medidas/N3.md`):**
  - The reading service answers as soon as the `document` is ready; the searchable PDF and the digital PDF are finished in the background.
  - The digital PDF is **off** by default, because it uses a paid model on every scan (fix R3). It is turned on with `?digital=1` or `SCANNER_DIGITAL=1`.
  - With no page detected but with text on paper, the service returns the `document` without `pageCorners` (optional in the contract) instead of 422.
- 2026-11-22 — **Live captions (Pau; brief `docs/briefs/subtitulos.md`, `web/src/captions/README.md`):**
  - The browser sends the audio (16 kHz PCM) to Go over `GET /captions` (WebSocket); Go passes it to Together AI: live captions and batch diarisation with Parakeet v3; language, barbarisms in quotes and translation with Qwen3.5-9B (no reasoning).
  - Contract 0.8, additions only: `GET /captions`, `CaptionsEvent` (with `revise`), `speakers`.
  - Pau's folders: `backend/captions/` (of Isaac's, only the route registration in `mux.go` is touched) and `web/src/captions/`.
  - Key `TOGETHER_API_KEY` only in `.env`; visible cost with a per-session cap (`CAPTIONS_LIMIT_USD`, $1); if Together fails, Nil's local Whisper is offered.
- 2026-11-22 — **Final overlay design, «Halo»** (Didac, `docs/DISENO.md`).
  - A full-screen, frameless layer, like the Xbox Game Bar.
  - Gesture Control in the large circle in the centre, and PDF Scanner, Read Text, AI Summary and Transcribe (*Coming soon*) in an arc above it.
  - Each tool opens a glass panel with the same header.
  - Atkinson Hyperlegible type, one colour per tool and yellow for what is being read and the focus.
  - The new screens use the tokens and components of `index.css` and `web/src/app/overlay/ui.tsx`.
- 2026-11-22 — **MX Keypad (N2, Isaac; `docs/KEYPAD.md`, brief `docs/briefs/N2.md`):**
  - **Direct reading over USB, without Logi Options+ or an SDK:** the keypad (VID 046D, PID C354) sends `13 ff 02 00 <counter> 01 <key>` in a vendor HID collection. Checked with the real keypad.
  - **Fallback:** key N has the global shortcut Ctrl+Alt+Shift+N.
  - **The keys, decided by Isaac:**
    1. open/close the app;
    2. start recording a voice command;
    3. stop the recording;
    4. read paper;
    5. read file;
    6. read/pause;
    7. summarise the selection;
    8. gestures;
    9. menu.
  - **Voice commands** (keys 2 and 3): Go transcribes the recording with `POST /transcribe` (cheap audio model) and the sentence is turned into a keypad action (`web/src/app/overlay/voiceCommand.ts`, in Spanish, Catalan and English).
  - Works with another program in front: Go shows the overlay and sends `overlay:keypad`. The contract does not change.
- 2026-11-22 — **PDF viewer that reads the whole PDF aloud (N4, Didac; brief `docs/briefs/N4.md`):**
  - reads page by page, with stop (X), speed, pages and go to a page (`web/src/document/PdfViewer.tsx`, `pdfReader.ts`);
  - the reading service provides each page (image and lines, with OCR for the scanned ones, with no page limit) and Go passes it on with `app_pdf.go`;
  - new test documents: 40 pages and 3 scanned pages.
- 2026-11-22 — **Gesture Control inside the overlay** (Nil, branch `feature/T6-overlay-unified`): a single executable. The gesture program becomes a package (`adapters/desktop/control`) that the app uses in its own process; the camera page (`mountGestureControl`) is mounted in option 1 and talks to Go through the `GestureCall` binding (the same API, without HTTP, port or token). With the gestures active, hiding the overlay shrinks it to a camera bubble in a corner (a hidden window would slow down the camera). `gesture-control` still exists to be used on its own (`task gestures`, or on Linux, where the camera does not work inside Wails).
- 2026-11-22 — **Overlay option 4: summarise the text selected in any program** (Didac, branch `feature/didac-resumir-seleccion`, `docs/OVERLAY.md`).
  - How it works: Go remembers the window that was in front when the overlay opened, copies its selection with Ctrl+C, summarises it with the **cheap model** (2–3 sentences, with a local $0 alternative) and leaves the summary in the clipboard, aloud and in a bubble next to the cursor.
  - Ready for Nil's hand cursor: `TriggerSummary` and the `overlay:summarize` event.
  - **It is the summary implementation that stays** (decision of Isaac and Didac): it replaces Isaac's N7, which had been merged (#48) and was removed from `main` (revert of de357f8; the N2 keypad stays). Summarising the open document (options 2 and 3) remains pending, on top of `backend/summary`.
  - The contract does not change.
- 2026-11-21 — **Overlay app** (branch `overlay`, details in `docs/OVERLAY.md`):
  - the desktop app is an always-on-top window that opens from any program with **Ctrl+Alt+Space** (`LAUZHACK_HOTKEY`; the MX Keypad, since 2026-11-22, over USB: see the N2 decision);
  - options: **1** gestures (Nil; since 2026-11-22 it lives inside the app, see the decision above), **2** read a paper (Pau and Didac: camera → reading service → guided reading) and **3** read a file from the PC (Didac: PDF, images, TXT/MD → guided reading);
  - the app starts and stops the reading service and Gesture Control;
  - no option uses AI and the contract does not change.
  - Reason: bring the features together in a single executable.
- 2026-11-21 — **Per-person startup:** no more closed tasks are handed out.
  - Each person works with their agent on what they decide: Nil, on the camera and its surroundings (voice, face, hands, keyboard); Didac and Pau, on a large and different feature each; Isaac chooses between the backend, a feature or helping someone else.
  - The agent first interviews its person (`docs/historial/arranque/<person>.md`) and leaves a confirmed brief in `docs/briefs/<person>.md`.
  - Reason: more autonomy. With the brief written down, new sessions do not repeat the interview.
- 2026-11-21 — **Unified project:** all branches integrated into `integration/proyecto-unificado` (normal merges, see `docs/historial/ESTADO_PROYECTO.md`); the per-agent tasks are dissolved: `TAREAS.md` becomes a single board without owners, and the per-agent status and plan are kept in `docs/historial/`. The split will be redefined after the brainstorm (`docs/historial/ideas/`).
- 2026-11-21 — **Protected local API** (`ws.Guard`): it only answers to `Host` 127.0.0.1 or localhost (no DNS rebinding) and to the app's origins (Vite, Wails), with CORS for them; `POST /message` only accepts JSON. Local processes (the scanner) do not send `Origin` and keep working. Without this, any open web page could send us documents or questions and spend AI.
- 2026-11-21 — **Voice fallback done (T18):** `POST /transcribe` (WAV → text, contract 0.6) with Gemini 2.5 Flash Lite and a free fallback; `transcribeRemote()` in `web/src/app/transcribe.ts` for role C.
- 2026-11-21 — **Contract 0.5:** `document.pageCorners` (corners of the page in the photo: top-left, top-right, bottom-right, bottom-left of the page as it reads) and `POST /scan` (the app sends the photo; Go passes it to the reading service at `SCANNER_URL`, by default `127.0.0.1:8770/scan`, and says aloud what is happening). `SCANNER_URL=fixture` lets you test everything without the service.
- 2026-11-21 — **Voice:** local recognition with `whisper-small` (T17, Nil) and a cloud fallback with `POST /transcribe` in Go and `google/gemini-2.5-flash-lite` (T18, Isaac), only if the local one fails. Measured: `whisper-tiny` fails, `whisper-small` gets it right in 1.1 s; Gemini gets it right in 2.3 s for $0.00006 (`docs/VOZ.md`).
- 2026-11-21 — **Folders accepted:** `adapters/desktop/` (Nil's Gesture Control, a separate Go program, port 8767) and `scanner/` (role B, Python). `scanner/demo_app/` is a test tool of Didac's, not part of the product.
- 2026-11-21 — **What triggers the scan:** the «read the document» command by **button** (the demo's plan B), **sentence** and **gesture** (action `scan_document`).
- 2026-11-21 — **Camera: use whichever there is.** In development, the laptop's webcam; if a Logitech camera is connected (MX Brio), that one is used, because it is the Logitech challenge's (Isaac's decision). Pending consequences: (1) with **a single camera**, the scanner (Python) and the gestures (browser) cannot open it at the same time: we have to decide which one opens it; (2) `scanner/capturar.py` today fails if it does not find the Brio: it must use the available camera if it is not there (role B); (3) the interface will pick the Logitech one by name if it is connected (role A).
- 2026-11-21 — Go forwards to every WebSocket client each `document` it accepts (contract 0.4.0, `ServerMessage` includes `document`): the screen shows and highlights the document even if the scanner sent it. Badly framed documents are not forwarded. Minimal view in `web/src/app/DocumentText.tsx`; B2 can replace it in `web/src/document`.
- 2026-11-21 — A single session shared by the whole app (`ws.Hub`): messages from any client (interface over WebSocket, scanner through `POST /message`) update the same state and each `speak`/`stats` is sent to every WebSocket client — it is a desktop app for one person; without this, the explanation of the scanner's document went back to the scanner and not to the screen.
- 2026-11-21 — Code, comments, commits and PR titles in English; conversation and documentation in Spanish («Language» section) — the team asks for it. Commits already in `main` are not rewritten. In the contract, the `stats` tiers go from `barato`/`caro` to `cheap`/`expensive` (nobody else used them yet). *(Documentation moved to English on 2026-11-22: see the top entry.)*
- 2026-11-21 — B's scanner (Python, `scanner/`) connects to Go by sending `document` messages to `ws://127.0.0.1:8765/ws` (the blocks with box and confidence come from Tesseract) and receives `speak` and `stats` — the contract does not change and B stays isolated in its folder. Agreed by Isaac, Didac and Pau.
- 2026-11-21 — AI budget: €10 for the whole team. While developing, `LLM_PROFILE=dev` (free models with vision first and Haiku as a last resort); the default profile (Haiku + Sonnet) is for the demo. Key in `.env` (ignored by git) or in the environment — so the budget does not run out before the demo.
- 2026-11-21 — `stats` message (Go → browser) with the models' cost and latency, sent after each call; its payload is the JSON of `llm.Meter.Snapshot()` (a test guarantees it). An additive-only change: it does not affect the existing messages — showing the cost on screen is what AXA asks for.
- 2026-11-21 — The Wails app serves the contract on `127.0.0.1:8765` (`/health` and `/ws`; changed with `LAUZHACK_ADDR` and, if the port is taken, it uses a free one). The frontend asks Go for the URL with the `WsURL()` binding. A fixed port so that a local process (for example, the Python scanner) can send `document` without going through the browser. It only listens on 127.0.0.1.
- 2026-11-21 — Models through `backend/llm`: `cheap` tier `anthropic/claude-haiku-5.5` and `expensive` `anthropic/claude-sonnet-5.5` (both with vision; configurable with `LLM_CHEAP_MODEL` and `LLM_EXPENSIVE_MODEL`), key in `OPENROUTER_API_KEY`. The package provides the mechanism (cache, meter, `CompleteWithEscalation`) and B2 decides when to escalate with its doubt function — AXA's frugality criterion stays in one place and can be measured.
- 2026-11-21 — WebSocket messages: a common envelope `{type, id, ts, payload}` (`ts` in ms since epoch; coordinates normalised to [0, 1] over the cropped document). The browser sends `document`, `pointer` and `utterance`; Go answers with `speak` (with `replyTo` = `id` of the message it answers). Schemas in `api/openapi.yaml`, examples in `api/fixtures/` — a single contract shared by Go and TS.
- 2026-11-21 — Generated types, never by hand: Go in `api/gen` (package `gen`, oapi-codegen as `go tool`) and TypeScript in `web/src/api/types.ts` (openapi-typescript, aliases in `web/src/api/index.ts`). They are regenerated with `task gen` — so Go and TS do not drift apart.
- 2026-11-21 — `Taskfile.yml` instead of a `Makefile`; Go module `github.com/IsaacIbanez/hackathon`, Go ≥ 1.26 — there is no `make` on Windows; the dependencies (oapi-codegen) require Go 1.26.
- 2026-11-21 — Final structure: Wails in the root, frontend in `web/`, Go packages in `backend/<name>` without `internal/`, mock in `backend/cmd/mock` — verified: Go refuses to import `internal/` from the root, and Wails accepts `frontend:dir` and our own packages (Isaac's test on Windows, Wails v2.17.1).
- 2026-11-21 — One main agent (Claude) per person and Gemini for support or review; the agents do not edit `TAREAS.md` — fewer conflicts and more control with four people.
- 2026-11-21 — Small PRs, reviewed by another person and merged every 30–60 minutes — the process must not slow down development.
- 2026-11-21 — A single monorepo with Go + a web frontend inside a desktop app — everything stays in one place and the agents coordinate through files.
- 2026-11-21 — Contract (OpenAPI and WebSocket messages) before the code — it allows working in parallel with mocks.
- 2026-11-21 — Vision, gestures and voice in the browser, Go only orchestrates — it is local, cheap and fits AXA's frugality.
- 2026-11-21 — Wails as the desktop wrapper, with a camera test on every OS in the first hour — plan B: Electron.
- 2026-11-21 — Logitech haptics and keypad parked; only the camera SDK is looked at — focus on the camera loop.
- 2026-11-21 — If the Logitech SDK requires Python or C#, it goes as a separate adapter in `adapters/logitech/` that talks to the app over local WebSocket or HTTP — it isolates the SDK's language.
