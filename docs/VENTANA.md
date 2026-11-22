# La ventana de la app: formas, jerarquía y quién decide

**Léelo antes de tocar** `app_window.go`, `app_overlay.go`, `app_summary.go`, `web/src/app/overlay/gestureHost.ts` o cualquier cosa que muestre, oculte o cambie el tamaño de la ventana. Arreglo R5 (Pau, 2026-11-22; ficha `docs/arreglos/R5.md`).

## El problema que había
La app es **una sola ventana de Wails** que toma varias formas. Antes, seis funciones la movían cada una por su cuenta (`SetLayer`, `SetCompact`, `SetScreenOverlay`, `HideOverlay`, la burbuja de AI Summary y el atajo), con banderas sueltas (`visible`, `compact`, `screen`, `bubble`, `layer`). Ninguna sabía qué forma tocaba al terminar, y el resultado era un caos de ventanas que se abrían, se encogían y se cerraban:
- **Menú del puño:** al cerrarlo, la ventana quedaba siempre en 960×680 centrada, aunque antes fuera la capa a pantalla completa.
- **Modo cursor:** encogía el overlay a la burbuja y, al quitarlo, lo volvía a abrir.
- **Cerrar AI Summary:** dejaba la ventana a 960×680 sin mirar en qué forma estaba.

## El modelo actual
Las piezas **solo dicen lo que quieren** (`windowInputs` en `app_window.go`) y **una sola función decide y aplica la forma** (`desiredShape` + `applyShape`, una transición cada vez).

| Entrada | Quién la cambia | Significa |
|---|---|---|
| `open` | El atajo (Ctrl+Alt+Espacio), el keypad, Esc o «Hide» (`HideOverlay`), «Shrink to a camera bubble» y el doble clic en la burbuja (`SetCompact`) | La persona quiere ver el overlay |
| `layer` | La vista (`SetLayer`, desde `Overlay.tsx`) | `true`: capa a pantalla completa (menú y herramientas de lectura); `false`: ventana normal (la página de Gesture Control, para que sus clics lleguen a los programas de debajo) |
| `gestures` | `SetGesturesActive` (`gestureHost.ts`) | El motor de gestos usa la cámara (siempre desde N1; PDF Scanner lo pausa) |
| `gestureScreen` | `SetScreenOverlay` (la página de gestos) | El menú del puño o el control de volumen/brillo está abierto (temporal) |
| `summary` | AI Summary (`showBubble`, `CloseSummary`) | La burbuja del resumen está abierta (temporal) |

**Jerarquía** (`desiredShape`; manda la primera que se cumple):
1. `summary` → **burbuja de AI Summary** junto al puntero.
2. `gestureScreen` (con los gestos activos) → **pantalla de gestos**: transparente a pantalla completa, con la cámara en una esquina.
3. `open` y `layer` → **capa** a pantalla completa.
4. `open` → **ventana** centrada de 960×680.
5. `gestures` → **burbuja de cámara** en una esquina (el overlay está oculto, pero los gestos siguen).
6. Nada → **oculta**.

Como la forma sale siempre de las entradas, **al acabar algo temporal** (menú del puño o resumen) **la ventana vuelve exactamente a lo que había**, sin que nadie lo recuerde a mano.

## Reglas de convivencia (decididas con Pau)
- **El overlay manda; los gestos conviven.** Gesture Control nunca abre, cierra ni encoge el overlay: solo pone su menú encima un momento.
- **Modo cursor:** no toca la ventana. Con el overlay abierto, el cursor de la mano puede pulsar sus botones; con el overlay oculto, la burbuja se queda.
- **Ocultar** (Esc en el menú, «Hide», el atajo con el overlay delante): con los gestos activos va a la burbuja; sin gestos, se oculta. Si no hay ningún atajo que funcione ni gestos, solo se minimiza, para que la ventana no se pierda.
- **El atajo:** con el overlay delante, lo oculta. Oculto, en la burbuja o tapado por otra ventana, lo trae al frente tal como estaba.
- **El keypad:** trae el overlay tal como estaba y hace la acción. Si estaba abierto el resumen, lo cierra.
- **Al cerrar AI Summary**, el overlay se oculta (a la burbuja si hay gestos) y el foco vuelve al programa del que salió el texto.

## Cómo comprobarlo
- **Cada cambio de forma queda en el log:** `window: layer -> gesture-screen` en `build/bin/lauzhack.log`.
- **Tests:** `go test -run Shape .`, que prueba la jerarquía y que las formas temporales vuelven a la de antes.
- **Recorrido con el `.exe`** (2026-11-22): arranque → capa · Ctrl+Alt+Espacio → burbuja · otra vez → capa · tecla 8 → ventana · tecla 4 → capa · menú del puño → `gesture-screen` → capa · Esc → burbuja.

## Si añades algo que cambia la ventana
1. **No llames a `wruntime.Window*` desde una función nueva.** Añade, si hace falta, una entrada a `windowInputs` y su sitio en `desiredShape`.
2. Cambia las entradas con `a.setWindow(func(in *windowInputs) { … }, raise)`. `raise=true` trae la ventana al frente aunque la forma no cambie.
3. Añade el caso a `app_window_test.go`.
4. **La página se entera por eventos** (no los cambies sin mirar `gestureHost.ts` y `Overlay.tsx`):
   - `overlay:expanded`: capa o ventana;
   - `overlay:compact`: burbuja;
   - `overlay:screen`: pantalla de gestos;
   - `overlay:hidden`;
   - `overlay:shown`: la página toma el foco del teclado.
