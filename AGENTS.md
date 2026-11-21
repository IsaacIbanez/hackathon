# AGENTS.md — Contexto del proyecto de hackathon

Este archivo lo leen todos los agentes (Claude Code, Gemini CLI) al empezar. Es la fuente de verdad del proyecto.

## Proyecto
- **Nombre:** (por definir)
- **Evento:** LauzHack 2026. Duración total: 24 horas.
- **Objetivo:** app de escritorio que usa la cámara (webcam Logitech), el micro y gestos para leer y entender documentos en papel, y ayudar a rellenarlos. Combina tres challenges: Logitech (la webcam como "ojos y oídos" de la IA, flujos con contexto), IMC Tech for Good (inclusión y accesibilidad) y AXA (uso frugal de IA multimodal).
- **Historia de la demo:** una persona con baja visión sostiene un documento (carta o formulario de seguros) delante de la cámara; la app lo lee, lo explica en lenguaje sencillo y la ayuda a rellenarlo por voz o señalando con la mano.
- **Stack previsto:** Go (backend y orquestación, IDE GoLand), Wails para la app de escritorio, interfaz en React + Vite + TypeScript + Tailwind, MediaPipe y Web Speech API en el navegador, modelos vía OpenRouter (AXA da una clave de 10 USD por equipo). Wails está pendiente de confirmar con la prueba de cámara (T3); plan B: Electron con Go como proceso aparte.
- **Reglas de la hackathon, incluido el uso de IA:** (por confirmar)

## Orden de prioridades
1. Primero el bucle de cámara funcionando de punta a punta.
2. Después gestos y voz.
3. Accesibilidad como capa final, pero con lo barato desde el principio (HTML semántico, texto grande, salida por voz).
4. Fuera de alcance por ahora: ratón háptico (MX Master 4) y keypad de Logitech.

## Equipo
Cuatro personas, cada una con una cuenta de Claude Pro y una de Gemini Plus (ver `ROSTER.md`). Cada persona es responsable de su propio agente Claude y de su agente Gemini.

## Roles
- **Humanos:** dan directrices, priorizan, revisan y aprueban merges.
- **Agentes:** ejecutan la tarea asignada en `TAREAS.md`, documentan su estado en `estado/` y abren un PR.

## Reglas de trabajo para los agentes
1. Al empezar: `git pull`, lee `AGENTS.md`, `TAREAS.md` y tu archivo en `estado/`.
2. Trabaja solo en la tarea asignada a tu slot. Si necesitas algo de otra tarea, anótalo en tu estado y pregunta a un humano.
3. Rama: `feature/<id-tarea>-<nombre-corto>`. Usa `scripts/nueva-tarea.sh` para crear la rama y tu carpeta de trabajo.
4. Commits pequeños, con mensaje claro en español.
5. Solo escribes en tu archivo de `estado/` y en la fila de tu tarea en `TAREAS.md`.
6. Si cambias una interfaz o un contrato entre módulos, anótalo en "Decisiones".
7. No mergees a `main`. Abre un PR con: qué hiciste, qué falta, decisiones tomadas y cómo probarlo.
8. Nunca escribas claves, contraseñas ni datos de cuentas en el repositorio.

## Arquitectura
Detalle en `docs/ARQUITECTURA.md`. Resumen:
- El **navegador** (dentro de la app Wails) captura cámara y micro y hace el trabajo barato en local: detección y recorte del documento, OCR local, landmarks de manos, voz.
- **Go** orquesta: WebSocket, sesiones y enrutado frugal entre un modelo barato y uno caro, con caché y contador de coste y latencia.
- **Contrato primero**: `api/openapi.yaml` y el esquema de mensajes del WebSocket son la única interfaz entre módulos. Mensajes previstos: `document`, `pointer`, `utterance`, `speak`.
- **Frugalidad** (criterio de AXA): lo caro solo se llama si lo barato duda, y se muestra el coste.

## Roles y carpetas
Cada persona es dueña de sus carpetas; no se edita código de otro rol sin avisar.

| Rol | Carpetas | Responsabilidad |
|-----|----------|-----------------|
| A. Núcleo e integración | `backend/cmd`, `backend/internal/{ws,session,llm}`, `api/`, CI, empaquetado Wails | Contrato, servidor Go, cliente de modelos frugal, contador, integración y pitch |
| B1. Captura y visión | `web/src/camera` | Flujo de cámara, detección y recorte del papel, calidad de imagen, OCR local |
| B2. Comprensión de documentos | `backend/internal/ocr`, `web/src/document` | Texto a campos y significado, decidir cuándo escalar al modelo caro, vista del documento |
| C. Interacción | `web/src/input` | Gestos de mano y voz |

B1 y B2 acuerdan en la primera hora el mensaje `document` (bloques de texto con caja en la imagen y confianza).
La asignación de personas a roles se anota en `ROSTER.md`.


## Decisiones
- 2026-11-21 — Monorepo único con Go + frontend web dentro de una app de escritorio — queda todo en un sitio y los agentes se coordinan por archivos.
- 2026-11-21 — Contrato (OpenAPI y mensajes WebSocket) antes que el código — permite trabajar en paralelo con mocks.
- 2026-11-21 — Visión, gestos y voz en el navegador, Go solo orquesta — es local, barato y encaja con la frugalidad de AXA.
- 2026-11-21 — Wails como envoltura de escritorio, con prueba de cámara en todos los SO en la primera hora — plan B: Electron.
- 2026-11-21 — Hápticos y keypad de Logitech aparcados; solo se mira el SDK de la cámara — foco en el bucle de cámara.
- 2026-11-21 — Si el SDK de Logitech exige Python o C#, va como adaptador aparte en `adapters/logitech/` que habla con la app por WebSocket o HTTP local — aísla el lenguaje del SDK.
