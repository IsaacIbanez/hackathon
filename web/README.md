# web/ (React + Vite + TypeScript + Tailwind)

Interfaz dentro de la app de escritorio. Captura cámara y micro y hace en local el trabajo barato.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `src/app` | rol A | estructura de la app, pantallas comunes, contador de coste |
| `src/camera` | rol B1 | flujo de cámara, detección y recorte del documento, OCR local |
| `src/document` | rol B2 | vista del documento, campos resaltados |
| `src/input` | rol C | gestos de mano (MediaPipe) y voz |

Lee primero `../api/` (el contrato) y solo tu carpeta.
