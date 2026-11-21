# TAREAS.md — Tablero único

Desde la integración del 2026-11-21 (rama `integration/proyecto-unificado`) ya no hay tareas por agente: este es el único tablero, **sin responsables**. El reparto se redefinirá después de la lluvia de ideas (`docs/ideas/`). El tablero anterior T1–T19, con responsables, está íntegro en `docs/historial/TAREAS_por_agente.md`.

Cada línea remite a `docs/ESTADO_PROYECTO.md` (§2, tabla por funcionalidad), donde están las rutas, el origen, la evidencia y lo que falta. «Verificado» significa que se ejecutó en esta integración y se vio funcionar. Lo que pasa sus tests pero necesita hardware, una clave de pago o dependencias que no había se cuenta como **sin verificar**.

## Terminado y verificado
- Contrato 0.6 (`api/openapi.yaml`) con tipos Go y TypeScript generados y sincronizados.
- Servidor Go: `/health`, `/ws` con sesión compartida, `POST /message`, `POST /scan`, `POST /transcribe`.
- Lógica de sesión: explicar el documento, leer el campo señalado en local, responder preguntas, avisos de encuadre locales y eco del documento a la interfaz.
- API local protegida: `Host`, `Origin`, CORS y `/message` solo JSON.
- Cliente de modelos: listas de respaldo, caché, contador de coste y `.env`. Verificado con modelos gratuitos.
- Servidor mock (`task mock`) y escáner de ejemplo (`SCANNER_URL=fixture`).
- Conexión Go ↔ servicio de lectura en Python: `/scan` → 8770 → respuesta hablada (camino «sin hoja», 422).
- App de escritorio (`wails build`): arranca con doble clic, encuentra el `.env`, escribe el log y el diagnóstico de voz y cámara.
- Gesture Control (`adapters/desktop`), en modo simulación: protección de `Host`, token y página servida.
- CI: gofmt, `task check` y tipos generados al día.

## Terminado sin verificar (código y tests listos; falta hardware, clave o dependencias)
- Captura de la MX Brio (`scanner/capturar.py`): sin la cámara.
- Pipeline foto → PDF buscable → `document` con `pageCorners` (`scanner/`): sin Tesseract; 15 tests se saltan.
- Servicio de lectura, camino con hoja (200 + `pageCorners`): sin Tesseract.
- PDF digital con modelo de visión (`scanner/pdf/.../vision.py`): usa modelos de pago.
- Cámara en la app (`openCamera`, `captureStill`) y guía de encuadre con disparo automático (`startFramingGuide`): sin cámara real en esta integración.
- Gestos con MediaPipe, puente de gestos, puntero y lupa visual del puntero: sin mano real.
- Voz: Whisper local en un Worker, medidor de micro, dictado de formularios y lector frase a frase: sin micrófono; los modelos se descargan de Hugging Face.
- Gesture Control actuando sobre el sistema de verdad (teclas, clics): solo en simulación.
- Transcripción en la nube con Gemini: no se volvió a llamar porque es de pago; con el modelo gratuito funciona, con errores.
- Páginas de prueba: Gesture Lab (`web/src/input/demo`), demo de cámara (`web/src/camera/demo`) y `scanner/demo_app` (8780).
- Linux y macOS: solo se ha probado Windows (el CI compila en Linux).

## Parcial
- **Unión en la app del flujo «lee el documento».** Están todas las piezas (cámara de la app, guía de encuadre, `POST /scan`, `pageCorners`), pero la interfaz todavía no las llama.
- **Orden `scan_document`** por voz o gesto: no existe todavía.
- **Puntero sobre el papel real con `pageCorners`:** el puntero sigue usando la imagen entera de la cámara (`WHOLE_FRAME_AS_SEEN`).
- **Respaldo de voz en la nube:** el endpoint y `transcribeRemote()` existen, pero el reconocimiento de voz no los usa.
- **Criterio de escalado al modelo caro:** sigue el provisional (`DefaultDoubt`).
- **Demo sin red:** MediaPipe, transformers.js y Whisper se descargan de internet.
- **Documentos reales anonimizados como fixtures del contrato** (`api/fixtures/real/`): hay PDF imprimibles inventados en `scanner/pdf/samples/print/`, pero no `document` JSON reales.
- **Prueba de Wails y cámara en otros sistemas** (`docs/PRUEBA_WAILS.md`): solo Windows.
- Accesibilidad, flujo de la demo y pitch (`docs/PITCH.md`): borrador.

## Roto
- Nada falla en las comprobaciones automáticas ni en las pruebas en ejecución de esta integración. Observaciones que no son fallos:
  - el modelo gratuito de transcripción cometió errores en una de las dos pruebas;
  - el servicio de lectura responde 503 sin Tesseract y Go lo dice como error genérico.
- **Referencias obsoletas tras disolver las tareas por agente:** `README.md`, `INSTRUCCIONES_ARRANQUE.md`, `scripts/ver-estado.sh`, `docs/ARQUITECTURA.md` (§«Cómo se coordinan»), `docs/PRUEBA_WAILS.md` y `docs/INTEGRACION_SCANNER.md` siguen apuntando a `estado/`. Ver `docs/ESTADO_PROYECTO.md` §7.

## Duplicado o alternativo (decisión para humanos; detalle en `docs/ESTADO_PROYECTO.md` §6)
- Apertura de cámara: `Gestures.tsx` (`getUserMedia`, 1280×720) frente a `web/src/camera` (`openCamera`, la Logitech si está, 4K).
- Salida de voz: `web/src/app/voice.ts` (sin uso) frente a `web/src/input/voice/speaker.ts` (en uso).
- Llevar el documento a la app: Python con `scan.py --send` (`POST /message`) frente a la app (`POST /scan` → servicio 8770).
- Avisos de encuadre: en el navegador (`startFramingGuide`) y en Go (`quality.issues`); el escáner también devuelve 422 cuando no ve la hoja.
- Del dedo al bloque: `blockAt` en Go y en TypeScript (`pointing.ts`), copias mantenidas a mano, más la homografía del módulo de manos.
- Modelos de IA: cliente Go (`backend/llm`, contador en `stats`) frente a `scanner/pdf/.../vision.py` (otro cliente, otro `.env`, coste fuera del contador; `LLM_CHEAP_MODEL` es una lista en Go y un único modelo en Python).
- Reconocimiento de voz: Whisper local frente a `POST /transcribe` (pensados como principal y respaldo; sin conectar).
- Páginas de prueba: la app, Gesture Lab, la demo de cámara, `scanner/demo_app` y la página de Gesture Control.
- `scanner/AGENTS.md` y `scanner/AGENTS_B.md` son idénticos.
- Carpetas previstas que siguen vacías: `backend/ocr/` y `web/src/document/` (la comprensión de documentos vive en `scanner/` y en `backend/session/`).

## Ideas sin decidir
- Todas las ideas de la lluvia previa, con sus autores, en `docs/ideas/IDEAS.md`; los duplicados agrupados (sin ordenar ni elegir) en `docs/ideas/AGRUPACION.md`.

Aparcado desde el principio (sin cambios): ratón háptico MX Master 4 y keypad de Logitech.
