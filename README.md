# Hackathon — repositorio de trabajo conjunto

Este repositorio es el único punto de coordinación entre personas y agentes de IA. Los agentes no se hablan entre sí directamente: se coordinan leyendo y escribiendo aquí.

## Equipo
Cuatro personas, cada una con un agente de Claude (Pro) y uno de Gemini (Plus): 8 agentes en total.

## Por dónde empezar
1. Lee `AGENTS.md` (reglas y contexto del proyecto).
2. Mira `ROSTER.md` para saber qué agente te corresponde.
3. Mira `TAREAS.md` para elegir o recibir una tarea.
4. Usa `INSTRUCCIONES_ARRANQUE.md` para lanzar tu agente.

## Estructura
- `AGENTS.md` — contexto, reglas y decisiones del proyecto. Lo lee todo agente al empezar.
- `ROSTER.md` — personas y agentes (P1-C/P1-G, …, P4-C/P4-G).
- `TAREAS.md` — tablero de tareas, dependencias y responsables.
- `estado/` — un archivo por agente con su estado actual. Cada agente escribe solo en el suyo.
- `scripts/nueva-tarea.sh` — crea la rama y la carpeta de trabajo (worktree) de un agente.
- `INSTRUCCIONES_ARRANQUE.md` — textos listos para pegar en Claude Code o Gemini CLI.

## Flujo
- Una tarea = una rama = un Pull Request.
- Cada agente trabaja en su propia carpeta de trabajo (worktree) para no pisar a los demás.
- Nadie mergea a `main` sin revisión de una persona que no sea la autora. PRs pequeños, fusionados cada 30–60 minutos.
- Antes de cada sesión, `git pull`. Al terminar, `git push` y PR.

## Reglas de oro
- Los agentes no tocan `estado/` de otro agente.
- Los cambios de contrato entre módulos se anotan en `docs/DECISIONES.md`.
- Los agentes no editan `TAREAS.md`; lo actualiza quien fusiona el PR.
- Las credenciales de las cuentas nunca van al repositorio.
