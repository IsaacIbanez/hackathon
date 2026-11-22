# Decisiones del proyecto

Registro completo, de la más nueva a la más antigua. Movido desde `AGENTS.md` el 2026-11-22 para ahorrar tokens: `docs/ESTADO.md` resume las vigentes. **Si tomas una decisión que cambia una interfaz o el contrato, añádela aquí arriba** (una entrada corta) y, si afecta al trabajo diario, una línea en «Decisiones vigentes» de `docs/ESTADO.md`.

- 2026-11-22 — **Sistema de diseño nuevo para el overlay** (Isaac; `docs/DESIGN.md`):
  - Sustituye a Halo (`docs/DISENO.md`): tokens semánticos en `web/src/index.css` (texto, un solo acento, estados, transparencias, 5 tamaños de letra, radios, elevación, movimiento) y componentes base en `ui.tsx` (`IconButton`, `Switch`, `Tag`, más `.btn-quiet` y `.backing`).
  - Las transparencias se conservan con los mismos valores, ahora como tokens; el contraste se ha medido sobre un escritorio blanco y uno negro.
  - Se migra por áreas, un PR cada una, solo la apariencia (sin tocar lógica, props ni contrato). Motivo: coherencia entre pantallas y un aspecto de overlay sobrio, no de app «hecha por IA».
- 2026-11-22 — **Una sola pieza decide la forma de la ventana** (R5, Pau; `docs/VENTANA.md`):
  - `app_window.go`: las partes declaran lo que quieren (`open`, `layer`, `gestures`, `gestureScreen`, `summary`) y `desiredShape` decide con una jerarquía fija: resumen > menú del puño > overlay (capa o ventana) > burbuja de cámara > oculta.
  - Las formas temporales vuelven solas a la que había. Los gestos nunca abren, cierran ni encogen el overlay; el modo cursor no toca la ventana.
  - Motivo: seis funciones movían la ventana por su cuenta y el menú del puño, el modo cursor o el resumen dejaban el overlay en 960×680 o lo encogían.
- 2026-11-22 — **Contexto para las IA reorganizado** (Pau, a petición del equipo):
  - `AGENTS.md` pasa de 12 KB a ~3 KB: qué es, dónde estamos, qué leer según la tarea y 10 reglas. Se carga en cada petición.
  - Tres documentos nuevos: `docs/ESTADO.md` (dónde estamos y adónde vamos; mantenerlo al día), `docs/MAPA.md` (carpetas, dueños, puertos y flujos) y `docs/TRABAJAR.md` (ciclo de trabajo, `.exe`, trampas de Windows, ahorro de tokens).
  - `scanner/AGENTS.md` pasa de 15,6 KB a ~2,5 KB y se borra su copia `AGENTS_B.md`.
  - Al historial: `ESTADO_PROYECTO.md`, `INSTRUCCIONES_ARRANQUE.md`, `arranque/`, `ideas/`, `PRUEBA_WAILS.md` y los briefs por persona de Didac e Isaac; el de los subtítulos pasa a `docs/briefs/subtitulos.md`.
- 2026-11-22 — **Escaneo medido y mejorado (N3, Pau; `docs/medidas/N3.md`):**
  - El servicio de lectura responde en cuanto el `document` está listo; el PDF buscable y el PDF digital se terminan en segundo plano.
  - El PDF digital va **desactivado** por defecto, porque usa un modelo de pago en cada escaneo (arreglo R3). Se activa con `?digital=1` o `SCANNER_DIGITAL=1`.
  - Sin hoja detectada pero con texto sobre papel, el servicio devuelve el `document` sin `pageCorners` (opcional en el contrato) en vez de 422.
- 2026-11-22 — **Subtítulos en directo (Pau; brief `docs/briefs/subtitulos.md`, `web/src/captions/README.md`):**
  - El navegador manda el audio (PCM 16 kHz) a Go por `GET /captions` (WebSocket); Go lo pasa a Together AI: subtítulos en directo y diarización por lotes con Parakeet v3; idioma, barbarismos entre comillas y traducción con Qwen3.5-9B (sin razonamiento).
  - Contrato 0.8, solo añade: `GET /captions`, `CaptionsEvent` (con `revise`), `speakers`.
  - Carpetas de Pau: `backend/captions/` (de Isaac solo se toca el registro de la ruta en `mux.go`) y `web/src/captions/`.
  - Clave `TOGETHER_API_KEY` solo en `.env`; coste visible con tope por sesión (`CAPTIONS_LIMIT_USD`, 1 $); si Together falla, se ofrece el Whisper local de Nil.
- 2026-11-22 — **Diseño final del overlay, «Halo»** (Didac, `docs/DISENO.md`).
  - Una capa a pantalla completa y sin marco, como Xbox Game Bar.
  - Gesture Control en el círculo grande del centro, y PDF Scanner, Read Text, AI Summary y Transcribe (*Coming soon*) en un arco por encima.
  - Cada herramienta abre un panel de cristal con la misma cabecera.
  - Tipografía Atkinson Hyperlegible, un color por herramienta y el amarillo para lo que se lee y el foco.
  - Las pantallas nuevas usan los tokens y los componentes de `index.css` y `web/src/app/overlay/ui.tsx`.
- 2026-11-22 — **MX Keypad (N2, Isaac; `docs/KEYPAD.md`, brief `docs/briefs/N2.md`):**
  - **Lectura directa por USB, sin Logi Options+ ni SDK:** el keypad (VID 046D, PID C354) envía `13 ff 02 00 <contador> 01 <tecla>` en una colección HID del fabricante. Comprobado con el keypad real.
  - **Respaldo:** la tecla N tiene el atajo global Ctrl+Alt+Shift+N.
  - **Las teclas, decididas por Isaac:**
    1. abrir/cerrar la app;
    2. empezar a grabar una orden de voz;
    3. parar la grabación;
    4. leer papel;
    5. leer archivo;
    6. leer/pausa;
    7. resumir la selección;
    8. gestos;
    9. menú.
  - **Órdenes de voz** (teclas 2 y 3): Go transcribe la grabación con `POST /transcribe` (modelo de audio barato) y la frase se convierte en una acción del keypad (`web/src/app/overlay/voiceCommand.ts`, en español, catalán e inglés).
  - Funciona con otro programa delante: Go muestra el overlay y envía `overlay:keypad`. El contrato no cambia.
- 2026-11-22 — **Visor de PDF que lee el PDF entero en voz alta (N4, Didac; brief `docs/briefs/N4.md`):**
  - lee página a página, con parar (X), velocidad, páginas e ir a página (`web/src/document/PdfViewer.tsx`, `pdfReader.ts`);
  - el servicio de lectura da cada página (imagen y líneas, con OCR para las escaneadas, sin límite de páginas) y Go la pasa con `app_pdf.go`;
  - documentos de prueba nuevos: 40 páginas y 3 páginas escaneadas.
- 2026-11-22 — **Gesture Control dentro del overlay** (Nil, rama `feature/T6-overlay-unified`): un solo ejecutable. El programa de gestos pasa a ser un paquete (`adapters/desktop/control`) que la app usa en su propio proceso; la página de la cámara (`mountGestureControl`) se monta en la opción 1 y habla con Go por el binding `GestureCall` (la misma API, sin HTTP, puerto ni token). Con los gestos activos, ocultar el overlay lo encoge a una burbuja de cámara en una esquina (una ventana oculta frenaría la cámara). `gesture-control` sigue existiendo para usarlo solo (`task gestures`, o en Linux, donde la cámara no funciona dentro de Wails).
- 2026-11-22 — **Opción 4 del overlay: resumir el texto seleccionado en cualquier programa** (Didac, rama `feature/didac-resumir-seleccion`, `docs/OVERLAY.md`).
  - Funcionamiento: Go recuerda la ventana que había delante al abrir el overlay, copia su selección con Ctrl+C, la resume con el **modelo barato** (2–3 frases, con alternativa local a 0 $) y deja el resumen en el portapapeles, en voz alta y en una burbuja junto al cursor.
  - Preparado para el cursor de la mano de Nil: `TriggerSummary` y el evento `overlay:summarize`.
  - **Es la implementación del resumen que se queda** (decisión de Isaac y Didac): sustituye a la N7 de Isaac, que se había fusionado (#48) y se retiró de `main` (revert de de357f8; el keypad N2 se queda). Resumir el documento abierto (opciones 2 y 3) queda pendiente, sobre `backend/summary`.
  - El contrato no cambia.
- 2026-11-21 — **App overlay** (rama `overlay`, detalle en `docs/OVERLAY.md`):
  - la app de escritorio es una ventana siempre encima que se abre desde cualquier programa con **Ctrl+Alt+Espacio** (`LAUZHACK_HOTKEY`; el MX Keypad, desde el 2026-11-22, por USB: ver la decisión N2);
  - opciones: **1** gestos (Nil; desde el 2026-11-22 va dentro de la app, ver la decisión siguiente), **2** leer un papel (Pau y Didac: cámara → servicio de lectura → lectura guiada) y **3** leer un archivo del PC (Didac: PDF, imágenes, TXT/MD → lectura guiada);
  - la app arranca y para el servicio de lectura y Gesture Control;
  - ninguna opción usa IA y el contrato no cambia.
  - Motivo: juntar las funcionalidades en un solo ejecutable.
- 2026-11-21 — **Arranque por persona:** no se reparten más tareas cerradas.
  - Cada persona trabaja con su agente en lo que decida: Nil, en la cámara y su entorno (voz, cara, manos, teclado); Didac y Pau, en una funcionalidad grande y distinta cada uno; Isaac decide entre el backend, una funcionalidad o ayudar a otra persona.
  - El agente entrevista primero a su persona (`docs/historial/arranque/<persona>.md`) y deja un brief confirmado en `docs/briefs/<persona>.md`.
  - Motivo: más autonomía. Con el brief por escrito, las sesiones nuevas no repiten la entrevista.
- 2026-11-21 — **Proyecto unificado:** todas las ramas integradas en `integration/proyecto-unificado` (merges normales, ver `docs/historial/ESTADO_PROYECTO.md`); las tareas por agente se disuelven: `TAREAS.md` pasa a ser un tablero único sin responsables y el estado y el plan por agente se guardan en `docs/historial/`. El reparto se redefinirá tras la lluvia de ideas (`docs/historial/ideas/`).
- 2026-11-21 — **API local protegida** (`ws.Guard`): solo responde a `Host` 127.0.0.1 o localhost (sin DNS rebinding) y a los orígenes de la app (Vite, Wails), con CORS para ellos; `POST /message` solo acepta JSON. Los procesos locales (el scanner) no mandan `Origin` y siguen funcionando. Sin esto, cualquier web abierta podía enviarnos documentos o preguntas y gastar IA.
- 2026-11-21 — **Respaldo de voz hecho (T18):** `POST /transcribe` (WAV → texto, contrato 0.6) con Gemini 2.5 Flash Lite y un respaldo gratuito; `transcribeRemote()` en `web/src/app/transcribe.ts` para el rol C.
- 2026-11-21 — **Contrato 0.5:** `document.pageCorners` (esquinas de la hoja en la foto: arriba-izq, arriba-der, abajo-der, abajo-izq de la hoja tal como se lee) y `POST /scan` (la app envía la foto; Go la pasa al servicio de lectura en `SCANNER_URL`, por defecto `127.0.0.1:8770/scan`, y dice en voz alta lo que pasa). `SCANNER_URL=fixture` permite probarlo todo sin el servicio.
- 2026-11-21 — **Voz:** reconocimiento local con `whisper-small` (T17, Nil) y respaldo en la nube con `POST /transcribe` en Go y `google/gemini-2.5-flash-lite` (T18, Isaac), solo si el local falla. Medido: `whisper-tiny` falla, `whisper-small` acierta en 1,1 s; Gemini acierta en 2,3 s por 0,00006 $ (`docs/VOZ.md`).
- 2026-11-21 — **Carpetas aceptadas:** `adapters/desktop/` (Gesture Control de Nil, programa Go aparte, puerto 8767) y `scanner/` (rol B, Python). `scanner/demo_app/` es una herramienta de prueba de Didac, no parte del producto.
- 2026-11-21 — **Qué dispara el escaneo:** la orden «lee el documento» por **botón** (plan B de la demo), **frase** y **gesto** (acción `scan_document`).
- 2026-11-21 — **Cámara: se usa la que haya.** En desarrollo, la webcam del portátil; si hay una cámara Logitech conectada (MX Brio), se usa esa, porque es la del reto de Logitech (decisión de Isaac). Consecuencias pendientes: (1) con **una sola cámara**, el scanner (Python) y los gestos (navegador) no pueden abrirla a la vez: hay que decidir cuál la abre; (2) `scanner/capturar.py` hoy falla si no encuentra la Brio: debe usar la cámara disponible si no está (rol B); (3) la interfaz elegirá la Logitech por nombre si está conectada (rol A).
- 2026-11-21 — Go reenvía a todos los clientes WebSocket cada `document` que acepta (contrato 0.4.0, `ServerMessage` incluye `document`): la pantalla muestra y resalta el documento aunque lo haya enviado el scanner. Los documentos con mal encuadre no se reenvían. Vista mínima en `web/src/app/DocumentText.tsx`; B2 puede sustituirla en `web/src/document`.
- 2026-11-21 — Una sola sesión compartida por toda la app (`ws.Hub`): los mensajes de cualquier cliente (interfaz por WebSocket, scanner por `POST /message`) actualizan el mismo estado y cada `speak`/`stats` se envía a todos los clientes WebSocket — es una app de escritorio para una persona; sin esto, la explicación del documento del scanner volvía al scanner y no a la pantalla.
- 2026-11-21 — Código, comentarios, commits y títulos de PR en inglés; conversación y documentación en español (sección «Idioma») — lo pide el equipo. Los commits ya en `main` no se reescriben. En el contrato, los niveles de `stats` pasan de `barato`/`caro` a `cheap`/`expensive` (aún no los usaba nadie más).
- 2026-11-21 — El scanner de B (Python, `scanner/`) se conecta a Go enviando mensajes `document` a `ws://127.0.0.1:8765/ws` (los bloques con caja y confianza salen de Tesseract) y recibe `speak` y `stats` — el contrato no cambia y B sigue aislado en su carpeta. Acordado por Isaac, Didac y Pau.
- 2026-11-21 — Presupuesto de IA: 10 € para todo el equipo. Mientras se desarrolla, `LLM_PROFILE=dev` (modelos gratuitos con visión primero y Haiku como último recurso); el perfil por defecto (Haiku + Sonnet) es para la demo. Clave en `.env` (ignorado por git) o en el entorno — que no se acabe el presupuesto antes de la demo.
- 2026-11-21 — Mensaje `stats` (Go → navegador) con el coste y la latencia de los modelos, enviado tras cada llamada; su payload es el JSON de `llm.Meter.Snapshot()` (hay un test que lo garantiza). Cambio solo aditivo: no afecta a los mensajes existentes — enseñar el coste en pantalla es lo que pide AXA.
- 2026-11-21 — La app Wails sirve el contrato en `127.0.0.1:8765` (`/health` y `/ws`; se cambia con `LAUZHACK_ADDR` y, si el puerto está ocupado, usa uno libre). El frontend pide la URL a Go con el binding `WsURL()`. Puerto fijo para que un proceso local (por ejemplo, el scanner en Python) pueda enviar `document` sin pasar por el navegador. Solo escucha en 127.0.0.1.
- 2026-11-21 — Modelos vía `backend/llm`: nivel `cheap` `anthropic/claude-haiku-5.5` y `expensive` `anthropic/claude-sonnet-5.5` (ambos con visión; configurables con `LLM_CHEAP_MODEL` y `LLM_EXPENSIVE_MODEL`), clave en `OPENROUTER_API_KEY`. El paquete pone el mecanismo (caché, contador, `CompleteWithEscalation`) y B2 decide cuándo escalar con su función de duda — el criterio de frugalidad de AXA queda en un solo sitio y se puede medir.
- 2026-11-21 — Mensajes del WebSocket: sobre común `{type, id, ts, payload}` (`ts` en ms desde epoch; coordenadas normalizadas a [0, 1] sobre el documento recortado). El navegador envía `document`, `pointer` y `utterance`; Go responde con `speak` (con `replyTo` = `id` del mensaje que contesta). Esquemas en `api/openapi.yaml`, ejemplos en `api/fixtures/` — un contrato único que comparten Go y TS.
- 2026-11-21 — Tipos generados, nunca a mano: Go en `api/gen` (paquete `gen`, oapi-codegen como `go tool`) y TypeScript en `web/src/api/types.ts` (openapi-typescript, alias en `web/src/api/index.ts`). Se regeneran con `task gen` — así Go y TS no se desincronizan.
- 2026-11-21 — `Taskfile.yml` en lugar de `Makefile`; módulo Go `github.com/IsaacIbanez/hackathon`, Go ≥ 1.26 — en Windows no hay `make`; las dependencias (oapi-codegen) piden Go 1.26.
- 2026-11-21 — Estructura definitiva: Wails en la raíz, frontend en `web/`, paquetes Go en `backend/<nombre>` sin `internal/`, mock en `backend/cmd/mock` — comprobado: Go rechaza importar `internal/` desde la raíz, y Wails acepta `frontend:dir` y paquetes propios (prueba de Isaac en Windows, Wails v2.17.1).
- 2026-11-21 — Un agente principal (Claude) por persona y Gemini de apoyo o revisión; los agentes no editan `TAREAS.md` — menos conflictos y más control con cuatro personas.
- 2026-11-21 — PRs pequeños, revisados por otra persona y fusionados cada 30–60 minutos — el proceso no debe frenar el desarrollo.
- 2026-11-21 — Monorepo único con Go + frontend web dentro de una app de escritorio — queda todo en un sitio y los agentes se coordinan por archivos.
- 2026-11-21 — Contrato (OpenAPI y mensajes WebSocket) antes que el código — permite trabajar en paralelo con mocks.
- 2026-11-21 — Visión, gestos y voz en el navegador, Go solo orquesta — es local, barato y encaja con la frugalidad de AXA.
- 2026-11-21 — Wails como envoltura de escritorio, con prueba de cámara en todos los SO en la primera hora — plan B: Electron.
- 2026-11-21 — Hápticos y keypad de Logitech aparcados; solo se mira el SDK de la cámara — foco en el bucle de cámara.
- 2026-11-21 — Si el SDK de Logitech exige Python o C#, va como adaptador aparte en `adapters/logitech/` que habla con la app por WebSocket o HTTP local — aísla el lenguaje del SDK.
