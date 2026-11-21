# Plan por persona (histórico)

Trasladado **íntegro** desde `AGENTS.md` («Plan actual», subsecciones por persona) el 2026-11-21, al integrar todas las ramas en `integration/proyecto-unificado`. Ya no está vigente: el reparto se redefinirá. El estado real de cada pieza está en `docs/ESTADO_PROYECTO.md`.

### Siguiente tarea de cada uno (actualizado 2026-11-21, 20:30)
| Quién | Ya hecho | Ahora | Para probar sin los demás |
|---|---|---|---|
| **Didac (B2)** | Pipeline foto → PDF + `document`; envío a la app (`scan.py --send`); cámara disponible sin Brio; OCR en paralelo; código en inglés; `scanner/ENTREGA.md` (todo en `feature/B-contexto-scanner`) | ~~Abrir el PR~~ (fusionado, #26). **Ahora** T13: servicio `POST /scan` en 8770 que reciba la foto (su pipeline ya admite `--png`) y devuelva `document()` + `pageCorners`. Después, 2–3 documentos reales anonimizados en `api/fixtures/real/` | `curl --data-binary @foto.png http://127.0.0.1:8770/scan` |
| **Pau (B1)** | Captura de la MX Brio (#12); **cámara en la app** (`openCamera`, `captureStill`, #31); ideas (#32); **T19 hecha** en `feature/T19-encuadre` (`startFramingGuide`, ver abajo; probada con la cámara del portátil) | **1)** Probar T19 con la **MX Brio** y una hoja real y ajustar los umbrales si hace falta. **2)** Traducir `capturar.py` al inglés **avisando a Didac** (`scan.py` y `demo_app` usan sus nombres) | su página de prueba (`npx vite web/src/camera` → `/demo/`, botón «Start framing guide») |
| **Nil (C)** | Gestos (#9), voz con Whisper local (#19), arreglo del puntero (#23, de Isaac) | **1)** Arreglar #20 (cabecera `Host`). **2)** T17: **mejorar el reconocimiento de voz** (ver abajo). **3)** T15: acción `scan_document` (frase «lee el documento» y gesto) y puntero con `pageCorners` en `Gestures.tsx`. **4)** MediaPipe y modelos servidos en local para la demo | `docs/PROBAR_GESTOS.md`; las esquinas de un ejemplo de `api/fixtures/real/` |
| **Isaac (A)** | Contrato, servidor, sesión, modelos, pantalla, puente de gestos, empaquetado, pitch | ~~Fusionar el PR de Didac~~ (#26). ~~T11: contrato 0.5 y `POST /scan`~~ (hecho). ~~T18: `POST /transcribe`~~ (hecho). **Ahora** T14: botón «Read document» y unión en la app | servicios falsos en los tests de Go |
| **Todos** | — | T16: lluvia de ideas en `docs/IDEAS.md` (3 ideas cada uno como mínimo) | — |

### Guía de encuadre y disparo automático (T19, Pau)
Para quien no ve, el problema no es leer: es saber si el papel está bien puesto. En local y sin IA, en `web/src/camera`:

```ts
// Mira el vídeo mientras dura la orden «lee el documento» y va dando avisos hasta que la foto es buena.
startFramingGuide(video: HTMLVideoElement, opts: {
  lang: string                                  // "es-ES": textos de los avisos en el idioma del usuario
  onHint: (hint: FramingHint, text: string) => void   // la app lo dice en voz alta (sin repetir el mismo aviso seguido)
  onCapture: (still: Blob) => void              // disparo automático: papel quieto + nítido + con luz
  timeoutMs?: number                            // si no se consigue, se dispara igualmente con la mejor foto (por defecto 8 s)
}): { stop(): void }

type FramingHint = 'dark' | 'blurry' | 'moving' | 'hold_still' | 'ready'
```
- **Quieto:** comparar fotogramas seguidos (diferencia media pequeña durante ~0,7 s). **Nítido** y **con luz:** `frameMetrics` (ya existe).
- Al disparar: un pitido corto (como los de la voz de Nil) y `onCapture` con la mejor foto (`captureStill`).
- Lo que depende de la hoja (`cropped`, `too_far`, inclinada) lo dice Go con el `document` que devuelve el escáner; no hace falta detectarla en el navegador.
- **Lo une Isaac** en la app (T14): la orden «lee el documento» → `startFramingGuide` → `POST /scan` con la foto.

**Estado (2026-11-21, 22:30): hecha** en `feature/T19-encuadre`, con la interfaz de arriba. Además, `onCapture` recibe un segundo argumento `info` (`reason: 'ready' | 'timeout'`, tamaño, nitidez, `elapsedMs`) y hay `onError` y `onFrame` opcionales.
- Avisos en es, ca y en. Un aviso tiene que durar 0,3 s antes de decirse, no se repite mientras sigue igual y se repite a los 5 s.
- Dispara cuando el papel lleva 0,7 s quieto, con luz y con la nitidez estable (el autoenfoque ha terminado): el fotograma más nítido de ese momento, a resolución completa, con pitido y «Foto hecha». A los 8 s, la mejor foto vista.
- Umbral de movimiento medido con la MX Brio (escena quieta: 1,4 de media, 2,8 en el p95 → 4,5). Detalle en `web/src/camera/README.md`.
- Probado: tests (91 en `web`), y en el navegador con la cámara del portátil (1280x720, disparo `ready` a los 2,8 s).
- **Falta:** probarlo con la MX Brio (4K) y una hoja sujeta a mano, comprobar que el `motion` de una mano quieta queda por debajo de 4,5 y ajustar si no; y la unión en la app (Isaac, T14).

### Voz: reconocimiento mejor que el actual (T17 Nil, T18 Isaac)
Hoy el dictado usa `whisper-tiny` en la CPU y se equivoca mucho. Medido el 2026-11-21 con la misma frase en español («¿Qué tengo que poner aquí, en la fecha del siniestro? ¿Y dónde firmo?»), detalle en `docs/VOZ.md`:

| Opción | Resultado | Tiempo | Coste |
|---|---|---|---|
| `whisper-tiny` local (lo de hoy) | falla («firma» en vez de «firmo») ya con audio limpio | 0,4 s | 0 $ |
| **`whisper-small` local** (q8) | **exacta** | **1,1 s** (descarga ~250 MB la primera vez) | 0 $ |
| **`google/gemini-2.5-flash-lite`** (OpenRouter, audio) | **correcta** (solo puntuación) | **2,3 s** | **0,00006 $** |
| nemotron omni (gratis) / qwen omni | correctas | ~7 s | 0 $ / 0,00006 $ |
| voxtral-small | cambia palabras | 7,5 s | 0,00056 $ |

**Plan (frugal):** primero en local, y la nube solo si falla.
- **Nil (T17):** pasar a `whisper-small` (WebGPU si está, si no WASM q8), forzar el idioma, **precargar el modelo al abrir la app** para que la primera pregunta no espere, y dejar `whisper-tiny` para equipos lentos. Si el resultado local sale vacío o con error, usar el respaldo de Isaac.
- **Isaac (T18):** `POST /transcribe` en Go (audio → texto) con `google/gemini-2.5-flash-lite` y respaldo gratuito; el coste aparece en `stats`.

Sincronización corta cada hora: qué he fusionado y qué necesito del contrato.
