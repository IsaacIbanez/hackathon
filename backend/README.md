# backend/ (Go)

Orquestación: WebSocket, sesiones, enrutado frugal entre modelos, caché y contador de coste.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `cmd/mock` | rol A | servidor mock sin Wails (para probar sin la ventana) |
| `ws` | rol A | WebSocket |
| `session` | rol A | sesiones |
| `llm` | rol A | cliente de modelos (OpenRouter), caché, coste y latencia |
| `ocr` | rol B2 | texto a campos y significado; decide cuándo escalar al modelo caro |

Lee primero `../api/` (el contrato) y solo tu carpeta.
