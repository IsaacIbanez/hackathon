# web/ (React + Vite + TypeScript + Tailwind)

Interfaz dentro de la app de escritorio. Captura cámara y micro y hace en local el trabajo barato.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `src/api` | rol A | tipos generados del contrato (`types.ts`, no editar) y alias (`index.ts`) |
| `src/app` | rol A | estructura de la app, pantallas comunes, contador de coste |
| `src/camera` | rol B1 | flujo de cámara, detección y recorte del documento, OCR local |
| `src/document` | rol B2 | vista del documento, campos resaltados |
| `src/input` | rol C | gestos de mano (MediaPipe) y voz |

Lee primero `../api/` (el contrato) y solo tu carpeta.

## Cómo arrancarlo
- Con ventana: `task dev` (`wails dev` desde la raíz).
- Sin ventana: `task mock` en la raíz y `npm run dev` aquí; abre la URL de Vite en el navegador.
- El WebSocket se toma de `VITE_WS_URL` (por defecto `ws://localhost:8080/ws`, el mock).
- `wailsjs/` lo genera Wails: no se edita a mano.
