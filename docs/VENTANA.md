# The app's window: shapes, hierarchy and who decides

**Read this before touching** `app_window.go`, `app_overlay.go`, `app_summary.go`, `web/src/app/overlay/gestureHost.ts` or anything that shows, hides or resizes the window. Fix R5 (Pau, 2026-11-22; sheet `docs/arreglos/R5.md`).

## The problem there was
The app is **a single Wails window** that takes several shapes. Before, six functions moved it each on their own (`SetLayer`, `SetCompact`, `SetScreenOverlay`, `HideOverlay`, the AI Summary bubble and the shortcut), with loose flags (`visible`, `compact`, `screen`, `bubble`, `layer`). None of them knew which shape was due when they finished, and the result was a chaos of windows opening, shrinking and closing:
- **Fist menu:** when closed, the window always ended up at 960×680 centred, even if before it was the full-screen layer.
- **Cursor mode:** it shrank the overlay to the bubble and, when turned off, opened it again.
- **Closing AI Summary:** it left the window at 960×680 without looking at which shape it was in.

## The current model
The pieces **only say what they want** (`windowInputs` in `app_window.go`) and **a single function decides and applies the shape** (`desiredShape` + `applyShape`, one transition at a time).

| Input | Who changes it | Means |
|---|---|---|
| `open` | The shortcut (Ctrl+Alt+Space), the keypad, Esc or «Hide» (`HideOverlay`), «Shrink to a camera bubble» and double-clicking the bubble (`SetCompact`) | The person wants to see the overlay |
| `layer` | The view (`SetLayer`, from `Overlay.tsx`) | `true`: full-screen layer (menu and reading tools); `false`: normal window (the Gesture Control page, so that its clicks reach the programs underneath) |
| `gestures` | `SetGesturesActive` (`gestureHost.ts`) | The gesture engine is using the camera (always since N1; PDF Scanner pauses it) |
| `gestureScreen` | `SetScreenOverlay` (the gesture page) | The fist menu or the volume/brightness control is open (temporary) |
| `summary` | AI Summary (`showBubble`, `CloseSummary`) | The summary bubble is open (temporary) |

**Hierarchy** (`desiredShape`; the first one that holds wins):
1. `summary` → **AI Summary bubble** next to the pointer.
2. `gestureScreen` (with the gestures active) → **gesture screen**: transparent and full screen, with the camera in a corner.
3. `open` and `layer` → full-screen **layer**.
4. `open` → centred 960×680 **window**.
5. `gestures` → **camera bubble** in a corner (the overlay is hidden, but the gestures carry on).
6. Nothing → **hidden**.

Since the shape always comes from the inputs, **when something temporary ends** (fist menu or summary) **the window goes back to exactly what was there**, without anyone remembering it by hand.

## Coexistence rules (decided with Pau)
- **The overlay rules; the gestures coexist.** Gesture Control never opens, closes or shrinks the overlay: it only puts its menu on top for a moment.
- **Cursor mode:** does not touch the window. With the overlay open, the hand cursor can press its buttons; with the overlay hidden, the bubble stays.
- **Hide** (Esc in the menu, «Hide», the shortcut with the overlay in front): with the gestures active it goes to the bubble; without gestures, it hides. If there is no working shortcut and no gestures, it only minimises, so that the window is not lost.
- **The shortcut:** with the overlay in front, it hides it. Hidden, in the bubble or covered by another window, it brings it to the front as it was.
- **The keypad:** brings the overlay back as it was and does the action. If the summary was open, it closes it.
- **When closing AI Summary**, the overlay hides (to the bubble if there are gestures) and the focus goes back to the program the text came from.

## How to check it
- **Every shape change is in the log:** `window: layer -> gesture-screen` in `build/bin/lauzhack.log`.
- **Tests:** `go test -run Shape .`, which tests the hierarchy and that the temporary shapes go back to the previous one.
- **Run with the `.exe`** (2026-11-22): startup → layer · Ctrl+Alt+Space → bubble · again → layer · key 8 → window · key 4 → layer · fist menu → `gesture-screen` → layer · Esc → bubble.

## If you add something that changes the window
1. **Do not call `wruntime.Window*` from a new function.** Add, if needed, an input to `windowInputs` and its place in `desiredShape`.
2. Change the inputs with `a.setWindow(func(in *windowInputs) { … }, raise)`. `raise=true` brings the window to the front even if the shape does not change.
3. Add the case to `app_window_test.go`.
4. **The page finds out through events** (do not change them without looking at `gestureHost.ts` and `Overlay.tsx`):
   - `overlay:expanded`: layer or window;
   - `overlay:compact`: bubble;
   - `overlay:screen`: gesture screen;
   - `overlay:hidden`;
   - `overlay:shown`: the page takes the keyboard focus.
