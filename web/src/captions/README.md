# Subtítulos en directo (`web/src/captions` + `backend/captions`)

Dueño: Pau (P4, rol B1). Brief: `docs/briefs/pau.md`. Contrato: `GET /captions` en `api/openapi.yaml` (0.7).

Muestra subtítulos de lo que se oye por el micrófono y, si se quiere, del audio de una pestaña o una llamada. Dice quién habla, traduce cada frase al idioma elegido y guarda la transcripción en un `.txt`. El historial no desaparece: la lista crece y se puede descargar.

## Cómo funciona
```
navegador (AudioWorklet, 16 kHz PCM16) --WebSocket /captions--> Go (backend/captions) --> Together AI
   ^                                                                 |  realtime: subtítulos (Nemotron)
   +---- partial / final / speaker / translation / cost / saved -----+  lotes: quién habla (Whisper, diarize)
                                                                        chat: traducción (Qwen3.5-9B)
```
- **Subtítulos:** el texto parcial se va actualizando mientras se habla y la frase queda fija con la pausa.
- **Quién habla:** cada 15 s de audio, Go diariza los últimos 25 s; los 10 s de solape sirven para reconocer a las mismas personas. Al pulsar *Stop* repite la diarización sobre toda la grabación, para que el `.txt` tenga las etiquetas bien.
- **Traducción:** solo de las frases terminadas, con caché. El idioma se cambia en directo.
- **Coste:** se ve en pantalla. Al llegar al tope por sesión (`CAPTIONS_LIMIT_USD`, 1 $ por defecto), la sesión se para.
- **Documento:** se guarda en `Documentos/LauzHack/captions-AAAA-MM-DD-HHMM.txt`, fuera del repo, cada minuto y al parar. El botón *Download transcript* descarga lo mismo desde la página.
- **Si falla:**
  - Go reintenta la conexión con Together 3 veces (a 1, 2 y 4 s) y la página reintenta 3 veces la conexión con Go;
  - después se ofrece *Use local Whisper*, el `WhisperListener` de Nil, que usa el micrófono por defecto y no tiene parciales, ni quién habla, ni traducción.

## Probarlo
1. En `.env`, en la raíz del repo (ignorado por git), pon `TOGETHER_API_KEY=...`. La clave no se escribe nunca en el repo.
2. Arranca el servidor: `task server` (o `go run ./backend/cmd/server`).
3. Arranca la página: `cd web` y `npm run dev`, y abre `http://localhost:5173/src/captions/page/`. Dentro de la app (Wails), el componente `<LiveCaptions />` encuentra solo la dirección de Go.
4. Elige el micrófono (la MX Brio sale primero si está), el idioma hablado y el de destino, y pulsa *Start*.
5. Para subtitular una llamada o un vídeo, pulsa *Add call audio* y elige la pestaña marcando «Compartir audio». En Chrome funciona; en la ventana de Wails puede no estar disponible.

Tests: `go test ./backend/captions`, con un Together falso que cubre el flujo, la diarización, la traducción, el tope, los reintentos y el `.txt`; y `npm test` en `web` (`src/captions/test`).

## Variables (todas opcionales, salvo la clave)
| Variable | Por defecto |
|---|---|
| `TOGETHER_API_KEY` | — (sin ella, la página dice que falta y ofrece Whisper local) |
| `CAPTIONS_ASR_MODEL` | `nvidia/nemotron-3.5-asr-streaming-0.6b` (alternativa: `nvidia/parakeet-tdt-0.6b-v3`) |
| `CAPTIONS_DIARIZE_MODEL` | `openai/whisper-large-v3` |
| `CAPTIONS_TRANSLATE_MODEL` | `Qwen/Qwen3.5-9B` |
| `CAPTIONS_LIMIT_USD` | `1` |
| `CAPTIONS_DIR` | `~/Documents/LauzHack` |

## Para la app (Isaac)
```tsx
import { LiveCaptions } from '../captions'
// p. ej. tras un botón «Live captions»:
<LiveCaptions onClose={() => setShowCaptions(false)} />
```
El componente ocupa el alto de su contenedor (`h-full`). Al cerrarlo, la sesión se termina y Go guarda la transcripción.
