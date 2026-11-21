# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T2 (esqueleto) — PR 1: contrato, tipos generados, mock y Taskfile
- **Rama:** feature/T2-contrato
- **Estado:** en revisión (PR 1)
- **Último cambio:** 2026-11-21

## Hecho
- `api/openapi.yaml`: `/health`, `/ws` y mensajes `document`, `pointer`, `utterance`, `speak` en un sobre `{type, id, ts, payload}`.
- `api/fixtures/*.json` y test que comprueba que encajan en los tipos.
- `go.mod` (módulo `github.com/IsaacIbanez/hackathon`), tipos Go en `api/gen`, tipos TS en `web/src/api/types.ts`.
- `backend/ws` (servidor WebSocket reutilizable) y `backend/cmd/mock` con tests.
- `Taskfile.yml` (`gen`, `mock`, `check`) y documentación cambiada de `make` a `task`.

## Pendiente
- PR 2: workflow de GitHub Actions (`task check`) y proyecto Wails en la raíz con React + Vite + TS + Tailwind en `web/`.

## Bloqueos y preguntas para humanos
- Hace falta Go ≥ 1.26 (lo piden las dependencias; con `GOTOOLCHAIN=auto`, el valor por defecto, Go lo descarga solo) y `task` (`go install github.com/go-task/task/v3/cmd/task@latest`).

## Archivos tocados
`api/`, `backend/ws/`, `backend/cmd/mock/`, `web/src/api/`, `go.mod`, `go.sum`, `Taskfile.yml`, `.gitignore`, `AGENTS.md`, `docs/ARQUITECTURA.md`.
