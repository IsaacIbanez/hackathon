# AGENTS.md — Empieza aquí

Lo cargan todos los agentes (Claude Code, Gemini CLI) **en cada petición**: es corto a propósito. Versiones largas anteriores: `docs/historial/`.

## Qué es
**LauzHack 2026.** App de escritorio para personas con baja visión que lee y explica documentos (papel con la cámara, o archivos), con gestos, voz y el MX Keypad de Logitech. Retos: Logitech, IMC (accesibilidad) y AXA (IA frugal). Es un **overlay** a pantalla completa (Go + Wails, React en `web/`, Python en `scanner/`).

## Dónde estamos
**Fase de arreglos (R1–R4):** dejar la app sólida para la demo antes de añadir nada. Qué funciona, qué falla y qué viene después: **`docs/ESTADO.md`**. Tablero: `TAREAS.md`.

## Qué leer (solo lo que necesites)
| Vas a… | Lee |
|---|---|
| Situarte | `docs/ESTADO.md` (estado y siguiente paso) |
| Coger un arreglo o una tarea | su ficha: `docs/arreglos/R<n>.md` o `docs/tareas/N<n>.md`, y su brief si existe (`docs/briefs/`) |
| Saber dónde está algo o de quién es | `docs/MAPA.md` (carpetas, dueños, puertos, puntos de entrada) |
| Trabajar: rama, checks, `.exe`, PR, trampas de Windows | `docs/TRABAJAR.md` |
| Probar la app | `docs/COMO_PROBAR.md` |
| Tocar pantallas | `docs/DISENO.md` (Halo) y `docs/OVERLAY.md` (busca la sección, es largo) |
| Tocar el keypad / el contrato | `docs/KEYPAD.md` / `api/openapi.yaml` |
| Saber por qué se decidió algo | `docs/DECISIONES.md` (archivo: solo si hace falta) |

**No leas** `docs/historial/` salvo que te lo pidan.

## Reglas
1. `git pull` al empezar. Trabaja solo en tu ficha; si necesitas otra cosa, pregunta a tu persona.
2. **No toques carpetas de otra persona** (dueños en `docs/MAPA.md`): apúntalo en su ficha y avísala.
3. **Sin brief o ficha confirmados, no hay código.** Preguntas a tu persona en tandas de 3–5, con opciones y la recomendada primero.
4. Rama `feature/<ID>-<nombre>`; un arreglo = un commit, con su línea en el «Registro» de la ficha.
5. **Antes de subir:** `task check` en verde y, si toca la app, probado con el `.exe` real (`docs/TRABAJAR.md`).
6. A `main` solo con PR revisado y CI en verde, **o si una persona lo pide expresamente**.
7. El contrato (`api/`) cambia en un PR aparte; después, `task gen`.
8. **Nunca** claves ni contraseñas en el repo: van en `.env` (ignorado).
9. Si cambias una interfaz entre módulos: una entrada en `docs/DECISIONES.md` y, si afecta al día a día, una línea en `docs/ESTADO.md`.
10. Gasta pocos tokens: lee rangos (`grep`, `sed -n`), filtra la salida de los comandos, sin subagentes, una sesión por tarea (`/clear`).

## Idioma
Código, comentarios, logs, tests, textos de la interfaz, commits y títulos de PR, **en inglés**. Conversación con el equipo y documentación (`*.md`), **en español**.
