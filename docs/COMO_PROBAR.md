# Cómo probar

Movido desde `AGENTS.md` el 2026-11-22 (resumen allí).

1. **Clave (una vez):** crea `.env` en la raíz (está en `.gitignore`; la clave se pasa por chat, nunca por git):
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   LLM_PROFILE=dev
   ```
   `LLM_PROFILE=dev` pone primero modelos **gratuitos** (a veces lentos o saturados), pero **no garantiza 0 $**: el nivel caro es Haiku (de pago) y `/transcribe` prueba antes Gemini. Para no gastar nada, fija `LLM_CHEAP_MODEL`, `LLM_EXPENSIVE_MODEL` y `LLM_TRANSCRIBE_MODELS` solo con modelos `:free` (ver `docs/historial/ESTADO_PROYECTO.md` §4).
2. **Servidor:**
   - `task server` → lógica real (sesión + modelos) en `127.0.0.1:8765` (`/ws`, `POST /message`, `POST /scan`, `/health`). Sin el servicio de lectura de Didac, arráncalo con `SCANNER_URL=fixture` y `/scan` responderá con el formulario de ejemplo (con `pageCorners`).
   - `task mock` → respuestas fijas en `localhost:8080`, sin clave ni coste.
   - `task dev` → la app de escritorio completa (Wails), con el servidor real dentro si hay clave.
3. **Interfaz en el navegador:** `cd web` y `VITE_WS_URL=ws://127.0.0.1:8765/ws npm run dev` (PowerShell: `$env:VITE_WS_URL="ws://127.0.0.1:8765/ws"; npm run dev`). «Developer tools» → **Send sample document** para probar sin scanner; «Turn on hand gestures» para los gestos (guía paso a paso: `docs/PROBAR_GESTOS.md`).
4. **Scanner (B):** envía tu `document` con `POST /message` → guía `docs/INTEGRACION_SCANNER.md`, ejemplo `python api/examples/send_message.py --demo-ocr`.
5. **App de escritorio (ejecutable):** `wails build` → `build/bin/lauzhack.exe` (doble clic). Busca el `.env` en la carpeta actual, junto al `.exe` y hasta 3 carpetas por encima (la raíz del repo). Log en `build/bin/lauzhack.log`. «Developer tools» enseña qué soporta la ventana (voces en español, dictado, cámara).
6. **Overlay:** `task overlay` (o `wails build`) → `build/bin/lauzhack.exe`, un solo ejecutable con Gesture Control dentro; Ctrl+Alt+Espacio o la tecla 1 del MX Keypad lo abre. Ver `docs/OVERLAY.md` y `docs/KEYPAD.md`.
   - **Opciones 2 y 3** (papel y archivo): la app arranca `scanner/service.py` con `scanner/pdf/.venv` si existe; si no, con el Python del sistema, que suele fallar con `No module named 'cv2'` (`build/bin/reading-service.log`). Instálalo una vez con `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1`, que también instala Tesseract (hace falta para el papel y los PDF escaneados).
   - **Visto en la prueba del 2026-11-22:**
     - si otro programa tiene Ctrl+Alt+Espacio, usa la tecla 1 del keypad o Ctrl+Alt+Shift+1;
     - con los gestos, el menú llegó a **suspender el ordenador** (`did: suspend` en el log) y la pinza del volumen dio saltos hasta 0 % (código de Nil: pendiente de avisarle);
     - silenciar el micro solo actúa sobre una llamada de Google Meet abierta.
7. **Antes del PR:** `task check`.

Puertos: 8765 app/servidor real · 8766 `scanner/capturar.py --servidor` · 8080 mock. Guion de la demo: `docs/PITCH.md`.

**Reglas de estructura (comprobadas, no cambiar sin avisar):**
- Nada de carpetas `internal/`: el `main.go` de la raíz no puede importarlas (Go lo rechaza). Los paquetes van en `backend/<nombre>` y se importan como `<módulo>/backend/<nombre>`.
- El frontend vive en `web/`, con `"frontend:dir": "web"` en `wails.json` y `//go:embed all:web/dist` en `main.go`.
- `backend/cmd/mock` es un `main` aparte para probar sin Wails.
- `web/wailsjs/` lo genera Wails: no se edita a mano.
