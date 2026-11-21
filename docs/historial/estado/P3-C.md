# Estado — P3-C

- **Persona:** Nil
- **Herramienta:** Claude Code
- **Tarea actual:** T6 (rol C): voz (hablar y escuchar) y gestos que actúan sobre el ordenador real (Gesture Control).
- **Ramas:** `feature/T6-voice` y `feature/T6-gesture-control` (cada una con su PR).
- **Estado:** en revisión.
- **Último cambio:** 2026-11-21

## Hecho
- Módulo de manos en `web/src/input/` (fusionado en #9): poses, gestos estables, deslizar, puntero suavizado con selección por permanencia, puntero en coordenadas del documento, acciones por contexto y demo «Gesture Lab». Código en inglés.
- **Voz** (`feature/T6-voice`, carpeta `web/src/input/voice/`):
  - `Speaker` lee frase a frase: pausar y reanudar siguen donde se quedó, «repite» dice la última frase, elige la mejor voz del idioma y no corta los textos largos. Sustituye a `app/voice.ts` con la misma interfaz.
  - `VoiceInput` escucha solo cuando se pide (señalar y mantener, o menú → dictar), con pitidos y subtítulos. Las órdenes cortas («para», «sigue», «repite», «más alto»…) se resuelven en local, sin modelo; el resto va a Go como `utterance`; si no se dice nada, se envía la pregunta por defecto.
  - Reconocimiento: el del navegador y, si no funciona (por ejemplo dentro de Wails), Whisper local en la página (transformers.js); el audio no sale del ordenador.
  - Conectado en `app/App.tsx` y `app/Gestures.tsx` (archivos del rol A, cambio pequeño para que lo revise Isaac).
- **Gesture Control** (`feature/T6-gesture-control`): programa local en Go (`adapters/desktop/`) y su página (`web/src/input/desktop/`). Hace atajos de teclado, ratón, volumen del sistema y controles de videollamada (Meet, Zoom, Teams: silenciar, cámara, levantar la mano, salir) en Windows, Linux y macOS. Solo escucha en 127.0.0.1:8767 y pide un token que cambia en cada arranque.
  - Contexto nuevo `call`: ✋ levantar la mano, 👍 silenciar, 👎 cámara, ✌️ menú ↓ salir.
  - Varias manos y caras: sigue la más cercana a la cámara y no salta a otra salvo que esté claramente más cerca.
  - El seguimiento sigue funcionando con la ventana en segundo plano.

## Pendiente
- Probar voz y Gesture Control en un ordenador real (micrófono, altavoces, llamada de verdad). Whisper local no se ha podido probar desde mi entorno (Hugging Face está bloqueado).
- Probar con la webcam y una mano real; ajustar umbrales (`DEFAULT_OPTIONS`, `DEFAULT_THRESHOLDS`).
- Añadir `@mediapipe/tasks-vision@0.10.21` a `web/package.json` y servir el modelo en local, para no depender de la red en la demo.
- Pasar a español `web/src/input/README.md` (sigue en inglés desde #9).

## Bloqueos y preguntas para humanos
- **Carpeta nueva `adapters/desktop/`** (programa en Go del rol C): sigue la decisión de que los adaptadores viven en `adapters/` y hablan con la app en local. Es un programa aparte y no toca la app Wails. Confirmadlo y añadidlo a «Decisiones» en `AGENTS.md`.
- **Puerto 8767** para Gesture Control: el 8766 lo usa el scanner (`scanner/capturar.py --servidor`).
- **Cámara compartida:** la videollamada y la ventana de gestos usan la misma webcam; en Linux puede estar ocupada (ver `adapters/desktop/README.md`).

## Archivos tocados
- `web/src/input/**`, `adapters/desktop/**`, `estado/P3-C.md`
- `web/src/app/App.tsx` y `web/src/app/Gestures.tsx` (solo en `feature/T6-voice`)
