# Demo · Nil: gestures

Owner: **Nil**. Common plan and rules: `docs/demo/README.md`.

## What you review
| Piece | Where |
|---|---|
| Hand tracking and gestures (MediaPipe) | `web/src/input/` |
| The Gesture Control page, fist menu, cursor mode, volume and brightness level | `web/src/input/desktop/` (`gestureControl.ts`, `menu.ts`, `menuView.ts`, `gestureControl.css`) |
| The helper that really presses keys and moves the mouse | `adapters/desktop/` |
| The single camera shared with PDF Scanner, the bubble and «Main menu» | `web/src/app/overlay/gestureHost.ts` (Isaac's: tell them if you touch it) |

## What has to work in the demo
1. **Key 6** (Gesture Control): the overlay shrinks to the camera bubble at the top left and the gestures work.
2. **The bubble** only jumps to the other top corner when the hand cursor goes over it.
3. **Fist menu:** it opens, each option is chosen by holding the gesture, and it closes without leaving the window in an odd state.
   - «Main menu» (formerly «Close gestures») goes back to the overlay's main menu **without** turning off the camera or the gestures.
   - «Close app» closes it.
4. **Cursor mode:** move the mouse with your finger and click buttons of the overlay. The most important one is PDF Scanner's «Take photo».
5. **Three fingers** read aloud the text selected in another program; swiping back starts again and swiping forward ends.
6. **Volume and brightness with the pinch**, without jumps.
7. **Shared camera:** opening PDF Scanner (key 2) pauses the gestures and, when you leave, they come back on their own.

## Known bugs and risks
- **The fist menu's «Microphone» mutes the Windows mic.** If it stays muted, voice commands (key 7) hear nothing. It has to be visible: the option should clearly say «Muted» or «On» and the state should be the real one when the menu opens (today it starts as «Microphone» until pressed). Consider whether it should be in the demo.
- **Unintended actions:** 5 minutes of use without anything firing on its own (R2). Watch the log (`did:`).
- **The pinch** went from 20 % to 100 % and to 0 % in one second. It is fixed in R2: check it.
- **The camera with no light or covered:** the page has to say what is going on and not stay black.
- **Performance:** hand tracking runs on the main thread. If the overlay feels slow with gestures on, measure it (frames) before changing anything.

## How to test
`task overlay` → `build/bin/lauzhack.exe` with the MX Brio. Key 1 opens the menu and key 6 turns on the gestures. The tests are in `web/src/input/test/` (`task check`).

## Done when
- [ ] The 7 points above work twice in a row with the `.exe`.
- [ ] 5 minutes of use without unintended actions.
- [ ] The mic state in the fist menu is the real one.
- [ ] No camera or helper error without an on-screen message.

## Prompt for your agent
```
Read AGENTS.md, docs/demo/README.md and docs/demo/NIL.md. You work for Nil in the demo polish phase:
do not add features, make what exists robust. Review web/src/input, web/src/input/desktop and
adapters/desktop, one by one, against the points in «What has to work» and «Known bugs and risks».
Before changing code, reproduce it with the .exe (task overlay) and the log. One fix = one commit on a
demo/nil-<topic> branch, with its line in the Log of docs/demo/NIL.md. task check green before pushing.
If you need to touch gestureHost.ts or another folder, ask me first.
For each fix write or update its tests, run task check (and the tests of your part) and
test it with the .exe; open a PR and, with green CI, merge it yourself into main
(gh pr merge <n> --merge). Nobody reviews other people's work.
```

## Log (filled in by the agent)
For each bug: symptom → how to reproduce it → cause → fix → how it was checked (with the `.exe`).

**1. «Close gestures» left the gestures active (2026-11-22)**
- Symptom: after «Close gestures» the overlay came back, but the hand kept firing actions. There was also old code left that turned the camera off.
- Fix: «Close gestures» puts the gestures to sleep (`HandInteraction.sleepNow`), turns cursor mode off and goes back to the overlay; the camera stays on. An open palm or opening Gesture Control (key 6, `wakeNow`) wakes them up.
- Checked: new test in `experimental.test.ts`, `tsc`, 199 tests. The `.exe` is still missing (Nil tests it on Windows).

**2. «Microphone» did not show the real state (2026-11-22)**
- Symptom: the option said «Microphone» until pressed. Also, after pressing it on Windows it did not change either: the helper answers «microphone on» and the page was looking for «unmuted».
- Fix: the helper has `GET /api/mic` (`{"muted": true|false}`, `Desktop.MicMuted` on Windows, Linux and macOS). The page reads it at startup and when the menu opens (at most every 2 s); after pressing, it uses the helper's answer (`micStateOf`). If that fails, it reads the real state again. When muted, it warns that voice commands will not hear.
- Checked: `TestServerMicState` (Go), tests of `micStateOf` and `micMuted` (web), `go vet` Linux and Windows, 201 tests. The `.exe` is still missing (Nil on Windows).

**3. «Close gestures» becomes «Main menu» (2026-11-22, asked for by Nil after testing it)**
- Symptom: a way was needed to go back to the overlay's general menu without turning the gestures off completely; fix 1 put them to sleep.
- Fix: ↖ «Main menu» shows the overlay's main menu (`gestures:main-menu` → `view = "menu"`) and, from the bubble, restores the window. The gestures and cursor mode stay active. `sleepNow` is removed; `wakeNow` stays for key 6.
- Checked: tests updated, `tsc`, 201 tests, web build. The `.exe` is still missing (Nil on Windows).

**4. Thumb to the left = go back and undo (2026-11-22, asked for by Nil)**
- What: the fist with the thumb pointing to the user's left (`thumbs_left`, in `poses.ts`) goes back in the fist menu (thumbs down no longer does). If volume or brightness is waiting for the pinch, it cancels it. Outside the menu it undoes the last action (15 s): volume and brightness back to the value before, microphone and cursor mode.
- To restore the exact value, the helper reads the current volume and brightness: `GET /api/level?target=volume|brightness` (`Desktop.Level`; Windows through Core Audio and WMI, Linux with wpctl/pactl/amixer and brightnessctl/light, macOS volume only).
- Checked: `TestServerLevel`, `TestParsePercent` (Go), pose, menu, cancel and `level()` tests (web), `go vet` Linux, Windows and macOS, 209 tests, web build, and Nil tested it with the `.exe` on Windows.
