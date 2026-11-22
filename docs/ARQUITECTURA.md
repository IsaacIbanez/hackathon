# Architecture and 24-hour plan

Short summary in `AGENTS.md`. This file keeps the details.

## Planned folder structure
```
hackathon/
├── AGENTS.md, CLAUDE.md, GEMINI.md
├── Taskfile.yml          # task gen / mock / check
├── api/openapi.yaml      # backend <-> frontend contract
├── api/fixtures/         # a JSON example of each message
├── api/gen/              # generated Go types (do not edit)
├── backend/              # Go
│   ├── cmd/mock/         # mock server without Wails
│   └── {ws,session,llm,ocr}/   # no "internal/"
├── web/                  # React + Vite + TS + Tailwind
│   └── src/{api,app,camera,document,input}/   # src/api: generated TS types
├── adapters/logitech/    # only if the SDK requires Python or C#
├── docs/
└── .github/workflows/ci.yml
```

## Data flow
1. The camera and the mic are captured in the browser (`getUserMedia`).
2. B1 detects and crops the document and runs local OCR.
3. The `document` message (text blocks with their box in the image and a confidence) travels over WebSocket to Go.
4. B2 decides: if the OCR is reliable, it structures it locally; if in doubt, it escalates to a larger model through OpenRouter.
5. C provides `pointer` (the area pointed at with the hand) and `utterance` (what the user says).
6. Go answers with `speak` and with the fields to highlight. The UI shows them and reads them aloud.
7. A records the cost and latency of each call and shows them on screen.

## How the agents coordinate
- Through files and git, not messages: `TAREAS.md`, `estado/`, the Decisions section of `AGENTS.md` and the contract in `api/`.
- One task, one branch, one PR; nobody merges into `main` without human review.
- `task check` (go vet, go test, frontend build) before opening a PR.
- A contract change is written down in Decisions and the rest are told.

## 24 h schedule
| Hours | What |
|-------|-----|
| H0–1 | Repo, CI, contract, camera test on every OS and what the Logitech SDK offers for the camera |
| H1–4 | End-to-end skeleton: the camera sends a frame, Go answers, the UI shows it |
| H4–16 | Modules in parallel (capture, understanding, interaction) |
| H16–20 | Accessibility and the demo flow |
| H20–24 | Feature freeze, polish and rehearse |

## Challenge criteria (so we do not lose sight of them)
- **AXA:** a real app scores more than a notebook or slides; "AI slop" is penalised; frugality is valued (not throwing everything at a large model), along with our own technical challenge, teamwork and the presentation.
- **IMC:** real usefulness, technical quality, potential social impact and presentation; aimed at an NGO in education, inclusion or community.
- **Logitech:** the webcam as the AI's eyes and ears, with multimodal inputs and context-aware flows.

## To find out at the Logitech stand
- What the SDK exposes for the camera beyond a normal video (focus, zoom...) and the link to its documentation.
- Whether Python or C# is needed and for which exact part.
