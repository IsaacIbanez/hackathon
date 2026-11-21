# Status — P3-C

- **Person:** Nil
- **Tool:** Claude Code
- **Current task:** T6 (role C): voice (speaking and listening) and gestures acting on the real computer (Gesture Control helper).
- **Branch:** `claude/kind-cray-863b6t` (the one assigned by the cloud session; it can be renamed to `feature/T6-hand-gestures` when opening the PR)
- **State:** in progress (hand module merged in #9; desktop helper on this branch, not in a PR yet)
- **Last change:** 2026-11-21

## Done
- `web/src/input/` module with no npm dependencies (MediaPipe is loaded from jsDelivr at runtime). All code, identifiers, event values and comments are in English.
- Poses: point, palm, fist, thumbs up, thumbs down, victory, pinch.
- Stable gestures (held ~0.3 s with the hand still), swipe left/right, smoothed pointer (One Euro) and dwell selection (~0.9 s pointing still).
- Mapping to actions per context (`document`, `form`, `pc`): `read`, `pause`, `next`, `previous`, `explain_here`, etc.
- Pointer in document coordinates through a homography from the paper's 4 corners.
- Tests with synthetic hands (43, run by `npm test` in `web/`); the module builds with the app (`npm run build`) and passes `oxlint`.
- Experimental: sleep/wake mode, palm only counts when facing the camera, fist disabled, 👎 thumbs down, 🤏 volume with the pinch, only from the menu (simple measure: on-screen thumb–index line ÷ hand size; fixed 0–100 % scale in 10 % steps; confirmed by holding still ~1 s), ✌️ quick menu chosen by holding the pointer on an option (without the option on the side of the hand in use, which is detected automatically), head gestures (nod and shake; blinking was removed at the team's request), reduced mobility profile and point + ask (demo only).
- Demo in `web/src/input/demo/` ("Gesture Lab"): centred camera, English UI, toggles for each experimental feature, pinch tuning sliders and a per-context gesture guide. Tested in headless Chromium with a fake camera: the model loads and analyses frames. Still needs testing with a real hand.

- **Gesture Control** (`adapters/desktop/` + `web/src/input/desktop/`): a local Go helper that performs gesture actions on the real computer — shortcuts, mouse, system volume and video-call controls (Meet, Zoom, Teams: mute, camera, raise hand, leave) on Windows, Linux and macOS, behind a per-run token on 127.0.0.1. New `call` context: ✋ raise hand, 👍 mute, 👎 camera, ✌️ menu ↓ leave. The tracker keeps running when its window is hidden. Tested with Go/TS tests and a dry run end to end; not yet on a real desktop.

- **Voice** (`web/src/input/voice/`): `Speaker` reads sentence by sentence (pause/resume where it stopped, repeat the last sentence, best voice for the language, no 15 s cut-off) and is a drop-in for `app/voice.ts`. `VoiceInput` listens push-to-talk (point and hold, or menu → dictate) with beeps and captions: short commands ("para", "repite", "más alto"…) run locally; anything else goes to Go as an `utterance`; saying nothing sends the default "¿Qué pone aquí?". Listening uses the browser recognizer and falls back to local Whisper (transformers.js, audio stays on the computer) where the browser one doesn't work, e.g. inside Wails. Wired into `app/Gestures.tsx` and `app/App.tsx` (role A files: small change, please review). Whisper could not be tried here (Hugging Face is blocked in my environment).

## To do
- Test Gesture Control on a real desktop (Windows, Linux, macOS) with a real call; check each app's shortcuts.
- Decide which experimental features stay after testing them with the camera.
- Test with the webcam and a real hand; tune thresholds (`DEFAULT_OPTIONS`, `DEFAULT_THRESHOLDS`).
- Connect to the WebSocket now that T2 has published the contract (`api/openapi.yaml`).
- Add `@mediapipe/tasks-vision@0.10.21` to `web/package.json` and pass `loadVision: () => import("@mediapipe/tasks-vision")`; serve the model locally so the demo doesn't depend on the network.
- Try voice on a real computer: browser recognizer in Chrome/Edge and local Whisper inside the Wails app (first use downloads ~40 MB).

## Blockers and questions for humans
- **New folder `adapters/desktop/`** (Go helper, role C): it follows the decision that adapters live in `adapters/` and talk to the app locally. It is a separate program and doesn't touch the Wails app; please confirm, and add it to the Decisions in `AGENTS.md`.
- **Contract proposal (T2, Isaac):** `pointer` message = `{ "type": "pointer", "x": 0.42, "y": 0.31, "space": "document" | "image", "select": false, "t": 1234 }`, with `select: true` for the dwell selection. Plus a message for gesture actions, e.g. `{ "type": "action", "action": "read" | "pause" | "next" | "previous" | "repeat" | "explain_here", "source": "gesture" }`. My module emits local events; adapting them to that shape is trivial.
- **For B1:** I need the 4 document corners in normalized image coordinates (top-left, top-right, bottom-right, bottom-left) to map the pointer to document coordinates.
- **Language of the docs:** the new rule in `AGENTS.md` (#8) keeps documentation (`*.md`, `estado/`) in Spanish, but Nil asked for everything in English, so `web/src/input/README.md` and this file are in English. Confirm which one the team prefers.

## Files touched
- `web/src/input/**`
- `estado/P3-C.md`
