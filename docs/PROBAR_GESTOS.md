# Testing the gestures and the voice (5 minutes, no scanner)

No paper needed: the app uses a **sample form** and **the whole image of your webcam acts as the paper**. The fields are drawn on top of your image, so you can see where each one is and where your finger points.

## 1. Start
1. In the repo root: `task dev` (the first time it takes a while).
2. At the bottom, expand **Developer tools** → press **Send sample document**. The form shows up on the right in large type and the app explains it aloud.
3. Press **Turn on hand gestures** and allow the camera.

You will see your image (like a mirror) with **four white boxes**: title at the top, name and date below, signature at the bottom right.

## 2. Point
- Raise your hand and **stretch out only the index finger** (the other fingers closed), with the palm facing the camera or sideways.
- A **blue dot** appears where your finger points and, over the video, the text **«☝️ Pointing»**. If it does not appear, the gesture is not recognised: bring the hand closer, improve the light or close the other fingers more.
- Move the blue dot onto a box: it **turns yellow**, **its text in large type** appears at the top and the app **reads it** instantly (no AI).
- Leave the box and come back: it **reads it again**. Staying inside does not repeat.

## 3. Ask by voice
- With **Ask with my voice** ticked, **hold the blue dot still for ~1 s** over a box → «Listening…» and a beep → ask aloud, for example **«¿Qué tengo que poner aquí?»** (What do I have to put here?).
- Your sentence shows in blue; the answer arrives in 2–5 s, talking about the pointed field. The first time it downloads the voice model (~40 MB).
- If you say nothing, it asks by default «¿qué pone aquí?» (what does it say here?).
- Without the checkbox, holding still asks directly for the field's explanation.

## 4. Other gestures
| Gesture | Does |
|---|---|
| ✋ open palm, still | goes quiet |
| 👍 | continues what was paused (or summarises the document) |
| ✌️ and then pointing at an option | menu: repeat, volume, help |

## If something does not work
| What happens | Try |
|---|---|
| No blue dot | more light, hand closer (40–70 cm), only the index finger stretched out |
| The dot moves the wrong way | it should not: report it (the mirroring was fixed on 2026-11-21) |
| It reads the next field | the boxes have a reach margin; point at the centre of the box |
| It does not answer questions | look at «Developer tools» (dictation and voices) and `build/bin/lauzhack.log` if you use the `.exe` |

Once the scanner is connected, the boxes will be the real paper's, not the whole image.
