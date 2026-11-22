# TAREAS.md — Tablero

Tareas acordadas el 2026-11-22. Las anteriores (T1–T19) son historial: `docs/historial/TAREAS_ANTERIORES.md`. Cada tarea tiene su ficha en `docs/tareas/<ID>.md` con el objetivo, el estado actual, las preguntas abiertas, a quién preguntar, los criterios de «hecho» y los riesgos. Antes de empezar, lee `docs/TRABAJAR.md`.

Los agentes no editan este archivo: lo actualiza un humano al fusionar.

## Ahora: fase de arreglos (prioridad sobre N1–N9)
Asignado por Isaac el 2026-11-22, tras la prueba de la app completa. Fichas en `docs/arreglos/`.

| ID | Arreglo | Responsable | Estado |
|----|---------|-------------|--------|
| R1 | [Una sola interfaz: Halo en todas las pantallas](docs/arreglos/R1.md) | Didac | pendiente |
| R2 | [Gesture Control seguro y estable](docs/arreglos/R2.md) | Nil | pendiente |
| R3 | [PDF Scanner de punta a punta (después, Transcribe)](docs/arreglos/R3.md) | Pau | pendiente |
| R4 | [Arranque e integración: versión visible, instalación, keypad y voz](docs/arreglos/R4.md) | Isaac | pendiente |

## Funcionalidades N1–N9 (estado real el 2026-11-22: mapa en el artifact «Mapa de la app LauzHack»)
| ID | Tarea | Responsable | Estado | Rama | PR | Depende de |
|----|-------|-------------|--------|------|----|------------|
| N1 | [Overlay sólido](docs/tareas/N1.md) | Nil | hecho | — | — | — |
| N2 | [Keypad](docs/tareas/N2.md) | Isaac | hecho (falta probar la voz con micro) | — | — | — (acciones: N1, N4) |
| N3 | [Perfeccionar el escaneo de documentos](docs/tareas/N3.md) | Pau | hecho | — | — | — |
| N4 | [Botón en el PDF para leer en voz alta todo el PDF](docs/tareas/N4.md) | Didac | hecho | — | — | — |
| N5 | [Modo cursor](docs/tareas/N5.md) | por asignar | parcial | — | — | N1, N3, N4 |
| N6 | [Selección de texto en el modo cursor](docs/tareas/N6.md) | por asignar | parcial | — | — | N5 |
| N7 | [Resumir con IA: el documento y el texto seleccionado](docs/tareas/N7.md) | por asignar | parcial (la selección, sí; el documento, no) | — | — | N5, N6 |
| N8 | [Demostrar que lo anterior es óptimo (eficiencia)](docs/tareas/N8.md) | por asignar | pendiente | — | — | N7 |
| N9 | [Control por voz del volumen](docs/tareas/N9.md) | por asignar | parcial | — | — | — (relacionada con N4) |

Orden: N1 va primero. N2, N3 y N9 son en gran parte independientes. N5 → N6 → N7 → N8.
