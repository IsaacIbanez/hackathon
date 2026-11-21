# Gesture Control (programa de escritorio)

Dueño: rol C (Nil). Un programa local pequeño en Go que hace que los gestos de la mano (`web/src/input`) actúen sobre el ordenador real: control del ratón, teclado, volumen, brillo, silencio de micrófono, energía del sistema y lanzador de aplicaciones.

Sirve la página de la ventana de cámara (`web/src/input/desktop/`) y una API local en `127.0.0.1:8767` (el 8766 es del scanner), protegida por un token por ejecución, comprobación de cabecera `Host` (contra DNS rebinding) y verificación de `Origin`. Es independiente de la app Wails.

## Cómo se arranca
Desde la raíz del repositorio:

```bash
cd web && npm ci && npx vite build src/input/desktop --outDir ../../../../adapters/desktop/dist --emptyOutDir && cd ..
```
```bash
go run ./adapters/desktop
```

Abre una ventana pequeña «Gesture Control» (Chrome, Edge, Chromium o Brave, con un perfil propio para que siga siguiendo la mano aunque quede detrás de la videollamada). Opciones:

- `-dry-run`: solo escribe en la terminal lo que haría, sin pulsar nada (para pruebas seguras).
- `-open=false`: no abre la ventana del navegador; abre tú la URL que aparece.
- `-apps <ruta>`: ruta a un archivo `apps.json` personalizado.
- `-screen 1920x1080`: tamaño de pantalla cuando no se detecta automáticamente (Linux Wayland sin Hyprland).

Para compilarlo como un único binario ejecutable:
```bash
go build -o gesture-control ./adapters/desktop
```
(En Windows: `gesture-control.exe`). La interfaz web va embebida en el binario, por lo que debe construirse antes (`vite build`).

## Detector de gestos y modo reposo
El detector arranca en modo **dormido** (`requireWake`) para prevenir gestos accidentales:
- Se despierta mostrando una **palma abierta estricta** mantenida ~1,2 s delante de la cámara.
- La postura es exigente: los 5 dedos extendidos y rectos (rectitud ≥ 0,93), dedos separados (separación índice–meñique ≥ 0,8), la palma orientada a la cámara y la mano erguida (inclinación ≤ 40°).
- La pantalla muestra avisos contextuales (`wakeHint`) indicando qué corregir: `"open"`, `"straight"`, `"spread"`, `"facing"` o `"upright"`.
- Tras un periodo de inactividad sin gestos ni movimiento de ratón, vuelve a dormirse automáticamente.

## Menú rápido con el puño (✊) y páginas
El menú se presenta en una rejilla 3×3 de pantalla (con el centro vacío):
- **Abrir y cerrar:** un ✊ puño mantenido ~0,5 s y quieto abre el menú principal. Dentro del menú, soltar el puño y volver a mostrar ✊ durante ~0,5 s lo cierra. También se cierra solo tras 5 s de inactividad.
- **Tirar atrás (navegación):** un pulgar hacia abajo 👎 mantenido ~0,3 s o un barrido lateral ✋← permite retroceder de página en el menú (o cerrarlo desde la página principal).
- **Página principal:**
  - ↑ 🔊 Volume y ↓ 🔆 Brightness: activan el control de nivel por pinza (🤏 abrir o cerrar dedos pulgar e índice, fijándolo al quedarse quieto).
  - ← 🎙️ Microphone: conmuta el micrófono. En modo Videollamada utiliza el atajo de la app (`toggle_mic`), y en modo Ordenador conmuta el micrófono del sistema operativo (`mic_mute`).
  - → 🚀 Apps ▸: abre el submenú de aplicaciones.
  - ↘ ⏻ Computer ▸: abre el submenú de opciones de energía.
  - En modo Videollamada se añaden: ↖ ✋ Raise hand (levantar mano) y ↙ 📞 Leave call (salir de la llamada).
- **Submenú Computer:**
  - Opciones: ↑ Suspender…, ← Reiniciar…, → Apagar… y ↓ Volver.
  - Todas las opciones de apagado/reinicio requieren confirmación previa.
- **Página de confirmación de energía:**
  - Menú simplificado a sólo 2 opciones: ↑ ↩ Back (volver a Computer) y ↓ ✔ Yes, <action> (confirma la acción).
  - Por seguridad, sólo la celda inferior confirma la acción.
  - La celda elegida queda temporalmente bloqueada para que la nueva pantalla no active opciones accidentalmente al cambiar de página.
- **Submenú Apps:**
  - Permite abrir hasta 7 aplicaciones configuradas en `apps.json` distribuidas en las celdas disponibles (`APP_CELLS`), con ↓ Volver. Si no hay apps configuradas, muestra huecos («App N · not set»).

## Control del ratón con la mano
Al activar la casilla **«Move the mouse with ☝️»** (activada por defecto):
- **Mover cursor:** apuntar con el dedo índice ☝️ desplaza el cursor suavemente (mapeo con margen para alcanzar las esquinas sin salirse del encuadre de la cámara).
- **Clic izquierdo:** se realiza exclusivamente juntando la punta del dedo corazón (heart finger) y el pulgar mientras se apunta. Quedarse quieto nunca hace clic (mantenerse quieto sólo confirma gestos como despertar o fijar el volumen/brillo).
- **Clic derecho:** dar dos toques rápidos seguidos con el dedo corazón sobre el pulgar.
- **Arrastre:** mantener juntos el corazón y el pulgar mientras se desplaza el índice.
- **Arrastrar (mantener pulsado):** juntar corazón y pulgar y mantenerlos juntos más de 300 ms (emite `mouse down`). Al separar los dedos, se suelta el botón (`mouse up`).
- **Sin conflicto de gestos:** el gesto de victoria (✌️) se ha eliminado por completo porque se asemejaba a la postura de clic; dos dedos levantados cuentan como apuntar en reposo.

## Aplicaciones configurables (`apps.json`)
La lista de aplicaciones se configura mediante un archivo JSON local. La página web sólo conoce los identificadores (`id`) y nombres (`name`), impidiendo que el navegador ejecute comandos arbitrarios.

Orden de búsqueda de `apps.json`:
1. Parámetro `-apps <ruta>`
2. `./apps.json`
3. `adapters/desktop/apps.json`
4. Junto al ejecutable

Ejemplo (`adapters/desktop/apps.example.json`):
```json
[
  {
    "id": "browser",
    "name": "Browser",
    "open": "https://lauzhack.com"
  },
  {
    "id": "files",
    "name": "File Manager",
    "open": "."
  },
  {
    "id": "calculator",
    "name": "Calculator",
    "windows": ["calc.exe"],
    "linux": ["gnome-calculator"],
    "mac": ["open", "-a", "Calculator"]
  }
]
```

## Requisitos y soporte por sistema operativo

### Windows
- Funciona sin herramientas externas adicionales (utiliza `user32.dll` y llamadas a PowerShell 5.1).
- **Ratón:** eventos de `user32.dll` (`mouse_event`).
- **Brillo:** ajuste vía WMI (`WmiMonitorBrightnessMethods`).
- **Micrófono:** script C# en PowerShell interactuando con las interfaces COM de CoreAudio (`MMDeviceEnumerator` e `IAudioEndpointVolume`).
- **Energía:** `shutdown /s /t 0`, `shutdown /r /t 0`, y `SetSuspendState` en Forms para suspender.

### Linux
- **Teclado y ratón:**
  - En **X11**: requiere `xdotool` (`xdotool mousedown 1`, `xdotool mouseup 1`, `xdotool click 3`).
  - En **Wayland**: requiere `wtype` (teclas) e `ydotool` (ratón, con `ydotoold` en ejecución; clics con `0x40`, `0x80` y `0xC1`).
- **Brillo:** usa `brightnessctl set N%`, `light -S N` o `xrandr --output <display> --brightness <v>`.
- **Micrófono:** usa `wpctl set-mute`, `pactl set-source-mute` o `amixer sset Capture toggle`.
- **Energía:** `systemctl suspend`, `systemctl reboot`, `systemctl poweroff`.
- **Ventana activa:** enfoca llamadas mediante `hyprctl` (Hyprland), `swaymsg` (Sway) o `xdotool` (X11).

### macOS
- Otorga permiso de Accesibilidad a la terminal (Ajustes del Sistema → Privacidad y seguridad → Accesibilidad).
- **Ratón:** requiere `cliclick` (`brew install cliclick`).
- **Brillo:** utiliza la herramienta `brightness` (`brew install brightness`) si está presente, o teclas de brillo mediante AppleScript.
- **Micrófono:** ajusta y restaura el volumen de entrada (`input volume`) mediante AppleScript.
- **Energía:** `pmset sleepnow` (suspender), o AppleScript para reiniciar y apagar vía System Events.

## Endpoints de la API local
Todas las llamadas requieren la cabecera `X-Gesture-Token` con el token generado al arrancar, y validan la cabecera `Host` y `Origin`:
- `GET /api/status`: devuelve plataforma, driver de escritorio, modo dryRun, lista de apps de llamada y lanzadores (`launchers: [{id, name}]`) sin revelar órdenes internas.
- `POST /api/action`: ejecuta una acción de sistema (`Request{action, value, app, confirm, target}`). Las acciones de energía exigen `confirm: true` (error 428 si falta).
- `POST /api/mouse`: gestiona botones del ratón con `{action: "down" | "up" | "click" | "right_click"}` garantizando orden secuencial en cola.
- `POST /api/pointer`: actualiza la posición del puntero `{x, y}` normalizado [0, 1].

## Límites conocidos
- **Pantallas externas:** el control de brillo está limitado a pantallas internas de portátiles o salidas primarias compatibles con los controladores del sistema (no soporta DDC/CI para monitores de escritorio externos).
- **Pruebas en hardware real:** la implementación ha sido validada exhaustivamente mediante pruebas unitarias y en modo `-dry-run`, pero las acciones físicas de hardware (apagado real, suspensión, micrófonos específicos) deben supervisarse en cada entorno.
- **Cámara compartida:** si una videollamada bloquea el acceso exclusivo a la webcam en Linux, arranca con `-open=false` y abre la interfaz web en una pestaña del mismo navegador para compartir el stream.
