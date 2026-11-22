# Overlay: one app that brings the features together

Branch `overlay`, created on 2026-11-21. Isaac's brief: `docs/historial/briefs/isaac.md`.

The desktop app stops being a normal window and becomes an **overlay**: a window always on top of the others that opens from any program with **Ctrl+Alt+Space**. The Logitech **MX Keypad** can also open it if that combination is assigned to one of its keys in Logi Options+. The overlay offers the team's features as options.

**Design (2026-11-22):** a full-screen layer, in the style of the Xbox Game Bar. Gesture Control goes in a large circle in the centre and the other tools in an arc above it, with the English names shown in brackets. Everything follows the «Halo» system, described in `docs/DISENO.md`.

| Key | Option | Whose | What it does |
|---|---|---|---|
| **1** | Hand gestures (*Gesture Control*, centre) | Nil (C) | **Gesture Control** inside the window itself: the camera sees the hand and controls the computer (mouse, volume, brightness, microphone, apps, shut down, video call) |
| **2** | Read a paper (*PDF Scanner*) | Pau (B1) and Didac (B2) | Camera with the voice framing guide → automatic photo → reading service → **guided reading** aloud |
| **3** | Read a file (*Read Text*) | Didac (B2) | Asks for a document from the PC. A **PDF** opens in a **viewer** with the real pages and a «Read the whole PDF» button that reads it all, page by page and with no limit (N4, `docs/briefs/N4.md`). Text and images are read line by line (**guided reading**) |
| **4** | Summarise the selected text (*AI Summary*) | Didac (B2) | Summarises in 2–3 plain sentences the text selected in **any program**: says it aloud, copies it to the clipboard and shows it in a bubble next to the cursor (section «Option 4») |
| 5 | Live captions (*Transcribe*) | Pau (B1) | `<LiveCaptions />` (`web/src/captions`) over `GET /captions`; needs `TOGETHER_API_KEY` in `.env` |

Options 1 to 3 are **local and free**: they call no AI model. Option 4 uses the **cheap model**: about $0.0001 per summary, with the cost in view. Without a key, it summarises locally.

## How it is built and started
Requirements:
- Go 1.26 or later, Wails 2.17.1, Task and Node.
- The scanner's Python environment (`scanner/pdf/.venv`, see `scanner/ENTREGA.md`).
- Tesseract, only for photos, scanned PDFs and images.

```
task overlay          # build/bin/lauzhack.exe (with Gesture Control inside)
build\bin\lauzhack.exe
```
- `task overlay` runs `wails build`: a single executable. Gesture Control goes inside (package `adapters/desktop/control`). To use it on its own, without the overlay, `task gestures` builds `build/bin/gesture-control` as before.
- The app looks for `scanner/service.py` going up from its folder (up to 4 levels), so `build/bin/lauzhack.exe` finds it in the repo.
- Log in `build/bin/lauzhack.log`; the reading service writes to `reading-service.log`, in the same folder.

Optional variables:

| Variable | What for | Default |
|---|---|---|
| `LAUZHACK_HOTKEY` | Another shortcut: `ctrl+shift+l`, `f13`… A single key is only accepted from F13 to F24 | `ctrl+alt+space` |
| `LAUZHACK_PYTHON` | Another Python interpreter for the reading service | the one in `scanner/pdf/.venv`; without it, the app gives the install command instead of using the system Python |
| `LAUZHACK_GESTURES_DRY_RUN` | `1`: the gestures only write to the log what they would do, without pressing anything | off |
| `LAUZHACK_SCREEN` | Screen size for the mouse when it is not detected (Linux Wayland), for example `1920x1080` | detected |
| `LAUZHACK_APPS` | Path to the `apps.json` of the gestures' «Apps» menu | `apps.json` is looked for (see `adapters/desktop/README.md`) |
| `SCANNER_URL` | Another reading service, or `fixture` for the fixed example | `http://127.0.0.1:8770/scan` |

## How it is used
- **Ctrl+Alt+Space:**
  - If the overlay is hidden, it shows it in front with the keyboard ready.
  - If it is open but covered by another window (the gestures', for example), it brings it to the front.
  - If it is in front, it hides it.
- **In the menu:**
  - **1 to 4** (also Num 1–4) choose an option.
  - **Esc** hides the overlay.
  - **D** opens the previous development screen (`App.tsx`).
  - **Q** closes the app and the programs it has started.
- **Inside an option:** **Esc** goes back to the menu. What is being read keeps playing even if the overlay is hidden.
- **Guided reading** (options 2 and 3): Space or Num 5 pauses and resumes, ← or Num 4 goes to the previous line, → or Num 6 to the next, R or Num 8 repeats, and a click on a line reads from there.
- **Camera at the top left (N1):** every screen shows the camera with the points of the tracked hand. It is the same gesture engine as option 1, always on while the overlay is open (`gestureHost.ts`). The **Hide camera** button hides the view (the gestures carry on); **📷 Show camera** shows it again, and it is remembered for next time. When the gesture menu is opened with ✊, or when adjusting the volume or the brightness, the view grows to the whole window. While option 2 or the development screen uses the camera, it pauses with a notice. Without a camera (or blocked, or taken by another program), it says so over the view and the rest of the app keeps working.
- **Everything with the mouse (N1):** at the top right there are buttons for what the keys do: **Developer screen** (D, in the menu), **Hide** (Esc) and **Quit** (Q). Each option has its button in the menu and **← Menu** to go back.
- **Option 1:** the full Gesture Control page (switch, Call/Computer, the call app, cursor mode, gesture guide and log). While the gestures are running, **the shortcut**, **Hide** or **M** do not hide the window: they shrink it to a **camera bubble** in a bottom corner, always on top, and the gestures keep working. The shortcut or a double click on the bubble restores it to full size. (A hidden window would slow the camera down.) From the bubble, opening the gesture menu with ✊ (or adjusting the volume or the brightness) turns the window into a **transparent full screen**: the options come up over whatever is open and the camera stays small in a corner; when done it goes back to the bubble. It only takes the screen while the mouse is not needed, so it never keeps other programs' clicks.
- **Option 2:** the photo is taken on its own when the paper is still (after 8 s, the best there is); **Enter** takes it right away. If there is no page, it says so aloud and **Enter** retries.
- **Option 3:** the file dialog opens; **O** opens another file.
  - With a **PDF**, **Space** (or the yellow button) reads it all.
  - Viewer keys:

    | Action | Keys |
    |---|---|
    | Previous / next line | ← → |
    | Repeat | R |
    | Stop | X |
    | Faster / slower (0.75× to 1.5×) | + / − |
    | Previous / next page | PgUp / PgDn |
    | Go to a page | G |

  - At the start of each page it says «Page N of M».
- **Option 4:**
  - Select a text in any program, press the shortcut and then **4**. The bubble comes up with the summary.
  - **R** repeats it.
  - **Esc** (or the shortcut) closes the bubble and gives the focus back to the program the text came from.

**MX Keypad:** in Logi Options+, give one key the Ctrl+Alt+Space combination and, if you like, other keys «1», «2» and «3» (or Num 1–3) and the guided reading ones (Num 4, 5, 6 and 8). Nothing needs to change in the app. *Not tested yet with the real keypad.*

## Adding a button or a panel (N1)
Everything is in `web/src/app/overlay/extensions.ts`: they are lists, and `Overlay.tsx` draws them. Nothing else needs to be touched.

- **A button in the top-right bar** (shows on every screen): add an entry to `TOOLBAR`.
  ```ts
  {
    id: 'help',                       // unique
    label: '❓ Help',                 // the button's text (in English, like the rest of the interface)
    key: 'H',                         // optional: the key that does the same, shown next to it
    show: (ctx) => ctx.view === 'menu', // optional: on which screens it shows (by default, all)
    run: (ctx) => ctx.setView('read-file'), // what it does: change screen, call Go (desktop())…
  },
  ```
  If the button does the same as a key, the key is still handled in `Overlay.tsx`; the button only makes it reachable with the mouse.
- **A panel in the menu** (below the options): create a component (for example `MyPanel.tsx`) and add `{ id, title, Component: MyPanel }` to `MENU_PANELS`. The list is empty now: the gesture help panel that was at the bottom left was removed on 2026-11-22.
- **A new menu option** (a whole screen): an entry in `modes.ts` and its component in `views` of `Overlay.tsx` (see below).
- **The camera:** the top-left view is `CameraPanel` in `Overlay.tsx`. If a new screen opens the camera on its own, add it to `NEEDS_CAMERA` in `Overlay.tsx`: the gestures leave it the camera while it is open.

## How it is built
```
lauzhack.exe (Wails, always-on-top window)
├─ web/src/app/overlay/      menu and options (React)
│    modes.ts                list of options: key, title, owner, ready
│    Overlay.tsx             menu, keys, Esc, development screen
│    GesturesMode.tsx        1: mounts the Gesture Control page (web/src/input/desktop) in the window
│    DocumentsMode.tsx       2: openCamera + startFramingGuide (Pau) → ReadPhoto → GuidedReader (Didac)
│    ReadFileMode.tsx        3: OpenAndReadFile → GuidedReader
│    desktop.ts              access to the Go bindings (window.go), without depending on wailsjs/
├─ app_overlay.go            bindings: OverlayInfo, HideOverlay, Quit, EnsureReadingService,
│                            ReadPhoto, OpenAndReadFile, GestureCall, SetGesturesActive, SetCompact
├─ backend/overlay/          global shortcut (Windows RegisterHotKey), helper processes
└─ backend/scanner/          reading service client: Scan (photos) and ReadFile (files)

Processes the app starts (and stops when it closes, with their children):
  scanner/service.py         127.0.0.1:8770 (only if it is not already answering); POST /scan and POST /document
```

**PC files → document.** The resulting document is the contract's `DocumentPayload`, unchanged.
- Text (`.txt`, `.md`): Go reads it (`scanner.FromText`). One line per block; long paragraphs are split into sentences.
- PDF and images: they go to the reading service's `POST /document` (`scanner/documents.py`).
  - **PDF with text:** the lines come from the PDF itself, instantly and without OCR.
  - **Scanned page:** rendered at 300 dpi and passed through OCR, at most 8 pages per PDF.
  - **PNG or JPEG:** passed through OCR, looking for the page if it is a photo of a paper.
  - The pages are stacked from top to bottom: page p of n takes `y ∈ [p/n, (p+1)/n]`, so they are read in order.
- To add a format: `FileTypes` in `backend/scanner/document.go` and, if it is not text, a reader in `scanner/documents.py`.

## Decisions (2026-11-21, Isaac with Didac)
1. **Branch `overlay`** from `feature/didac-lectura-guiada`: the full integration (#38), plus the per-person startup (#39) and guided reading (#40). `main` is not touched.
2. **The shortcut is Ctrl+Alt+Space**, configurable with `LAUZHACK_HOTKEY`. The keypad sends the same combination from Logi Options+.
3. **Three options for now:** gestures (Nil), read a paper (Pau and Didac) and read a file (Didac). Adding another one is an entry in `modes.ts` and a component.
4. **«Text to speech» reads a document from the PC** (PDF, text or image) and shares the reader with the scanned papers. Current formats: PDF with text, scanned PDF, images and TXT/Markdown. Others can be added later (Word…).
5. **The app starts the reading service** if it is not answering, with the repo's Python, and stops it when it closes (only if it started it).
6. **Gesture Control lives inside the app** (changed by Nil, 2026-11-22): a single executable. The camera page is mounted in option 1 and its actions go to Go through the `GestureCall` binding, which answers the same API as the standalone program (`control.Server.Call`) without HTTP, port or token. With the gestures active the window does not hide, it shrinks to a bubble; also, the app asks WebView2 not to throttle the page when it is covered (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`).
7. **One camera at a time:** option 2 stops the gestures before opening the camera.
8. **The bindings return JSON as text.** If they returned structs, Wails would generate `models.ts` with `namespace`, which the project's `tsconfig` rejects (`erasableSyntaxOnly`).
9. **Window:** normal, with a frame, always on top and 960×680. It opens visible the first time. The visual design is left for later.
10. **Log:** first the file and then stderr, and serious failures (panic) also go to the log. Before, `build/bin/lauzhack.log` stayed empty because an app without a console has no valid stderr.

## Option 4: summarise the selected text
Added on 2026-11-22. Didac's feature; their brief is in `docs/historial/briefs/didac.md`.
- It was done on the `feature/didac-resumir-seleccion` branch and merged into `main` on 2026-11-22. Only Didac's commits went in, without Nil's `feature/T6-overlay-unified`, which was not in `main` yet.
- By decision of Isaac and Didac, **this is the summary implementation that stays**: it replaces Isaac's N7. N7 had been merged (#48) and was removed from `main` when this was merged (revert of de357f8). Its brief is kept in `docs/briefs/N7.md` as history.
- N7 also summarised the open document in options 2 and 3. That remains pending; it can be done by calling `backend/summary` with the document's text.

**Flow:**
1. **Select.** The person selects text in any program: Word, the browser, a PDF, email…
2. **Remember the program.** When the overlay's shortcut is pressed, Go notes which window was in front (`overlay.RememberTarget`) before the overlay takes the focus.
3. **Copy the selection.** With **4**, Go gives the focus back to that window and sends **Ctrl+C**. It waits for the clipboard to change, at most 0.9 s, and reads the text (`overlay.CopySelection`). If the clipboard does not change, nothing was selected: it says so aloud and shows it.
4. **Summarise** (`backend/summary`).
   - It is sent to the **cheap tier** (`backend/llm`), with a cache and a cost meter, so the spending adds up in `stats`.
   - It asks for **2 or 3 plain sentences (45 words at most)** in the text's language, with deadlines, dates, amounts and what has to be done, without phone numbers or courtesy formulas.
   - Texts of more than **12,000 characters** (about 6 pages) are cut and the bubble says so.
   - Those of fewer than 40 characters are read as they are.
   - **Without a key, or if the model fails:** a local summary that keeps the 2–3 sentences with dates, amounts and deadline words, at $0.
5. **Copy the summary** to the clipboard. It replaces the copied text.
6. **Show the bubble.** The overlay window shrinks to 540×420 next to the cursor (`overlay.PlaceNearCursor`; it switches sides if it does not fit), says the summary aloud and shows the cost and «summarised in the cloud».

**Decisions (Didac, 2026-11-22):**
- **Where:** the text can be in any program, not just in the app.
- **Trigger:** for now, overlay option 4. Later, Nil's hand cursor (see below).
- **Engine:** the cheap model, with a local alternative.
- **Output:**
  - a bubble next to the cursor;
  - voice;
  - clipboard.
- **Style:** 2–3 plain sentences.
- **Long texts:** a 12,000-character limit with a notice.
- **Privacy:** a discreet notice («summarised in the cloud»). The text is not saved anywhere, except in the in-memory cache while the app is open.

**Ready for the hand cursor (Nil):**
- `TriggerSummary()` (Go binding) notes the window in front and emits the `overlay:summarize` event; the overlay opens option 4.
- A Gesture Control «summarise» action only has to call it.
- **MX Keypad (N2):** there is a `summarize` action, which opens option 4. When a keypad key is pressed, Go remembers the window that was in front, just like with the shortcut. It does not have a key assigned yet (page 2 of N2).
- **Pending when connecting it:** in `main`, the gestures are a separate program (`gesture-control.exe`), so opening option 4 does not take the camera away from them.
- If `feature/T6-overlay-unified` is merged (the gestures inside the window), opening option 4 will change the view and turn that camera off. Then the summary bubble will have to be shown without leaving option 1.

**Limitations:**
- Windows only.
- It does not work in programs that do not copy with Ctrl+C.
- The clipboard ends up with the summary, not with what it had before.
- The `.exe` only looks for the key in the root `.env`. In the tests I passed it through the environment, without writing it to any file.

**Tested** (2026-11-22, real `.exe`, Windows 11 at 125 %):
- **Summary of the letter:** the selection (728 characters) from another window went through Haiku and a 2-sentence summary came out (246–260 characters) with the due date, the deadline and the amount. It took 1.3 s, cost $0.00010 and was left copied in the clipboard.
- **Bubble:** it was placed next to the cursor and inside the screen.
- **No selection:** a notice on screen and aloud.
- **Esc:** closes the bubble and gives the focus back to the source window.
- **Tests:** `backend/summary` (fake model, local alternative, cutting, language) and the web's lint, types and build.

## Ready for what is not defined yet
| Pending | What is ready | Who decides |
|---|---|---|
| Opening an option **by voice or by gesture** (for example, the `scan_document` action, «read the document») | The options are a list (`MODES`) and the menu only needs a `setView(id)`. The voice and gesture module can emit that command when it exists | Nil and Isaac |
| **Explaining** the document with AI (as the app does with `POST /scan`) | Not connected, so as not to spend. It would be enough to send the document over the WebSocket (`document`): Go already explains it and the cost shows up in `stats` | Team (cost, AXA) |
| **More formats** (Word, ePub…) | `FileTypes` in Go and a reader in `documents.py` | Didac |
| **MX Keypad** | The shortcut and all the keys are normal combinations, with no Logitech-specific code | Test it with the real keypad |
| Voice **language** | Fixed to es-ES in option 2; the reader uses the document's language if it has one | Team |
| **Linux and macOS** | The shortcut is only done for Windows; on the other systems the window stays open | If needed |
| **Visual design** | Functional, with large text and high contrast | Later |
| **Summarising with the hand cursor** | `TriggerSummary()` and the `overlay:summarize` event (see «Option 4») | Nil and Didac |
| What happens with the **previous screen** (`App.tsx`, with «Send sample document» and the diagnostics) | It opens with **D** from the menu | Isaac |

## What is tested
Tested on Windows 11 with the real `.exe`, sending the keys to the system and checking with screenshots and the log:
- The shortcut shows and hides the overlay from any program, and brings it to the front if it is covered. Esc hides it.
- **Option 3:** with `01-carta-renovacion.pdf`, the app started the reading service on its own in 1 s. It read 21 lines of the PDF in 16 ms and started reading them aloud, with the line highlighted.
- **Option 2:** the camera opened, the guide fired after 8 s and the service answered 422 (there was no paper in front). The app said so and offered to retry. The camera image came out with the covered-camera icon: it has to be repeated with the MX Brio uncovered and a paper.
- **Option 1:** (before merging it) Gesture Control started with its window. **Gestures inside the app: not tested on Windows yet** — only with tests, the Windows build and a browser test with simulated bindings.
- **Q and closing the window** also stop the reading service.
- **Tests:**
  - Go: `backend/overlay` (shortcuts, service URL) and `backend/scanner` (text, sending to `/document`, unsupported types);
  - Python: `scanner/test_service.py` (PDF with text, 2-page PDF, scanned PDF with OCR and invalid file): 33 out of 33;
  - web: lint without warnings, 136 tests and build.

**Not tested:**
- the MX Keypad;
- a real paper with the camera uncovered;
- a scanned PDF or an image from the app (it is, with the service's tests);
- Linux and macOS.

**Seen once:** in the first test, the `.exe` closed on its own, leaving nothing in the log, which did not work back then. It has not happened again. If it happens again, the reason now ends up in `lauzhack.log`.
