# MX Keypad

Task N2 (`docs/tareas/N2.md`), brief `docs/briefs/N2.md`. Owner: Isaac.

The **MX Keypad** (MX Creative Console) controls the app **without installing anything**: it is plugged in over USB and the app reads its keys directly (without Logi Options+ or an SDK). It works **even when another program has the focus**: the app shows the overlay (if it was hidden or covered) and does the action. The menu says «MX Keypad connected» when it detects it.

**Fallback:** each action also has a **Ctrl+Alt+Shift + key** shortcut, registered globally on Windows. It works with Logi Options+, with the keypad over Bluetooth or through the Bolt receiver (untested), or with a normal keyboard.

## Keys (page 1)
Decided again by Isaac, key by key, on 2026-11-22 (they were in another order before). The fallback shortcut of key N is always **Ctrl+Alt+Shift+N**.

| Key | Action | What it does in the app |
|---|---|---|
| 1 | **Open/close the app** | shows or hides the overlay from any program (like Ctrl+Alt+Space) |
| 2 | PDF Scanner (read paper) | opens option 2 (camera) |
| 3 | Read Text (read file) | opens option 3 (PDF, image, text) |
| 4 | AI Summary | option 4: summarises the text selected in the program in front |
| 5 | Transcribe | opens option 5 (live captions) |
| 6 | Gesture Control | opens option 1 |
| 7 | **Voice command** | first press: a beep and a red «Recording…» notice; second: an end beep, it is transcribed (about 2 s) and the app carries out the command |
| 8 | Read/pause | `Space` in the open reader |
| 9 | Back to the menu | goes back to the menu (does not hide the window) |

Keys 2–5 match the numbers of the options on screen; Gesture Control is option 1 on screen and key 6 on the keypad. A key with the `off` action does nothing (it does not even show the overlay); every press shows up in the log as `overlay: keypad key N -> action`.

## Voice commands (key 7)
- **How it works:**
  - press 7, say the command and press 7 again;
  - Go transcribes it (`POST /transcribe`, the cheap audio model: about 2 s and $0.00006; with `LLM_PROFILE=dev`, the same model order as `LLM_TRANSCRIBE_MODELS`);
  - the sentence is turned into a keypad action.
- **The app always answers:**
  - it repeats on screen what it heard;
  - if it does not understand it, it says «I can't do: …».
- **Limit:** after 30 s the recording stops on its own.
- **It needs the key** (`OPENROUTER_API_KEY`). Without it, it says so.

| You say (Spanish, Catalan or English) | Does |
|---|---|
| «lee el documento», «escanea el papel», «llegeix el paper» | read paper (option 2) |
| «abre un archivo», «léeme el PDF» | read file (option 3) |
| «resume», «resumen» | summarise the selection (option 4) |
| «gestos» | option 1 |
| «menú», «vuelve», «atrás» | menu |
| «siguiente», «anterior», «repite» | in the reader |
| «pausa», «lee», «continúa» | read/pause |
| «oculta», «cierra» | hides the app |
| «sube el volumen», «más alto», «puja el volum», «louder» | raises the **system volume** by 10 % (Windows shows its indicator) |
| «baja el volumen», «más bajo», «baixa el volum», «quieter» | lowers the system volume by 10 % |
| «borra el texto», «elimina la selección», «esborra», «delete» | **deletes the selected text** in the program in front. It first checks that there is selected text (it copies it); if there is none, it deletes nothing and says «No text is selected». The clipboard stays as it was |

The phrases are in `web/src/app/overlay/voiceCommand.ts`, with tests.

## Using it
1. Plug the MX Keypad in over USB.
2. Start the app (`task overlay` → `build/bin/lauzhack.exe`). The log (`build/bin/lauzhack.log`) must say `MX Keypad read directly: connected=true`; it can also be plugged in with the app open (it looks for it every 2 s).
3. Test: with another program in front, press key 2 (read paper). The overlay should appear on that option. Then, key 7, say «abre un archivo» and key 7 again.

**Checked on 2026-11-22 with the real keypad, without Options+:** all 9 keys arrived with their action, two rounds in a row (with the previous table; the physical keys are the same). **Not tested yet:** the voice commands with a real microphone. Without a keypad it can be tested with the fallback combinations from the keyboard.

**With Logi Options+** (optional): on page 1, give each key **Action → Keyboard shortcut** with the combination from the table. If Options+ keeps the keypad for itself, the app keeps working through the shortcuts.

## If something does not work
- **A shortcut is taken by another program:**
  - the log says `overlay: keypad: could not register …`;
  - the menu warns about it in yellow;
  - the other keys keep working.
- **The menu does not say «MX Keypad connected»:** look at the log. Only the USB keypad is recognised (Logitech VID 046D, PID C354).
- **Turning the keypad off (direct reading and shortcuts):** `LAUZHACK_KEYPAD=off`.
- **Windows only.** On Linux and macOS there are no global shortcuts (just like Ctrl+Alt+Space).

## How it works (for whoever maintains it)
- **Direct reading:**
  - `backend/overlay/keypadhid.go` (format) and `keypadhid_windows.go` (opening the device);
  - the keypad sends `13 ff 02 00 <counter> 01 <key>` in a vendor HID collection, with the key from 1 to 9 on press and `00` on release (measured without Options+);
  - key N does row N of `DefaultKeypad`;
  - a test uses reports recorded from the real keypad.
- `backend/overlay/keypad.go`: the shortcut → action table (`DefaultKeypad`).
- `backend/overlay/hotkey_windows.go`: `ListenAll` registers all the shortcuts (`RegisterHotKey`) on a single thread, with one id per shortcut.
- `app_overlay.go` (`keypadPressed`): shows the window if needed and emits the Wails event `overlay:keypad` with the action.
- `web/src/app/overlay/keypad.ts`: translates the action.
  - The options and «menu» change the overlay's view.
  - The reading ones simulate the key the guided reader already understands (`web/src/document/reader.ts`), without touching the reader.
  - A test checks that those keys are still the reader's.
- **Adding a key:**
  1. an entry in `DefaultKeypad` (Go; with direct reading, there are only 9 keys per page);
  2. a case in `keypadCommand` (TS);
  3. a row in this table.

## Pending (optional)
- Page 2: turning the volume up and down (also as a voice command) and cursor mode (N5).
- The MX Creative Console's dial for the volume.
- Testing with the full app: a key pressed from another program → overlay, and unplugging and plugging back in.
- Keypad pages: changing page sends nothing that we have seen. Untested whether page 2 sends other numbers.
