# MX Keypad

Tarea N2 (`docs/tareas/N2.md`), brief `docs/briefs/N2.md`. Dueño: Isaac.

El **MX Keypad** (MX Creative Console) controla la app **sin instalar nada**: se enchufa por USB y la app lee sus teclas directamente (sin Logi Options+ ni SDK). Funciona **aunque otro programa tenga el foco**: la app muestra el overlay (si estaba oculto o tapado) y hace la acción. El menú dice «MX Keypad connected» cuando lo detecta.

**Respaldo:** cada acción tiene también un atajo **Ctrl+Alt+Shift + tecla**, registrado en Windows de forma global. Sirve con Logi Options+, con el keypad por Bluetooth o por el receptor Bolt (sin probar), o con un teclado normal.

## Teclas (página 1)
Decidido de nuevo por Isaac, tecla a tecla, el 2026-11-22 (antes estaban en otro orden). El atajo de respaldo de la tecla N es siempre **Ctrl+Alt+Shift+N**.

| Tecla | Acción | Qué hace en la app |
|---|---|---|
| 1 | **Abrir/cerrar la app** | muestra u oculta el overlay desde cualquier programa (como Ctrl+Alt+Espacio) |
| 2 | PDF Scanner (leer papel) | abre la opción 2 (cámara) |
| 3 | Read Text (leer archivo) | abre la opción 3 (PDF, imagen, texto) |
| 4 | AI Summary | opción 4: resume el texto seleccionado en el programa de delante |
| 5 | Transcribe | abre la opción 5 (subtítulos en directo) |
| 6 | Gesture Control | abre la opción 1 |
| 7 | **Orden de voz** | primera pulsación: pitido y aviso rojo «Recording…»; segunda: pitido de fin, se transcribe (unos 2 s) y la app hace la orden |
| 8 | Leer/pausa | `Espacio` en el lector abierto |
| 9 | Volver al menú | vuelve al menú (no oculta la ventana) |

Las teclas 2–5 coinciden con los números de las opciones en pantalla; Gesture Control es la opción 1 en pantalla y la tecla 6 en el keypad. Una tecla con la acción `off` no hace nada (ni muestra el overlay); cada pulsación sale en el log como `overlay: keypad key N -> acción`.

## Órdenes de voz (tecla 7)
- **Cómo funciona:**
  - pulsa la 7, di la orden y vuelve a pulsar la 7;
  - Go la transcribe (`POST /transcribe`, el modelo de audio barato: unos 2 s y 0,00006 $; en `LLM_PROFILE=dev`, el mismo orden de modelos de `LLM_TRANSCRIBE_MODELS`);
  - la frase se convierte en una acción del keypad.
- **La app responde siempre:**
  - repite lo que ha oído en pantalla;
  - si no lo entiende, dice «No sé hacer: …».
- **Límite:** a los 30 s la grabación para sola.
- **Necesita la clave** (`OPENROUTER_API_KEY`). Sin ella, lo dice.

| Dices (español, catalán o inglés) | Hace |
|---|---|
| «lee el documento», «escanea el papel», «llegeix el paper» | leer papel (opción 2) |
| «abre un archivo», «léeme el PDF» | leer archivo (opción 3) |
| «resume», «resumen» | resumir la selección (opción 4) |
| «gestos» | opción 1 |
| «menú», «vuelve», «atrás» | menú |
| «siguiente», «anterior», «repite» | en el lector |
| «pausa», «lee», «continúa» | leer/pausa |
| «oculta», «cierra» | oculta la app |
| «borra el texto», «elimina la selección», «esborra», «delete» | **borra el texto seleccionado** en el programa de delante. Antes comprueba que hay texto seleccionado (lo copia); si no lo hay, no borra nada y dice «No hay texto seleccionado». El portapapeles se queda como estaba |

Las frases están en `web/src/app/overlay/voiceCommand.ts`, con tests.

## Usarlo
1. Enchufa el MX Keypad por USB.
2. Arranca la app (`task overlay` → `build/bin/lauzhack.exe`). En el log (`build/bin/lauzhack.log`) debe salir `MX Keypad read directly: connected=true`; se puede enchufar también con la app abierta (lo busca cada 2 s).
3. Prueba: con otro programa delante, pulsa la tecla 2 (leer papel). El overlay debe aparecer en esa opción. Después, tecla 7, di «abre un archivo» y otra vez tecla 7.

**Comprobado el 2026-11-22 con el keypad real, sin Options+:** las 9 teclas llegaron con su acción, dos rondas seguidas (con la tabla anterior; las teclas físicas son las mismas). **Sin probar todavía:** las órdenes de voz con micrófono real. Sin keypad se puede probar con las combinaciones de respaldo desde el teclado.

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
- Página 2: subir y bajar el volumen (también como orden de voz) y el modo cursor (N5).
- Dial de la MX Creative Console para el volumen.
- Probar con la app completa: tecla pulsada desde otro programa → overlay, y desenchufar y volver a enchufar.
- Páginas del keypad: el cambio de página no envía nada que hayamos visto. Sin probar si la página 2 manda otros números.
