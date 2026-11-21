# web/ (React + Vite + TypeScript + Tailwind)

Interfaz dentro de la app de escritorio. Captura cámara y micro y hace en local el trabajo barato.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `src/api` | rol A | tipos generados del contrato (`types.ts`, no editar) y alias (`index.ts`) |
| `src/app` | rol A | app, conexión, voz (`voice.ts`), contador de coste y **puente de gestos** (`bridge.ts`, `Gestures.tsx`) |
| `src/camera` | rol B1 | flujo de cámara, detección y recorte del documento, OCR local |
| `src/document` | rol B2 | vista del documento, campos resaltados |
| `src/input` | rol C | gestos de mano (MediaPipe) y voz |

Lee primero `../api/` (el contrato) y solo tu carpeta.

## Cómo arrancarlo
- Con ventana: `task dev` (`wails dev` desde la raíz).
- Sin ventana: `task mock` en la raíz y `npm run dev` aquí; abre la URL de Vite en el navegador.
- URL del WebSocket: dentro de Wails se la pide a Go (`WsURL()`, normalmente `ws://127.0.0.1:8765/ws`); fuera de Wails usa `VITE_WS_URL` o, por defecto, el mock (`ws://localhost:8080/ws`).
- `wailsjs/` lo genera Wails: no se edita a mano.

## Puente de gestos (`src/app/bridge.ts`)
Convierte los eventos del módulo de manos (rol C, `src/input`) en mensajes del contrato:

| Gesto (acción de `src/input`) | Mensaje | ¿Gasta IA? |
|---|---|---|
| ☝️ señalar | `pointer` con x, y del documento (máx. 5/s); Go busca el bloque y lo lee | No |
| ☝️ mantener (`explain_here`) | `pointer` + `utterance` «¿Qué pone aquí y qué tengo que hacer?» | Sí |
| 👍 `read` | `utterance` «Léeme el documento.» | Sí |
| menú → `ask_for_help` | `utterance` «Necesito ayuda con este documento.» | Sí |
| ✋ `pause`, menú → `repeat`, 🤏 `volume` | control local de la voz | No |
| menú → `dictate` | hook `onDictate` (entrada de voz: rol C) | — |

**Provisional:** mientras no se decida quién es dueño de la cámara, `Gestures.tsx` toma la imagen entera de la cámara como documento (`WHOLE_FRAME`).
Tests: `npm test` (`src/app/test/bridge.test.ts`).
