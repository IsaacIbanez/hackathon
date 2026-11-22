# web/src/camera — camera and sharpest photo (role B1, Pau)

Opens **a single camera** (the Logitech one if it is there) and takes the **sharpest photo** for `POST /scan`.
The same sharpness criterion as `scanner/capturar.py` (variance of the Laplacian).

## Interface (the one A and C use)
```ts
import { openCamera, captureStill } from '../camera/index.ts'

const stream = await openCamera()        // MediaStream; the MX Brio if it is connected
video.srcObject = stream; await video.play()
// … gestures with the same <video> …
const photo = await captureStill(video)  // Blob image/png: the sharpest frame of ~0.5 s
await fetch('http://127.0.0.1:8765/scan', { method: 'POST', body: photo, headers: { 'Content-Type': photo.type } })
```

| Function | What it does |
|---|---|
| `openCamera(opts?)` | Prefers the camera whose name contains «Brio», then «Logitech» or «Logi»; ignores virtual cameras («Logi Capture»…). If there is none, it opens whichever there is. It asks for 3840x2160 at 30 fps (`width`, `height`, `frameRate`); the camera delivers the closest it supports. Options: `prefer: /acer/i`, `deviceId`. |
| `captureStill(video, opts?)` | Looks at the frames for `durationMs` (500 by default), measures the sharpness of each one on a 960 px wide copy (~5 ms) and returns the sharpest **at full resolution**, without mirroring or cropping. Lossless PNG by default; `type: 'image/jpeg'` (quality 0.95) weighs less and encodes sooner. |
| `captureStillDetailed(video, opts?)` | The same, but also returns `width`, `height`, `sharpness`, `brightness`, `frames` and `elapsedMs`. |
| `describeStream(stream)` | «MX Brio 3840x2160 @ 30 fps», for logs and diagnostics. |

### Framing guide and automatic shot (T19)
```ts
import { startFramingGuide } from '../camera/index.ts'

const guide = startFramingGuide(video, {
  lang: 'es-ES',
  onHint: (hint, text) => speaker.say(text),        // the app says it aloud
  onCapture: (photo, info) => sendToScan(photo),    // PNG Blob; info.reason = 'ready' | 'timeout'
  timeoutMs: 8000,                                  // optional
})
// guide.stop() if the user cancels
```
- It looks at each video frame, locally and without AI, and gives hints: `dark` («there is little light»), `moving` («the paper is moving»), `blurry» («it is blurry: move it a little further away»), `hold_still` («like that, don't move it»). Texts in Spanish, Catalan and English (`hintText`); for any other language, English.
- A hint has to last 0.3 s before it is said (one odd frame does not speak), it is not repeated while it stays the same, and it is repeated after 5 s if the problem continues.
- **Automatic shot:** when the paper has been **still for 0.7 s**, has **light** and the **sharpness is stable** (the autofocus has finished), it keeps the sharpest frame of that still moment at full resolution, plays a short beep, says «Photo taken» (`onHint('ready', …)`) and calls `onCapture`. Then it stops on its own.
- If it does not manage it within `timeoutMs` (8 s), it fires anyway with the best photo seen (`info.reason = 'timeout'`).
- What depends on the page (cut off, far, tilted) is said by Go with the scanner's `document`; it is not detected here.
- Thresholds (`thresholds`, see `DEFAULT_THRESHOLDS` in `framing.ts`), measured with the MX Brio:
  - Still if the mean difference between frames (960 px copy reduced 4x4) is below **4.5**. With a still scene, the MX Brio gives 1.4 on average and less than 2.8 in 95 % of the frames.
  - Dark if the mean grey is below **50**. A lit white page goes above 100.
  - Absolute sharpness depends a lot on the scene (from 24 to 700 with the same camera), so «blurry» only fires below **15**, when there is no detail at all. What really decides the shot is that the sharpness is **stable**: the last 4 frames, with a 15 % margin.
- The test page shows these values live to tune them.

Notes:
- The cameras' names are only visible after permission is given. If they cannot be seen yet, `openCamera` opens the default camera and, if the Logitech one then appears, switches to it.
- The «hold the paper still» notice is given by the app (role A) before calling `captureStill`.
- 4K by default because handwriting has to be readable. If the gestures are slow on some machine, it can be opened with `openCamera({ width: 1920, height: 1080 })`.
- Two programs cannot use the MX Brio at the same time: if `scanner/capturar.py --servidor` is open, the app will not be able to open it (and vice versa).

## Testing
- Tests without a camera: `cd web && npm test` (`src/camera/test/`).
- Test page with the camera: from the root, `npx vite web/src/camera` and open http://localhost:5173/demo/. Buttons «Open camera», «Capture still» and «Start framing guide» (it says the hints aloud with the browser's voice and shows light, sharpness and movement live); it shows the chosen camera, the resolution, the sharpness, how long it took and a link to download the photo.

## Files
- `open.ts`: `openCamera`, `describeStream`.
- `still.ts`: `captureStill`, `captureStillDetailed`.
- `guide.ts`: `startFramingGuide` (video → hints and shot).
- `framing.ts`: the guide's logic, `FramingJudge` and `HintGate`, and the texts (no DOM, with tests).
- `frames.ts`: canvas and frame utilities shared by `still.ts` and `guide.ts`.
- `shutter.ts`: the «photo taken» beep, in the style of the voice ones (`src/input/voice/earcons.ts`).
- `select.ts`: picking the camera by name (no DOM, with tests).
- `sharpness.ts`: brightness, sharpness and movement (no DOM, with tests).
- `demo/`: test page. `test/`: tests.
