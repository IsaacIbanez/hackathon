# api/

Contrato entre módulos. Es la única interfaz entre backend y frontend.

- **Dueño:** rol A (Isaac).
- Un cambio aquí se anota en la sección Decisiones de `AGENTS.md` y se avisa al resto.

## Contenido
| Archivo | Qué es |
|---------|--------|
| `openapi.yaml` | `GET /health`, `GET /ws` y los mensajes del WebSocket en `components/schemas` |
| `fixtures/*.json` | un ejemplo de cada mensaje (`document`, `pointer`, `utterance`, `speak`, `speak-utterance`, `stats`) |
| `gen/types.gen.go` | tipos Go generados (paquete `gen`). **No editar** |
| `oapi-codegen.yaml` | configuración del generador de Go |
| `../web/src/api/types.ts` | tipos TypeScript generados. **No editar**; usa los alias de `web/src/api/index.ts` |

Tras cambiar `openapi.yaml`: `task gen` y commitea lo generado.

## Mensajes del WebSocket
Sobre común: `{ "type": "...", "id": "...", "ts": 1795262400000, "payload": { ... } }` (`ts` en ms).
Coordenadas normalizadas a [0, 1] sobre el documento recortado, origen arriba a la izquierda.

| type | Sentido | payload |
|------|---------|---------|
| `document` | navegador → Go | `blocks[]` (`id`, `text`, `box {x,y,w,h}`, `confidence`), `quality {score, issues[]}`, opcional `imageWidth`, `imageHeight`, `lang` |
| `pointer` | navegador → Go | `x`, `y`, opcional `blockId` |
| `utterance` | navegador → Go | `text`, `isFinal`, opcional `lang` |
| `speak` | Go → navegador | `text`, `highlightBlockIds[]`, `lang`, opcional `replyTo` |
| `stats` | Go → navegador | coste y latencia acumulados: `cheap` y `expensive` (`calls`, `cacheHits`, `errors`, `costUsd`, `avgLatencyMs`, `lastLatencyMs`) y `totalCostUsd`. Se envía tras cada llamada a un modelo |

## Servidor mock y app
La app de escritorio (`task dev` o el ejecutable) sirve lo mismo en `ws://127.0.0.1:8765/ws`, por ahora con las mismas respuestas de ejemplo. Cualquier proceso local puede conectarse (no hace falta un navegador).

`task mock` (o `go run ./backend/cmd/mock -addr localhost:8080`):
- `GET http://localhost:8080/health` → `{"status":"ok"}`
- `ws://localhost:8080/ws`: `document` → responde `fixtures/speak.json` y después `fixtures/stats.json`; `utterance` final → `fixtures/speak-utterance.json` y `stats`; `pointer` → no responde. El `replyTo` de la respuesta es el `id` recibido.

Prueba rápida desde la consola del navegador:
```js
const ws = new WebSocket("ws://localhost:8080/ws");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "utterance", id: "u1", ts: Date.now(), payload: { text: "hola", isFinal: true } }));
```
