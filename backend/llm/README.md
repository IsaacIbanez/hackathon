# backend/llm

Frugal model client (OpenRouter). Owner: role A.

- Two tiers: `llm.Cheap` (by default `anthropic/claude-haiku-5.5`) and `llm.Expensive` (`anthropic/claude-sonnet-5.5`). Both accept images.
- **Cache**: the exact same request is not paid twice.
- **Meter**: calls, cache hits, errors, cost in USD and latency per tier (`Meter.Snapshot()`). Its JSON is the payload of the contract's `stats` message.
- **Escalation**: `CompleteWithEscalation` tries the cheap one and only calls the expensive one if your doubt function says yes (or if the cheap one fails). **The caller decides the policy (role B2)**.

## Configuration (environment or a `.env` file in the root; never in the repo)
`.env` is in `.gitignore`. The team's key is passed by chat, not through git.
```
OPENROUTER_API_KEY=sk-or-v1-...
LLM_PROFILE=dev
```

| Variable | Required | Default |
|----------|-------------|-------------|
| `OPENROUTER_API_KEY` | yes | — |
| `LLM_PROFILE` | no | empty (demo). `dev` = free ones first, see below |
| `LLM_CHEAP_MODEL` | no | `anthropic/claude-haiku-5.5` |
| `LLM_EXPENSIVE_MODEL` | no | `anthropic/claude-sonnet-5.5` |
| `OPENROUTER_URL` | no | `https://openrouter.ai/api/v1` |

Each model accepts a **comma-separated list**: if one fails (429, down or an empty answer), the next one is tried.

**While developing, use `LLM_PROFILE=dev`** (we have €10 for the whole team):
- cheap: `nvidia/nemotron-3.5-super-vl:free` → `google/gemma-4-31b-it:free` → `google/gemma-4-26b-a4b-it:free` → `anthropic/claude-haiku-5.5` (paid, last resort)
- expensive: `anthropic/claude-haiku-5.5`

Tested on 2026-11-21: nemotron (free) reads a form in an image well and answers in Spanish in about 3 s; the `:free` ones often return 429, which is why there are several. Reasoning models spend tokens thinking: do not lower `MaxTokens` below ~1000.

## Usage
```go
c, err := llm.NewFromEnv()
r, escalated, err := c.CompleteWithEscalation(ctx, llm.Request{
    System:   "Explain documents in plain language.",
    Messages: []llm.Message{{Role: "user", Text: ocrText, Images: []string{dataURL}}},
    JSON:     true,
}, func(r llm.Response) bool { return !isValidJSON(r.Text) })
// r.Text, r.CostUSD, r.LatencyMs, r.Cached; c.Meter.Snapshot() for the total
```

Test with the real key: `go run ./backend/cmd/llmcheck "question"` (options `-expensive`, `-image photo.jpg` and `-max 1500`).
The tests (`go test ./backend/llm`) use a fake OpenRouter: they spend nothing and need no key.
