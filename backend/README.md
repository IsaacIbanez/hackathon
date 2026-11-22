# backend/ (Go)

Orchestration: WebSocket, sessions, frugal routing between models, cache and cost meter.

| Folder | Owner | Contents |
|---------|-------|-----------|
| `cmd/mock` | role A | mock server without Wails: answers with the fixtures (`task mock`, port 8080) |
| `cmd/server` | role A | **real** server without Wails: sessions + models (`task server`, port 8765) |
| `cmd/llmcheck` | role A | a quick test of the model client with the real key |
| `mock` | role A | sample answers (fixtures) |
| `ws` | role A | WebSocket |
| `session` | role A | the WebSocket's real logic, one session per connection (see below) |
| `llm` | role A | model client (OpenRouter), cache, cost and latency |
| `ocr` | role B2 | text to fields and meaning; decides when to escalate to the expensive model |

Read `../api/` (the contract) first and only your folder.

## What a session does (`backend/session`)
| Arrives | Answer | Spends AI? |
|-------|-----------|-----------|
| `document` with bad quality (`quality.score` < 0.5) or without blocks | Local framing advice («the image is blurry»…) | No |
| A correct `document` | A plain explanation + blocks to highlight → `speak` + `stats` | Yes (cheap; expensive if in doubt) |
| `pointer` over a new block | Reads that block aloud | No |
| A final `utterance` | Answers with the document and the pointed block as context → `speak` + `stats` | Yes |
| `utterance` without a document | «I can't see any document yet» | No |

- Model calls run in the background; a new document or question cancels the previous one.
- **Escalation criterion (role B2):** `session.Config.Doubt`. The provisional one (`DefaultDoubt`) escalates if the cheap answer is not valid JSON, comes back empty or highlights blocks that do not exist.
- Local texts in Spanish and English (`localTexts` in `prompts.go`), depending on the document's language.
- The Wails app uses real sessions if there is an OpenRouter key (environment or `.env`); otherwise, the fixtures.

Tested on 2026-11-21 with the real key and `LLM_PROFILE=dev`: sample document → correct explanation in 4 s; pointing at the date → immediate reading; «¿Qué tengo que poner aquí?» (What do I have to put here?) → «Ponga la fecha del siniestro, en el orden día, mes y año» (Put the date of the incident, in day, month and year order). Total cost: $0.
