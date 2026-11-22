# MX Keypad

Tarea N2 (`docs/tareas/N2.md`), brief `docs/briefs/N2.md`. Dueño: Isaac.

El **MX Keypad** (MX Creative Console) controla la app desde **Logi Options+**. Cada tecla envía un atajo de teclado **Ctrl+Alt+Shift + tecla**, sin SDK de Logitech. La app registra esos atajos en Windows de forma global, así que **funcionan aunque otro programa tenga el foco**: la app muestra el overlay (si estaba oculto o tapado) y hace la acción.

## Teclas (página 1)
| Tecla | Acción | Atajo que envía | Qué hace en la app |
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

## Configurarlo en otro ordenador (unos 5 minutos)
1. Instala **Logi Options+** y conecta el MX Keypad.
2. En Options+, abre el MX Keypad y elige la **página 1**.
3. Para cada tecla de la tabla: **Acción → Atajo de teclado** (*Keyboard shortcut*) y pulsa la combinación de la columna «Atajo que envía».
4. Opcional: pon a cada tecla un icono o un texto de Options+ que diga su acción.
5. Arranca la app (`task overlay` → `build/bin/lauzhack.exe`). En el log (`build/bin/lauzhack.log`) debe salir `overlay: 9 keypad shortcuts`.
6. Prueba: con otro programa delante, pulsa la tecla 3 (leer papel). El overlay debe aparecer en esa opción.

Sin keypad se puede probar igual: pulsa las combinaciones con el teclado.

## Si algo no va
- **Un atajo está ocupado por otro programa:**
  - el log dice `overlay: keypad: could not register …`;
  - el menú lo avisa en amarillo;
  - las demás teclas siguen funcionando.
- **Desactivar el keypad:** `LAUZHACK_KEYPAD=off`.
- **Solo Windows.** En Linux y macOS no hay atajos globales (igual que Ctrl+Alt+Espacio).

## Cómo funciona (para quien lo mantenga)
- `backend/overlay/keypad.go`: la tabla de atajos → acción (`DefaultKeypad`).
- `backend/overlay/hotkey_windows.go`: `ListenAll` registra todos los atajos (`RegisterHotKey`) en un mismo hilo, con un id por atajo.
- `app_overlay.go` (`keypadPressed`): muestra la ventana si hace falta y emite el evento de Wails `overlay:keypad` con la acción.
- `web/src/app/overlay/keypad.ts`: traduce la acción.
  - Las opciones y «menú» cambian la vista del overlay.
  - Las de lectura simulan la tecla que el lector guiado ya entiende (`web/src/document/reader.ts`), sin tocar el lector.
  - Un test comprueba que esas teclas siguen siendo las del lector.
- **Añadir una tecla:**
  1. una entrada en `DefaultKeypad` (Go);
  2. un caso en `keypadCommand` (TS);
  3. una fila en esta tabla.

## Pendiente (opcional)
- Página 2: subir y bajar el volumen de la voz y, cuando existan, resumir (N7) y modo cursor (N5).
- Dial de la MX Creative Console para el volumen.
- Probado con el keypad real: **pendiente** (criterio de «hecho» del brief).
