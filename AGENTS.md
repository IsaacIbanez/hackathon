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
- **Agentes:** ejecutan la tarea asignada en `TAREAS.md`, documentan su estado en `estado/` y abren un PR.

## Reglas de trabajo para los agentes
1. Al empezar: `git pull`, lee `AGENTS.md`, `TAREAS.md` y tu archivo en `estado/`.
2. Trabaja solo en la tarea asignada a tu slot. Si necesitas algo de otra tarea, anótalo en tu estado y pregunta a un humano.
3. Rama: `feature/<id-tarea>-<nombre-corto>`. Usa `scripts/nueva-tarea.sh` para crear la rama y tu carpeta de trabajo.
4. Commits pequeños, con mensaje claro en español.
5. Solo escribes en tu archivo de `estado/` y en tus carpetas de rol. **No edites `TAREAS.md`**: lo actualiza un humano al fusionar (así se evitan conflictos).
6. Si cambias una interfaz o un contrato entre módulos, anótalo en "Decisiones".
7. No mergees a `main` salvo que una persona del equipo te lo pida expresamente. Abre un PR pequeño con: qué hiciste, qué falta, decisiones tomadas y cómo probarlo.
8. Nunca escribas claves, contraseñas ni datos de cuentas en el repositorio.

## Flujo de integración a `main`
1. El agente termina, hace commit, empuja su rama y abre el PR (pequeño: una tarea o parte de ella).
2. Revisa otra persona, no el autor, en pocos minutos: CI en verde, solo toca carpetas de su rol y la app arranca (probar la rama, o leer el diff si es corto). Gemini puede hacer una primera revisión.
3. Se pulsa **Merge** (preferible *squash and merge*) y se borra la rama.
4. Esa misma persona marca la tarea en `TAREAS.md` (`hecha`) y enlaza el PR.
5. Los demás hacen `git pull` en `main` y rebasan sus ramas. Si hay conflicto, lo resuelve el agente de la rama atrasada.
6. Objetivo: fusionar a menudo (cada 30–60 minutos), PRs pequeños y revisiones rápidas.
7. `task check` (go vet, go test y build del front) debe pasar antes de abrir el PR. Usamos [Task](https://taskfile.dev) (`Taskfile.yml`) en vez de `make` porque en Windows no hay `make`; se instala con `go install github.com/go-task/task/v3/cmd/task@latest`.

## Ramas y carpetas: para qué sirve cada cosa
- **Ramas y worktrees** (`scripts/nueva-tarea.sh`): aíslan el trabajo para que dos agentes no se pisen y un fallo no rompa `main`. No ahorran tokens.
- **Carpetas por rol**: evitan conflictos al fusionar y son lo que ahorra tokens, porque cada agente solo lee lo suyo.

## Cómo ahorrar contexto (tokens)
- Mantén este archivo corto. Si crece, mueve el detalle a `docs/` y deja solo el enlace.
- Lee solo lo necesario: `api/` (contrato), tu carpeta de rol y tu archivo de `estado/`. No explores el resto del repo.
- Trabaja en tareas pequeñas y empieza una sesión nueva por tarea, en vez de arrastrar una conversación larga.
- Para saber qué hace otro módulo, usa el contrato y el servidor mock, no su código.
- Cada carpeta tiene un `README.md` (en `api/`, `backend/` y `web/`) con su dueño y qué contiene.

## Estructura de carpetas
```
main.go, app.go, wails.json, go.mod   en la raíz (lo exige Wails; rol A)
Taskfile.yml               task gen | task mock | task check (rol A)
api/                       contrato (rol A): openapi.yaml, fixtures/, gen/ (tipos Go generados)
backend/cmd/mock           servidor mock sin Wails (A)
backend/ws                 WebSocket (A)
backend/session            sesiones (A)
backend/llm                modelos, caché, coste (A)
backend/ocr                comprensión de documentos (B2)
web/src/api                tipos TypeScript generados del contrato (A; no editar types.ts)
web/src/app                app y pantallas comunes (A)
web/src/camera             cámara, recorte y OCR local (B1)
web/src/document           vista del documento (B2)
web/src/input              gestos y voz (C)
docs/                      documentación
```
Para trabajar contra el contrato sin Wails: `task mock` (servidor en `localhost:8080`, WebSocket en `/ws`, ver `api/README.md`).

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
Cada persona es dueña de sus carpetas; no se edita código de otro rol sin avisar.

| Rol | Persona | Carpetas | Responsabilidad |
|-----|---------|----------|-----------------|
| A. Núcleo e integración | Isaac (P1) | `backend/cmd`, `backend/{ws,session,llm}`, `api/`, CI, empaquetado Wails | Contrato, servidor Go, cliente de modelos frugal, contador, integración y pitch |
| B1. Captura y visión | Didac (P2) o Pau (P4) | `web/src/camera` | Flujo de cámara, detección y recorte del papel, calidad de imagen, OCR local |
| B2. Comprensión de documentos | Pau (P4) o Didac (P2) | `backend/ocr`, `web/src/document` | Texto a campos y significado, decidir cuándo escalar al modelo caro, vista del documento |
| C. Interacción | Nil (P3) | `web/src/input` | Gestos de mano y voz |

B1 y B2 acuerdan en la primera hora el mensaje `document` (bloques de texto con caja en la imagen y confianza).
Didac y Pau se reparten B1 y B2 entre ellos (por decidir). La asignación completa está en `ROSTER.md`.


## Decisiones
- 2026-11-21 — Modelos vía `backend/llm`: nivel barato `anthropic/claude-haiku-5.5` y caro `anthropic/claude-sonnet-5.5` (ambos con visión; configurables con `LLM_MODELO_BARATO` y `LLM_MODELO_CARO`), clave en `OPENROUTER_API_KEY`. El paquete pone el mecanismo (caché, contador, `CompleteEscalando`) y B2 decide cuándo escalar con su función de duda — el criterio de frugalidad de AXA queda en un solo sitio y se puede medir.
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
