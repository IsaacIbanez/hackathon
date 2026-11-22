# Live captions (`web/src/captions` + `backend/captions`)

Owner: Pau (P4, role B1). Brief: `docs/briefs/subtitulos.md`. Contract: `GET /captions` in `api/openapi.yaml` (0.7).

Shows captions of what is heard through the microphone and, if wanted, of the audio of a tab or a call. It says who is speaking, translates each sentence into the chosen language and saves the transcript to a `.txt`. The history does not disappear: the list grows and can be downloaded.

## How it works
```
browser (AudioWorklet, 16 kHz PCM16) --WebSocket /captions--> Go (backend/captions) --> Together AI
   ^                                                                 |  realtime: captions (Nemotron)
   +---- partial / final / speaker / translation / cost / saved -----+  batch: who is speaking (Whisper, diarize)
                                                                        chat: translation (Qwen3.5-9B)
```
- **Captions:** the partial text keeps updating while speaking and the sentence becomes fixed at the pause.
- **Who is speaking:**
  - Every 15 s of audio, Go diarises the last 45 s; the 30 s of overlap are used to recognise the same people.
  - With *People speaking* (2, 3…) it is told how many people there are, and that is what helps the most.
  - If each person speaks their own language, the language decides who is speaking in the long sentences.
  - On *Stop* it repeats the diarisation over the whole recording, so that the `.txt` has the labels right, and it keeps the numbering already shown.
- **Languages and barbarisms:** each person can speak a different language. Each sentence comes out with its language (`ES`, `EN`) and with the words from another language in quotes: `el "meeting"`.
- **Translation:** of the finished sentences, in the same call as the language. The target language is changed live.
- **Check against the real service** (costs less than a cent): `go test -tags live -run Live -v ./backend/captions`.
- **Cost:** shown on screen. When the per-session cap is reached (`CAPTIONS_LIMIT_USD`, $1 by default), the session stops.
- **Document:** saved to `Documents/LauzHack/captions-YYYY-MM-DD-HHMM.txt`, outside the repo, every minute and on stop. The *Download transcript* button downloads the same from the page.
- **If it fails:**
  - Go retries the connection with Together 3 times (at 1, 2 and 4 s) and the page retries the connection with Go 3 times (`reconnect.ts`);
  - a final error (no key, key rejected, cost cap) is not retried: the page says once what to do;
  - after that, *Use local Whisper* is offered, Nil's `WhisperListener`, which uses the default microphone and has no partials, no who-is-speaking and no translation.

## Trying it
1. In `.env`, in the repo root (ignored by git), set `TOGETHER_API_KEY=...`. The key is never written to the repo.
2. Start the server: `task server` (or `go run ./backend/cmd/server`).
3. Start the page: `cd web` and `npm run dev`, and open `http://localhost:5173/src/captions/page/`. Inside the app (Wails), the `<LiveCaptions />` component finds Go's address on its own.
4. Choose the microphone (the MX Brio comes first if it is there), the spoken language and the target one, and press *Start*.
5. To caption a call or a video, press *Add call audio* and choose the tab ticking «Share audio». It works in Chrome; in the Wails window it may not be available.

Tests: `go test ./backend/captions`, with a fake Together that covers the flow, the diarisation, the translation, the cap, the retries and the `.txt`; and `npm test` in `web` (`src/captions/test`).

## Variables (all optional, except the key)
| Variable | Default |
|---|---|
| `TOGETHER_API_KEY` | — (without it, the page says it is missing and offers local Whisper) |
| `CAPTIONS_ASR_MODEL` | `nvidia/parakeet-tdt-0.6b-v3` (with a single language `nvidia/nemotron-3.5-asr-streaming-0.6b` also works) |
| `CAPTIONS_DIARIZE_MODEL` | `nvidia/parakeet-tdt-0.6b-v3` |
| `CAPTIONS_TRANSLATE_MODEL` | `Qwen/Qwen3.5-9B` |
| `CAPTIONS_LIMIT_USD` | `1` |
| `CAPTIONS_DIR` | `~/Documents/LauzHack` |

## For the app (Isaac)
```tsx
import { LiveCaptions } from '../captions'
// e.g. after a «Live captions» button:
<LiveCaptions onClose={() => setShowCaptions(false)} />
```
The component takes its container's height (`h-full`). When it is closed, the session ends and Go saves the transcript.
