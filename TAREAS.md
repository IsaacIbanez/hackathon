# TAREAS.md — Tablero de la hackathon

Estados: `pendiente` → `en curso` → `en revisión` → `hecha`

Asigna un agente de `ROSTER.md` (por ejemplo `P2-C` o `P2-G`) como responsable.

| ID | Tarea | Agente responsable | Estado | Rama | PR | Depende de |
|----|-------|--------------------|--------|------|----|------------|
| T1 | Definir alcance, arquitectura y reparto | Humanos | hecha | feature/T1-alcance-y-arquitectura | #1 | — |
| T2 | Esqueleto: monorepo, contrato `api/openapi.yaml`, mensajes WebSocket, CI, `Taskfile.yml` y servidor mock | P1-C (Isaac) — rol A | hecha | feature/T2-contrato, feature/T2-wails-ci | 5acd70f, #2 | T1 |
| T3 | Prueba de cámara en todos los SO (Wails) según `docs/PRUEBA_WAILS.md` (Windows hecho por Isaac) y qué ofrece el SDK de Logitech para la cámara | P2 o P4 — rol B1 | pendiente | — | — | T1 |
| T4 | Captura y visión: flujo de cámara, detección y recorte, OCR local | P4 (Pau) — rol B1 | en curso: captura de la MX Brio (única y modo servidor en 8766) fusionada (#12); falta recorte/OCR y enviar `document` con `POST /message` | feature/B-scanner-captura | #12 | T2 |
| T5 | Comprensión de documentos: pipeline foto → documento (OCR, PDF buscable) | P2 (Didac) — rol B2 | hecha: fusionada en `main` (envío a la app, OCR en paralelo, en inglés, `scanner/ENTREGA.md`) | feature/B-contexto-scanner | #26 | T2 |
| T6 | Interacción: gestos de mano y voz | P3 (Nil) — rol C | en curso: gestos (#9) y voz con Whisper local (#19) fusionados; Gesture Control (#20) con cambios pedidos | feature/T6-* | #9, #19, #20 | T2 |
| T7 | Cliente de modelos frugal, caché y contador de coste y latencia | P1-C (Isaac) — rol A | hecha (probada con la clave real) | feature/T7-llm | #3, #7 | T2 |
| T8 | Integración de punta a punta y pruebas | P1-C (Isaac) — rol A | en curso: la app sirve `/ws` (#4), `stats` (#6) y la lógica real document/pointer/utterance → speak (#10), probada con modelos gratis; falta el criterio de B2 y conectar el scanner de B y los gestos de C | feature/T8-session | #4, #6, #10 | T4–T7 |
| T9 | Accesibilidad y flujo de la demo | Todos | pendiente | — | — | T8 |
| T10 | Documentación y presentación | Humanos (borrador: P1-C) | en curso: guion en `docs/PITCH.md` | feature/T10-pitch | — | T9 |
| T11 | Contrato 0.5 (`document.pageCorners`) y `POST /scan` en Go → servicio de lectura; `SCANNER_URL=fixture` para probar sin él | P1-C (Isaac) — rol A | hecha | feature/T11-scan | (este PR) | — |
| T12 | Cámara en la app: `openCamera` (Logitech si está) y `captureStill` (foto más nítida) | P4 (Pau) — rol B1 | hecha | feature/T12-camara | #31 | — |
| T13 | Servicio de lectura `POST /scan` (8770) que recibe la foto y devuelve `document` + `pageCorners`; 2–3 documentos reales anonimizados en `api/fixtures/real/` | P2 (Didac) — rol B2 | pendiente | — | — | T5 (PR), T11 (contrato) |
| T14 | Unión en la app: botón «Read document», foto → `/scan`, esquinas al puntero; explicaciones ajustadas al OCR real | P1-C (Isaac) — rol A | pendiente | — | — | T11–T13, T15 |
| T15 | Orden `scan_document` (voz y gesto), puntero y recuadros sobre el papel real con `pageCorners`; arreglo de #20 (`Host`); MediaPipe en local | P3 (Nil) — rol C | pendiente | — | — | T11 (contrato) |
| T16 | Lluvia de ideas de funciones en `docs/IDEAS.md` | Todos | pendiente | — | — | — |
| T17 | Reconocimiento de voz mejor: `whisper-small` local (WebGPU/WASM), idioma forzado, precarga; respaldo T18 si falla (`docs/VOZ.md`) | P3 (Nil) — rol C | pendiente | — | — | — |
| T18 | `POST /transcribe` en Go: audio → texto con `google/gemini-2.5-flash-lite` (+ respaldo gratuito), coste en `stats` | P1-C (Isaac) — rol A | pendiente | — | — | — |
| T19 | Guía de encuadre por voz y disparo automático (`startFramingGuide` en `web/src/camera`, ver AGENTS.md); traducir `capturar.py` avisando a Didac | P4 (Pau) — rol B1 | pendiente | — | — | T12 |

Aparcado por ahora (no empezar): ratón háptico MX Master 4 y keypad de Logitech.

Reglas: solo se empieza una tarea cuando sus dependencias están en `hecha`. Excepción: T4–T6 pueden empezar contra el servidor mock en cuanto el contrato de T2 esté fusionado. Los prototipos aislados (por ejemplo, una prueba de MediaPipe o de OCR sin conectar al resto) se pueden empezar antes. Los agentes no editan este archivo: al fusionar un PR, quien lo revisa actualiza la fila de la tarea (estado y enlace al PR).
