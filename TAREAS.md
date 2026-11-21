# TAREAS.md — Tablero de la hackathon

Estados: `pendiente` → `en curso` → `en revisión` → `hecha`

Asigna un agente de `ROSTER.md` (por ejemplo `P2-C` o `P2-G`) como responsable.

| ID | Tarea | Agente responsable | Estado | Rama | PR | Depende de |
|----|-------|--------------------|--------|------|----|------------|
| T1 | Definir alcance, arquitectura y reparto | Humanos | hecha | feature/T1-alcance-y-arquitectura | #1 | — |
| T2 | Esqueleto: monorepo, contrato `api/openapi.yaml`, mensajes WebSocket, CI, `Taskfile.yml` y servidor mock | P1-C (Isaac) — rol A | hecha | feature/T2-contrato, feature/T2-wails-ci | 5acd70f, #2 | T1 |
| T3 | Prueba de cámara en todos los SO (Wails) según `docs/PRUEBA_WAILS.md` (Windows hecho por Isaac) y qué ofrece el SDK de Logitech para la cámara | P2 o P4 — rol B1 | pendiente | — | — | T1 |
| T4 | Captura y visión: flujo de cámara, detección y recorte, OCR local | P2 o P4 — rol B1 | pendiente | — | — | T2 |
| T5 | Comprensión de documentos: campos, escalado al modelo caro, vista del documento | P4 o P2 — rol B2 | pendiente | — | — | T2 |
| T6 | Interacción: gestos de mano y voz | P3 (Nil) — rol C | pendiente | — | — | T2 |
| T7 | Cliente de modelos frugal, caché y contador de coste y latencia | P1 (Isaac) — rol A | pendiente | — | — | T2 |
| T8 | Integración de punta a punta y pruebas | P1 (Isaac) — rol A | pendiente | — | — | T4–T7 |
| T9 | Accesibilidad y flujo de la demo | Todos | pendiente | — | — | T8 |
| T10 | Documentación y presentación | Humanos | pendiente | — | — | T9 |

Aparcado por ahora (no empezar): ratón háptico MX Master 4 y keypad de Logitech.

Reglas: solo se empieza una tarea cuando sus dependencias están en `hecha`. Excepción: T4–T6 pueden empezar contra el servidor mock en cuanto el contrato de T2 esté fusionado. Los prototipos aislados (por ejemplo, una prueba de MediaPipe o de OCR sin conectar al resto) se pueden empezar antes. Los agentes no editan este archivo: al fusionar un PR, quien lo revisa actualiza la fila de la tarea (estado y enlace al PR).
