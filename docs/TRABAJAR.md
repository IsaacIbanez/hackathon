# How to work in the repo (and which pitfalls to avoid)

## Life cycle of a fix or a task
1. `git pull` on `main` and a `feature/<ID>-<name>` branch (better in a worktree: `scripts/nueva-tarea.sh`).
2. Read the sheet (`docs/arreglos/` or `docs/tareas/`). A fix's sheet is its brief; an N task needs a brief confirmed by your person (`docs/briefs/<ID>.md`, template in `docs/briefs/README.md`).
3. **Reproduce the bug with the real `.exe`** before fixing it (below).
4. One bug = one commit, with its line in the sheet's «Log»: symptom → how to reproduce it → cause → fix → how it was checked.
5. `task check` green (go vet, go test, lint, frontend tests and build).
6. A small PR (what, what is missing, decisions, how to test it). Another person tests it with their `.exe`; it is merged with green CI. Straight into `main` only if a person asks for it.
7. If you close something that changes the overall status, update its line in `docs/ESTADO.md`.

## Build and test the app
- **Once per machine:** Go ≥ 1.26, `go install github.com/go-task/task/v3/cmd/task@latest`, Wails v2, Node; then **`task setup`** (the scanner with its Python, Tesseract and the languages, and the web dependencies).
- **Build:** `task overlay` → `build/bin/lauzhack.exe` (reads the root `.env`; log in `build/bin/lauzhack.log`). The log and the menu footer say which version it is (`version: <commit> (built …)`; a «+» = built with uncommitted changes).
- **Before opening it, close any other copy** of the app and of `gesture-control.exe`: with two open you do not know which one you are testing.
- **Without a window:** `task server` (real logic on 8765) or `task mock` (fixed answers on 8080, no cost).
- **Smoke tests:** `docs/COMO_PROBAR.md`.

## Known pitfalls (Windows)
- **`npm ci` fails with `EPERM` and leaves `web/node_modules` almost empty** if a running `node` (an `npm run dev`, Vite) locks a file. Close the `npm run dev` processes before `task check`; if it already happened, `npm install` in `web/` recovers it.
- **The camera gives black images** if another program is using it (the Windows Camera app, a browser tab, the overlay): close it. The MX Brio can only be used by one program at a time.
- **Windows Smart App Control** blocks `go.exe` and everything it builds («An Application Control policy has blocked this file»): it must be turned off in Windows Security.
- **Line endings:** many files are CRLF. When editing with scripts, keep the file's format; a `git diff` with only CRLF changes is not a real change.
- **`gh`** (GitHub CLI) is needed to see CI and PRs: `winget install GitHub.cli` and `gh auth login`.
- **Keys:** `.env` in the root (`OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `LLM_PROFILE=dev`). Never in the repo nor in another tool's chat.

## Saving tokens
- One session per task; when you finish, leave what is pending in the sheet and `/clear`.
- Read only your sheet, `docs/ESTADO.md` and what they link to. Search with `grep` and read ranges; do not open large files whole (`docs/OVERLAY.md`, `web/src/input/interaction.ts`, `app_overlay.go`).
- Filter the output: `task check 2>&1 | grep -E "ℹ fail|FAIL|error"`, `… | tail -20`, `gh … --jq`. Never dump whole logs or diffs.
- No subagents nor repo-wide searches, unless your person asks for them. Sonnet by default; Opus for design or hard debugging.
