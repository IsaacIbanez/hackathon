# Estado — P4-C

- **Persona:** Pau
- **Herramienta:** Claude Code
- **Tarea actual:** T19 — guía de encuadre por voz y disparo automático (`startFramingGuide` en `web/src/camera`); después, traducir `capturar.py` avisando a Didac
- **Rama:** feature/T19-encuadre
- **Estado:** en revisión (falta probarlo con la MX Brio en la página de prueba)
- **Último cambio:** 2026-11-21 22:00

## Hecho
- #12: `scanner/capturar.py`, captura de la MX Brio (única ≈2,7 s, modo servidor ≈0,4 s, puerto 8766).
- #31 (T12): `openCamera` (Logitech por nombre) y `captureStill` (foto más nítida de ~0,5 s) en `web/src/camera`.
- #32 (T16): 4 ideas en `docs/IDEAS.md`.
- T19: `startFramingGuide(video, { lang, onHint, onCapture, timeoutMs })`:
  - Avisos `dark`, `moving`, `blurry`, `hold_still` (es, ca, en). Un aviso tiene que durar 0,3 s, no se repite mientras sigue igual y se repite a los 5 s.
  - Disparo automático: 0,7 s quieto, con luz y nitidez estable (autoenfoque terminado). Guarda el fotograma más nítido de ese momento a resolución completa, con pitido, «Foto hecha» y `onCapture`. A los 8 s dispara con la mejor foto vista.
  - Umbral de movimiento calibrado con la MX Brio (ruido con la escena quieta: 1,4 de media y 2,8 en el p95 → umbral 4,5).
  - Lógica pura en `framing.ts` (11 tests nuevos; 22 en `src/camera`, 91 en `web`). `tsc`, build y oxlint en verde.
  - Página de prueba: botón «Start framing guide», con los avisos en voz alta y los valores en directo.

## Pendiente
- Probar T19 con la MX Brio y una hoja de verdad (`npx vite web/src/camera` → `/demo/`) y ajustar los umbrales si hace falta.
- Traducir `capturar.py` al inglés en un PR aparte, cambiando también las llamadas de `scan.py` y `demo_app` de Didac (con su permiso), o dejando `capturar.py` como alias.

## Bloqueos y preguntas para humanos
- Isaac (A), para T14: `startFramingGuide` usa el mismo `<video>` que los gestos; los avisos llegan por `onHint` y la app los dice con su voz (en la demo uso `speechSynthesis`). El pitido de disparo es propio (`shutter.ts`): Nil podría añadir un earcon `capture` a `earcons.ts` si se quiere uno solo.
- Isaac (A) y Nil (C): `openCamera` pide 4K por defecto. Si los gestos van lentos, se puede usar `openCamera({ width: 1920, height: 1080 })`.
- `oxlint` de `web/node_modules` no arranca en Windows (falta el binario nativo en `package-lock.json`); con `npx oxlint@1.90.0` funciona.
- La MX Brio no la pueden usar dos programas a la vez: con `capturar.py --servidor` abierto, la app no puede abrirla.

## Archivos tocados
- `web/src/camera/{guide,framing,frames,shutter}.ts` (nuevos), `still.ts` (usa `frames.ts`), `sharpness.ts` (`downsample`, `meanAbsDiff`), `index.ts`, `README.md`, `test/framing.test.ts`, `demo/*`
- `estado/P4-C.md`
