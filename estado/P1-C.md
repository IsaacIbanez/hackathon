# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T8 (integración)
- **Rama:** feature/T8-mensaje-stats (PR #6, pendiente de visto bueno)
- **Estado:** en curso
- **Último cambio:** 2026-11-21

## Hecho
- T2 (contrato, mock, Taskfile, CI, Wails + React): fusionada (5acd70f, #2). CI de Linux en verde.
- T7 (`backend/llm`: niveles cheap/expensive, caché, contador, `CompleteWithEscalation`): fusionada (#3).
- T8 parte 1: la app Wails sirve `/health` y `/ws` en `127.0.0.1:8765` (#4). Probado con el ejecutable y un cliente WebSocket sin navegador.
- Tests de módulos del frontend (`node --test`) dentro de `task check`, y `test/` y `demo/` fuera del build de la app (#5).
- Limpieza: `.gitattributes` (LF en el código), `task fmt` y comprobación de `gofmt` en el CI.

## Pendiente
- **PR #6 (mensaje `stats`, solo añade): necesita el visto bueno del equipo.** CI en verde.
- T8: sustituir las respuestas de ejemplo por la lógica real (`backend/llm` + B2).

## Bloqueos y preguntas para humanos
- **Cómo llega el scanner de B a Go.** B trabaja en Python (`scanner/`: captura con la MX Brio, OCR con Tesseract, PDF buscable), no en el navegador. Propuesta: el scanner envía `document` (bloques con caja y confianza, que Tesseract ya da) a `ws://127.0.0.1:8765/ws`, y Go responde con `speak`. Encaja con el contrato sin cambiarlo. Falta que Didac, Pau e Isaac lo acuerden.
- **Para Nil (rama `claude/kind-cray-863b6t`):** probada en local sobre `main`, sus 43 tests pasan en `task check`. Falla un único error de TypeScript: `web/src/input/interaccion.ts:230`, `esperarSoltarPinza` está declarada y no se usa (`noUnusedLocals`). Hay que quitarla o usarla antes del PR.
- Hace falta Go ≥ 1.26 y `task`.

## Archivos tocados
`api/`, `backend/{ws,mock,llm,cmd}`, `main.go`, `app.go`, `wails.json`, `Taskfile.yml`, `.github/workflows/ci.yml`, `.gitattributes`, `.gitignore`, `web/` (salvo `camera`, `document`, `input`), `AGENTS.md`, `docs/ARQUITECTURA.md`.
