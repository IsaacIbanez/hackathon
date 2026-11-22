# Cómo trabajar en el repo (y qué trampas evitar)

## Ciclo de un arreglo o una tarea
1. `git pull` en `main` y rama `feature/<ID>-<nombre>` (mejor en un worktree: `scripts/nueva-tarea.sh`).
2. Lee la ficha (`docs/arreglos/` o `docs/tareas/`). La ficha de un arreglo es su brief; una tarea N necesita un brief confirmado por tu persona (`docs/briefs/<ID>.md`, plantilla en `docs/briefs/README.md`).
3. **Reproduce el fallo con el `.exe` real** antes de arreglarlo (abajo).
4. Un fallo = un commit, con su línea en el «Registro» de la ficha: síntoma → cómo reproducirlo → causa → arreglo → cómo se ha comprobado.
5. `task check` en verde (go vet, go test, lint, tests y build del front).
6. PR pequeño (qué, qué falta, decisiones, cómo probarlo). Otra persona lo prueba con su `.exe`; se fusiona con el CI en verde. A `main` directo, solo si una persona lo pide.
7. Si cierras algo que cambia el estado general, actualiza la línea en `docs/ESTADO.md`.

## Compilar y probar la app
- **Una vez por equipo:** Go ≥ 1.26, `go install github.com/go-task/task/v3/cmd/task@latest`, Wails v2, Node; después **`task setup`** (el escáner con su Python, Tesseract y los idiomas, y las dependencias web).
- **Compilar:** `task overlay` → `build/bin/lauzhack.exe` (lee el `.env` de la raíz; log en `build/bin/lauzhack.log`). El log y el pie del menú dicen qué versión es (`version: <commit> (built …)`; un «+» = compilado con cambios sin commit).
- **Antes de abrirlo, cierra cualquier otra copia** de la app y de `gesture-control.exe`: con dos abiertas no sabes cuál estás probando.
- **Sin ventana:** `task server` (lógica real en 8765) o `task mock` (respuestas fijas en 8080, sin coste).
- **Pruebas de humo:** `docs/COMO_PROBAR.md`.

## Trampas conocidas (Windows)
- **`npm ci` falla con `EPERM` y deja `web/node_modules` casi vacío** si hay un `node` en marcha (un `npm run dev`, Vite) que bloquea un archivo. Cierra los `npm run dev` antes de `task check`; si ya pasó, `npm install` en `web/` lo recupera.
- **La cámara da imágenes negras** si otro programa la usa (la app Cámara de Windows, una pestaña del navegador, el overlay): ciérralo. La MX Brio solo la puede usar un programa a la vez.
- **Smart App Control** de Windows bloquea `go.exe` y todo lo que compila («Una directiva de Control de aplicaciones bloqueó este archivo»): hay que desactivarlo en Seguridad de Windows.
- **Saltos de línea:** muchos archivos están en CRLF. Al editar con scripts, conserva el formato del archivo; `git diff` con solo cambios de CRLF no es un cambio real.
- **`gh`** (GitHub CLI) hace falta para ver el CI y los PR: `winget install GitHub.cli` y `gh auth login`.
- **Claves:** `.env` en la raíz (`OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `LLM_PROFILE=dev`). Nunca en el repo ni en el chat de otra herramienta.

## Ahorro de tokens
- Una sesión por tarea; al acabar, deja lo pendiente en la ficha y `/clear`.
- Lee solo tu ficha, `docs/ESTADO.md` y lo que enlacen. Busca con `grep` y lee rangos; no abras enteros los archivos grandes (`docs/OVERLAY.md`, `web/src/input/interaction.ts`, `app_overlay.go`).
- Filtra la salida: `task check 2>&1 | grep -E "ℹ fail|FAIL|error"`, `… | tail -20`, `gh … --jq`. Nunca vuelques logs ni diffs enteros.
- Sin subagentes ni búsquedas por todo el repo, salvo que tu persona lo pida. Sonnet por defecto; Opus para diseño o depuración difícil.
