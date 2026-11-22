# Briefs per person

Each agent keeps here, in `docs/briefs/<person>.md` (`isaac`, `didac`, `pau` or `nil`), the brief its person confirmed after the interview in `docs/historial/arranque/<person>.md`. In a new session, the agent reads the brief and works from it, without repeating the interview.

Rules:
- One brief per person. Its agent writes it and it is only saved once the person confirms it.
- If the plan changes, the brief is updated before the code and noted in «Brief changes».
- Other people's briefs can be read so as not to overlap, but they are not edited.

## Template

```markdown
# Brief for <Person> (P<n>)
Confirmed by <person> on <YYYY-MM-DD HH:MM>. Last review: <YYYY-MM-DD HH:MM>.

## Goal
One or two sentences: what is built, for whom and what problem it solves.

## What the demo will show
What the jury will see and hear, in 2-4 sentences.

## Scope
- ...

## Out of scope
- ...

## Flow, from the user's point of view
1. ...
A concrete example: input → output.

## «Done» criteria (measurable)
- [ ] ... (with the figure, the test or the command that proves it)

## Folders it touches
- Own: ...
- Other people's, with their agreement: ...

## Contract (`api/openapi.yaml`)
- Consumes: ...
- Adds or changes: ... (in a separate PR, reviewed by ...)

## Models and cost
- Which model or service it uses, when it calls it and with what cost limit.

## If it fails
- How it degrades without breaking the app.

## Dependencies on other people
- ...

## Risks
- ...

## Open questions
- ...

## Brief changes
- <YYYY-MM-DD HH:MM> — what changed and why.
```
