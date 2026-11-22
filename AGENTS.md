# AGENTS.md — Start here

Every agent (Claude Code, Gemini CLI) loads this file **on every request**: it is short on purpose. Earlier long versions: `docs/historial/`.

## What it is
**LauzHack 2026.** A desktop app for people with low vision that reads and explains documents (paper through the camera, or files), with gestures, voice and the Logitech MX Keypad. Challenges: Logitech, IMC (accessibility) and AXA (frugal AI). It is a full-screen **overlay** (Go + Wails, React in `web/`, Python in `scanner/`).

## Where we are
**Polishing for the demo (2026-11-22):** nothing new; each person makes their part robust. **Split: `docs/demo/README.md`** and your person's sheet (`docs/demo/NIL.md`, `PAU.md`, `ISAAC.md`), with a ready-made prompt for your agent. Overall status: `docs/ESTADO.md`.

## What to read (only what you need)
| You are going to… | Read |
|---|---|
| Get your bearings | `docs/ESTADO.md` (status and next step) |
| Prepare the demo (current phase) | `docs/demo/README.md` and your sheet `docs/demo/<PERSON>.md` |
| Pick up a fix or a task | its sheet: `docs/arreglos/R<n>.md` or `docs/tareas/N<n>.md`, and its brief if there is one (`docs/briefs/`) |
| Find where something is or whose it is | `docs/MAPA.md` (folders, owners, ports, entry points) |
| Work: branch, checks, `.exe`, PR, Windows pitfalls | `docs/TRABAJAR.md` |
| Test the app | `docs/COMO_PROBAR.md` |
| Touch screens | **`docs/DESIGN.md`** (design system: tokens, components, rules; mandatory) and `docs/OVERLAY.md` (search for the section, it is long) |
| Show, hide or resize the window | `docs/VENTANA.md` (a single piece decides the shape) |
| Touch the keypad / the contract | `docs/KEYPAD.md` / `api/openapi.yaml` |
| Know why something was decided | `docs/DECISIONES.md` (archive: only if needed) |

**Do not read** `docs/historial/` unless asked to.

## Rules
1. `git pull` when you start. Work only on your sheet; if you need something else, ask your person.
2. **Do not touch another person's folders** (owners in `docs/MAPA.md`): note it in their sheet and tell them.
3. **No confirmed brief or sheet, no code.** Ask your person questions in batches of 3–5, with options and the recommended one first.
4. Branch `feature/<ID>-<name>`; one fix = one commit, with its line in the sheet's «Log».
5. **Before pushing:** `task check` green and, if it touches the app, tested with the real `.exe` (`docs/TRABAJAR.md`).
6. Into `main` only with a reviewed PR and green CI, **or if a person explicitly asks**. **During the demo polish, each agent merges its own PR once CI is green** (`docs/demo/README.md`).
7. The contract (`api/`) changes in a separate PR; then `task gen`.
8. **Never** keys or passwords in the repo: they go in `.env` (ignored).
9. If you change an interface between modules: an entry in `docs/DECISIONES.md` and, if it affects day-to-day work, a line in `docs/ESTADO.md`.
10. Spend few tokens: read ranges (`grep`, `sed -n`), filter command output, no subagents, one session per task (`/clear`).

## Language
**Everything in the repo is in English:** code, comments, logs, tests, interface text, documentation (`*.md`), commits and PR titles. File names of existing docs stay as they are. Data that tests or handles Spanish on purpose (test sentences, language detection, prompts) stays in Spanish. `docs/historial/` is an archive and stays in Spanish. Conversation with the team: in Spanish.
