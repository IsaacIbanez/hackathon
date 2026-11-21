# Reconocimiento de voz: qué usar (T17, T18)

Problema: el dictado entiende mal. Hoy usa `whisper-tiny` (el Whisper más pequeño, 39 M parámetros) en la CPU, y en el navegador intenta antes el reconocedor del sistema.

## Medición (2026-11-21)
Misma frase en español, generada con la voz «Helena» de Windows (audio **limpio**: con micro real y ruido, las diferencias crecen):
«¿Qué tengo que poner aquí, en la fecha del siniestro? ¿Y dónde firmo?»

### En local (transformers.js 3.8.1, `q8`, CPU, Node en un portátil Windows)
| Modelo | Descarga | Carga | Transcribir | Resultado |
|---|---|---|---|---|
| `onnx-community/whisper-tiny` (lo de hoy) | ~40 MB | 23 s | 0,4 s | «que tengo que poner aquí en la fecha del siniestro. Y donde **firma**.» ❌ |
| `onnx-community/whisper-base` | ~80 MB | 38 s | 0,6 s | «…Y donde **firmó**?» ❌ |
| **`onnx-community/whisper-small`** | ~250 MB | 108 s (solo la 1.ª vez; luego, caché) | **1,1 s** | «que tengo que poner aquí, en la fecha del siniestro. **¿Y dónde firmo?**» ✅ |
| `onnx-community/whisper-large-v3-turbo` | ~560 MB (q4f16, WebGPU) | — | — | no medido; el mejor, pero pesado |

### En la nube (OpenRouter, mensaje con `input_audio` en WAV)
| Modelo | Tiempo | Coste | Resultado |
|---|---|---|---|
| **`google/gemini-2.5-flash-lite`** | **2,3 s** | **0,00006 $** | «Que tengo que poner aquí, en la fecha del siniestro y dónde firmo.» ✅ (solo puntuación). A veces da 429: hay que tener respaldo |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 7,1 s | 0 $ | correcta ✅, lenta (razona) |
| `qwen/qwen3.8-omni-flash` | 7,0 s | 0,00006 $ | exacta ✅, lenta |
| `mistralai/voxtral-small-24b-2507` | 7,5 s | 0,00056 $ | ❌ cambia palabras («debo» en vez de «tengo») |

## Respaldo en la nube: hecho (T18, 2026-11-21)
- **Go:** `POST /transcribe?lang=es-ES` con el audio en `audio/wav` → `{"text", "model", "costUsd", "latencyMs"}`; el coste sale en el contador (`stats`). Modelos: `LLM_TRANSCRIBE_MODELS` (por defecto `google/gemini-2.5-flash-lite,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`).
- **Probado** con la frase de arriba: «que tengo que poner aquí en la fecha del siniestro y dónde firmo», 2,3 s, 0,00006 $.
- **Para Nil:** en `web/src/app/transcribe.ts` está `transcribeRemote(samples, sampleRate, lang, wsUrl)`: codifica el audio en WAV, busca el servidor a partir de la URL del WebSocket (`resolveWsUrl()`) y devuelve el texto. Llamadla solo si el reconocimiento local falla o sale vacío.

## Decisión
1. **Local primero (Nil, T17):** `whisper-small`. Con WebGPU si la ventana lo tiene; si no, WASM `q8`. Idioma forzado (`spanish`). **Precargar el modelo al abrir la app**, con un aviso «preparando la voz…», para no hacer esperar en la primera pregunta. `whisper-tiny` solo como último recurso en equipos lentos.
2. **Nube como respaldo (Isaac, T18):** `POST /transcribe` en Go (cuerpo: audio WAV 16 kHz mono) → `{"text": "..."}` con `google/gemini-2.5-flash-lite` y, si falla, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. Se usa **solo** si el local falla, sale vacío o el usuario lo activa. El coste sale en el contador (`stats`).
3. **Mejoras baratas del audio** (Nil): remuestreo a 16 kHz con `OfflineAudioContext` en vez del lineal; probar `autoGainControl: true`; revisar los umbrales del detector de voz (`vad.ts`) con el micro real.

**Para la demo:** con Hugging Face bloqueado o sin red, el modelo local no se puede descargar. Hay que descargarlo antes (queda en la caché del navegador) o servirlo en local, igual que MediaPipe (T15).
