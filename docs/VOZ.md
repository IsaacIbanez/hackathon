# Speech recognition: what to use (T17, T18)

Problem: dictation understands badly. Today it uses `whisper-tiny` (the smallest Whisper, 39 M parameters) on the CPU, and in the browser it tries the system recogniser first.

## Measurement (2026-11-21)
The same Spanish sentence, generated with the Windows «Helena» voice (**clean** audio: with a real mic and noise, the differences grow):
«¿Qué tengo que poner aquí, en la fecha del siniestro? ¿Y dónde firmo?» (What do I have to put here, in the date of the claim? And where do I sign?)

### Local (transformers.js 3.8.1, `q8`, CPU, Node on a Windows laptop)
| Model | Download | Load | Transcribe | Result |
|---|---|---|---|---|
| `onnx-community/whisper-tiny` (today's) | ~40 MB | 23 s | 0.4 s | «que tengo que poner aquí en la fecha del siniestro. Y donde **firma**.» ❌ |
| `onnx-community/whisper-base` | ~80 MB | 38 s | 0.6 s | «…Y donde **firmó**?» ❌ |
| **`onnx-community/whisper-small`** | ~250 MB | 108 s (first time only; then, cache) | **1.1 s** | «que tengo que poner aquí, en la fecha del siniestro. **¿Y dónde firmo?**» ✅ |
| `onnx-community/whisper-large-v3-turbo` | ~560 MB (q4f16, WebGPU) | — | — | not measured; the best, but heavy |

### Cloud (OpenRouter, message with `input_audio` in WAV)
| Model | Time | Cost | Result |
|---|---|---|---|
| **`google/gemini-2.5-flash-lite`** | **2.3 s** | **$0.00006** | «Que tengo que poner aquí, en la fecha del siniestro y dónde firmo.» ✅ (punctuation only). Sometimes returns 429: a fallback is needed |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 7.1 s | $0 | correct ✅, slow (it reasons) |
| `qwen/qwen3.8-omni-flash` | 7.0 s | $0.00006 | exact ✅, slow |
| `mistralai/voxtral-small-24b-2507` | 7.5 s | $0.00056 | ❌ changes words («debo» instead of «tengo») |

## Cloud fallback: done (T18, 2026-11-21)
- **Go:** `POST /transcribe?lang=es-ES` with the audio as `audio/wav` → `{"text", "model", "costUsd", "latencyMs"}`; the cost shows up in the meter (`stats`). Models: `LLM_TRANSCRIBE_MODELS` (by default `google/gemini-2.5-flash-lite,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`).
- **Tested** with the sentence above: «que tengo que poner aquí en la fecha del siniestro y dónde firmo», 2.3 s, $0.00006.
- **For Nil:** `web/src/app/transcribe.ts` has `transcribeRemote(samples, sampleRate, lang, wsUrl)`: it encodes the audio as WAV, finds the server from the WebSocket URL (`resolveWsUrl()`) and returns the text. Call it only if local recognition fails or comes out empty.

## Decision
1. **Local first (Nil, T17):** `whisper-small`. With WebGPU if the window has it; otherwise, WASM `q8`. Forced language (`spanish`). **Preload the model when the app opens**, with a «preparing the voice…» notice, so the first question does not have to wait. `whisper-tiny` only as a last resort on slow machines.
2. **Cloud as a fallback (Isaac, T18):** `POST /transcribe` in Go (body: 16 kHz mono WAV audio) → `{"text": "..."}` with `google/gemini-2.5-flash-lite` and, if it fails, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. Used **only** if local fails, comes out empty or the user turns it on. The cost shows up in the meter (`stats`).
3. **Cheap audio improvements** (Nil): resampling to 16 kHz with `OfflineAudioContext` instead of the linear one; try `autoGainControl: true`; review the voice detector's thresholds (`vad.ts`) with the real mic.

**For the demo:** with Hugging Face blocked or without a network, the local model cannot be downloaded. It has to be downloaded beforehand (it stays in the browser's cache) or served locally, just like MediaPipe (T15).
