# backend/llm

Cliente frugal de modelos (OpenRouter). Dueño: rol A.

- Dos niveles: `llm.Cheap` (por defecto `anthropic/claude-haiku-5.5`) y `llm.Expensive` (`anthropic/claude-sonnet-5.5`). Los dos aceptan imágenes.
- **Caché**: la misma petición exacta no se paga dos veces.
- **Contador**: llamadas, aciertos de caché, errores, coste en USD y latencia por nivel (`Meter.Snapshot()`). Su JSON es el payload del mensaje `stats` del contrato.
- **Escalado**: `CompleteWithEscalation` prueba el barato y solo llama al caro si tu función de duda dice que sí (o si el barato falla). **La política la decide quien llama (rol B2)**.

## Configuración (entorno o archivo `.env` en la raíz; nunca en el repo)
`.env` está en `.gitignore`. La clave del equipo se pasa por chat, no por git.
```
OPENROUTER_API_KEY=sk-or-v1-...
LLM_PROFILE=dev
```

| Variable | Obligatoria | Por defecto |
|----------|-------------|-------------|
| `OPENROUTER_API_KEY` | sí | — |
| `LLM_PROFILE` | no | vacío (demo). `dev` = gratuitos primero, ver abajo |
| `LLM_CHEAP_MODEL` | no | `anthropic/claude-haiku-5.5` |
| `LLM_EXPENSIVE_MODEL` | no | `anthropic/claude-sonnet-5.5` |
| `OPENROUTER_URL` | no | `https://openrouter.ai/api/v1` |

Cada modelo admite una **lista separada por comas**: si uno falla (429, caído o respuesta vacía), se prueba el siguiente.

**Mientras desarrolláis, usad `LLM_PROFILE=dev`** (tenemos 10 € para todo el equipo):
- cheap: `nvidia/nemotron-3.5-super-vl:free` → `google/gemma-4-31b-it:free` → `google/gemma-4-26b-a4b-it:free` → `anthropic/claude-haiku-5.5` (de pago, último recurso)
- expensive: `anthropic/claude-haiku-5.5`

Probado el 2026-11-21: nemotron (gratis) lee bien un formulario en imagen y responde en español en unos 3 s; los `:free` dan 429 a menudo, por eso hay varios. Los modelos que razonan gastan tokens pensando: no bajéis `MaxTokens` de ~1000.

## Uso
```go
c, err := llm.NewFromEnv()
r, escalated, err := c.CompleteWithEscalation(ctx, llm.Request{
    System:   "Explain documents in plain language.",
    Messages: []llm.Message{{Role: "user", Text: ocrText, Images: []string{dataURL}}},
    JSON:     true,
}, func(r llm.Response) bool { return !isValidJSON(r.Text) })
// r.Text, r.CostUSD, r.LatencyMs, r.Cached; c.Meter.Snapshot() para el total
```

Prueba con la clave real: `go run ./backend/cmd/llmcheck "pregunta"` (opciones `-expensive`, `-image foto.jpg` y `-max 1500`).
Los tests (`go test ./backend/llm`) usan un OpenRouter falso: no gastan ni necesitan clave.
