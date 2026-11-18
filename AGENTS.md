# AGENTS.md — Contexto del proyecto de hackathon

Este archivo lo leen todos los agentes (Claude Code, Gemini CLI) al empezar. Es la fuente de verdad del proyecto.

## Proyecto (pendiente de definir)
- **Nombre:** (por definir)
- **Objetivo:** (por definir)
- **Fecha de inicio y de entrega:** (por definir)
- **Stack:** (por definir)
- **Reglas de la hackathon, incluido el uso de IA:** (por definir)

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

## Arquitectura (pendiente)

## Decisiones
- (fecha) — decisión — motivo
