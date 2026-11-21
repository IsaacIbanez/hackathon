# AGENTS.md — Contexto del proyecto de hackathon

Este archivo lo leen todos los agentes (Claude Code, Gemini CLI) al empezar. Es la fuente de verdad del proyecto.

## Proyecto
- **Nombre:** (provisional) Proyecto LauzHack
- **Evento:** LauzHack 2026. Duración total: 24 horas.
- **Objetivo:** app de escritorio que usa la cámara (webcam Logitech), el micro y gestos para leer y entender documentos en papel, y ayudar a rellenarlos. Combina tres challenges: Logitech (la webcam como "ojos y oídos" de la IA, flujos con contexto), IMC Tech for Good (inclusión y accesibilidad) y AXA (uso frugal de IA multimodal).
- **Historia de la demo:** una persona con baja visión sostiene un documento (carta o formulario de seguros) delante de la cámara; la app lo lee, lo explica en lenguaje sencillo y la ayuda a rellenarlo por voz o señalando con la mano.
- **Stack:** Go (backend y orquestación, IDE GoLand), Wails para la app de escritorio, interfaz en React + Vite + TypeScript + Tailwind, MediaPipe y Web Speech API en el navegador, modelos vía OpenRouter (AXA da una clave de 10 USD por equipo). Wails confirmado en Windows (compila, `getUserMedia` funciona sin pedir permiso en `wails dev`); falta repetir la prueba en Linux y en los otros equipos (`docs/PRUEBA_WAILS.md`). Plan B: Electron con Go como proceso aparte.
- **Reglas de la hackathon, incluido el uso de IA:** no hay restricciones sobre el uso de IA (confirmado por el equipo).

## Orden de prioridades
1. Primero el bucle de cámara funcionando de punta a punta.
2. Después gestos y voz.
3. Accesibilidad como capa final, pero con lo barato desde el principio (HTML semántico, texto grande, salida por voz).
4. Fuera de alcance por ahora: ratón háptico (MX Master 4) y keypad de Logitech.

## Equipo
Cuatro personas, cada una con una cuenta de Claude Pro y una de Gemini Plus (ver `ROSTER.md`). Cada persona supervisa **un agente principal (Claude)** y usa Gemini como segunda opción: una tarea paralela pequeña o la revisión del PR de otra persona. Una persona no puede supervisar bien más de uno o dos agentes a la vez.

## Roles
- **Humanos:** dan directrices, priorizan, revisan y aprueban merges.
- **Agentes:** ejecutan lo que les asigne un humano (el reparto se redefinirá; tablero único en `TAREAS.md`) y abren un PR. El estado por agente anterior está en `docs/historial/estado/`.

## Idioma
- **Código en inglés:** identificadores, comentarios, mensajes de log y de error, nombres de tests, textos de la interfaz, variables de entorno, descripciones del contrato (`api/openapi.yaml`), mensajes de commit y títulos de PR.
- **En español:** la conversación con el equipo, la documentación (`*.md`, `docs/`, `TAREAS.md`) y los datos de ejemplo que imitan documentos reales en español (fixtures, textos de prueba).
- El código que ya existe se pasa a inglés por partes: cada dueño traduce sus carpetas cuando le venga bien, sin mezclarlo con otros cambios. Rol A ya lo ha hecho (#8).

## Reglas de trabajo para los agentes
1. Al empezar: `git pull`, lee `AGENTS.md`, `TAREAS.md` (tablero único) y `docs/ESTADO_PROYECTO.md`.
2. Trabaja solo en lo que te haya asignado un humano (el reparto se está redefiniendo). Si necesitas algo de otra parte, pregunta a un humano.
3. Rama: `feature/<id-tarea>-<nombre-corto>`. Usa `scripts/nueva-tarea.sh` para crear la rama y tu carpeta de trabajo.
4. Commits pequeños, con mensaje claro en inglés.
5. Solo escribes en tus carpetas de rol. **No edites `TAREAS.md`**: lo actualiza un humano al fusionar (así se evitan conflictos). Los archivos de estado por agente ya no se usan (historial en `docs/historial/estado/`).
6. Si cambias una interfaz o un contrato entre módulos, anótalo en "Decisiones".
7. No mergees a `main` salvo que una persona del equipo te lo pida expresamente. Abre un PR pequeño con: qué hiciste, qué falta, decisiones tomadas y cómo probarlo.
8. Nunca escribas claves, contraseñas ni datos de cuentas en el repositorio.

## Flujo de integración a `main`
1. El agente termina, hace commit, empuja su rama y abre el PR (pequeño: una tarea o parte de ella).
2. Revisa otra persona, no el autor, en pocos minutos: CI en verde, solo toca carpetas de su rol y la app arranca (probar la rama, o leer el diff si es corto). Gemini puede hacer una primera revisión.
3. Se pulsa **Merge** (preferible *squash and merge*) y se borra la rama.
4. Esa misma persona actualiza el tablero único de `TAREAS.md` y enlaza el PR.
5. Los demás hacen `git pull` en `main` y rebasan sus ramas. Si hay conflicto, lo resuelve el agente de la rama atrasada.
6. Objetivo: fusionar a menudo (cada 30–60 minutos), PRs pequeños y revisiones rápidas.
7. `task check` (go vet, go test y build del front) debe pasar antes de abrir el PR. Usamos [Task](https://taskfile.dev) (`Taskfile.yml`) en vez de `make` porque en Windows no hay `make`; se instala con `go install github.com/go-task/task/v3/cmd/task@latest`.

## Ramas y carpetas: para qué sirve cada cosa
- **Ramas y worktrees** (`scripts/nueva-tarea.sh`): aíslan el trabajo para que dos agentes no se pisen y un fallo no rompa `main`. No ahorran tokens.
- **Carpetas por rol**: evitan conflictos al fusionar y son lo que ahorra tokens, porque cada agente solo lee lo suyo.

## Cómo ahorrar contexto (tokens)
- Mantén este archivo corto. Si crece, mueve el detalle a `docs/` y deja solo el enlace.
- Lee solo lo necesario: `api/` (contrato), tu carpeta de rol y `docs/ESTADO_PROYECTO.md`. No explores el resto del repo.
- Trabaja en tareas pequeñas y empieza una sesión nueva por tarea, en vez de arrastrar una conversación larga.
- Para saber qué hace otro módulo, usa el contrato y el servidor mock, no su código.
- Cada carpeta tiene un `README.md` (en `api/`, `backend/` y `web/`) con su dueño y qué contiene.

## Estructura de carpetas
```
main.go, app.go, wails.json, go.mod   en la raíz (lo exige Wails; rol A)
Taskfile.yml               task gen | mock | server | dev | fmt | check (rol A)
api/                       contrato (rol A): openapi.yaml, fixtures/, gen/ (tipos Go), examples/ (cliente Python)
backend/cmd/mock           servidor mock sin Wails: respuestas fijas, puerto 8080 (A)
backend/cmd/server         servidor real sin Wails: sesión + modelos, puerto 8765 (A)
backend/cmd/llmcheck       prueba rápida del cliente de modelos con la clave real (A)
backend/mock               respuestas de ejemplo (fixtures) (A)
backend/ws                 WebSocket (A)
backend/session            lógica real: una sesión compartida, prompts, respuestas locales (A)
backend/llm                modelos, caché, coste (A)
backend/ocr                comprensión de documentos (B2)
web/src/api                tipos TypeScript generados del contrato (A; no editar types.ts)
web/src/app                app y pantallas comunes (A)
web/src/camera             cámara, recorte y OCR local (B1)
web/src/document           vista del documento (B2)
web/src/input              gestos y voz (C)
scanner/                   captura MX Brio y OCR a PDF en Python (B; reglas en scanner/AGENTS.md)
docs/                      documentación: ESTADO_PROYECTO.md (estado real), PITCH.md, INTEGRACION_SCANNER.md, PROBAR_GESTOS.md, VOZ.md, ARQUITECTURA.md
docs/ideas/                lluvia de ideas (IDEAS.md) y agrupación de duplicados
docs/historial/            estado, tareas y plan por agente anteriores (solo consulta)
adapters/desktop/          Gesture Control: gestos → teclas reales del sistema, puerto 8767 (C)
```
## Cómo probar
1. **Clave (una vez):** crea `.env` en la raíz (está en `.gitignore`; la clave se pasa por chat, nunca por git):
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   LLM_PROFILE=dev
   ```
   `LLM_PROFILE=dev` usa modelos **gratuitos** (0 $; a veces lentos o saturados). Quítalo solo para la demo.
2. **Servidor:**
   - `task server` → lógica real (sesión + modelos) en `127.0.0.1:8765` (`/ws`, `POST /message`, `POST /scan`, `/health`). Sin el servicio de lectura de Didac, arráncalo con `SCANNER_URL=fixture` y `/scan` responderá con el formulario de ejemplo (con `pageCorners`).
   - `task mock` → respuestas fijas en `localhost:8080`, sin clave ni coste.
   - `task dev` → la app de escritorio completa (Wails), con el servidor real dentro si hay clave.
3. **Interfaz en el navegador:** `cd web` y `VITE_WS_URL=ws://127.0.0.1:8765/ws npm run dev` (PowerShell: `$env:VITE_WS_URL="ws://127.0.0.1:8765/ws"; npm run dev`). «Developer tools» → **Send sample document** para probar sin scanner; «Turn on hand gestures» para los gestos (guía paso a paso: `docs/PROBAR_GESTOS.md`).
4. **Scanner (B):** envía tu `document` con `POST /message` → guía `docs/INTEGRACION_SCANNER.md`, ejemplo `python api/examples/send_message.py --demo-ocr`.
5. **App de escritorio (ejecutable):** `wails build` → `build/bin/lauzhack.exe` (doble clic). Busca el `.env` en la carpeta actual, junto al `.exe` y hasta 3 carpetas por encima (la raíz del repo). Log en `build/bin/lauzhack.log`. «Developer tools» enseña qué soporta la ventana (voces en español, dictado, cámara).
6. **Antes del PR:** `task check`.

Puertos: 8765 app/servidor real · 8766 `scanner/capturar.py --servidor` · 8080 mock. Guion de la demo: `docs/PITCH.md`.

**Reglas de estructura (comprobadas, no cambiar sin avisar):**
- Nada de carpetas `internal/`: el `main.go` de la raíz no puede importarlas (Go lo rechaza). Los paquetes van en `backend/<nombre>` y se importan como `<módulo>/backend/<nombre>`.
- El frontend vive en `web/`, con `"frontend:dir": "web"` en `wails.json` y `//go:embed all:web/dist` en `main.go`.
- `backend/cmd/mock` es un `main` aparte para probar sin Wails.
- `web/wailsjs/` lo genera Wails: no se edita a mano.

## Arquitectura
Detalle en `docs/ARQUITECTURA.md`. Resumen:
- El **navegador** (dentro de la app Wails) captura cámara y micro y hace el trabajo barato en local: detección y recorte del documento, OCR local, landmarks de manos, voz.
- **Go** orquesta: WebSocket, sesiones y enrutado frugal entre un modelo barato y uno caro, con caché y contador de coste y latencia.
- **Contrato primero**: `api/openapi.yaml` y el esquema de mensajes del WebSocket son la única interfaz entre módulos. Mensajes previstos: `document`, `pointer`, `utterance`, `speak`.
- **Frugalidad** (criterio de AXA): lo caro solo se llama si lo barato duda, y se muestra el coste.

## Roles y carpetas
Cada persona es dueña de sus carpetas; no se edita código de otro rol sin avisar. *El reparto de esta tabla se redefinirá (ver «Reparto» más abajo).*

| Rol | Persona | Carpetas | Responsabilidad |
|-----|---------|----------|-----------------|
| A. Núcleo e integración | Isaac (P1) | `api/`, `backend/`, `web/src/app/` (salvo `Gestures.tsx`), `main.go`, `app.go`, CI, `docs/` | Contrato, servidor Go y orquestación, lógica de respuestas, modelos frugales, pantalla, empaquetado, revisión de PRs y pitch |
| B1. Cámara en la app | Pau (P4) | `web/src/camera/`, `scanner/capturar.py` | Abrir la cámara (la Logitech si está), sacar la foto más nítida, avisos de calidad en directo |
| B2. Lectura de documentos | Didac (P2) | `scanner/` (pipeline y servicio), `web/src/document/` | Foto → hoja, orientación, OCR, `document` con esquinas; servicio local para la app |
| C. Interacción | Nil (P3) | `web/src/input/`, `web/src/app/Gestures.tsx`, `adapters/desktop/` | Gestos, voz (dictado y lectura), orden «lee el documento», puntero sobre el papel real |

Si necesitas algo de otro carril, pídelo mediante el **contrato** (`api/openapi.yaml`): lo cambia el rol A primero, en un PR pequeño, y luego cada uno lo implementa en lo suyo.

## Plan actual: una cámara que hace gestos y, con una orden, lee documentos
Decidido por Isaac el 2026-11-21. La app abre **una sola cámara** (la que haya; la Logitech si está) y la deja en **modo gestos**. Con la orden **«lee el documento»** (botón, frase o gesto):
1. La app avisa «sujeta el papel quieto» y saca la **foto más nítida** de esa misma cámara (B1).
2. La envía a Go con `POST /scan` (A).
3. Go la pasa al **servicio de lectura** de Didac, `POST http://127.0.0.1:8770/scan` (B2), que devuelve el `document` con las **esquinas de la hoja** en esa foto.
4. Go lo guarda, lo envía a la pantalla y lo explica en voz alta (A).
5. El puntero usa esas esquinas: señalar con el dedo apunta a los campos del **papel real** (C).

### Interfaces entre carriles (así se trabaja en paralelo, cada uno con un falso de los demás)
| Interfaz | Forma | La implementa | La usa |
|---|---|---|---|
| `document.pageCorners` (contrato 0.5, opcional) | 4 puntos normalizados [0, 1] sobre la foto: arriba-izq, arriba-der, abajo-der, abajo-izq | B2 | C (puntero), A (pantalla) |
| `POST /scan` en Go (8765) | cuerpo: la foto (`image/jpeg` o `image/png`) → `202`; el resultado llega por WebSocket (`document` + `speak` + `stats`) | A | la app |
| `POST /scan` del servicio de lectura (8770) | cuerpo: la foto → `200` con un `DocumentPayload` (con `pageCorners`) o `422 {"error": "..."}` si no hay hoja | B2 | Go (A) |
| `web/src/camera`: `openCamera(): Promise<MediaStream>` y `captureStill(video): Promise<Blob>` | la Logitech por nombre si está; la foto más nítida de ~0,5 s | B1 | la app (A), gestos (C) |
| Acción `scan_document` | la emite el módulo de gestos y voz (frase «lee el documento» y un gesto u opción del menú) | C | la app (A) |

Puertos: 8765 app · 8766 captura de Pau (pruebas) · 8767 Gesture Control (Nil) · 8770 servicio de lectura (Didac) · 8780 app de prueba de Didac · 8080 mock.

### Reparto
El reparto por persona y las tareas T1–T19 se cerraron con la integración del 2026-11-21 (rama `integration/proyecto-unificado`). **El reparto se redefinirá** después de la lluvia de ideas (`docs/ideas/`). El plan por persona anterior está íntegro en `docs/historial/plan_por_agente.md` y el estado real de cada pieza, en `docs/ESTADO_PROYECTO.md`.

## Decisiones
- 2026-11-21 — **Proyecto unificado:** todas las ramas integradas en `integration/proyecto-unificado` (merges normales, ver `docs/ESTADO_PROYECTO.md`); las tareas por agente se disuelven: `TAREAS.md` pasa a ser un tablero único sin responsables y el estado y el plan por agente se guardan en `docs/historial/`. El reparto se redefinirá tras la lluvia de ideas (`docs/ideas/`).
- 2026-11-21 — **API local protegida** (`ws.Guard`): solo responde a `Host` 127.0.0.1 o localhost (sin DNS rebinding) y a los orígenes de la app (Vite, Wails), con CORS para ellos; `POST /message` solo acepta JSON. Los procesos locales (el scanner) no mandan `Origin` y siguen funcionando. Sin esto, cualquier web abierta podía enviarnos documentos o preguntas y gastar IA.
- 2026-11-21 — **Respaldo de voz hecho (T18):** `POST /transcribe` (WAV → texto, contrato 0.6) con Gemini 2.5 Flash Lite y un respaldo gratuito; `transcribeRemote()` en `web/src/app/transcribe.ts` para el rol C.
- 2026-11-21 — **Contrato 0.5:** `document.pageCorners` (esquinas de la hoja en la foto: arriba-izq, arriba-der, abajo-der, abajo-izq de la hoja tal como se lee) y `POST /scan` (la app envía la foto; Go la pasa al servicio de lectura en `SCANNER_URL`, por defecto `127.0.0.1:8770/scan`, y dice en voz alta lo que pasa). `SCANNER_URL=fixture` permite probarlo todo sin el servicio.
- 2026-11-21 — **Voz:** reconocimiento local con `whisper-small` (T17, Nil) y respaldo en la nube con `POST /transcribe` en Go y `google/gemini-2.5-flash-lite` (T18, Isaac), solo si el local falla. Medido: `whisper-tiny` falla, `whisper-small` acierta en 1,1 s; Gemini acierta en 2,3 s por 0,00006 $ (`docs/VOZ.md`).
- 2026-11-21 — **Carpetas aceptadas:** `adapters/desktop/` (Gesture Control de Nil, programa Go aparte, puerto 8767) y `scanner/` (rol B, Python). `scanner/demo_app/` es una herramienta de prueba de Didac, no parte del producto.
- 2026-11-21 — **Qué dispara el escaneo:** la orden «lee el documento» por **botón** (plan B de la demo), **frase** y **gesto** (acción `scan_document`).
- 2026-11-21 — **Cámara: se usa la que haya.** En desarrollo, la webcam del portátil; si hay una cámara Logitech conectada (MX Brio), se usa esa, porque es la del reto de Logitech (decisión de Isaac). Consecuencias pendientes: (1) con **una sola cámara**, el scanner (Python) y los gestos (navegador) no pueden abrirla a la vez: hay que decidir cuál la abre; (2) `scanner/capturar.py` hoy falla si no encuentra la Brio: debe usar la cámara disponible si no está (rol B); (3) la interfaz elegirá la Logitech por nombre si está conectada (rol A).
- 2026-11-21 — Go reenvía a todos los clientes WebSocket cada `document` que acepta (contrato 0.4.0, `ServerMessage` incluye `document`): la pantalla muestra y resalta el documento aunque lo haya enviado el scanner. Los documentos con mal encuadre no se reenvían. Vista mínima en `web/src/app/DocumentText.tsx`; B2 puede sustituirla en `web/src/document`.
- 2026-11-21 — Una sola sesión compartida por toda la app (`ws.Hub`): los mensajes de cualquier cliente (interfaz por WebSocket, scanner por `POST /message`) actualizan el mismo estado y cada `speak`/`stats` se envía a todos los clientes WebSocket — es una app de escritorio para una persona; sin esto, la explicación del documento del scanner volvía al scanner y no a la pantalla.
- 2026-11-21 — Código, comentarios, commits y títulos de PR en inglés; conversación y documentación en español (sección «Idioma») — lo pide el equipo. Los commits ya en `main` no se reescriben. En el contrato, los niveles de `stats` pasan de `barato`/`caro` a `cheap`/`expensive` (aún no los usaba nadie más).
- 2026-11-21 — El scanner de B (Python, `scanner/`) se conecta a Go enviando mensajes `document` a `ws://127.0.0.1:8765/ws` (los bloques con caja y confianza salen de Tesseract) y recibe `speak` y `stats` — el contrato no cambia y B sigue aislado en su carpeta. Acordado por Isaac, Didac y Pau.
- 2026-11-21 — Presupuesto de IA: 10 € para todo el equipo. Mientras se desarrolla, `LLM_PROFILE=dev` (modelos gratuitos con visión primero y Haiku como último recurso); el perfil por defecto (Haiku + Sonnet) es para la demo. Clave en `.env` (ignorado por git) o en el entorno — que no se acabe el presupuesto antes de la demo.
- 2026-11-21 — Mensaje `stats` (Go → navegador) con el coste y la latencia de los modelos, enviado tras cada llamada; su payload es el JSON de `llm.Meter.Snapshot()` (hay un test que lo garantiza). Cambio solo aditivo: no afecta a los mensajes existentes — enseñar el coste en pantalla es lo que pide AXA.
- 2026-11-21 — La app Wails sirve el contrato en `127.0.0.1:8765` (`/health` y `/ws`; se cambia con `LAUZHACK_ADDR` y, si el puerto está ocupado, usa uno libre). El frontend pide la URL a Go con el binding `WsURL()`. Puerto fijo para que un proceso local (por ejemplo, el scanner en Python) pueda enviar `document` sin pasar por el navegador. Solo escucha en 127.0.0.1.
- 2026-11-21 — Modelos vía `backend/llm`: nivel `cheap` `anthropic/claude-haiku-5.5` y `expensive` `anthropic/claude-sonnet-5.5` (ambos con visión; configurables con `LLM_CHEAP_MODEL` y `LLM_EXPENSIVE_MODEL`), clave en `OPENROUTER_API_KEY`. El paquete pone el mecanismo (caché, contador, `CompleteWithEscalation`) y B2 decide cuándo escalar con su función de duda — el criterio de frugalidad de AXA queda en un solo sitio y se puede medir.
- 2026-11-21 — Mensajes del WebSocket: sobre común `{type, id, ts, payload}` (`ts` en ms desde epoch; coordenadas normalizadas a [0, 1] sobre el documento recortado). El navegador envía `document`, `pointer` y `utterance`; Go responde con `speak` (con `replyTo` = `id` del mensaje que contesta). Esquemas en `api/openapi.yaml`, ejemplos en `api/fixtures/` — un contrato único que comparten Go y TS.
- 2026-11-21 — Tipos generados, nunca a mano: Go en `api/gen` (paquete `gen`, oapi-codegen como `go tool`) y TypeScript en `web/src/api/types.ts` (openapi-typescript, alias en `web/src/api/index.ts`). Se regeneran con `task gen` — así Go y TS no se desincronizan.
- 2026-11-21 — `Taskfile.yml` en lugar de `Makefile`; módulo Go `github.com/IsaacIbanez/hackathon`, Go ≥ 1.26 — en Windows no hay `make`; las dependencias (oapi-codegen) piden Go 1.26.
- 2026-11-21 — Estructura definitiva: Wails en la raíz, frontend en `web/`, paquetes Go en `backend/<nombre>` sin `internal/`, mock en `backend/cmd/mock` — comprobado: Go rechaza importar `internal/` desde la raíz, y Wails acepta `frontend:dir` y paquetes propios (prueba de Isaac en Windows, Wails v2.17.1).
- 2026-11-21 — Un agente principal (Claude) por persona y Gemini de apoyo o revisión; los agentes no editan `TAREAS.md` — menos conflictos y más control con cuatro personas.
- 2026-11-21 — PRs pequeños, revisados por otra persona y fusionados cada 30–60 minutos — el proceso no debe frenar el desarrollo.
- 2026-11-21 — Monorepo único con Go + frontend web dentro de una app de escritorio — queda todo en un sitio y los agentes se coordinan por archivos.
- 2026-11-21 — Contrato (OpenAPI y mensajes WebSocket) antes que el código — permite trabajar en paralelo con mocks.
- 2026-11-21 — Visión, gestos y voz en el navegador, Go solo orquesta — es local, barato y encaja con la frugalidad de AXA.
- 2026-11-21 — Wails como envoltura de escritorio, con prueba de cámara en todos los SO en la primera hora — plan B: Electron.
- 2026-11-21 — Hápticos y keypad de Logitech aparcados; solo se mira el SDK de la cámara — foco en el bucle de cámara.
- 2026-11-21 — Si el SDK de Logitech exige Python o C#, va como adaptador aparte en `adapters/logitech/` que habla con la app por WebSocket o HTTP local — aísla el lenguaje del SDK.
