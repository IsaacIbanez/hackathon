# AGENTS.md — Contexto del proyecto de hackathon

Lo cargan todos los agentes (Claude Code, Gemini CLI) **en cada petición**: por eso es corto. El detalle está en `docs/` y se lee solo cuando hace falta. Versión completa anterior: `docs/historial/AGENTS_2026-11-22.md`.

## Proyecto
- **LauzHack 2026** (24 h). App de escritorio para personas con baja visión: lee y explica documentos (papel con la cámara o archivos), con gestos, voz y el MX Keypad. Challenges: Logitech (cámara y keypad), IMC Tech for Good (accesibilidad), AXA (IA frugal).
- **Stack:** Go + Wails (Windows confirmado), React + Vite + TS + Tailwind en `web/`, MediaPipe y Web Speech en la ventana, Python en `scanner/` (OCR), modelos vía OpenRouter (presupuesto del equipo: 10 €).
- **La app es el overlay** (`task overlay` → `build/bin/lauzhack.exe`): capa a pantalla completa con Gesture Control, PDF Scanner, Read Text, AI Summary y el keypad. Ver `docs/OVERLAY.md`, `docs/DISENO.md`, `docs/KEYPAD.md`.
- **Prioridades:** que la demo funcione de punta a punta → gestos y voz → accesibilidad (lo barato desde el principio: texto grande, salida por voz, foco visible). Fuera de alcance: ratón háptico MX Master 4.

## Equipo
Isaac, Didac, Pau y Nil (`ROSTER.md`). Cada persona supervisa un agente Claude y usa Gemini para tareas pequeñas o revisiones. Los humanos deciden, revisan y aprueban; los agentes ejecutan.

## Idioma
- **En inglés:** código, comentarios, logs, errores, tests, textos de la interfaz, variables de entorno, el contrato, commits y títulos de PR.
- **En español:** la conversación con el equipo, la documentación (`*.md`, `docs/`, `TAREAS.md`) y los datos de ejemplo que imitan documentos reales.

## Ahorro de tokens (el uso de las cuentas se acaba rápido)
1. **Una sesión por tarea.** Al terminar o cambiar de tarea, deja lo pendiente en el brief y empieza una sesión nueva (`/clear`). Una conversación larga reenvía todo su historial en cada petición.
2. **Al empezar, lee solo tu ficha** (`docs/tareas/<ID>.md`) y tu brief (`docs/briefs/<ID>.md`). **No leas por defecto** `docs/ESTADO_PROYECTO.md`, `docs/historial/`, `docs/DECISIONES.md` ni `docs/ideas/`: son archivo, solo si la tarea lo pide.
3. **Busca antes de leer:** usa `grep`/`rg` y lee solo el rango que necesitas. No leas enteros los archivos grandes (`docs/OVERLAY.md`, `web/src/input/interaction.ts`, `app_overlay.go`…).
4. **Filtra la salida de los comandos.** Por ejemplo:
   - `task check 2>&1 | grep -E "ℹ fail|FAIL|error"`;
   - `… | tail -20`;
   - `gh … --jq`.

   Nunca vuelques logs ni diffs enteros en la conversación.
5. **No repitas trabajo:** un `task check` antes del commit basta, salvo que cambies algo. No sondees con bucles: `gh pr checks <n> --watch` una sola vez.
6. **Para saber qué hace otro módulo**, lee su `README.md` o el contrato (`api/openapi.yaml`), no su código.
7. **Sin subagentes ni búsquedas por todo el repo**, salvo que tu persona lo pida.
8. **Modelo:** Sonnet por defecto (`/model sonnet`); Opus solo para diseño o depuración difícil. Las revisiones y las tareas mecánicas, mejor con Gemini.
9. **Conversación corta:**
   - preguntas en tandas de 3–5 con opciones (`AskUserQuestion`);
   - respuestas breves: qué hiciste, qué falta y qué tiene que decidir la persona.
10. **Este archivo:** si crece, mueve el detalle a `docs/` y deja aquí una línea con el enlace.

## Fase de arreglos (desde el 2026-11-22: va antes que N1–N9)
La app funciona mal en conjunto: pantallas con diseño nuevo y viejo, gestos peligrosos, escaneo que no arranca. **Nadie añade funcionalidades nuevas hasta cerrar su arreglo.** Una área por persona, con ficha en `docs/arreglos/`:

| ID | Arreglo | Persona |
|---|---|---|
| R1 | Una sola interfaz (Halo) en todas las pantallas | Didac |
| R2 | Gesture Control seguro y estable | Nil |
| R3 | PDF Scanner de punta a punta (y después Transcribe) | Pau |
| R4 | Arranque e integración: versión visible, instalación, keypad y voz | Isaac |

1. **La ficha es el brief.** No hagas entrevista; pregunta solo si algo no está claro (en una tanda).
2. **Antes de arreglar, reprodúcelo con el `.exe` real** (`task overlay` y `build/bin/lauzhack.exe`). Cierra antes cualquier otra instancia de la app.
3. **Un fallo, un commit.** Apunta en el «Registro» de la ficha: síntoma → cómo reproducirlo → causa → arreglo → cómo lo has comprobado.
4. **No toques lo de otra persona.** Si el fallo está en su carpeta, apúntalo en su ficha y avísala.
5. **Se da por cerrado** solo cuando se cumplen los «Hecho cuando» probados con el `.exe`, no solo con `task check`.
6. **PR pequeño por arreglo.** Pide a otra persona que lo pruebe con su `.exe` antes de fusionar.

## Al coger una tarea
Trabajo actual: `TAREAS.md` (N1–N9), con una ficha por tarea en `docs/tareas/<ID>.md`.
1. Lee la ficha y lo que enlace. Resuelve primero leyendo el repo lo que puedas; apúntalo como «estado actual».
2. Haz las «Preguntas abiertas» a tu persona (en español, tandas de 3–5, con la opción recomendada primero). Si no sabe algo, sugiérele preguntar a quien indica la ficha.
3. **No escribas código sin un brief confirmado:** objetivo, alcance, fuera de alcance, criterios de «hecho» medibles, carpetas, contrato, riesgos. Guárdalo en `docs/briefs/<ID>.md`, en un commit propio, cuando tu persona lo confirme. Si ya existe, úsalo y pregunta solo lo que falte o haya cambiado.
4. Si la persona cambia de idea, actualiza primero el brief y después el código.
5. (Antes se trabajaba por persona: `docs/briefs/<persona>.md` y `docs/arranque/` siguen como contexto.)

## Reglas de trabajo
1. **Al empezar:** `git pull` y lee tu ficha y tu brief. Trabaja solo en eso; si necesitas algo de otra parte, pregunta a un humano.
2. **Rama** `feature/<ID>-<nombre-corto>`; mejor en un worktree (`scripts/nueva-tarea.sh`), para no pisar a otros agentes. Commits pequeños, en inglés.
3. **Carpetas:** toca solo las de tu brief. Para usar las de otra persona, avísala y apúntalo en el brief.
4. **`TAREAS.md`:** no lo edites; lo actualiza un humano al fusionar.
5. **Contrato (`api/`):** sus cambios van en un PR aparte, pequeño, que otra persona revisa antes de construir encima. Mientras tanto, usa el mock. Tras cambiarlo, `task gen` (los tipos generados no se editan a mano).
6. **Antes del PR:** `task check` en verde (go vet, go test y build y tests del front).
7. **PR pequeño:** qué hiciste, qué falta, decisiones y cómo probarlo. Lo revisa otra persona, se fusiona **solo con el CI en verde** y se borra la rama.
8. **A `main` directamente:** solo si una persona lo pide expresamente.
9. **Decisiones:** si cambias una interfaz entre módulos, apúntala en `docs/DECISIONES.md` y añade aquí una línea si afecta al trabajo diario.
10. **Secretos:** nunca claves, contraseñas ni datos de cuentas en el repo. La clave va en `.env`, que está ignorado por git.

## Cómo probar (detalle en `docs/COMO_PROBAR.md`)
- **`.env` en la raíz:** `OPENROUTER_API_KEY=…` y `LLM_PROFILE=dev`. El perfil dev pone primero modelos gratuitos, pero **no es 0 $**: escala a Haiku.
- **La app:** `task overlay` → `build/bin/lauzhack.exe`. Se abre con Ctrl+Alt+Espacio o con la tecla 1 del keypad. Log en `build/bin/lauzhack.log`.
- **Opciones de papel y archivo:** necesitan `scanner/pdf/.venv` y Tesseract. Se instalan una vez con `powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1`.
- **Sin la app:** `task server` (lógica real en 8765) o `task mock` (respuestas fijas en 8080, sin coste).
- **Antes del PR:** `task check`.
- **Puertos:** 8765 app · 8767 Gesture Control suelto · 8770 servicio de lectura · 8080 mock.

## Estructura de carpetas (mapa: úsalo en vez de explorar)
```
main.go, app*.go, wails.json   raíz (lo exige Wails): app_overlay.go (overlay), app_pdf.go (visor PDF), app_summary.go (resumen)
api/                 contrato: openapi.yaml, fixtures/, gen/ (tipos Go generados)
backend/llm          modelos, caché, coste · backend/session  sesión, prompts, /scan, /transcribe
backend/summary      resumen de la selección (opción AI Summary)
backend/captions     subtítulos en directo: GET /captions (Together AI); página en web/src/captions
backend/scanner      cliente Go del servicio de lectura · backend/overlay  atajos, keypad USB, selección, procesos
backend/ws           WebSocket · backend/mock y backend/cmd/{mock,server,llmcheck}
web/src/app          pantallas comunes; web/src/app/overlay  menú y herramientas del overlay
web/src/camera       cámara y encuadre · web/src/document  lector guiado y visor de PDF
web/src/input        gestos y voz · web/src/api  tipos TS generados (no editar types.ts)
adapters/desktop     Gesture Control (lógica en control/; dentro de la app o suelto con task gestures)
scanner/             Python: OCR, PDF, servicio de lectura (reglas en scanner/AGENTS.md)
docs/                OVERLAY, DISENO, KEYPAD, COMO_PROBAR, DECISIONES, PITCH, ARQUITECTURA; tareas/, briefs/, historial/
```
**Reglas de estructura** (comprobadas, no cambiar sin avisar):
- No hay carpetas `internal/`: el `main.go` de la raíz no podría importarlas. Los paquetes van en `backend/<nombre>`.
- El frontend está en `web/` (`"frontend:dir": "web"`, `//go:embed all:web/dist`).
- `web/wailsjs/` lo genera Wails: no se edita a mano.
- Taskfile en vez de make; Go ≥ 1.26.

## Dueños de las carpetas
| Persona | Carpetas |
|---|---|
| Isaac (A) | `api/`, `backend/` (salvo `backend/summary`), `web/src/app/`, raíz Go, CI, `docs/` |
| Didac (B2) | `scanner/` (pipeline y servicio), `web/src/document/`, `backend/summary`, diseño del overlay |
| Pau (B1) | `web/src/camera/`, `scanner/capturar.py`, `scanner/benchmark/`, `backend/captions/`, `web/src/captions/` |
| Nil (C) | `web/src/input/`, `web/src/app/Gestures.tsx`, `adapters/desktop/`, `GesturesMode.tsx` |

No edites código de otra persona sin avisarla.

## Arquitectura (detalle en `docs/ARQUITECTURA.md`)
- **La ventana** (Wails) hace lo barato en local: cámara, manos, voz y lectura en voz alta.
- **Go** orquesta: bindings del overlay, WebSocket y sesión, y modelos con enrutado frugal (barato primero, caro solo si duda), caché y contador de coste (`stats`).
- **`scanner/service.py`** (8770) hace el OCR y el PDF.
- **Contrato primero:** `api/openapi.yaml` es la única interfaz entre módulos.

## Decisiones vigentes (registro completo: `docs/DECISIONES.md`)
- **Overlay «Halo»:** capa a pantalla completa, menú radial y un estilo común (`docs/DISENO.md`, Didac).
- **Gesture Control** va dentro de la app: un solo ejecutable (Nil).
- **MX Keypad:** se lee por USB, sin Options+; atajos de respaldo Ctrl+Alt+Shift+N (`docs/KEYPAD.md`, Isaac).
  - Teclas: 1 abrir/cerrar · 2 y 3 grabar y parar una orden de voz · 4 papel · 5 archivo · 6 leer/pausa · 7 resumen · 8 gestos · 9 menú.
- **Subtítulos en directo** (`GET /captions`, Pau): micro o llamada → Together AI; quién habla, idioma, barbarismos entre comillas y traducción; `.txt` guardado. Clave `TOGETHER_API_KEY` en `.env`, tope de 1 $ por sesión (`web/src/captions/README.md`).
- **AI Summary:** resume el texto seleccionado en cualquier programa, con el modelo barato. Es el resumen que se queda (Didac).
- **Visor de PDF:** lee el PDF entero en voz alta, página a página (N4, Didac).
- **API local protegida** (`ws.Guard`): solo 127.0.0.1 o localhost y los orígenes de la app.
- **Modelos:** `cheap` Haiku 5.5 y `expensive` Sonnet 5.5; la transcripción, con Gemini Flash Lite.
- **Presupuesto:** 10 € para todo el equipo. En desarrollo, `LLM_PROFILE=dev`.
- **Fallos vistos en la prueba del 2026-11-22** (`docs/COMO_PROBAR.md`):
  - un gesto llegó a suspender el ordenador;
  - la pinza del volumen da saltos;
  - Ctrl+Alt+Espacio puede estar ocupado por otro programa.
