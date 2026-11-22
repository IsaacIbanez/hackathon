# Mapa del repositorio: qué hay, de quién es y por dónde entrar

Úsalo en vez de explorar el repo. Para saber qué hace un módulo, lee su `README.md` o el contrato, no su código.

## Carpetas
| Carpeta | Qué es | Dueño | Lee primero |
|---|---|---|---|
| `main.go`, `app.go`, `app_overlay.go`, `app_pdf.go`, `app_summary.go`, `wails.json` | La app Wails: ventana, bindings del overlay, visor de PDF y resumen (la raíz la exige Wails) | Isaac | `docs/OVERLAY.md` («Cómo está hecho») |
| `api/` | **Contrato** `openapi.yaml` (0.8), fixtures y tipos Go generados (`gen/`) | Isaac | `api/README.md` |
| `backend/session` | Sesión compartida, prompts, `POST /scan`, `POST /transcribe`; registro de rutas en `mux.go` | Isaac | `backend/README.md` |
| `backend/llm` | Cliente de modelos (OpenRouter): niveles barato/caro, caché, coste | Isaac | `backend/llm/README.md` |
| `backend/overlay` | Atajos globales, keypad por USB, selección de texto, procesos auxiliares | Isaac | `docs/KEYPAD.md` |
| `backend/scanner` | Cliente Go del servicio de lectura (8770) | Isaac | — |
| `backend/summary` | AI Summary (resumen de la selección) | Didac | — |
| `backend/captions` | **Transcribe**: `GET /captions` (WebSocket) → Together AI | Pau | `web/src/captions/README.md` |
| `backend/ws`, `backend/mock`, `backend/cmd/*` | WebSocket y `ws.Guard`; servidor mock (8080); servidor real sin ventana (`task server`) | Isaac | — |
| `web/src/app/overlay` | **El overlay**: `Overlay.tsx` (vistas), `Hub.tsx` (menú radial), `modes.ts` (herramientas), `ui.tsx` (Panel, botones, iconos), `keypad.ts` | Isaac (diseño: Didac) | `docs/DISENO.md` |
| `web/src/app` (resto) | Pantalla Developer (`App.tsx`, `DocumentText.tsx`, `Cost.tsx`) | Isaac | — |
| `web/src/camera` | Cámara, foto más nítida, guía de encuadre por voz | Pau | `web/src/camera/README.md` |
| `web/src/captions` | Pantalla de Transcribe (`LiveCaptions.tsx`) | Pau | `web/src/captions/README.md` |
| `web/src/document` | Lectura guiada y visor de PDF | Didac | `web/src/document/README.md` |
| `web/src/input` | Gestos (MediaPipe) y voz (Whisper local, lector) | Nil | `web/src/input/README.md` |
| `web/src/input/desktop`, `adapters/desktop` | Página de Gesture Control y su ayudante que pulsa teclas reales | Nil | `adapters/desktop/README.md` |
| `web/src/api` | Tipos TS generados del contrato (**no editar `types.ts`**: `task gen`) | Isaac | — |
| `scanner/` | Python: foto → hoja → OCR (Tesseract) → `document` + PDF; servicio `service.py` (8770) | Didac | `scanner/AGENTS.md`, `scanner/README.md` |
| `scanner/capturar.py`, `scanner/benchmark/` | Captura de la MX Brio y medida del escaneo | Pau | `scanner/benchmark/README.md` |
| `docs/` | Documentación (este mapa, estado, diseño, pruebas…) | Isaac | `AGENTS.md` |

**Regla:** no edites código de otra persona sin avisarla. Si un arreglo lo necesita, apúntalo en su ficha.

## Puertos (todo en 127.0.0.1)
8765 app y servidor real · 8770 servicio de lectura (`scanner/service.py`) · 8767 Gesture Control suelto · 8080 mock · 5173 Vite (`npm run dev`).

## Flujos principales
- **PDF Scanner:** `web/src/camera` (foto) → `POST /scan` en Go → `scanner/service.py` (OCR) → `document` → lectura guiada (`web/src/document`).
- **Transcribe:** micro o llamada (`web/src/captions`) → `GET /captions` → `backend/captions` → Together AI → subtítulos, quién habla, traducción y `.txt` en `Documentos/LauzHack/`.
- **AI Summary:** selección en cualquier programa (`backend/overlay`) → `backend/summary` → modelo barato → burbuja.
- **Gestos:** cámara → MediaPipe (`web/src/input`) → acción → `adapters/desktop` (teclas reales); la cámara es única y se comparte entre herramientas (`gestureHost.ts`).

## Reglas de estructura (comprobadas)
- Sin carpetas `internal/` (el `main.go` de la raíz no podría importarlas): paquetes en `backend/<nombre>`.
- Frontend en `web/` (`"frontend:dir": "web"`, `//go:embed all:web/dist`); `web/wailsjs/` lo genera Wails.
- Taskfile en vez de make; Go ≥ 1.26.
