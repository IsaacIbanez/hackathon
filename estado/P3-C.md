# Estado — P3-C

- **Persona:** Nil
- **Herramienta:** Gemini CLI (relevo de Claude Code)
- **Tarea actual:** T6 (rol C): controles de cámara y escritorio en Gesture Control (menú con puño, ratón completo, brillo, micro, energía y lanzador de apps).
- **Rama:** `feature/T6-camera-controls` (sale de `feature/T17-voice` #29).
- **Estado:** lista para PR (PR #41 abierto y actualizado).
- **Último cambio:** 2026-11-21

## Hecho
- **Módulo compartido de gestos (`web/src/input/`):**
  - **Menú con el puño (✊):** abrir y cerrar menú con ✊ mantenido 500 ms y quieto. Soltar el puño para cerrarlo con un nuevo ✊ mantenido.
  - **Gestos para tirar atrás (`back`):** pulgar abajo 👎 mantenido ~0,3 s o barrido lateral ✋← para volver a la página anterior del menú o cerrarlo.
  - **Eliminación del gesto de victoria (✌️):** se elimina para evitar conflictos con el gesto de clic; índice y corazón arriba ahora cuentan como apuntar (`point`).
  - **Control del ratón:** apuntando con el índice ☝️, juntar corazón y pulgar hace clic; dos toques rápidos hacen clic derecho; mantener juntos > 300 ms inicia arrastre (`down`) y separar suelta (`up`). Se congela el cursor durante el toque y se desactiva la selección por permanencia (`select`).
  - **Control de brillo:** objetivo de nivel (`LevelTarget = "brightness"`) paralelo al volumen por pinza (🤏), con mínimo del 5 % para evitar pantalla negra.
  - **Rejilla 3×3 y submenús:** celdas configurables con `setMenuCells`; bloqueo temporal de la celda elegida (`blocked`) para evitar pulsaciones accidentales al cambiar de página.
  - **Menú simplificado cuando no hacen falta 4 opciones:** la página de confirmación de energía pasa de 4 opciones redundantes a 2 opciones limpias (↑ ↩ Back y ↓ ✔ Yes, <action>).
  - **Despertar estricto (`requireWake`):** requiere palma abierta estricta durante ~1,2 s (5 dedos rectos ≥ 0,93, extendidos con separación ≥ 0,8, palma hacia la cámara y vertical ≤ 40°), con avisos visuales de lo que falta.
- **Ventana de cámara (`web/src/input/desktop/`):**
  - Menú por páginas (`menu.ts`): Principal (volumen, brillo, micro, apps ▸, computer ▸, levantar mano y salir de llamada), Computer (suspender, reiniciar, apagar), Confirmación (sólo 2 opciones: ↑ ↩ Back y ↓ ✔ Yes, <action>) y Apps (hasta 7 accesos rápidos o huecos).
  - Soporte de marcha atrás con `goBack`: `confirm` -> `computer` -> `main` -> cerrar.
  - Cliente (`client.ts`): método `mouse(action)` con cola secuencial estricta, `latestOnly` para volumen y brillo, carga de lanzadores desde `/api/status`.
  - Interfaz (`main.ts`, `index.html`): indicador visual de estado dormido, anillo indicador de clic/arrastre en el puntero y tabla de gestos actualizada (incluye 👎 Thumbs down / ✋← Swipe para volver atrás).
- **Backend Go de Gesture Control (`adapters/desktop/`):**
  - Interfaz `Desktop` ampliada: `MouseDown()`, `MouseUp()`, `RightClick()`, `SetBrightness(v)`, `ToggleMicMute()`, `Power(kind)`, `OpenApp(argv)`.
  - Implementación en `DryRun` y en cada sistema (`desktop_linux.go`, `desktop_windows.go`, `desktop_darwin.go`, `desktop_other.go`).
  - Endpoints nuevos: `POST /api/mouse` y lista de `launchers` en `GET /api/status`.
  - Acciones de energía con confirmación obligatoria (`ErrNeedsConfirm` -> HTTP 428).
  - Carga y validación segura de aplicaciones configurables (`apps.json`, `apps.example.json`): sólo ejecuta `id` registrado localmente.
  - Flags: `-apps <ruta>`.
- **Pruebas y verificación:**
  - 137 tests web en verde (`npm test`), lint limpio (`oxlint`), build de la app y build de la página de desktop.
  - 13 tests unitarios en Go (`adapters/desktop`), con `go vet` y tests pasando en Linux, Windows y macOS.

- **Decisiones tomadas:**
- **Clic exclusivo con corazón y pulgar:** se elimina cualquier clic por permanencia (`select: null` en `pc` y `call`). Quedarse quieto NUNCA hace clic; sólo confirma gestos explícitos (despertar ~1,2 s, fijar nivel de volumen/brillo ~1 s, o elegir celda de menú ~0,5 s). El ratón y sus clics vienen activos por defecto al abrir Gesture Control.
- **Eliminación de ✌️:** eliminado porque colisionaba con el clic (corazón + pulgar mientras se apunta con el índice).
- **Rejilla 3×3 completa:** se usan las 8 celdas en la ventana de cámara. El lector de documentos mantiene su cruz sin el lado de la mano activa.
- **Menú con menos opciones cuando no hacen falta:** en la confirmación de energía se muestran sólo 2 opciones (↑ Volver, ↓ Confirmar) en vez de rellenar 4 celdas con 3 "Cancel" idénticos.
- **Gesto para tirar atrás:** 👎 pulgar abajo mantenido o ✋← barrido lateral emiten fase `back` en el menú para retroceder de submenú o cerrarlo limpiamente.
- **Seguridad en apagado:** confirmación obligatoria en celda ↓ (`confirm: true`); cualquier otra opción o gesto atrás cancela. Se bloquea la celda elegida para no activar opciones por permanencia.
- **Micrófono:** en llamada conmuta el de la aplicación (`toggle_mic`); fuera de llamada conmuta el del sistema operativo (`mic_mute`).
- **Brillo mínimo:** umbral inferior del 5 % para que la pantalla no se quede a oscuras.
- **Lanzador seguro:** la web sólo envía el `id` de la aplicación; el ejecutable resuelve el comando local de `apps.json`.
- **Umbrales de palma estricta:** ajustables para calibrar con hardware real si es necesario.

## Pendiente
- Probar con cámara y micrófono reales delante del ordenador; ajustar umbrales si a Nil le cuesta el clic o el despertar estricto.
- Avisar a Isaac (rol A):
  - `docs/PROBAR_GESTOS.md` (línea 29) aún menciona ✌️ para el menú (es archivo de `docs/`, pertenece a Isaac).
  - `web/src/app/test/bridge.test.ts` envía `'victory'` y espera `null` (sigue pasando, pero conviene limpiarlo cuando Isaac actualice el bridge).
- Unir en el futuro el lector de documentos y Gesture Control si el equipo lo decide (Nil prefirió aplazarlo).

## Archivos tocados
- `web/src/input/**` (`types.ts`, `poses.ts`, `interaction.ts`, `actions.ts`, `overlay.ts`, `demo/`, `desktop/**`, `test/**`, `README.md`)
- `adapters/desktop/**` (`executor.go`, `server.go`, `main.go`, `launchers.go`, `desktop_*.go`, `desktop_test.go`, `apps.example.json`, `.gitignore`, `README.md`)
- `estado/P3-C.md`
