# MX Keypad

Tarea N2 (`docs/tareas/N2.md`), brief `docs/briefs/N2.md`. Dueño: Isaac.

El **MX Keypad** (MX Creative Console) controla la app **sin instalar nada**: se enchufa por USB y la app lee sus teclas directamente (sin Logi Options+ ni SDK). Funciona **aunque otro programa tenga el foco**: la app muestra el overlay (si estaba oculto o tapado) y hace la acción. El menú dice «MX Keypad connected» cuando lo detecta.

**Respaldo:** cada acción tiene también un atajo **Ctrl+Alt+Shift + tecla**, registrado en Windows de forma global. Sirve con Logi Options+, con el keypad por Bluetooth o por el receptor Bolt (sin probar), o con un teclado normal.

## Teclas (página 1)
| Tecla | Acción | Atajo de respaldo | Qué hace en la app |
|---|---|---|---|
| 1 | Abrir/cerrar el overlay | Ctrl+Alt+Shift+O | lo mismo que Ctrl+Alt+Espacio |
| 2 | Gestos | Ctrl+Alt+Shift+1 | abre la opción 1 |
| 3 | Leer papel | Ctrl+Alt+Shift+2 | abre la opción 2 |
| 4 | Leer archivo | Ctrl+Alt+Shift+3 | abre la opción 3 |
| 5 | Volver al menú | Ctrl+Alt+Shift+B | vuelve al menú (no oculta la ventana) |
| 6 | Leer/pausa | Ctrl+Alt+Shift+P | `Espacio` en el lector guiado |
| 7 | Anterior | Ctrl+Alt+Shift+← | `←` en el lector guiado |
| 8 | Siguiente | Ctrl+Alt+Shift+→ | `→` en el lector guiado |
| 9 | Repetir | Ctrl+Alt+Shift+R | `R` en el lector guiado |

Las teclas 6–9 actúan sobre el documento abierto (opciones 2 y 3). En el menú no hacen nada.

## Usarlo
1. Enchufa el MX Keypad por USB.
2. Arranca la app (`task overlay` → `build/bin/lauzhack.exe`). En el log (`build/bin/lauzhack.log`) debe salir `MX Keypad read directly: connected=true`; se puede enchufar también con la app abierta (lo busca cada 2 s).
3. Prueba: con otro programa delante, pulsa la tecla 3 (leer papel). El overlay debe aparecer en esa opción.

**Comprobado el 2026-11-22 con el keypad real, sin Options+:** las 9 teclas llegaron con su acción, dos rondas seguidas. Sin keypad se puede probar con las combinaciones de respaldo desde el teclado.

**Con Logi Options+** (opcional): en la página 1, asigna a cada tecla **Acción → Atajo de teclado** con la combinación de la tabla. Si Options+ se queda el keypad para él, la app sigue funcionando por los atajos.

## Si algo no va
- **Un atajo está ocupado por otro programa:**
  - el log dice `overlay: keypad: could not register …`;
  - el menú lo avisa en amarillo;
  - las demás teclas siguen funcionando.
- **El menú no dice «MX Keypad connected»:** mira el log. Solo se reconoce el keypad por USB (Logitech VID 046D, PID C354).
- **Desactivar el keypad (lectura directa y atajos):** `LAUZHACK_KEYPAD=off`.
- **Solo Windows.** En Linux y macOS no hay atajos globales (igual que Ctrl+Alt+Espacio).

## Cómo funciona (para quien lo mantenga)
- **Lectura directa:**
  - `backend/overlay/keypadhid.go` (formato) y `keypadhid_windows.go` (abrir el dispositivo);
  - el keypad envía en una colección HID del fabricante `13 ff 02 00 <contador> 01 <tecla>`, con la tecla de 1 a 9 al pulsar y `00` al soltar (medido sin Options+);
  - la tecla N hace la fila N de `DefaultKeypad`;
  - un test usa informes grabados del keypad real.
- `backend/overlay/keypad.go`: la tabla de atajos → acción (`DefaultKeypad`).
- `backend/overlay/hotkey_windows.go`: `ListenAll` registra todos los atajos (`RegisterHotKey`) en un mismo hilo, con un id por atajo.
- `app_overlay.go` (`keypadPressed`): muestra la ventana si hace falta y emite el evento de Wails `overlay:keypad` con la acción.
- `web/src/app/overlay/keypad.ts`: traduce la acción.
  - Las opciones y «menú» cambian la vista del overlay.
  - Las de lectura simulan la tecla que el lector guiado ya entiende (`web/src/document/reader.ts`), sin tocar el lector.
  - Un test comprueba que esas teclas siguen siendo las del lector.
- **Añadir una tecla:**
  1. una entrada en `DefaultKeypad` (Go; con lectura directa, solo hay 9 teclas por página);
  2. un caso en `keypadCommand` (TS);
  3. una fila en esta tabla.

## Pendiente (opcional)
- Página 2: subir y bajar el volumen de la voz y, cuando existan, resumir (N7) y modo cursor (N5).
- Dial de la MX Creative Console para el volumen.
- Probar con la app completa: tecla pulsada desde otro programa → overlay, y desenchufar y volver a enchufar.
- Páginas del keypad: el cambio de página no envía nada que hayamos visto. Sin probar si la página 2 manda otros números.
