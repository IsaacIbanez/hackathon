# ROSTER.md — People and agents

Each person has a Claude Pro account and a Gemini Plus account. Each account is an agent: a slot and a working branch. (The per-agent status files now live in `docs/historial/estado/`.)

Names confirmed. The roles (A, B1, B2, C) are described in `AGENTS.md`.

| Person | Role | Claude agent (Pro) | Gemini agent (Plus) |
|---------|-----|---------------------|----------------------|
| P1 — Isaac | A | `P1-C` | `P1-G` |
| P2 — Didac | B (B1 or B2) | `P2-C` | `P2-G` |
| P3 — Nil | C | `P3-C` | `P3-G` |
| P4 — Pau | B (B1 or B2) | `P4-C` | `P4-G` |

## Usage rules
- Each person uses only their own accounts. Nobody logs into someone else's account.
- Each agent works on one task at a time.
- Each person supervises one main agent (Claude); Gemini is for support or for reviewing PRs.
- The task split will be redefined after the brainstorm (`docs/historial/ideas/`); `TAREAS.md` is now a single board without owners.
- Tools: Claude Code for the `-C` agents, Gemini CLI for the `-G` ones. Both read `AGENTS.md` from the repository folder.

## Limits
Each account has its own usage limits. Before assigning tasks, check how many sessions each account can sustain, and that the usage fits the hackathon rules.
