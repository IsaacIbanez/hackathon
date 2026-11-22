# TAREAS.md — Tablero

Tareas acordadas el 2026-11-22. Las anteriores (T1–T19) son historial: `docs/historial/TAREAS_ANTERIORES.md`. Cada tarea tiene su ficha en `docs/tareas/<ID>.md` con el objetivo, el estado actual, las preguntas abiertas, a quién preguntar, los criterios de «hecho» y los riesgos. Antes de empezar, lee «Al coger una tarea» en `AGENTS.md`.

Los agentes no editan este archivo: lo actualiza un humano al fusionar.

| ID | Tarea | Responsable | Estado | Rama | PR | Depende de |
|----|-------|-------------|--------|------|----|------------|
| N1 | [Overlay sólido](docs/tareas/N1.md) | Nil | pendiente | — | — | — |
| N2 | [Keypad](docs/tareas/N2.md) | Isaac | pendiente | — | — | — (acciones: N1, N4) |
| N3 | [Perfeccionar el escaneo de documentos](docs/tareas/N3.md) | Pau | pendiente | — | — | — |
| N4 | [Botón en el PDF para leer en voz alta todo el PDF](docs/tareas/N4.md) | Didac | pendiente | — | — | — |
| N5 | [Modo cursor](docs/tareas/N5.md) | por asignar | pendiente | — | — | N1, N3, N4 |
| N6 | [Selección de texto en el modo cursor](docs/tareas/N6.md) | por asignar | pendiente | — | — | N5 |
| N7 | [Resumir con IA: el documento y el texto seleccionado](docs/tareas/N7.md) | por asignar | pendiente | — | — | N5, N6 |
| N8 | [Demostrar que lo anterior es óptimo (eficiencia)](docs/tareas/N8.md) | por asignar | pendiente | — | — | N7 |
| N9 | [Control por voz del volumen](docs/tareas/N9.md) | por asignar | pendiente | — | — | — (relacionada con N4) |

Orden: N1 va primero. N2, N3 y N9 son en gran parte independientes. N5 → N6 → N7 → N8.
