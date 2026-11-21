# Gesture Control (programa de escritorio)

Dueño: rol C (Nil). Un programa local pequeño que hace que los gestos de `web/src/input` actúen sobre
el ordenador real: atajos de teclado, ratón, volumen del sistema y controles de videollamada.

Sirve la página de gestos y una API local en `127.0.0.1:8767` (el 8766 es del scanner), protegida
por un token que cambia en cada arranque: se rechazan las peticiones de otras webs. Es independiente
de la app Wails.

## Cómo se arranca
Desde la raíz del repositorio:

```bash
cd web && npm ci && npx vite build src/input/desktop --outDir ../../../../adapters/desktop/dist --emptyOutDir && cd ..
```
```bash
go run ./adapters/desktop
```

Abre una ventana pequeña «Gesture Control» (Chrome, Edge, Chromium o Brave, con un perfil propio para
que siga siguiendo la mano aunque quede detrás de la llamada). Opciones:

- `-dry-run`: solo escribe en la terminal lo que haría, sin pulsar nada (para la primera prueba).
- `-open=false`: no abre la ventana; abre tú la URL que aparece.
- `-screen 1920x1080`: tamaño de pantalla cuando no se detecta (Linux Wayland sin Hyprland).

Para tenerlo como un solo programa: `go build -o gesture-control ./adapters/desktop` (en Windows,
`gesture-control.exe`). La página va dentro, así que hay que construirla antes.

## Qué hacen los gestos
Modo **Videollamada** (eliges Google Meet, Zoom o Teams):

| Gesto | Acción |
|---|---|
| ✋ palma hacia la cámara, mantenida | levantar la mano |
| 👍 pulgar arriba, mantenido | silenciar / activar el micro |
| 👎 pulgar abajo, mantenido | encender / apagar la cámara |
| ✌️ menú ↓ | salir de la llamada |
| ✌️ menú ↑, y después 🤏 pinza y abrir | volumen del sistema (pasos de 10 %; quieto para fijarlo) |

Modo **Ordenador**: 👍 Intro, ✋ Escape, deslizar → pestaña siguiente / anterior, 👎 deshacer.
Con **«Move the mouse with ☝️»**, señalar mueve el cursor (la parte central de la cámara cubre toda la
pantalla) y quedarse quieto hace clic.

Antes de enviar el atajo, el programa pone delante la ventana de la llamada (por su título). Si no
puede, el atajo va a la ventana que esté activa.

## Según el sistema
- **Windows**: funciona sin instalar nada (API de Windows). El volumen se ajusta pulsando las teclas
  de volumen.
- **Linux**: en X11 hace falta `xdotool`. En Wayland, `wtype` (teclado) e `ydotool` (ratón, con
  `ydotoold` en marcha). El volumen usa `wpctl`, `pactl` o `amixer`. Poner la llamada delante funciona
  en X11, Hyprland y Sway.
- **macOS**: da a la terminal el permiso de Accesibilidad (Ajustes del Sistema → Privacidad y
  seguridad → Accesibilidad). El ratón necesita `cliclick` (`brew install cliclick`).

## Límites conocidos
- **Cámara compartida**: la llamada y esta ventana usan la webcam. Windows 10/11 y macOS suelen
  compartirla; en Linux puede estar ocupada. En ese caso, arranca con `-open=false` y abre la URL como
  ventana aparte del mismo navegador de la llamada (Chrome comparte la cámara entre sus ventanas).
- Los atajos son los de serie de cada app y no se han probado en todas las versiones; si alguno no
  funciona, está en `shortcuts.go`.
- Solo se ha probado con el modo `-dry-run` y los tests automáticos, aún no en un escritorio real.

## Archivos
- `main.go`: opciones, arranque del servidor y apertura de la ventana.
- `server.go`: la API local (`/api/status`, `/api/action`, `/api/pointer`) y la página.
- `executor.go`: convierte una acción en teclas, ratón o volumen; `DryRun` para los tests.
- `shortcuts.go`: atajos por acción, sistema y app de videollamada.
- `desktop_{windows,linux,darwin}.go`: la entrada real en cada sistema.
- La página está en `web/src/input/desktop/` y se construye en `dist/` (no se sube a git).
