# Brief for Pau (P4)
Confirmed by Pau on 2026-11-21 23:12. Last review: 2026-11-22 00:35 (mixed languages, barbarisms and better diarisation, asked for by Pau).

## Goal
Live captions of what is heard in a conference or a meeting (the microphone and, if wanted, a call's audio), with who is speaking and automatic translation into the chosen language, and the transcript saved to a text document. For people who do not hear well, do not understand the language or need very large type. It is a base utility of the app.

## What the demo will show
- Someone speaks Spanish in front of the MX Brio, whose mics pick up the audio, and the captions appear word by word in very large type and high contrast, with «Speaker 1» or «Speaker 2».
- When each sentence ends its translation comes out below, for example into English, and the accumulated cost is shown.
- A tab with a video or a call is shared and it captions that too.
- On stop, a `.txt` is left with the original transcript and the translation.

## Scope
- **Go, in a new `backend/captions` package:** a WebSocket `GET /captions` on 8765 that receives PCM audio from the browser and passes it to Together's realtime mode (`wss://api.together.ai/v1/realtime`).
  - Model `nvidia/parakeet-tdt-0.6b-v3`, changed with `CAPTIONS_ASR_MODEL`. It only detects 25 European languages and understands sentences with two languages mixed.
  - Key in `TOGETHER_API_KEY`, in `.env` and never in the repo.
  - The browser never sees the key.
- **Partials and final sentences:** the partial text updates while speaking, and the sentence becomes fixed at the pause (Together's VAD).
- **Language, barbarisms and translation:** a single call per final sentence to `Qwen/Qwen3.5-9B` on Together (`CAPTIONS_TRANSLATE_MODEL`, no reasoning), with the previous sentences and the speaker's usual language as context. It does three things:
  - gives the sentence's main language;
  - puts the words from another language in quotes (`el "meeting"`; `Okay, "hasta luego"` said by an English speaker);
  - translates it into the target language, which is chosen and changed live (or «don't translate»).
  - Go checks that the model has only added quotes; if it has changed any word, the original text stays.
  - When it is known who said it and that person usually speaks another language, the sentence is reviewed again. The change is only accepted if the language changes and the model marks foreign words.
- **Spoken language:** detected on its own, and each person can speak a different one, or one is forced. What matters is Spanish and English; Catalan is not a priority.
- **Diarisation (who is speaking):**
  - A «People speaking» selector (don't know, 1–6): passed to the diarisation (`max_speakers` live; `min_speakers = max_speakers` in the final pass).
  - Live, approximate: every 15 s, with 45 s windows overlapping by 30 s, Go sends the audio to `nvidia/parakeet-tdt-0.6b-v3` in batch with `diarize=true`. It labels the sentences already shown by time, and matches the voices of one window and the next by what they say in the overlap.
  - The language is also a hint: with 2 people or more and as many languages as people (each one speaks their own), each language belongs to one person. Sentences of 4 words or more follow the language; short ones from a known person follow the voice, because that is where the barbarisms are. If it is not said how many people there are, a bilingual person is not split in two.
  - The final pass keeps the numbering already shown on screen.
  - On stop, exact: a pass with diarisation over the whole recording, for the saved document.
- **Its own page (`web/src/captions/`):**
  - the chosen microphone (the MX Brio if it is there) and, optionally, the audio of a tab or a call (`getDisplayMedia`), mixed and converted to 16 kHz mono 16-bit;
  - **a history that does not disappear**: a growing list, with time, person, original and translation, that scrolls down on its own to the end unless you have scrolled up to read (a «Jump to latest» button);
  - type of at least 32 px, high contrast and `aria-live` on the final sentences;
  - a «Download transcript» button.
- **Saved document:** Go writes `Documents/LauzHack/captions-YYYY-MM-DD-HHMM.txt`, outside the repo, every minute and on stop. First the original with the time and the person; then, if it has been translated, the translation.
- **Visible cost** on the page, with a per-session cap of **$1** (`CAPTIONS_LIMIT_USD`): when reached it stops and warns.
- **If Together or the network fails:**
  - a clear notice and retrying only 3 times (at 1, 2 and 4 s);
  - if it keeps failing, **local Whisper** (Nil's `WhisperListener`) is offered, by sentences and without partials or diarisation, with a notice that it is worse than the online model.
- **A «Live captions» button** in the app, added by Isaac in `web/src/app`.

## Out of scope
- Giving each person their own name.
- Captions on top of other applications (floating window).
- Translating the partials.
- Reading the translation aloud.
- Catalan as a priority.

## Flow, from the user's point of view
1. I open «Live captions» and choose the microphone, the spoken language («auto» by default) and the target language.
2. If I want, I press «Add call audio» and choose the tab or the screen with sound.
3. I press «Start». When speaking the partial text appears and, when pausing, the sentence becomes fixed in the history.
4. Its translation appears below, and the label of who is speaking arrives a few seconds later.
5. I press «Stop». The `.txt` is saved with the final labels and the page says where it is.

A concrete example: I say «¿Cuándo vence el plazo del seguro?» and another person answers «El quince de diciembre».
- **On screen:**
  - `[00:00:03] Speaker 1: ¿Cuándo vence el plazo del seguro?` / *When does the insurance deadline expire?*
  - `[00:00:07] Speaker 2: El quince de diciembre.` / *On the fifteenth of December.*
- **In the `.txt`:**
  ```
  Live captions — 2026-11-21 23:30 — spoken: es — translated to: en
  == Original ==
  [00:00:03] Speaker 1: ¿Cuándo vence el plazo del seguro?
  [00:00:07] Speaker 2: El quince de diciembre.
  == Translation (en) ==
  [00:00:03] Speaker 1: When does the insurance deadline expire?
  [00:00:07] Speaker 2: On the fifteenth of December.
  ```

## «Done» criteria (measurable)
- [ ] `go test ./backend/captions` with a fake Together: partial → final → translation, labels by time, cost cap, missing key (`no_key` error), drop and reconnection, and the `.txt` format.
- [ ] A real test with the microphone, one Spanish sentence: the first partial in under 1.5 s and the translation in under 2 s after the final sentence.
- [ ] With two people speaking in turns for 2 minutes, the final `.txt` has the right person in at least 80 % of the sentences.
- [ ] The audio of a tab with a video is captioned (in Chrome).
- [ ] After 5 minutes, the page still shows the first sentence, and the `.txt` has both sections.
- [ ] The cost on screen matches the sum of what is used (±10 %), and the session is cut at $1.
- [ ] Without a network: a notice in under 3 s, 3 retries and then local Whisper is offered, which works.
- [ ] No key in the repo: searching for the prefix of Together keys (`tgp_` + `v1_`) across the whole history only finds this line. And `task check` passes.

## Folders it touches
- **Own (new):** `backend/captions/` (agreed with Isaac) and `web/src/captions/`.
- **Other people's, with their agreement:**
  - Isaac:
    - a line in `backend/session/mux.go` (or wherever they say) to register `/captions`, without touching anything else of their code;
    - the button in `web/src/app`, which they add;
    - the note in `AGENTS.md`, which Pau asked for.
  - Nil: only their `WhisperListener` (`web/src/input/voice`) is used, without modifying it.

## Contract (`api/openapi.yaml`)
- Consumes: nothing of what is there.
- Adds `GET /captions`, in a separate PR reviewed by Isaac:
  - WebSocket with `?lang=auto|<ISO 639-1>&target=none|<ISO 639-1>`;
  - from the browser to Go: binary chunks of PCM s16le, 16 kHz, mono (~100 ms) and `{"type":"config","target":"en"}` to change the target language;
  - from Go to the browser:
    - `partial` `{text}`;
    - `final` `{id, start, text}`;
    - `speaker` `{id, speaker}`;
    - `translation` `{id, lang, text}`;
    - `cost` `{costUsd, limitUsd}`;
    - `saved` `{path}`;
    - `error` `{code, message, retryable}`.

## Models and cost
| What for | Model | Cost |
|---|---|---|
| Live captions | Parakeet v3 | $0.0035/min ≈ $0.21/h |
| Live diarisation | Parakeet v3 in batch, 45 s windows every 15 s | ≈ $0.0015/min × 3 ≈ $0.27/h |
| Final diarisation | Parakeet v3 in batch, a single pass | ≈ $0.09/h |
| Language, barbarisms and translation | `Qwen/Qwen3.5-9B` ($0.17 / $0.25 per million tokens), one call of ~650 tokens per final sentence | ≈ $0.06/h |
| Fallback | Local Whisper | $0 |

Total: about $0.6/h; measured: $0.0041 for 28 s of bilingual dialogue. The per-session cap is $1 (`CAPTIONS_LIMIT_USD`).

## If it fails
- **Without a key:** `no_key` error. The page says «Live captions need TOGETHER_API_KEY in .env» and offers local Whisper.
- **Without a network or with Together down:** a large notice and 3 retries (1, 2 and 4 s). If they keep failing, local Whisper is offered with its quality notice. The rest of the app is not affected.
- **Diarisation fails:** the sentences stay without a label, but the captions carry on.
- **Translation fails:** the original is shown and marked «translation unavailable».
- **Cap reached:** the session stops, the `.txt` is saved and it warns.
- **The call's audio cannot be captured** (for example, in WebView2): it carries on with the microphone only, and warns.

## Dependencies on other people
- **Isaac:** reviews the contract PR and the route registration, and adds the «Live captions» button to the app.
- **Nil:** their `WhisperListener` is the local fallback. If its interface changes, we must be told.

## Risks
- **Together's diarisation with two languages taking turns:** it mixes the voices. With Whisper the sentences in the other language are also lost, because it only transcribes one. Mitigated with Parakeet and with the language as a hint. With a single language it works well (5/5 and 18/18).
- **Short sentences with a wrongly assigned voice** (for example «Perfecto. Gracias.»): they follow the voice and may come out with the wrong person.
- **Mishearing the barbarisms:** «hasta luego» said with an English accent comes out as «Asta Luego». It is put in quotes, but the spelling is not corrected, because the model cannot change words.
- **Together authentication:** their documentation gives two different ways for realtime mode. The reference's one is used (`Authorization: Bearer` header) and it is tested with the real key.
- **Live labels:** the who-is-speaking ones can change between windows. They are approximate by design; the good ones are those in the final `.txt`.
- **Call audio in Wails:** WebView2 may not allow it. The demo of that part can be done in Chrome.
- **Go:** it was not installed on Pau's PC. It is installed with `winget install GoLang.Go`.
- **The key:** it was pasted in the session's chat. It has to be regenerated in Together after the hackathon.

## Open questions
- Test the diarisation with real human voices: the tests use Windows synthetic voices, which the service separates worse.
- Where exactly Isaac registers the route, if they prefer a place other than `mux.go`.

## Brief changes
- 2026-11-22 00:35 — At Pau's request: better diarisation, one person per language and barbarisms in quotes.
  - Parakeet v3 becomes the captions and diarisation model. With mixed languages, Nemotron split words and made up text; Whisper only transcribes one of the languages.
  - One Qwen call per final sentence for the language, the quotes and the translation.
  - A «People speaking» selector, the language as a hint to know who is speaking, 45 s live windows and stable numbering.
  - Contract 0.8: `speakers`, `revise` and `lang` in `final`.
  - Measured with synthetic voices, a 28 s Spanish/English dialogue: language, quotes and translation right in 8/8 sentences; who is speaking, 7/8 (before, 2/8 and 3 sentences without a person). The Spanish-only dialogue is still at 5/5.
- 2026-11-21 23:50 — Tested with the real Together (synthetic dialogue of 2 voices, 17 and 52 s):
  - Nemotron 3.5 understands Spanish and stays as the default model: first partial ~0.7 s after starting to speak; the sentence closes ~0.3 s after the pause.
  - Translation with Qwen's reasoning turned off: 0.1–0.4 s per sentence.
  - Who is speaking: 18/18 sentences right in the `.txt` and 10/10 live.
  - Live diarisation goes from every 30 s to every 15 s, so that the labels arrive sooner (+$0.03/h).
  - Real cost: $0.0025 for 17 s of audio, with everything.
- 2026-11-21 23:12 — First version, confirmed by Pau: diarisation (live approximate and final exact), transcript saved to `.txt`, a history that does not disappear and Catalan not a priority.
