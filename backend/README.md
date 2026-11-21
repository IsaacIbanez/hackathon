# backend/ (Go)

Orquestación: WebSocket, sesiones, enrutado frugal entre modelos, caché y contador de coste.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `cmd/server` | rol A | punto de entrada del servidor |
| `internal/ws` | rol A | WebSocket |
| `internal/session` | rol A | sesiones |
| `internal/llm` | rol A | cliente de modelos (OpenRouter), caché, coste y latencia |
| `internal/ocr` | rol B2 | texto a campos y significado; decide cuándo escalar al modelo caro |

Lee primero `../api/` (el contrato) y solo tu carpeta.
