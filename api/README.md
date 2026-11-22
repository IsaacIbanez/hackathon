# api/

Contract between modules. It is the only interface between backend and frontend.

- **Owner:** role A (Isaac).
- A change here is written down in `docs/DECISIONES.md` and the rest are told.

## Contents
| File | What it is |
|---------|--------|
| `openapi.yaml` | `GET /health`, `GET /ws` and the WebSocket messages in `components/schemas` |
| `fixtures/*.json` | an example of each message (`document`, `pointer`, `utterance`, `speak`, `speak-utterance`, `stats`) |
| `gen/types.gen.go` | generated Go types (package `gen`). **Do not edit** |
| `oapi-codegen.yaml` | configuration of the Go generator |
| `../web/src/api/types.ts` | generated TypeScript types. **Do not edit**; use the aliases in `web/src/api/index.ts` |

After changing `openapi.yaml`: `task gen` and commit what is generated.

## WebSocket messages
Common envelope: `{ "type": "...", "id": "...", "ts": 1795262400000, "payload": { ... } }` (`ts` in ms).
Coordinates normalised to [0, 1] over the cropped document, origin at the top left.

| type | Direction | payload |
|------|---------|---------|
| `document` | client → Go | `blocks[]` (`id`, `text`, `box {x,y,w,h}`, `confidence`), `quality {score, issues[]}`, optional `imageWidth`, `imageHeight`, `lang` |
| `pointer` | browser → Go | `x`, `y`, optional `blockId` |
| `utterance` | browser → Go | `text`, `isFinal`, optional `lang` |
| `speak` | Go → browser | `text`, `highlightBlockIds[]`, `lang`, optional `replyTo` |
| `document` (echo) | Go → all | the accepted document, as it is, so that the screen shows it even if the scanner sent it |
| `stats` | Go → all | accumulated cost and latency: `cheap` and `expensive` (`calls`, `cacheHits`, `errors`, `costUsd`, `avgLatencyMs`, `lastLatencyMs`) and `totalCostUsd`. Sent after each model call |

## `POST /scan` (contract 0.5)
The app sends the camera's photo (`image/jpeg`, `image/png` or `image/webp`, up to 40 MB) → `202`. Go says «One moment, I'm reading the document», passes it to the reading service (`SCANNER_URL`, by default `http://127.0.0.1:8770/scan`) and treats the returned document like any other. Problems are said aloud. `SCANNER_URL=fixture` answers with the sample form, without a service. The `document` can carry `pageCorners`: the page's corners in the photo (see `docs/INTEGRACION_SCANNER.md`).

## Shared session and `POST /message`
The app has **a single session** for all its clients: a message from anyone (the interface over WebSocket or the scanner with `POST /message`) updates the same state, and each `speak` and `stats` is sent to **all** WebSocket clients.

- `POST http://127.0.0.1:8765/message` with an envelope in the body → `202 {"ok":true}`; the answer reaches the interface, not here.
- A Python example with no dependencies: `api/examples/send_message.py` (and the guide `docs/INTEGRACION_SCANNER.md`).

## Mock server, real server and app
`task server` starts the real logic (sessions + models) without a window on `ws://127.0.0.1:8765/ws`; it needs the key in `.env`. It is what you should use to test the scanner or the frontend with real answers.

The desktop app (`task dev` or the executable) serves the same on `ws://127.0.0.1:8765/ws`, for now with the same sample answers. Any local process can connect (no browser needed).

`task mock` (or `go run ./backend/cmd/mock -addr localhost:8080`):
- `GET http://localhost:8080/health` → `{"status":"ok"}`
- `ws://localhost:8080/ws`: `document` → forwards the same `document` and answers `fixtures/speak.json` and `fixtures/stats.json`; final `utterance` → `fixtures/speak-utterance.json` and `stats`; `pointer` → no answer. The answer's `replyTo` is the received `id`.

A quick test from the browser console:
```js
const ws = new WebSocket("ws://localhost:8080/ws");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "utterance", id: "u1", ts: Date.now(), payload: { text: "hola", isFinal: true } }));
```
