# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T7 (cliente de modelos frugal, caché y contador)
- **Rama:** feature/T7-llm
- **Estado:** en revisión
- **Último cambio:** 2026-11-21

## Hecho
- T2 parte 1 (contrato, fixtures, tipos generados, mock, Taskfile): fusionada en `main`.
- T2 parte 2 (CI y Wails + React en `web/`): fusionada (#2), CI de Linux en verde.
- T7: `backend/llm` con niveles barato/caro, caché, contador de coste y latencia y `CompleteEscalando`; 8 tests contra un OpenRouter falso. `backend/cmd/llmprueba` para probar con la clave real.

## Pendiente
- Probar `go run ./backend/cmd/llmprueba` con la clave real de AXA (aquí no hay `OPENROUTER_API_KEY`).
- Mostrar el coste en la UI: propuesta de mensaje `stats` (Go → navegador) con `Meter.Snapshot()`. Es un cambio de contrato: avisar antes.
- Servir `/ws` dentro de la app Wails y conectar `backend/llm` al flujo real (T8).

## Bloqueos y preguntas para humanos
- Hace falta Go ≥ 1.26 y `task`.

## Archivos tocados
T7: `backend/llm/`, `backend/cmd/llmprueba/`, `AGENTS.md` (Decisiones), `estado/P1-C.md`.
