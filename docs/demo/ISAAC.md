# Demo · Isaac: arranque, overlay, voz e integración

Responsable: **Isaac**. Plan común y reglas: `docs/demo/README.md`. Isaac también hace el **ensayo general**. Cada agente fusiona su propio PR a `main` (`docs/demo/README.md`).

## Qué revisas
| Pieza | Dónde |
|---|---|
| Arranque: `.env`, servicios auxiliares, atajos, keypad por USB | `main.go`, `app.go`, `app_overlay.go`, `backend/overlay/` (`procs.go`, `keypad*.go`, `hotkey*.go`) |
| Servidor local y modelos | `backend/session/`, `backend/llm/`, `backend/ws/` |
| Overlay: menú, paneles, keypad y órdenes de voz | `web/src/app/overlay/` (`Overlay.tsx`, `Hub.tsx`, `keypad.ts`, `useVoiceCommand.tsx`, `recorder.ts`, `voiceCommand.ts`) |
| AI Summary (de Didac: avísale) | `backend/summary/`, `app_summary.go`, `SummarizeMode.tsx` |
| Read Text y visor de PDF (de Didac: avísale) | `ReadFileMode.tsx`, `web/src/document/`, `app_pdf.go`, `scanner/pdf_pages.py` |
| Guion de la demo | `docs/PITCH.md`, `docs/COMO_PROBAR.md` |

## Qué tiene que funcionar en la demo
1. **El arranque:**
   - con el `.exe` y el `.env` del portátil de la demo, el log dice `MX Keypad read directly: connected=true` y no hay errores;
   - si falta algo (claves, entorno del escáner, Tesseract), el menú lo **avisa al arrancar**.
2. **Tecla 1:** abre y cierra el menú desde cualquier programa. Las líneas 1–8 del menú hacen lo mismo que las teclas.
3. **Órdenes de voz (tecla 7):** «sube el volumen», «baja el volumen» y «borra el texto», esta última solo con texto seleccionado. Las de herramientas, como «lee el papel» o «resume», también.
4. **AI Summary (tecla 4):** resume el texto seleccionado en otro programa, en la burbuja junto al cursor.
5. **Read Text (tecla 3):** abre un PDF o una imagen y lo lee línea a línea; tecla 8 lee y pausa.
6. **El guion de la demo** está al día con lo que hace la app hoy, y cada paso tiene su plan B.

## Fallos y riesgos conocidos
- **PR #54 sin fusionar:** borrar por voz, volumen por voz, la grabación con `MediaRecorder` y el aviso de micro silenciado.
  - Probarlo con una voz real y fusionar.
  - Cada intento deja líneas `ui: voice:` y `transcribe:` en el log.
- **Avisos al arrancar** (con Pau):
  - si no hay `TOGETHER_API_KEY`, Transcribe no puede funcionar;
  - si no existe `scanner\pdf\.venv`, `pythonCommand` (`backend/overlay/procs.go`) cae al Python del sistema y el servicio muere sin que la pantalla diga qué hacer. Avisar con el comando exacto (`install.ps1`).
- **Una sola copia de la app:** si se abre dos veces, la segunda no consigue el puerto 8765 ni los atajos. Hay que avisarlo (pendiente de R4).
- **Versión visible:** el commit y la fecha en el log y en el menú, para saber qué `.exe` está abierto (R4).
- **`LLM_PROFILE=dev`** usa modelos gratis que pueden dar 429. En la demo no se usa (`docs/PITCH.md`).
- **`docs/PITCH.md` está viejo:** promete pasos con ⏳ (dictado, señalar un campo). Hay que reescribirlo con las herramientas reales (1–8) y el plan B de cada una.
- **Pantalla Developer** (tecla D): fuera de la demo.

## Cómo probar
- **App:** `task overlay` → `build/bin/lauzhack.exe`. Log: `build/bin/lauzhack.log`.
- **Tests:** `task check`. Sin ventana: `task server` (lógica real en 8765) o `task mock`.

## Hecho cuando
- [ ] PR #54 probado con voz real y en `main`.
- [x] El menú avisa al arrancar de cada cosa que falte, con qué hacer.
- [x] La segunda copia de la app avisa en vez de fallar en silencio.
- [ ] `docs/PITCH.md` reescrito y ensayado dos veces seguidas con el `.exe` de `main`.

## Prompt para tu agente
```
Lee AGENTS.md, docs/demo/README.md y docs/demo/ISAAC.md. Trabajas para Isaac en la fase de pulido para la
demo: no añadas funcionalidades, haz robusto lo que hay. Revisa el arranque (main.go, app*.go,
backend/overlay, backend/session), el overlay y las órdenes de voz (web/src/app/overlay), AI Summary y
Read Text, con los puntos de «Qué tiene que funcionar» y «Fallos y riesgos». Empieza por los avisos al
arrancar (claves que faltan, entorno del escáner) y por la segunda copia de la app. Reproduce con el .exe
y el log antes de cambiar nada. Un arreglo = un commit en una rama demo/isaac-<tema>, con su línea en el
Registro de docs/demo/ISAAC.md. Las carpetas de Didac, Nil o Pau: pregúntame antes de tocarlas.
Para cada arreglo escribe o actualiza sus tests, pasa task check (y los tests de tu parte) y
pruébalo con el .exe; abre un PR y, con el CI en verde, fusiónalo tú mismo a main
(gh pr merge <n> --merge). Nadie revisa lo de otros.
```

## Registro (lo rellena el agente)
Por cada fallo: síntoma → cómo reproducirlo → causa → arreglo → cómo se ha comprobado (con el `.exe`).
- 2026-11-22, avisos al arrancar: si faltaba una clave, el entorno del escáner o Tesseract, la app no lo decía hasta que la herramienta fallaba (Transcribe reintentaba cada segundo; el servicio moría con `No module named cv2`) → reproducido con el `.exe` y el `.env` sin `TOGETHER_API_KEY` → `backend/overlay/checks.go` (`StartupProblems`, función pura con tests) y `app_checks.go`: cada problema sale en el log (`startup:`) y en el menú, en color de aviso, con qué hacer (por ejemplo, el comando exacto de `install.ps1`). Comprobado con el `.exe`: avisa de `TOGETHER_API_KEY`.
- 2026-11-22, segunda copia: con dos copias abiertas, la segunda se iba a otro puerto en silencio y las dos se peleaban por el keypad y la cámara → reproducido abriendo dos `.exe` → mutex de Windows `Local\LauzHackOverlay` (`instance_windows.go`): la segunda copia lo dice en el log y en el menú. Comprobado con dos `.exe` a la vez.

**Aviso de Nil (2026-11-22):** he tocado `web/src/app/overlay/gestureHost.ts`. «Close gestures» ahora también duerme los gestos (la cámara sigue encendida) y `turnGesturesOn()` los despierta con `handle.wakeGestures()` en vez de simular un clic en la vista de la cámara. Detalle en el Registro de `docs/demo/NIL.md`.
