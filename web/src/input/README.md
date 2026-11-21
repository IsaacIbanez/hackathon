# Hand module (role C — T6, gestures)

Turns hand landmarks (MediaPipe HandLandmarker, in the browser) into app events and actions.
No npm dependencies: MediaPipe is loaded at runtime from jsDelivr
(`@mediapipe/tasks-vision@0.10.21`) and the model from Google Storage.

## Gestures
Few gestures, many actions: the meaning depends on the **context** (`document`, `form`, `pc`),
defined in `actions.ts` (`MAPS`). Items marked BETA are experimental.

| Gesture | Document | Form | Computer |
|---|---|---|---|
| 👍 thumbs up (hold ~0.3 s) | read | confirm field | Enter |
| ✋ open palm facing the camera, held still | pause | pause | Escape |
| ✋↔ swipe to the user's right / left | next / previous | next / previous field | next / previous tab |
| ☝️ point | pointer | pointer | pointer |
| ☝️ point and hold still ~0.9 s | explain here | dictate field | click |
| 👎 thumbs down (BETA) | undo | clear field | undo |
| ✌️ victory → quick menu; ☝️ hold the pointer on an option ~0.5 s (BETA) | ↑ adjust volume · ↓ repeat · ask for help on the side opposite the hand (no hand detected: → dictate, ← ask for help) | same | same |
| ✌️ menu → adjust volume, then 🤏 pinch and open; hold still ~1 s to set it (BETA) | volume | volume | volume |
| 🙂 nod (BETA, head) | read | confirm field | Enter |
| 🙂 shake (BETA, head) | pause | clear field | Escape |

Experimental options (in `InteractionOptions`):
- `requireWake`: sleep/wake mode. Gestures are ignored until an open palm is held ~1 s (or the
  user nods); it goes back to sleep after `sleepMs` without activity. Avoids accidental gestures.
- `REDUCED_MOBILITY_PROFILE`: longer times and larger radii for tremor or reduced mobility.
- Volume with the pinch (`level` event), deliberately simple. **Only enabled from the menu**
  ("adjust volume" option, which calls `startLevel()`) so it can't trigger by accident; if the fingers
  don't touch within `levelArmMs` (8 s), it is cancelled:
  - Measure = on-screen distance between the thumb and index fingertips ÷ the hand's on-screen size
    (wrist → middle knuckle), `screenSeparation`. It is the line that gets drawn; dividing by hand
    size makes it independent of the distance to the camera.
  - Measure ≤ `levelZero` (0.25) = 0 %; ≥ `levelFull` (1.0) = 100 %; linear in between, rounded to
    `levelStep` (10 %) steps with a little hysteresis (`levelHysteresis`).
  - To start, the fingers are brought below `levelZero` for ~0.15 s (with the index not tucked into a
    fist). It is confirmed by holding still ~1 s (`levelConfirmMs`).
  - Guided calibration: `setLevelScale(together, open)`; in the demo, the “Calibrate volume” button
    and sliders for the thresholds. In the demo it really changes the voice volume.
- Palm: only counts when the palm (not the back of the hand) faces the camera (`palmMustFaceCamera`),
  based on the detected hand and the order of the knuckles in the image.
- Fist: disabled by default (`useFist: false`): it is neither emitted nor ends the volume control.
- Menu: after opening it with ✌️, the user shows ☝️ and holds the pointer (the index tip) over an
  option for `menuSelectMs` (~0.5 s). Options fill fixed screen zones in a cross (thirds,
  `screenSector`); with ✌️ or in the centre nothing is chosen; it closes by itself after 5 s.
- Hand in use: detects which hand the user is using (`handInUse`, a smoothed vote over MediaPipe's
  label; `invertHandedness` in case it comes out swapped). The menu removes that hand's side
  (`menuSectors`, `menuFor`): ↑ adjust volume, ↓ repeat and, on the opposite side, ask for help.
  If the hand is unknown, all 4 options are shown.
- Several people or hands: the tracker detects up to 2 hands and 2 faces (`numHands`, `numFaces`)
  and the interaction follows the one nearest the camera (largest in the image, `handExtent`). Another
  hand only takes over when it is clearly nearer (`switchHandRatio`, 1.25), and switching resets the
  gesture in progress. `activeHand` tells which one is followed (the demo draws the others dimmed).
- Head: `createTracker(..., { face: true })` or `tracker.enableFace(true)` (another model, ~4 MB;
  only 1 in every 2 frames is analysed).
- Point + ask: only in the demo, using the browser's speech recognition (Chrome/Edge; Firefox
  doesn't have it).

Times and thresholds live in `DEFAULT_OPTIONS` (`interaction.ts`) and `HEAD_DEFAULTS` (`head.ts`).

## Usage
```ts
import { HandInteraction, createTracker, actionFor } from "./input/index.ts";

const interaction = new HandInteraction();       // { mirror: false } if the camera looks down at the paper
interaction.on((e) => {
  const action = actionFor(e, "document");       // "read" | "pause" | ... | null
  // e.type === "pointer" / "select": e.document is {x,y} in [0,1] within the document, or null
});
await createTracker(videoElement, (frame) => interaction.process(frame));
interaction.setDocument(corners);                // paper corners in the image (from B1)
```

Coordinates: `image` is the normalized [0,1] position in the camera frame **without mirroring**
(the same ones B1 uses). `document` is computed with a homography from the paper's 4 corners
(top-left, top-right, bottom-right, bottom-left), so it matches the text boxes of the `document`
message.

## Testing
The module's tests run with the rest of the frontend (`task check` → `npm test`):
```bash
cd web && npm test
```
Demo with the camera (needs Vite; it can run without installing anything in the repo):
```bash
npx vite@5.4.11 web/src/input
```
then open http://localhost:5173/demo/. To mark the document, press the button and click its 4
corners as you see them. Without access to jsDelivr, serve `@mediapipe/tasks-vision` locally and
pass `?mp=<path>`.

## Files
- `types.ts`: types and landmark indices.
- `poses.ts`: static pose (each finger's straightness; independent of rotation and distance).
- `interaction.ts`: gesture stabilisation, swipe, filtered pointer, dwell selection and the
  experimental features (sleep/wake, pinch level, quick menu, head).
- `actions.ts`: events to app actions, per context, plus the quick menu options.
- `head.ts`: nod and shake (experimental).
- `geometry.ts`, `filter.ts`: homography and One Euro filter.
- `tracker.ts`: the only file that depends on MediaPipe and the DOM.
- `demo/`: test page. `test/`: tests with synthetic hands.
