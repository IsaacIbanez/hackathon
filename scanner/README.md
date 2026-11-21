# scanner/ — captura de documentos (rol B1, Pau)

Prototipo aislado en Python: captura el frame completo de la webcam (Logitech MX Brio) por comando.
Reglas del subproyecto: `AGENTS_B.md`. No forma parte todavía del flujo de la app (eso es `web/src/camera`).

## Instalación (una vez)
```
python -m venv scanner/.venv
scanner/.venv/Scripts/python -m pip install -r scanner/requirements.txt   # Linux/macOS: scanner/.venv/bin/python
```
Para ver los nombres de las cámaras en Windows hace falta `ffmpeg` en el PATH (en Linux se leen de `/sys`).

## Uso
```
scanner/.venv/Scripts/python scanner/capturar.py --listar      # cámaras disponibles
scanner/.venv/Scripts/python scanner/capturar.py               # captura con la MX Brio
scanner/.venv/Scripts/python scanner/capturar.py --camara 0    # otra cámara (índice o parte del nombre)
scanner/.venv/Scripts/python scanner/capturar.py --probar      # comprueba la cámara sin guardar
scanner/.venv/Scripts/python scanner/capturar.py --json        # resultado en JSON (para integrar)
```

### Modo servidor (capturas en ~0,4 s)
```
scanner/.venv/Scripts/python scanner/capturar.py --servidor    # deja la cámara abierta (Ctrl+C para salir)
curl http://127.0.0.1:8766/captura                             # captura -> {"ok":true,"png":...,"json":...}
curl http://127.0.0.1:8766/estado                              # fps y nitidez actuales
```
Solo escucha en `127.0.0.1`. Mientras está abierto la cámara sigue encendida y decodifica 4K (~20 fps), con algo de CPU.
Cada captura usa el frame más nítido de los que llegan **después** de la orden (unos 0,15 s); si el autoenfoque está
reajustando, espera hasta 1 s a que se recupere.

### Qué hace y cuánto tarda (MX Brio, Windows 11)
- Guarda en `scanner/capturas/AAAAMMDD-HHMMSS-mmm.png` (sin pérdida, sin recortar) y un `.json` con los metadatos:
  cámara, resolución pedida y entregada, formato, ajustes de enfoque y exposición, y cómo se eligió el frame (nitidez).
  `capturas/` está en `.gitignore`: son documentos reales.
- Pide 3840x2160 en MJPG; la cámara entrega lo que puede, y lo entregado queda en el JSON. No se da por hecho el 4K.
  Los ajustes se pasan al abrir la cámara: con `cap.set()` cada uno reinicia el stream y el formato se queda en YUY2 (~5 fps).
- No usa una espera fija: la MX Brio reajusta el autoenfoque entre 1,1 y 1,25 s después del primer frame cuando la
  escena ha cambiado. El script espera a ese reajuste (o como mucho `--calentamiento`, 1,4 s) y guarda el frame
  **más nítido** de los últimos (varianza del laplaciano), nunca uno en mitad del reajuste.
- Captura única: la ruta del PNG sale a los ~2,7 s; el proceso termina ~0,7 s después porque cerrar la cámara en
  DirectShow tarda ~0,9 s (se hace en paralelo con el guardado). Modo servidor: ~0,4 s por captura.
- Si no encuentra la Brio, falla (código 2) en vez de usar otra cámara en silencio. Códigos: 0 ok, 2 no encontrada,
  3 no se abre, 4 sin frame. Los ajustes a `-1` significan que el backend no los expone.

## Tests (sin cámara)
```
scanner/.venv/Scripts/python -m unittest discover -s scanner
```
