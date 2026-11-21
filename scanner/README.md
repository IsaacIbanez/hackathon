# scanner/ — captura de documentos (rol B, Pau)

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
- Guarda en `scanner/capturas/AAAAMMDD-HHMMSS-mmm.png` (sin pérdida, sin recortar) y un `.json` con los metadatos:
  cámara, resolución pedida y entregada, formato, fps, ajustes de enfoque y exposición, frames descartados.
  `capturas/` está en `.gitignore`: son documentos reales.
- Pide 3840x2160 en MJPG; la cámara entrega lo que puede, y lo entregado queda en el JSON. No se da por hecho el 4K.
- Descarta 1,5 s de frames (`--calentamiento`) para que se ajusten la exposición y el enfoque.
- Si no encuentra la Brio, falla (código 2) en vez de usar otra cámara en silencio. Códigos: 0 ok, 2 no encontrada,
  3 no se abre, 4 sin frame. Los ajustes a `-1` significan que el backend no los expone.

## Tests (sin cámara)
```
scanner/.venv/Scripts/python -m unittest discover -s scanner
```
