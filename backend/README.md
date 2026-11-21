# backend/ (Go)

Orquestación: WebSocket, sesiones, enrutado frugal entre modelos, caché y contador de coste.

| Carpeta | Dueño | Contenido |
|---------|-------|-----------|
| `cmd/mock` | rol A | servidor mock sin Wails: responde con las fixtures (`task mock`, puerto 8080) |
| `cmd/server` | rol A | servidor **real** sin Wails: sesiones + modelos (`task server`, puerto 8765) |
| `cmd/llmcheck` | rol A | prueba rápida del cliente de modelos con la clave real |
| `mock` | rol A | respuestas de ejemplo (fixtures) |
| `ws` | rol A | WebSocket |
| `session` | rol A | lógica real del WebSocket, una sesión por conexión (ver abajo) |
| `llm` | rol A | cliente de modelos (OpenRouter), caché, coste y latencia |
| `ocr` | rol B2 | texto a campos y significado; decide cuándo escalar al modelo caro |

Lee primero `../api/` (el contrato) y solo tu carpeta.

## Qué hace una sesión (`backend/session`)
| Llega | Respuesta | ¿Gasta IA? |
|-------|-----------|-----------|
| `document` con mala calidad (`quality.score` < 0,5) o sin bloques | Consejo de encuadre en local («la imagen está borrosa»…) | No |
| `document` correcto | Explicación sencilla + bloques a resaltar → `speak` + `stats` | Sí (barato; caro si hay duda) |
| `pointer` sobre un bloque nuevo | Lee ese bloque en voz alta | No |
| `utterance` final | Responde con el documento y el bloque señalado como contexto → `speak` + `stats` | Sí |
| `utterance` sin documento | «Todavía no veo ningún documento» | No |

- Las llamadas al modelo van en segundo plano; un documento o una pregunta nuevos cancelan la anterior.
- **Criterio de escalado (rol B2):** `session.Config.Doubt`. El provisional (`DefaultDoubt`) escala si la respuesta barata no es JSON válido, viene vacía o resalta bloques que no existen.
- Textos locales en español e inglés (`localTexts` en `prompts.go`), según el idioma del documento.
- La app Wails usa sesiones reales si hay clave de OpenRouter (entorno o `.env`); si no, las fixtures.

Probado el 2026-11-21 con la clave real y `LLM_PROFILE=dev`: documento de ejemplo → explicación correcta en 4 s; señalar la fecha → lectura inmediata; «¿Qué tengo que poner aquí?» → «Ponga la fecha del siniestro, en el orden día, mes y año». Coste total: 0 $.
