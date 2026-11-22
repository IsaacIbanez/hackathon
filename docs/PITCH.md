# Pitch and demo (T10)

Script of the presentation and of the demo. Figures measured on 2026-11-21 (see «Figures»); what does not work yet is marked with ⏳ and **is not promised on stage**.

## The idea in one sentence
A person with low vision holds a letter or a form in front of the camera; the app tells them what it is and what they have to fill in, reads them the field they point at with their finger and answers what they ask, in plain language and at almost no AI cost.

## Script (3 minutes)
| Time | Who | What is said / done |
|---|---|---|
| 0:00–0:30 | Isaac | **The problem.** Letters from the insurer, the bank, the administration: for a person with low vision every paper is a barrier and depends on someone reading it to them. |
| 0:30–0:45 | Isaac | **The solution.** The Logitech webcam as the AI's eyes, the hand as a pointer and the voice as the interface. |
| 0:45–2:15 | Demo (see below) | Paper in front of the camera → explanation → point at a field → ask → cost on screen. |
| 2:15–2:45 | Isaac | **How it is frugal (AXA).** Local first: framing, reading the pointed field and gestures spend no AI. The cheap model explains; the expensive one only if the cheap one is unsure. The cost is shown on screen. |
| 2:45–3:00 | Isaac | **Impact (IMC) and close.** Designed with and for organisations of people with visual impairments; it runs locally, on a laptop with a webcam. |

## The demo, step by step
Preparation: see «Checklist». Screen: on the left the explanation + gestures + cost; on the right the document in large type.

1. **Show the form** (an insurance claim) to the MX Brio. ⏳ *Depends on B's scanner (`POST /message`).*
   In ~2 s the app says: «This document is an AXA Seguros insurance claim… You must write your full name and the date of the incident… Then you have to sign…». The fields are highlighted on screen.
2. **Point with the finger** at the date field → the app reads it instantly («Date of the incident»), **without AI**.
3. **Hold the finger still** (or ask «What do I have to put here?» ⏳ *voice dictation, role C*) → «Here you have to write the date on which the incident happened… day, month and year».
4. **Open palm** → it goes quiet. **👍** → it summarises the document.
5. **Point at the cost box**: «all of this cost $0.0003».

### Plan B (if something fails live)
| Fails | What to do |
|---|---|
| The scanner or the paper camera | «Developer tools» → **Send sample document** (same form); or `python api/examples/send_message.py api/fixtures/document.json` |
| The gestures | Carry on with the rest; the pointer can also be explained with the screen |
| Internet / OpenRouter | Remove the key from the `.env` and restart: the app answers with the sample answers (fixtures). Mention it naturally («offline mode») |
| The free model returns 429 | Do not use `LLM_PROFILE=dev` in the demo (see Checklist) |

## How each challenge fits
| Challenge | What they value | What we show (verifiable) |
|---|---|---|
| **Logitech** | Webcam as the AI's eyes and ears, multimodal inputs, context-aware flows | MX Brio for the document (4K capture, sharpest frame, `scanner/`); hands with MediaPipe (`web/src/input`); the context is shared: what is pointed at gives meaning to what is asked («what do I put **here**?») |
| **IMC Tech for Good** | Real usefulness, technical quality, social impact, presentation; an NGO in education, inclusion or community | Accessibility by design: large type, high contrast, visible focus, everything by voice, confirmation of every gesture (`aria-live`), doubtful lines read out marked as «(unclear)» |
| **AXA** | A real app (not a notebook), frugality, own technical challenge, teamwork, presentation; «AI slop» is penalised | A real desktop app (Wails + Go + React); cheap → expensive routing only when in doubt; local answers without AI; cache; cost visible on screen; a real insurance document as the use case |

**NGO for IMC (to be confirmed by the team):** a federation of blind and low-vision people (for example, in Switzerland the Fédération suisse des aveugles et malvoyants, or ONCE in Spain). Check the exact name before citing it.

## Figures (measured, not estimated)
| What | Value | How it was measured |
|---|---|---|
| Explaining the form with Haiku (cheap, paid) | **1.8 s · $0.00012** | real server, `api/fixtures/document.json`, 2026-11-21 |
| Answering «What do I have to put here?» | **1.7 s · $0.00017** | same |
| Reading the pointed field | **instant · $0** (local) | same |
| The same with free models (`LLM_PROFILE=dev`) | 2–4 s · $0 | nemotron, several tests |
| A $10 budget | ≈ **70,000** explanations or questions with Haiku | $10 ÷ ~$0.00014 |
| MX Brio capture | 4K, ~0.4 s in server mode | `scanner/README.md` (Pau) |
| Automated tests | 49 frontend + Go (session, client, WebSocket, contract) | `task check`, CI green |

## Hard questions (and a short answer)
- **What if the AI gets it wrong?** It only explains what the OCR has read and does not invent content (it is in the model's instructions); it marks doubtful lines; if the cheap answer is not valid, it escalates to the expensive model.
- **Privacy?** Camera, gestures and OCR run locally; the servers only listen on 127.0.0.1; only the document's text goes to the model, not the image. The key is never in the repository.
- **Why not just send the photo to a large model?** Cost and latency: with our routing, pointing and framing cost nothing and explaining costs $0.0001. It is AXA's criterion.
- **Does it work without internet?** Framing, reading the pointed field and the gestures do; the explanation needs the model. With a local model it could (we have not done it).
- **What did you build yourselves?** A contract and a Go server with a shared session, frugal routing with a cache and a meter, 4K capture picking the sharpest frame, OCR to a searchable PDF (⏳ on Didac's branch), a gesture module with MediaPipe, a gestures → AI bridge. See `AGENTS.md` and the PRs.

## Checklist before presenting
- [ ] `git pull` on `main` and `task check` green on the demo laptop; `wails build` and open `build/bin/lauzhack.exe`.
- [ ] «Developer tools»: Spanish voices and camera at «yes»; if something fails, look at `build/bin/lauzhack.log`.
- [ ] `.env` with the key and **without** `LLM_PROFILE=dev` (Haiku: faster and no 429; demo cost < $0.01).
- [ ] MX Brio connected and tested; a webcam for the hands if two cameras are used (decision pending).
- [ ] The form printed large, good light, no glare.
- [ ] Laptop volume high; a Spanish voice installed on the system.
- [ ] A full timed rehearsal (3 min) at least twice.
- [ ] Plan B tested: «Send sample document» and keyless mode.

## Pending (team)
- ⏳ B's scanner sending `document` with `POST /message` (guide: `docs/INTEGRACION_SCANNER.md`).
- ⏳ Decide who uses each camera.
- ⏳ Voice dictation (role C, `onDictate` hook ready).
- ⏳ Choose and confirm the NGO for IMC.
- ⏳ Split who speaks in each part of the script.
