# TAREAS.md — Tablero de la hackathon

Estados: `pendiente` → `en curso` → `en revisión` → `hecha`

Asigna un agente de `ROSTER.md` (por ejemplo `P2-C` o `P2-G`) como responsable.

| ID | Tarea | Agente responsable | Estado | Rama | PR | Depende de |
|----|-------|--------------------|--------|------|----|------------|
| T1 | Definir alcance, arquitectura y reparto | Humanos | en revisión | feature/T1-alcance-y-arquitectura | (este PR) | — |
| T2 | Esqueleto: monorepo, contrato `api/openapi.yaml`, mensajes WebSocket, CI, `Makefile` y servidor mock | Rol A (asignar) | pendiente | — | — | T1 |
| T3 | Prueba de cámara en todos los SO (Wails) y qué ofrece el SDK de Logitech para la cámara | Rol B1 (asignar) | pendiente | — | — | T1 |
| T4 | Captura y visión: flujo de cámara, detección y recorte, OCR local | Rol B1 (asignar) | pendiente | — | — | T2 |
| T5 | Comprensión de documentos: campos, escalado al modelo caro, vista del documento | Rol B2 (asignar) | pendiente | — | — | T2 |
| T6 | Interacción: gestos de mano y voz | Rol C (asignar) | pendiente | — | — | T2 |
| T7 | Cliente de modelos frugal, caché y contador de coste y latencia | Rol A (asignar) | pendiente | — | — | T2 |
| T8 | Integración de punta a punta y pruebas | Rol A (asignar) | pendiente | — | — | T4–T7 |
| T9 | Accesibilidad y flujo de la demo | Todos (asignar) | pendiente | — | — | T8 |
| T10 | Documentación y presentación | Humanos | pendiente | — | — | T9 |

Aparcado por ahora (no empezar): ratón háptico MX Master 4 y keypad de Logitech.

Reglas: solo se empieza una tarea cuando sus dependencias están en `hecha`. Excepción: T4–T6 pueden empezar contra el servidor mock en cuanto el contrato de T2 esté fusionado. Al terminar, actualiza tu fila y enlaza tu PR.
