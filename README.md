# LauzHack 2026 — lector de documentos para personas con baja visión

App de escritorio (overlay a pantalla completa) que lee y explica documentos en papel o en el PC, con la cámara MX Brio, gestos, voz y el MX Keypad de Logitech. Equipo: Isaac, Didac, Pau y Nil (`ROSTER.md`), cada uno con su agente de IA.

## Por dónde empezar
- **Personas y agentes:** `AGENTS.md` (corto: qué es, dónde estamos, qué leer y las reglas).
- **Dónde estamos y adónde vamos:** `docs/ESTADO.md`. Tablero: `TAREAS.md`.
- **Mapa del repo y dueños:** `docs/MAPA.md`. **Cómo trabajar:** `docs/TRABAJAR.md`.

## Arrancar la app (Windows)
1. `.env` en la raíz con `OPENROUTER_API_KEY=…` (y `TOGETHER_API_KEY=…` para Transcribe). Nunca va al repositorio.
2. Una vez: `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1` (OCR).
3. `task overlay` y abre `build\bin\lauzhack.exe`. Se muestra con Ctrl+Alt+Espacio o la tecla 1 del keypad.

Pruebas de humo: `docs/COMO_PROBAR.md`. Guion de la demo: `docs/PITCH.md`.
