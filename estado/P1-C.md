# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T8 (integración), primera parte: WebSocket dentro de la app
- **Rama:** feature/T8-ws-en-app
- **Estado:** en revisión
- **Último cambio:** 2026-11-21

## Hecho
- T2 parte 1 (contrato, fixtures, tipos generados, mock, Taskfile): fusionada en `main`.
- T2 parte 2 (CI y Wails + React en `web/`): fusionada (#2), CI de Linux en verde.
- T7 fusionada (#3): `backend/llm` con niveles barato/caro, caché, contador de coste y latencia y `CompleteEscalando`; 8 tests contra un OpenRouter falso. `backend/cmd/llmprueba` para probar con la clave real.
- T8 (parte 1): la app Wails sirve `/health` y `/ws` en `127.0.0.1:8765` con las respuestas de ejemplo; el frontend pide la URL a Go. Probado: ejecutable arrancado + cliente WebSocket sin navegador → `speak`.
- Limpieza: `.gitattributes` (LF en el código), `task fmt` y comprobación de `gofmt` en el CI.

## Pendiente
- Probar `go run ./backend/cmd/llmprueba` con la clave real de AXA (aquí no hay `OPENROUTER_API_KEY`).
- Mostrar el coste en la UI: propuesta de mensaje `stats` (Go → navegador) con `Meter.Snapshot()`. Es un cambio de contrato: avisar antes.
- T8: sustituir las respuestas de ejemplo por la lógica real (`backend/llm` + lo que defina B2).

## Bloqueos y preguntas para humanos
- **Decidir cómo llega el scanner de B a Go.** B trabaja en Python (`scanner/`: captura con la MX Brio, OCR con Tesseract, PDF buscable), no en el navegador. Propuesta: el scanner envía un mensaje `document` (bloques de texto con caja y confianza; Tesseract ya los da) a `ws://127.0.0.1:8765/ws`, y Go responde con `speak`. Encaja con el contrato sin cambiarlo. Falta que Didac, Pau e Isaac lo acuerden.
- Hace falta Go ≥ 1.26 y `task`.

## Archivos tocados
T8 parte 1: `app.go`, `main.go`, `backend/mock/`, `backend/cmd/mock/`, `backend/ws/local*.go`, `web/src/app/`, `web/wailsjs/go/`, `.gitattributes`, `Taskfile.yml`, `.github/workflows/ci.yml`, `AGENTS.md`, `api/README.md`, `web/README.md`.
T7: `backend/llm/`, `backend/cmd/llmprueba/`, `AGENTS.md` (Decisiones), `estado/P1-C.md`.
