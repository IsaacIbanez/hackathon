# backend/llm

Cliente frugal de modelos (OpenRouter). Dueño: rol A.

- Dos niveles: `llm.Barato` (por defecto `anthropic/claude-haiku-5.5`) y `llm.Caro` (`anthropic/claude-sonnet-5.5`). Los dos aceptan imágenes.
- **Caché**: la misma petición exacta no se paga dos veces.
- **Contador**: llamadas, aciertos de caché, errores, coste en USD y latencia por nivel (`Meter.Snapshot()`, listo para enviarlo a la UI).
- **Escalado**: `CompleteEscalando` prueba el barato y solo llama al caro si tu función de duda dice que sí (o si el barato falla). **La política la decide quien llama (rol B2)**.

## Configuración (variables de entorno, nunca en el repo)
| Variable | Obligatoria | Por defecto |
|----------|-------------|-------------|
| `OPENROUTER_API_KEY` | sí | — |
| `LLM_MODELO_BARATO` | no | `anthropic/claude-haiku-5.5` |
| `LLM_MODELO_CARO` | no | `anthropic/claude-sonnet-5.5` |
| `OPENROUTER_URL` | no | `https://openrouter.ai/api/v1` |

PowerShell: `$env:OPENROUTER_API_KEY = "sk-or-..."` · bash: `export OPENROUTER_API_KEY=sk-or-...`

## Uso
```go
c, err := llm.NewFromEnv()
r, escalo, err := c.CompleteEscalando(ctx, llm.Request{
    System:   "Explica documentos en lenguaje sencillo.",
    Messages: []llm.Message{{Role: "user", Text: textoOCR, Images: []string{dataURL}}},
    JSON:     true,
}, func(r llm.Response) bool { return !esJSONValido(r.Text) })
// r.Text, r.CostUSD, r.Latency, r.Cached; c.Meter.Snapshot() para el total
```

Prueba con la clave real: `go run ./backend/cmd/llmprueba "pregunta"` (opciones `-caro` e `-imagen foto.jpg`).
Los tests (`go test ./backend/llm`) usan un OpenRouter falso: no gastan ni necesitan clave.
