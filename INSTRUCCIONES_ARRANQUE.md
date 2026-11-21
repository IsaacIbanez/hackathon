# Instrucciones de arranque

## 1. Antes de la hackathon (ya)
1. Clona el repositorio.
2. Crea tu archivo de estado copiando `estado/_PLANTILLA.md` a `estado/<TU-AGENTE>.md` (por ejemplo `P1-C.md` o `P1-G.md`).
3. Inicia sesión en tu cuenta de Claude Pro y en tu cuenta de Gemini Plus, y comprueba que Claude Code y Gemini CLI funcionan en la carpeta del repositorio.

## 2. Al empezar la hackathon
1. `git pull` en `main`.
2. Lee `AGENTS.md`, `TAREAS.md` y tu archivo en `estado/`.
3. Crea tu carpeta de trabajo para la tarea asignada:
   ```
   scripts/nueva-tarea.sh <TU-AGENTE> <ID-TAREA> <nombre-corto>
   ```
4. Entra en esa carpeta y lanza tu agente.

## 3. Texto para pegar en el agente

### Claude Code (agentes -C)
```
Lee AGENTS.md, TAREAS.md y estado/<AGENTE>.md. Eres el agente <AGENTE> y tu tarea es <ID-TAREA>.
Trabaja solo en esa tarea, en la rama que ya está creada. Actualiza estado/<AGENTE>.md
al avanzar. No edites TAREAS.md. Si necesitas algo de otra tarea o tienes dudas,
anótalo en estado/<AGENTE>.md en "Bloqueos y preguntas para humanos" y pregunta.
Al terminar: haz commit, deja la rama lista y propón el texto del Pull Request.
```

### Gemini CLI (agentes -G)
```
Lee AGENTS.md, TAREAS.md y estado/<AGENTE>.md. Eres el agente <AGENTE> y tu tarea es <ID-TAREA>.
Trabaja solo en esa tarea, en la rama que ya está creada. Actualiza estado/<AGENTE>.md
al avanzar. No edites TAREAS.md. Si necesitas algo de otra tarea o tienes dudas,
anótalo en estado/<AGENTE>.md en "Bloqueos y preguntas para humanos" y pregunta.
Al terminar: haz commit, deja la rama lista y propón el texto del Pull Request.
```

## 4. Cómo coordinar a los agentes
- Los agentes no se hablan entre sí: se coordinan leyendo `estado/` y `TAREAS.md`.
- Una persona revisa periódicamente `estado/` y reasigna tareas si hace falta.
- Cuando una tarea depende de otra, el agente dependiente espera a que la fila de la dependencia esté en `hecha`, salvo lo que permite `TAREAS.md` (mock del contrato y prototipos aislados).
- Cada persona lanza un agente principal (Claude). Gemini se usa para una tarea paralela pequeña o para revisar PRs.
- Flujo de revisión y merge: ver "Flujo de integración a `main`" en `AGENTS.md`.

## 5. Instalacion rapida (Windows)
```
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```
Instala Git, Node, Claude Code y Gemini CLI, y clona el repositorio. Despues, `claude` y `gemini` piden iniciar sesion con tu cuenta.
Para ver el estado de todos: `bash scripts/ver-estado.sh`.
