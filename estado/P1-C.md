# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T2 (esqueleto) — PR 1 (contrato) y PR 2 (CI y Wails)
- **Rama:** feature/T2-contrato (PR 1), feature/T2-wails-ci (PR 2, sale de la de PR 1)
- **Estado:** en revisión (PR 1 y PR 2)
- **Último cambio:** 2026-11-21

## Hecho
- `api/openapi.yaml`: `/health`, `/ws` y mensajes `document`, `pointer`, `utterance`, `speak` en un sobre `{type, id, ts, payload}`.
- `api/fixtures/*.json` y test que comprueba que encajan en los tipos.
- `go.mod` (módulo `github.com/IsaacIbanez/hackathon`), tipos Go en `api/gen`, tipos TS en `web/src/api/types.ts`.
- `backend/ws` (servidor WebSocket reutilizable) y `backend/cmd/mock` con tests.
- `Taskfile.yml` (`gen`, `mock`, `check`) y documentación cambiada de `make` a `task`.

- PR 2: `.github/workflows/ci.yml` (task check + tipos generados al día), Wails en la raíz (`main.go`, `app.go`, `wails.json`) y frontend React + Vite + TS + Tailwind en `web/` con una pantalla mínima que prueba el bucle document → speak contra el mock. `wails build` comprobado en Windows.

## Pendiente
- Servir `/ws` desde dentro de la app Wails (hoy el front se conecta al mock en `localhost:8080`): T7/T8.
- Confirmar que el CI de Linux pasa en GitHub (no se ha podido probar en local).

## Bloqueos y preguntas para humanos
- Hace falta Go ≥ 1.26 (lo piden las dependencias; con `GOTOOLCHAIN=auto`, el valor por defecto, Go lo descarga solo) y `task` (`go install github.com/go-task/task/v3/cmd/task@latest`).

## Archivos tocados
`api/`, `backend/ws/`, `backend/cmd/mock/`, `web/src/api/`, `go.mod`, `go.sum`, `Taskfile.yml`, `.gitignore`, `AGENTS.md`, `docs/ARQUITECTURA.md`; PR 2: `main.go`, `app.go`, `wails.json`, `Taskfile.yml`, `.github/workflows/ci.yml`, `web/` (salvo `camera`, `document`, `input`).
