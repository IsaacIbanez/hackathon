# Brief de Isaac (P1): integración en una app overlay
Acordado el 2026-11-21. La sesión la llevó Didac haciendo de Isaac, por indicación del equipo. Última revisión: 2026-11-21.

## Camino elegido
De los tres caminos de `docs/arranque/isaac.md`, el elegido es **(a) backend e integración**: juntar las funcionalidades del equipo en una sola app de escritorio de tipo overlay.

## Objetivo
Una app ejecutable que se abra desde cualquier programa con un atajo de teclado (o con el MX Keypad de Logitech) y ofrezca las funcionalidades que hay ahora:
- los gestos de Nil;
- leer un papel con la cámara (Pau y Didac);
- leer en voz alta un archivo del PC (Didac).

## Qué se verá en la demo
Con cualquier programa abierto, se pulsa Ctrl+Alt+Espacio (o la tecla del keypad) y aparece el menú.
- **1:** la mano controla el ordenador.
- **2:** se pone una carta delante de la cámara; la app la fotografía sola y la lee en voz alta.
- **3:** se elige un PDF y se escucha línea a línea.

## Alcance
- Ventana siempre encima, atajo global configurable y menú con teclas (también las del teclado numérico).
- Tres opciones conectadas a lo que ya existe, sin cambiar el contrato.
- Arrancar y parar los programas auxiliares: el servicio de lectura y Gesture Control.
- Leer archivos del PC: PDF con texto, PDF escaneado, imágenes y TXT/MD.
- Dejar escrito lo que no está definido, con el código preparado (`docs/OVERLAY.md`).

## Fuera de alcance (de momento)
- El diseño visual.
- Abrir las opciones por voz o por gesto.
- Explicar con IA.
- Word y otros formatos.
- Linux y macOS.
- Integrar Gesture Control dentro del ejecutable.

## Criterios de «hecho»
- [x] `task overlay` genera `build/bin/lauzhack.exe` y `gesture-control.exe`.
- [x] El atajo muestra y oculta el overlay desde cualquier programa, y lo trae al frente si está tapado.
- [x] La opción 3 lee un PDF con texto: probado con la carta, 21 líneas en 16 ms; arranca el servicio si no está.
- [x] La opción 2 completa el ciclo cámara → foto → servicio → respuesta hablada (probado sin papel: 422).
- [x] La opción 1 arranca y para Gesture Control y su ventana.
- [x] Al cerrar la app (Q o la ventana) no queda ningún proceso auxiliar.
- [ ] Probado con el MX Keypad y con un papel real delante de la MX Brio.

## Carpetas que toca
- Propias (rol A):
  - `main.go`, `app.go`, `app_overlay.go`;
  - `backend/overlay/`, `backend/scanner/`;
  - `web/src/app/overlay/`, `web/src/main.tsx`;
  - `web/wailsjs/` (generado);
  - `Taskfile.yml`, `docs/`.
- De otros, con el visto bueno de Didac en esta misma sesión:
  - `scanner/service.py`, `scanner/documents.py` y `scanner/test_service.py` (`POST /document`);
  - `web/src/document/GuidedReader.tsx` (la opción `autoPlay`).
- Solo se usan, sin modificarlos: `web/src/camera` (Pau), `web/src/input/voice/speaker.ts` y `adapters/desktop` (Nil).

## Contrato
No cambia. Las opciones usan `DocumentPayload` a través de bindings de Wails, no del WebSocket. El servicio de lectura gana `POST /document`, que es interno de B2 y no forma parte del contrato.

## Modelos y coste
Ninguno: 0 $.

## Riesgos
- Una sola cámara: la opción 2 para los gestos antes de abrirla.
- El primer `.exe` se cerró una vez sin explicación y no se ha repetido. Ahora el log lo registraría.

## Preguntas abiertas
Las de la tabla «Preparado para lo que aún no está definido» de `docs/OVERLAY.md`.

## Cambios del brief
- 2026-11-21 — Primera versión.
