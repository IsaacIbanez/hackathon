# Estado del proyecto (integración del 2026-11-21)

Documento de referencia tras unificar todo el trabajo en la rama `integration/proyecto-unificado`. Describe **lo que hay de verdad** en el código, con evidencias (comando y resultado, anexo E1–E8). No define objetivos ni reparte trabajo: eso lo decidirán las personas.

Convenciones de estado:
- **Verificado:** se ejecutó en esta integración y se vio funcionar.
- **Sin verificar:** el código y sus tests están, pero hace falta hardware, una clave de pago o dependencias que no había en el equipo de la integración (Windows 11, sin Tesseract, sin ffmpeg, sin la MX Brio, sin micrófono ni mano delante de la cámara).
- **Parcial:** falta una parte identificada.
- **Duplicado:** hay otra implementación con el mismo fin.

---

## 1. Resumen

**Qué es hoy la app.** Una aplicación de escritorio (Wails: Go + React/TypeScript) para personas con baja visión, **pensada para** leer un documento en papel, explicarlo en voz alta en lenguaje sencillo, leer el campo que se señala con el dedo y responder a preguntas por voz. En esta integración **no se ha leído todavía ningún papel real**: el documento llega como ejemplo o desde el escáner, y la lectura de una foto real necesita Tesseract y la unión pendiente de §1.4. La IA es frugal: lo local primero (avisos de encuadre, lectura del campo señalado, gestos), un modelo barato para explicar y uno caro solo si el barato duda. El coste se ve en pantalla.

**Cómo se arranca** (detalle en §4):
```
task dev                       # la app de escritorio completa (Wails), con el servidor Go dentro
task server                    # solo el servidor real, sin ventana, en 127.0.0.1:8765
task mock                      # respuestas de ejemplo, sin clave ni coste, en localhost:8080
python scanner/service.py      # servicio de lectura de documentos (Python), 127.0.0.1:8770
```
La clave de OpenRouter va en `.env` (en `.gitignore`). `LLM_PROFILE=dev` pone primero modelos gratuitos, pero **no garantiza 0 $**: el modelo «caro» de dev es Haiku (de pago), así que cualquier escalada (duda o fallo del barato) va a Haiku; y `/transcribe` prueba primero Gemini (de pago), porque dev no cambia `LLM_TRANSCRIBE_MODELS`. Para no gastar nada: `LLM_CHEAP_MODEL` y `LLM_EXPENSIVE_MODEL` con solo modelos `:free` (por ejemplo `nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free`) y `LLM_TRANSCRIBE_MODELS=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. **Sin clave**, la app de escritorio responde con el mock, que no tiene `/message`, `/scan` ni `/transcribe` (404).

**De punta a punta, tal como está hoy:**
1. Un documento llega a Go de una de estas tres formas:
   - con el botón «Send sample document» de la interfaz;
   - desde el escáner en Python, con `scan.py --send` (`POST /message`);
   - con una foto enviada a `POST /scan`, que Go pasa al servicio de lectura.
2. Go guarda el documento en la **sesión compartida**, lo **reenvía a la interfaz** (vista en letra grande), da avisos locales si el encuadre es malo y, si es bueno, pide la **explicación** al modelo (barato → caro si duda). Después envía `speak` y `stats` (coste) a todas las ventanas.
3. En la interfaz, el **módulo de manos** (MediaPipe) convierte el dedo en puntero. El **puente** manda `pointer` y Go lee en local el bloque señalado. Mantener el dedo quieto abre el **dictado** (Whisper local): la pregunta se envía como `utterance` y Go responde con el documento y el bloque señalado como contexto.
4. **Lo que aún no está unido** (§2, «Parcial»):
   - la interfaz no hace todavía la foto ni llama a `POST /scan` (la cámara de la app, la guía de encuadre y el servicio existen por separado);
   - el puntero usa la imagen entera de la cámara en lugar de las esquinas reales de la hoja (`pageCorners`);
   - el respaldo de voz en la nube no está conectado.

---

## 2. Funcionalidades

Orígenes: rama o PR y agente (P1 Isaac, P2 Didac, P3 Nil, P4 Pau; «-C» = Claude). Evidencias en el anexo.

| # | Funcionalidad | Qué hace | Dónde | Origen | Estado | Evidencia | Qué falta | Dependencias y riesgos |
|---|---|---|---|---|---|---|---|---|
| F1 | Contrato y tipos generados | Sobre `{type,id,ts,payload}`; mensajes `document`, `pointer`, `utterance`, `speak`, `stats`; `/health`, `/ws`, `/message`, `/scan`, `/transcribe` | `api/openapi.yaml` (0.6.0), `api/gen/`, `web/src/api/`, `api/fixtures/` | T2…T18: #2, #6, #8, #13, #14, #35, #36, #37 (P1-C) | **Verificado** | E2 (tipos al día; `api` ok) | `document` JSON reales en `api/fixtures/real/` | Cambiar el contrato sin `task gen` rompe el CI (pasó en #36 y se arregló en #37) |
| F2 | Servidor Go y API local | `/ws` con **una sesión compartida** para todos los clientes (`ws.Hub`); `POST /message`; servidor local fijo en 8765 | `backend/ws/`, `backend/session/mux.go`, `backend/cmd/server`, `app.go`, `main.go` | #4, #10, #13, #14 (P1-C) | **Verificado** | E3 (health, WebSocket, `/message`), E2 | — | Puerto 8765 fijo (`LAUZHACK_ADDR`); si está ocupado usa otro y los procesos externos no lo encuentran |
| F3 | Lógica de la sesión | Explicar el documento; leer el bloque señalado **en local**; responder preguntas con el bloque señalado como contexto; avisos de encuadre locales (es/en); eco del documento a la interfaz | `backend/session/` | #10, #11, #14, #23 (P1-C) | **Verificado** | E3 (explicación en ~5,0 s a 0 $; puntero → «Fecha del siniestro…» casi al instante), E2 (tests de sesión) | Criterio de escalado definitivo (hoy `DefaultDoubt`, provisional); ajustar los prompts al OCR real | Calidad dependiente del modelo gratuito si `LLM_PROFILE=dev` |
| F4 | Cliente de modelos y coste | OpenRouter; niveles barato/caro con listas de respaldo; caché; contador de llamadas, coste y latencia (`stats`); `.env` junto al ejecutable; audio (`input_audio`) | `backend/llm/`, `backend/cmd/llmcheck` | #3, #7, #8, #17, #36 (P1-C) | **Verificado** con modelos gratuitos (fijados a mano, ver E3) | E2 (tests), E3 | Volver a medir los modelos de pago (no se llamaron en la integración) | **`LLM_PROFILE=dev` no es gratis del todo:** Haiku es el último respaldo del nivel barato **y** el modelo del nivel caro (`DevExpensiveModels`), así que toda escalada paga; presupuesto 10 € |
| F5 | Servidor mock | Respuestas fijas (fixtures) sin clave | `backend/mock/`, `backend/cmd/mock` | #2, #4, #6, #14 (P1-C) | **Verificado** | E3b | — | Responde solo a la conexión que escribe (no hay sesión compartida en el mock) |
| F6 | `POST /scan` | La app envía la foto; Go dice «Un momento…», la pasa al servicio de lectura y trata el documento devuelto; los problemas se dicen en voz alta. `SCANNER_URL=fixture` simula el servicio | `backend/scanner/`, `Session.ScanPhoto` | #35 (P1-C) | **Verificado** con el escáner de ejemplo y con el servicio real (caso «sin hoja») | E3 (fixture: documento con 4 esquinas + explicación), E4 (servicio real → 422 → «No encuentro la hoja…») | Camino con hoja y OCR real (200) | El 503 del servicio (sin Tesseract) se dice como error genérico |
| F7 | `POST /transcribe` | Audio WAV → texto con un modelo de audio en la nube (respaldo del reconocimiento local); coste en `stats` | `Session.Transcribe`, `web/src/app/transcribe.ts` | #36 (P1-C) | **Verificado** con el modelo gratuito; **Parcial** en la integración | E3 (Nemotron gratis: 5,3 s, 0 $, con errores); E2 (tests) | El reconocimiento de voz no lo llama (`transcribeRemote` sin uso); Gemini (de pago) no se volvió a llamar | El modelo gratuito se equivocó en una de dos pruebas |
| F8 | API local protegida | Solo `Host` 127.0.0.1/localhost; `Origin` de la app; CORS para la app; `/message` solo JSON | `backend/ws/guard.go` | #36 (P1-C) | **Verificado** | E3 (Host ajeno 403, Origin ajeno 403, `text/plain` 415, preflight de Vite 204), tests de `guard` | — | Los servicios Python (8766, 8770) no tienen esta protección (§7) |
| F9 | App de escritorio | Wails 2.17.1; frontend embebido; busca el `.env` junto al ejecutable; log en `lauzhack.log`; diagnóstico de voz y cámara. **Sin clave** usa el mock (sin `/message`, `/scan` ni `/transcribe`) | `main.go`, `app.go`, `wails.json`, `web/` | #2, #4, #17 (P1-C) | **Verificado** en Windows | E2 (`wails build` 13,36 MB), E4 (arranca desde `build/bin`, voces es-ES, cámara) | Linux y macOS (`docs/PRUEBA_WAILS.md`) | En Linux hace falta WebKitGTK 4.1 (`-tags webkit2_41`) |
| F10 | Interfaz principal | Pantalla: explicación grande, vista del documento en orden de lectura con resaltado (`aria-current`) y «(unclear)», contador de coste, herramientas de desarrollo con diagnóstico | `web/src/app/` (`App.tsx`, `DocumentText.tsx`, `Cost.tsx`, `diagnostics.ts`, `useSocket.ts`) | #2, #6, #14, #17 (P1-C); cambios de #29 (P3-C) | **Sin verificar** a la vista (compila; en el ejecutable el diagnóstico se ejecutó) | E2 (build y lint), E4 | Revisarla con una persona y con lector de pantalla | — |
| F11 | Puente de gestos y puntero | Gestos → mensajes del contrato; puntero con alcance de 0,05 alrededor de cada bloque (igual en Go y TS); recuadros y punto del dedo sobre el vídeo; anillo de permanencia; mano dibujada | `web/src/app/bridge.ts`, `pointing.ts`, `Gestures.tsx` | #11, #23 (P1-C); #29 (P3-C) | **Sin verificar** con una mano real | E2 (tests de `bridge` y `pointing`) | Usar `pageCorners` (hoy `WHOLE_FRAME_AS_SEEN`) | Copias a mano de `blockAt` en Go y TS |
| F12 | Módulo de manos | MediaPipe en el navegador: poses, deslizar, puntero suavizado, selección por permanencia, menú ✌️, volumen con pinza, cabeza (sí/no), varias manos, perfil de movilidad reducida | `web/src/input/` | #9, #20, #29 (P3-C) | **Sin verificar** con mano real | E2 (tests con manos sintéticas) | Servir MediaPipe en local | MediaPipe y su modelo se descargan de jsDelivr y Google |
| F13 | Voz | Lector frase a frase (pausa y continúa sin IA); dictado: Whisper `small` en un Web Worker (WebGPU si hay), precarga, medidor y calibración de ruido, dictado de campos con deletreo y confirmación | `web/src/input/voice/` | #19, #29 (P3-C) | **Sin verificar** con micrófono | E2 (tests de voz); E4 (la ventana tiene 3 voces es-ES y la API de reconocimiento) | Conectar el respaldo `transcribeRemote` | Modelos de Hugging Face (~250 MB la primera vez); sin red no hay dictado |
| F14 | Gesture Control | Programa Go aparte: gestos → teclas y clics reales del sistema; contexto de videollamada; página propia; token por ejecución y protección de `Host` | `adapters/desktop/`, `web/src/input/desktop/` | #20 (P3-C) | **Verificado** en simulación; **sin verificar** sobre el sistema real. Ojo: `wails build` borra la página ya construida en `adapters/desktop/dist` (observado por el revisor); hay que construirla después | E4 (401 sin token, 403 con Host ajeno, página 200 tras construirla), E2 (tests) | Probar con aplicaciones reales | Pulsa teclas de verdad: la protección es crítica (está) |
| F15 | Cámara en la app | `openCamera` (la Logitech por nombre si está, 4K), `captureStill` (la foto más nítida de ~0,5 s) | `web/src/camera/` | #31 (P4-C) | **Sin verificar** en esta integración | E2 (tests de selección y nitidez) | Que la interfaz la use (hoy `Gestures.tsx` abre la cámara por su cuenta) | — |
| F16 | Guía de encuadre y disparo automático | Avisos hablados (es/ca/en: oscuro, borroso, se mueve, quieto, listo) y foto automática con el papel quieto y nítido; a los 8 s, la mejor | `web/src/camera/` (`guide.ts`, `framing.ts`, …) | `feature/T19-encuadre` (P4-C, sin PR) | **Sin verificar** aquí (Pau la probó con la cámara del portátil, según su estado) | E2 (tests de encuadre) | Probarla con la MX Brio; unirla a la app | — |
| F17 | Captura de la MX Brio (Python) | Captura 4K del frame más nítido; modo servidor en 8766 (`GET /captura`) | `scanner/capturar.py` | #12 (P4-C) | **Sin verificar** (sin la cámara) | E2 (unittest del escáner) | — | `GET /captura` tiene efectos y no valida `Host` (§7) |
| F18 | Pipeline foto → PDF y `document` | Hoja, perspectiva, orientación, luz, OCR (Tesseract, dos pases en paralelo), PDF buscable, `Result.document()` con `pageCorners` | `scanner/pdf/` (`scanner_pdf`), `scanner/scan.py` | #26, #34 (P2-C) | **Sin verificar** (sin Tesseract: 15 tests se saltan) | E2 (pytest 66 ok / 15 saltados) | Instalar Tesseract y probar con papel real | Tesseract 5 + spa/cat/eng; ffmpeg para los nombres de cámara |
| F19 | Servicio de lectura | `POST /scan` en 127.0.0.1:8770: foto → `document` + `pageCorners`; 422 sin hoja; 503 sin Tesseract | `scanner/service.py` | #34 (P2-C) | **Verificado** el arranque y el caso 422 con Go; **sin verificar** el caso 200 | E4 | Caso con hoja y OCR | Una petición a la vez |
| F20 | PDF digital con modelo de visión | La página rehecha con texto real; envía la **imagen** a OpenRouter; Haiku → Sonnet si concuerda < 60 % con el OCR | `scanner/pdf/src/scanner_pdf/vision.py`, `digital.py` | #26 (P2-C) | **Sin verificar** (modelos de pago) | — | — | Desactivado por defecto (`digital=1` / `--digital`); coste fuera del contador; privacidad (§7) |
| F21 | Documentos de prueba imprimibles | 3 PDF con datos inventados (carta, formulario, aviso en catalán) y su generador | `scanner/pdf/samples/print/`, `make_print_samples.py` | `feature/T13-real-fixtures` (P2-C, sin PR) | **Sin verificar** (no se regeneraron) | — | Su `document` JSON como fixture del contrato | — |
| F22 | Páginas de prueba | Gesture Lab, demo de cámara, app de prueba del escáner (8780) | `web/src/input/demo/`, `web/src/camera/demo/`, `scanner/demo_app/` | #9, #31, #26 | **Sin verificar** | — | — | Duplicadas con la app (§6) |
| F23 | CI | gofmt, `task check` (lint, tests y build del front, `go vet`, `go test`) y tipos al día, en Ubuntu 24.04 | `.github/workflows/ci.yml`, `Taskfile.yml` | #2, #5, #8 (P1-C) | **Verificado en `main`** (verde tras #37); en esta rama, ver el PR en borrador (en Windows pasa todo lo equivalente, E2) | historial de ejecuciones de `main` | Los tests de Python no están en el CI | — |
| F24 | Documentación y pitch | Guion de 3 min con cifras medidas, guías de prueba, voz, integración del escáner | `docs/` | #15, #16, #18, #23, #25, #35, #36 | Borrador | — | Repartir el guion y ensayar | Las cifras de Haiku y Gemini se midieron antes de la integración |
| F25 | Ideas | 16 ideas de 4 personas y su agrupación neutral | `docs/ideas/` | #27, #30, #32 | Recopiladas | — | Decidirlas (personas) | — |

---

## 3. Arquitectura real frente a `docs/ARQUITECTURA.md`

```
 Ventana de escritorio (Wails, lauzhack.exe)
 ├─ Interfaz React (web/src)
 │   app/     pantalla, vista del documento, coste, voz de salida, puente de gestos, diagnóstico
 │   input/   manos (MediaPipe) + voz (Whisper local, lector frase a frase)        ← Nil
 │   camera/  openCamera, captureStill, guía de encuadre (aún sin usar por app/)    ← Pau
 │        │ WebSocket /ws y HTTP (Guard: Host, Origin, CORS)
 └─ Servidor Go en 127.0.0.1:8765 (mismo proceso)
     ws.Hub ── una Session compartida ── backend/llm ── OpenRouter (HTTPS)
       POST /message · POST /scan ──► backend/scanner ──► servicio de lectura 8770
       POST /transcribe ──► modelo de audio (nube)

 Procesos aparte (opcionales)
   scanner/service.py  127.0.0.1:8770  foto → OCR (Tesseract) → document + pageCorners   ← Didac
   scanner/scan.py     captura (capturar.py, MX Brio) → PDF → POST /message               ← Didac, Pau
   scanner/capturar.py --servidor 8766 · scanner/demo_app 8780
   adapters/desktop    Gesture Control 8767: gestos → teclado/ratón del sistema           ← Nil
```

**Divergencias con `docs/ARQUITECTURA.md`** (que describe el plan inicial):
1. **OCR:** el plan lo ponía en el navegador (B1). Está en **Python** (`scanner/`, Tesseract), como proceso aparte (servicio 8770 o `scan.py`).
2. **Comprensión de documentos (B2):** el plan preveía `backend/ocr` y `web/src/document`, y **ambas carpetas siguen vacías**. La estructuración está en el pipeline de Python y las explicaciones, en `backend/session` (prompts y escalado provisional).
3. **Sesiones:** el plan hablaba de sesiones. Hay **una sola sesión compartida** por toda la app (decisión de AGENTS.md), con eco del documento a todas las ventanas.
4. **Herramientas:** el plan cita un `Makefile`. Se usa **`Taskfile.yml`** (`task`).
5. **`adapters/`:** el plan lo reservaba para el SDK de Logitech. Contiene **Gesture Control**, que no usa ese SDK. El SDK de Logitech no se usa en ningún sitio.
6. **Puertos y procesos nuevos** que el plan no tenía: 8766, 8767, 8770 y 8780.
7. **Coordinación:** el plan dice «por `TAREAS.md` y `estado/`». Desde esta integración, `estado/` está en `docs/historial/` y `TAREAS.md` es un tablero único.
8. **Cámara:** el plan no decía quién la abre. Decisión en AGENTS.md: la que haya, la Logitech si está. Hoy la abre `Gestures.tsx` y el escáner Python abre la suya (§6).

---

## 4. Cómo arrancar y probar cada pieza

**Requisitos** (medidos en Windows 11):

| Qué | Versión o detalle | Para qué |
|---|---|---|
| Go | ≥ 1.26 (probado 1.27.4) | servidor, app, Gesture Control |
| Node | 24 en CI (probado 26.13.1) | frontend |
| task | 3.x (`go install github.com/go-task/task/v3/cmd/task@latest`) | `task gen/mock/server/dev/fmt/check` |
| Wails | 2.17.1 | app de escritorio |
| Python | ≥ 3.10 (probado 3.14.3) + `scanner/pdf/pyproject.toml` | escáner |
| Tesseract 5 + spa/cat/eng | `scanner\pdf\scripts\install.ps1` | OCR (sin él: 503) |
| ffmpeg (Windows) | — | nombres de las cámaras en `capturar.py` |
| Clave de OpenRouter | `.env` en la raíz (Go) y `scanner/.env` (Python), ambos en `.gitignore` | explicaciones, transcripción, PDF digital |
| Linux | GTK3 + WebKitGTK 4.1 (`-tags webkit2_41`, ya en el Taskfile) | app |
| Red | jsDelivr, Google Storage, Hugging Face | MediaPipe, transformers.js, Whisper |

**Comandos** (Windows con PowerShell o Git Bash; en Linux son los mismos con `/`):

| Pieza | Comando | Qué esperar |
|---|---|---|
| Todo lo del CI | `task check` | lint, 124 tests web, build, `go vet`, `go test` |
| Tipos del contrato | `task gen` | sin cambios en `git status` |
| App de escritorio | `task dev` · o `wails build` y `build\bin\lauzhack.exe` | ventana; log en `build/bin/lauzhack.log` |
| Servidor sin ventana | `task server` (con `SCANNER_URL=fixture` si no hay servicio de lectura) | `GET http://127.0.0.1:8765/health` → `{"status":"ok"}` |
| Mock | `task mock` | `GET http://localhost:8080/health` |
| Interfaz en el navegador | `cd web` y `$env:VITE_WS_URL="ws://127.0.0.1:8765/ws"; npm run dev` | «Developer tools» → «Send sample document» |
| Gestos | guía en `docs/PROBAR_GESTOS.md` | — |
| Probar la IA sin pagar | `LLM_CHEAP_MODEL` y `LLM_EXPENSIVE_MODEL` con solo modelos `:free` (por ejemplo `nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free`) y `LLM_TRANSCRIBE_MODELS=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (`LLM_PROFILE=dev` **no basta**: escala a Haiku y `/transcribe` prueba Gemini) | coste 0 $ en el contador |
| Cliente de modelos | `go run ./backend/cmd/llmcheck "hola"` | respuesta, coste y latencia |
| Servicio de lectura | `python scanner\service.py` (con las dependencias de `scanner/pdf`) | `GET http://127.0.0.1:8770/health` |
| Escáner por línea de comandos | `python scanner\scan.py --send` (o `--png foto.png --send`) | documento en la app |
| Enviar un documento a mano | `python api/examples/send_message.py --demo-ocr` | la interfaz lo explica |
| Tests del escáner | `cd scanner/pdf && python -m pytest -q` · `cd scanner && python -m unittest discover -s .` | 66 ok/15 saltados · 29 ok |
| Gesture Control | `cd web && npx vite build src/input/desktop --outDir ../../../../adapters/desktop/dist --emptyOutDir` y luego `go run ./adapters/desktop -dry-run` | página en 127.0.0.1:8767 |

---

## 5. Contrato

**Versión 0.6.0** (`api/openapi.yaml`). Historial: 0.1.0 (T2) → 0.2.0 (inglés, `stats` con `cheap`/`expensive`) → 0.3.0 (`POST /message`, sesión compartida) → 0.4.0 (eco de `document`) → 0.5.0 (`pageCorners`, `POST /scan`) → 0.6.0 (`POST /transcribe`, API protegida).

Todos los mensajes viajan dentro del sobre `{type, id, ts, payload}`. `ts` va en milisegundos y las coordenadas, normalizadas a [0, 1].

| Mensaje | Sentido | Contenido |
|---|---|---|
| `document` | cliente → Go; y Go → todos (eco) | `blocks[]` (`id`, `text`, `box`, `confidence`), `quality {score, issues[]}`, `imageWidth/Height`, `lang`, `pageCorners[4]` (opcional, sobre la foto) |
| `pointer` | cliente → Go | `x`, `y` y, opcional, `blockId` (si falta, Go busca el bloque) |
| `utterance` | cliente → Go | `text`, `isFinal`, `lang` |
| `speak` | Go → todos | `text`, `highlightBlockIds[]`, `lang`, `replyTo` |
| `stats` | Go → todos | `cheap` y `expensive` (`calls`, `cacheHits`, `errors`, `costUsd`, `avgLatencyMs`, `lastLatencyMs`), `totalCostUsd` |

| Endpoint | Qué hace |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `GET /ws` | WebSocket de la sesión compartida |
| `POST /message` | un sobre en JSON → 202 (solo `application/json`) |
| `POST /scan` | foto (jpeg, png o webp, ≤ 40 MB) → 202; resultado por WebSocket |
| `POST /transcribe?lang=` | WAV (≤ 10 MB) → `{text, model, costUsd, latencyMs}` |

**Puertos:** 8765 app y servidor · 8080 mock · 8766 captura Python · 8767 Gesture Control · 8770 servicio de lectura · 8780 app de prueba del escáner · 5173 Vite.

---

## 6. Decisiones

**Tomadas** (detalle y motivos en `AGENTS.md`, «Decisiones»):
- Wails en la raíz, frontend en `web/`, paquetes en `backend/<nombre>` sin `internal/`.
- Contrato primero; tipos siempre generados (`task gen`); `Taskfile` en lugar de `Makefile`.
- Código y commits en inglés; conversación y documentación en español.
- Sesión compartida.
- Puerto fijo 8765.
- API protegida.
- Presupuesto: `LLM_PROFILE=dev` mientras se desarrolla.
- Cámara: la que haya, la Logitech si está; una cámara con la orden «lee el documento».
- Voz: local primero, nube como respaldo.
- Carpetas `adapters/desktop/` y `scanner/` aceptadas.
- Proyecto unificado (esta integración).

Decisiones que se ven en el código y no están en `AGENTS.md`:
- el escalado provisional (`DefaultDoubt`);
- el alcance de 0,05 del puntero;
- el umbral de calidad de 0,5 para no gastar IA;
- el PDF digital desactivado por defecto.

**DECISIONES PENDIENTES PARA HUMANOS:**
1. **Apertura de la cámara (duplicado).** `web/src/app/Gestures.tsx` (`getUserMedia`, 1280×720, de Nil e Isaac) frente a `web/src/camera/openCamera` (la Logitech si está, 4K, de Pau). La interfaz usa la primera.
2. **Cómo llega el documento a la app en la demo.** `scanner/scan.py --send` (Python abre su cámara → `POST /message`) frente a la app (foto de la app → `POST /scan` → servicio 8770). Con una sola cámara, las dos vías no pueden tener la cámara a la vez.
3. **Salida de voz (duplicado).** `web/src/app/voice.ts` (sin uso) frente a `web/src/input/voice/speaker.ts` (en uso).
4. **Avisos de encuadre.** Hay tres capas: navegador (`startFramingGuide`), Go (`quality.issues`) y escáner (422). Hay que decidir cuáles se oyen y en qué orden.
5. **Puntero sobre el papel real.** Pasar de `WHOLE_FRAME_AS_SEEN` a `pageCorners`. Además, `blockAt` está en Go y en TS, copiado a mano.
6. **Respaldo de voz en la nube.** Conectar o no `transcribeRemote` (de pago con Gemini; el gratuito comete errores).
7. **Dos clientes de IA.** El de Go (`backend/llm`, coste en pantalla) y el de Python (`vision.py`, coste fuera del contador, su propio `.env`). Además, **`LLM_CHEAP_MODEL` admite una lista en Go y un único modelo en Python**: una lista rompería el PDF digital.
8. **Criterio de escalado al modelo caro** (B2): sigue el provisional.
9. **Idioma de la documentación.** `web/src/input/README.md` y el estado de Nil están en inglés por petición de Nil; la regla dice español.
10. **Páginas de prueba:** cuáles se quedan (Gesture Lab, demo de cámara, `scanner/demo_app`, página de Gesture Control).
11. **`scanner/AGENTS.md` y `scanner/AGENTS_B.md`** son idénticos.
12. **Modelos para la demo.** Los gratuitos son más lentos, a veces devuelven 429 y la transcripción tiene errores. Haiku y Gemini son de pago (las cifras en `docs/PITCH.md` y `docs/VOZ.md`).
13. **Demo sin red.** MediaPipe, transformers.js y Whisper se descargan de internet.
14. **PRs abiertos** que esta rama incluye: #20 (la revisión sigue en «cambios pedidos» en GitHub aunque el arreglo de `Host` está y sus tests pasan), #27, #29, #30 y #34. También las ramas sin PR `feature/T19-encuadre` y `feature/T13-real-fixtures`. Hay que decidir si se cierran al fusionar esta rama.
15. **Carpetas vacías** `backend/ocr/` y `web/src/document/`.
16. **Documentos con referencias al flujo por agente** (§7): actualizarlos cuando se redefina el reparto.
17. **`ROSTER.md`** sigue diciendo «B1 o B2» para Didac y Pau. `AGENTS.md` fija Pau = B1 y Didac = B2.

---

## 7. Deuda técnica, seguridad y lo no verificado

**Seguridad:**
- **Claves:** se buscó en todas las ramas y en todo el historial, también en el clon local antiguo (E7). **0 coincidencias** de patrones de claves y ningún `.env` subido nunca. Los `.env` (raíz y `scanner/`) están en `.gitignore`.
- **La clave del equipo se pegó en chats durante la hackathon: hay que revocarla al terminar** (ya lo anotan `scanner/ENTREGA.md` y el historial).
- **API Go:** protegida (F8).
- **Gesture Control:** `Host`, token y origen (F14).
- **Servicios Python sin esa protección:** `capturar.py --servidor` (8766, `GET /captura` con efectos), `service.py` (8770) y `scanner/demo_app/server.py` (8780) solo escuchan en 127.0.0.1, pero no validan `Host` ni `Origin`.
  - **Sin necesidad de DNS rebinding,** una web abierta puede lanzar un escaneo con un `POST` sencillo (`text/plain`, sin preflight): el revisor lo comprobó contra 8770 (respuesta 422).
  - **Ese escaneo puede costar dinero:** `service.py` acepta `?digital=1`, que activa el modelo de visión de pago.
  - **`demo_app` expone más:** el vídeo de la cámara (`GET /preview.mjpg`), los archivos (`GET /file`: capturas y PDF) y `POST /api/scan?digital=1`.
  - **Con DNS rebinding,** además se pueden leer las respuestas.
- **Privacidad:**
  - Go solo manda texto a los modelos;
  - `/transcribe` manda audio a la nube (es un respaldo);
  - el PDF digital manda la imagen de la página (desactivado por defecto).

**Deuda técnica:**
- Los tests de Python no están en el CI.
- `blockAt` está copiado en Go y en TS.
- `voice.ts` no se usa.
- Las rutas de `.env` difieren entre Go y Python.
- El 503 del servicio de lectura se dice como error genérico.
- Las cifras de modelos de pago se midieron antes de la integración.
- En Windows, `wails build` reescribe los finales de línea de `go.mod`, que aparece como modificado en `git status` aunque su contenido no cambia (`git diff go.mod` vacío; `go mod tidy -diff` sin diferencias). `.gitattributes` no cubre `go.mod`.

**Referencias obsoletas tras disolver las tareas por agente** (no tocadas, a propósito):
- `README.md` (`estado/`);
- `INSTRUCCIONES_ARRANQUE.md` (flujo por agente);
- `scripts/ver-estado.sh` (lee `estado/`);
- `docs/ARQUITECTURA.md` («Cómo se coordinan» y la arquitectura inicial, §3);
- `docs/PRUEBA_WAILS.md` y `docs/INTEGRACION_SCANNER.md` (apuntan a `estado/`).

**No verificado y por qué:**
| Qué | Por qué |
|---|---|
| OCR, PDF y servicio de lectura con hoja (F18, F19) | sin Tesseract |
| Captura de la MX Brio (F17) | sin la cámara |
| Gestos, puntero, cámara de la app, guía de encuadre (F11, F12, F15, F16) | sin una mano ni cámara reales delante en la integración |
| Dictado con Whisper (F13) | sin micrófono; descarga de Hugging Face |
| Teclas reales de Gesture Control (F14) | solo en simulación |
| PDF digital (F20), Haiku, Sonnet y Gemini | de pago, no se llamaron |
| Linux y macOS | solo Windows (el CI compila en Ubuntu) |
| Las páginas de prueba (F22) y la interfaz a la vista (F10) | necesitan una persona delante |

---

## 8. Destino de cada rama y PR

Orden de integración (un merge normal por rama, sin *squash*; commits sobre `main` 72fc2b6):

| Commit | Qué |
|---|---|
| 0d1a557 | Lo único que solo estaba en el clon local `Documents/hackathon`: el ejemplo de `scripts/nueva-tarea.sh` (`P2-C`). Sus 4 commits nunca se subieron; el resto de su contenido ya estaba en GitHub (E8) |
| 006a7ae | Integra `feature/T19-encuadre` (sin PR) |
| 13fcc6f | Integra `feature/T13-scan-service` (#34) |
| b5d54fe | Integra `feature/T13-real-fixtures` (sin PR) |
| f1aa014 | Integra `feature/T6-gesture-control` (#20) |
| 33c3a97 | Integra `feature/T17-voice` (#29) |
| d688726 | Integra `feature/T16-ideas-didac` (#27): conflicto en `docs/IDEAS.md` resuelto conservando las filas de Pau y de Didac |
| 8b77432 | Integra `feature/T16-ideas-nil` (#30) |
| e4058de | Disuelve las tareas por agente (§4 del encargo) |

| Rama | PR | Autor | Destino | Prueba (E6: diff rama ↔ integración en sus archivos) |
|---|---|---|---|---|
| `feature/T19-encuadre` | — | Pau | **integrada** | 13/13 archivos idénticos |
| `feature/T13-scan-service` | #34 | Didac | **integrada** | 6/6 idénticos |
| `feature/T13-real-fixtures` | — | Didac | **integrada** | 5/5 idénticos |
| `feature/T17-voice` | #29 | Nil | **integrada** | 47/47 idénticos |
| `feature/T6-gesture-control` | #20 | Nil | **integrada** | 27/30 idénticos; los 3 restantes solo tienen inserciones posteriores de #29 (mismo autor) |
| `feature/T16-ideas-didac` | #27 | Didac | **integrada** | sus 4 filas están; la única línea distinta es la fila de Isaac, que #30 amplió con «Hecho por Nil en #29» |
| `feature/T16-ideas-nil` | #30 | Nil | **integrada** | todo está (la diferencia son las filas de Didac añadidas después) |
| `feature/T16-ideas-pau` | #32 | Pau | **ya estaba en main** | idem que #27 |
| `feature/T12-camara` | #31 | Pau | **ya estaba en main** | las diferencias son la reorganización posterior de Pau en T19 (`still.ts` → `frames.ts`) |
| `feature/B-contexto-scanner` | #26 | Didac | **ya estaba en main** | las diferencias son trabajo posterior: de Didac en #34 y, en `docs/INTEGRACION_SCANNER.md`, de Isaac en #35 |
| `docs/camera-decision` | #21 | Isaac | **ya estaba en main** | ediciones posteriores de `AGENTS.md` |
| `feature/T1-alcance-y-arquitectura` | #1 | Isaac | **ya estaba en main** | ediciones posteriores |
| `claude/kind-cray-863b6t` | #9 | Nil | **#9 ya estaba en main**; sus commits posteriores **no se integran a propósito** | son borradores que Nil rehízo: la voz en #19 y #29 (`listener.ts` en `main`: +48/−9 líneas respecto al borrador) y Gesture Control en #20 (af203ac, 5f98a1c, 2c3853d). Integrarlos revertiría trabajo más nuevo. La rama no se borra, así que no se pierde nada |
| Ramas borradas tras fusionarse (#2–#8, #10–#19, #22–#25, #28, #33, #35–#37; entre ellas #12 `feature/B-scanner-captura`, de Pau) | — | Isaac, Nil, Pau | ya en main (*squash*) | — |
| Worktree local `hackathon-worktrees/P1-C-T2` | — | — | nada que integrar | limpio, en un commit antiguo de `main` |

Las rutas que cambian en esta rama (`estado/` → `docs/historial/estado/`, `TAREAS.md` → `docs/historial/TAREAS_por_agente.md` y `docs/IDEAS.md` → `docs/ideas/IDEAS.md`) se movieron sin cambiar su contenido: se comprobó byte a byte.

---

## Anexo: evidencias

- **E1. Base (`main` 72fc2b6).** Comando: `check.sh`, que repite el CI (gofmt, `task check`, tipos al día) más los tests de Python, y `wails build`. Resultado:
  - gofmt OK;
  - `task check` OK: 82 tests web y 6 paquetes Go;
  - tipos al día;
  - pytest: 62 ok y 15 saltados;
  - unittest: 23 OK;
  - `wails build` OK (13 324 800 bytes).
- **E2. Integración, tras cada merge y al final.** Mismo comando. Resultado final:
  - gofmt OK;
  - `task check` OK: **124 tests web** y **7 paquetes Go** (`api`, `backend/llm`, `mock`, `scanner`, `session`, `ws`, `adapters/desktop`);
  - tipos al día;
  - pytest: **66 ok y 15 saltados** (los saltados necesitan Tesseract);
  - unittest: **29 OK (2 saltados)**;
  - `wails build` OK (13 362 176 bytes).
- **E3. Servidor real (`go run ./backend/cmd/server`).** Configuración: `SCANNER_URL=fixture` y `LLM_CHEAP_MODEL` y `LLM_EXPENSIVE_MODEL` con solo modelos `:free` (por ejemplo `nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free`) y `LLM_TRANSCRIBE_MODELS=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (no se usó `LLM_PROFILE=dev`, porque escala a Haiku). Resultados:
  - `GET /health` → `{"status":"ok"}`;
  - `POST /scan` con un PNG:
    - a 1,5 s, `speak` «Un momento, estoy leyendo el documento.»;
    - `document` con 4 bloques y **4 `pageCorners`**;
    - la explicación («Este documento es una declaración de siniestro de AXA Seguros…»), unos 5,0 s después del `POST` (4 965 ms según el log del servidor). Los 1,5 s y 6,5 s que imprime el script se cuentan desde que abre el WebSocket e incluyen sus pausas;
    - `stats` con 0 $;
  - `POST /message` con un `pointer` en (0,3; 0,27) → «Fecha del siniestro: __/__/____» casi al instante (el 1,0 s impreso es la pausa del script);
  - `POST /transcribe` con un WAV en español → `nvidia/nemotron-3-nano-omni…:free`, 5 340 ms, 0 $, «¿Qué tengo que poner aquí? en la fecha del siestru. y donde firmo.» (con errores);
  - protección:
    - `Host` ajeno → 403;
    - `Origin` ajeno → 403;
    - `text/plain` a `/message` → 415;
    - preflight desde `http://localhost:5173` → 204.
- **E3b. Mock (`go run ./backend/cmd/mock`).** Una conexión envía `api/fixtures/document.json` y recibe `document` (4 bloques), `speak` («Es una declaración de siniestro de AXA…») y `stats` (0,00652 $).
- **E4. Procesos aparte.**
  - **Servicio de lectura.** Comando: `python scanner/service.py`, con las dependencias de `pyproject.toml` en un entorno fuera del repo.
    - `GET /health` → `{"ok": true, "tesseract": null, "busy": false}`;
    - `POST /scan` con un PNG → **422** `page_not_detected`;
    - Go `POST /scan` → servicio → `speak` «No encuentro la hoja. Ponla entera delante de la cámara, plana, y vuelve a pedírmelo.».
  - **Gesture Control.** Comando: `go run ./adapters/desktop -dry-run -open=false`.
    - `GET /` → 503 (página sin construir) y, tras `npx vite build src/input/desktop …`, 200 con el token inyectado;
    - `/api/status` sin token → 401;
    - `Host` ajeno → 403.
  - **Ejecutable.** `build/bin/lauzhack.exe`, lanzado desde su carpeta. El log dice:
    - «real sessions, cheap=…:free»;
    - «WebSocket on ws://127.0.0.1:8765/ws»;
    - diagnóstico: 3 voces es-ES (Helena, Laura, Pablo), `speechRecognition: true`, `camera: true` con 1 entrada de vídeo.
- **E5. CI.** Ejecuciones de `main` en GitHub: #36 en rojo (tipos sin regenerar) y #37 en verde.
- **E6. Nada perdido.** Comando: `verify_branches.sh`. Para cada rama remota, `git diff <rama> integration/proyecto-unificado -- <archivos que tocó la rama>`, ejecutado antes de mover los archivos de la fase de disolución. Resultados en la tabla del §8.
- **E7. Claves.** Se buscaron los patrones `sk-or-v1-…`, `sk-ant-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `AIza…` y `BEGIN … PRIVATE KEY` en:
  - las puntas de todas las ramas: **0 archivos**;
  - `git log --all -G`: **0 commits**;
  - archivos con nombre de secreto subidos alguna vez: **0**;
  - `.env` en el índice: **no**;
  - historial del clon local antiguo: **0**.

  No se imprimió ningún valor.
- **E9. Revisión independiente.** Un agente que no había visto el trabajo intentó refutar este informe en un clon limpio, sin clave.
  - Confirmó: las cifras de E1 y E2, el contrato, las 7 ramas integradas (con sus segundos padres), los traslados idénticos byte a byte, 0 secretos y lo que §2 marca como parcial.
  - Refutó tres cosas, ya corregidas: faltaba #12 en §8, se citaba una «lupa del puntero» inexistente en `TAREAS.md`, y se decía «`LLM_PROFILE=dev` = 0 $».
  - Añadió riesgos, también incorporados: `demo_app` (8780), `?digital=1`, el paso al mock sin clave, los tiempos de E3 y que `wails build` borra la página de Gesture Control.
- **E8. Clon local `Documents/hackathon`.** Tiene 4 commits que nunca se subieron (857becc…fbda60a). Se buscó cada archivo de su punta en el historial de GitHub y todos estaban, menos una versión de `scripts/nueva-tarea.sh` que solo difiere en el comentario de ejemplo. Esa diferencia se integró en 0d1a557.
