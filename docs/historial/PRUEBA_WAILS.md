# Prueba de Wails y cámara (T3)

Objetivo: comprobar en cada equipo que Wails arranca y que la cámara funciona dentro de la ventana. Si falla en algún sistema, el plan B es Electron.

## Pasos
1. Instala Go y Node.
   - Windows: `winget install GoLang.Go` y `winget install OpenJS.NodeJS.LTS`; cierra y abre la terminal.
   - Linux: con el gestor de paquetes de tu distribución.
2. Instala Wails y comprueba el sistema:
   ```
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   wails doctor
   ```
   Si `wails` no se encuentra, añade `~/go/bin` (en Windows `%USERPROFILE%\go\bin`) al PATH. En Linux hacen falta GTK3 y WebKitGTK; `wails doctor` dice qué falta. Si tu distribución solo trae WebKitGTK 4.1, añade `-tags webkit2_41` a `wails dev` y `wails build`.
3. Crea un proyecto de prueba **fuera del repo**:
   ```
   wails init -n spike -t react-ts
   cd spike
   wails dev
   ```
4. Mueve el frontend a `web/` (como en nuestra estructura):
   - Renombra la carpeta `frontend` a `web`.
   - En `wails.json` añade `"frontend:dir": "web"`.
   - En `main.go` cambia `//go:embed all:frontend/dist` por `//go:embed all:web/dist`.
   - **Guarda los archivos** y vuelve a lanzar `wails dev`.
5. Comprueba que Go acepta nuestros paquetes: crea `backend/ws/ws.go` con `package ws` y una función `Hi() string`, impórtala desde `main.go` (`"spike/backend/ws"`) y llámala al empezar `main()`. `go build ./...` debe compilar y `wails dev` debe imprimir el texto.
6. Prueba la cámara. Con la ventana abierta, clic derecho, **Inspeccionar**, pestaña Consola, y pega:
   ```
   navigator.mediaDevices.getUserMedia({video:true}).then(s=>console.log('OK',s.getVideoTracks()[0].label)).catch(e=>console.log('ERROR',e.name,e.message))
   ```
7. Si puedes, repite con la webcam de Logitech conectada.
8. Opcional pero útil: `wails build` y ejecuta el binario, para ver si la cámara se comporta igual fuera de `wails dev`.

## Qué anotar
Escribe el resultado en tu `estado/<agente>.md`: sistema operativo, versión de Wails, si compiló, si salió el texto del paquete, resultado de la consola (`OK` y nombre, o el error completo), si pidió permiso y si lo probaste con Logitech y con `wails build`. Quien coordine pasa el resumen a esta tabla.

## Resultados
| Persona | Sistema | Wails / Go / Node | Compila y paquetes propios | Cámara en `wails dev` | Permiso | Logitech | `wails build` |
|---------|---------|-------------------|----------------------------|------------------------|---------|----------|---------------|
| Isaac | Windows 11 | 2.17.1 / 1.27.4 / 26.13.1 | Sí | OK (cámara integrada "FHD Camera") | No pidió | Pendiente | Pendiente |
| Didac | | | | | | | |
| Pau | | | | | | | |
| Nil | | | | | | | |
