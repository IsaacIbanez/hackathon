# Status — P3-C

- **Person:** Nil
- **Tool:** Claude Code
- **Current task:** T6 (role C), hand gestures part. Voice comes later.
- **Branch:** `claude/kind-cray-863b6t` (the one assigned by the cloud session; it can be renamed to `feature/T6-hand-gestures` when opening the PR)
- **State:** in review (isolated prototype, waiting for the T2 contract)
- **Last change:** 2026-11-21

## Done
- `web/src/input/` module with no npm dependencies (MediaPipe is loaded from jsDelivr at runtime). All code, identifiers, event values and comments are in English.
- Poses: point, palm, fist, thumbs up, thumbs down, victory, pinch.
- Stable gestures (held ~0.3 s with the hand still), swipe left/right, smoothed pointer (One Euro) and dwell selection (~0.9 s pointing still).
- Mapping to actions per context (`document`, `form`, `pc`): `read`, `pause`, `next`, `previous`, `explain_here`, etc.
- Pointer in document coordinates through a homography from the paper's 4 corners.
- Tests with synthetic hands (`node --test 'web/src/input/test/*.test.ts'`, 43 tests) and type checking with `tsc`.
- Experimental: sleep/wake mode, palm only counts when facing the camera, fist disabled, 👎 thumbs down, 🤏 volume with the pinch, only from the menu (simple measure: on-screen thumb–index line ÷ hand size; fixed 0–100 % scale in 10 % steps; confirmed by holding still ~1 s), ✌️ quick menu chosen by holding the pointer on an option (without the option on the side of the hand in use, which is detected automatically), head gestures (nod and shake; blinking was removed at the team's request), reduced mobility profile and point + ask (demo only).
- Demo in `web/src/input/demo/` ("Gesture Lab"): centred camera, English UI, toggles for each experimental feature, pinch tuning sliders and a per-context gesture guide. Tested in headless Chromium with a fake camera: the model loads and analyses frames. Still needs testing with a real hand.

## To do
- Decide which experimental features stay after testing them with the camera.
- Test with the webcam and a real hand; tune thresholds (`DEFAULT_OPTIONS`, `DEFAULT_THRESHOLDS`).
- Connect to the WebSocket once T2 publishes the contract.
- Once `web/package.json` exists (T2): add `@mediapipe/tasks-vision@0.10.21` and pass `loadVision: () => import("@mediapipe/tasks-vision")`; serve the model locally so the demo doesn't depend on the network. Then delete `web/src/input/tsconfig.json`.
- Voice (microphone → `utterance`), the other half of T6.

## Blockers and questions for humans
- **Controlling the computer** (real Enter, tabs, click, scroll) would have to be done by Go with an OS automation library: discuss with Isaac (T2). For now only the actions are emitted.
- **Contract proposal (T2, Isaac):** `pointer` message = `{ "type": "pointer", "x": 0.42, "y": 0.31, "space": "document" | "image", "select": false, "t": 1234 }`, with `select: true` for the dwell selection. Plus a message for gesture actions, e.g. `{ "type": "action", "action": "read" | "pause" | "next" | "previous" | "repeat" | "explain_here", "source": "gesture" }`. My module emits local events; adapting them to that shape is trivial.
- **For B1:** I need the 4 document corners in normalized image coordinates (top-left, top-right, bottom-right, bottom-left) to map the pointer to document coordinates.
- The frontend must import with the `.ts` extension (`allowImportingTsExtensions`, like Vite's react-ts template) so the tests run with `node --test` without compiling.
- `CLAUDE.md` still says to reply and commit in Spanish; the team asked for English from now on, so a human should update that line.

## Files touched
- `web/src/input/**`
- `estado/P3-C.md`
