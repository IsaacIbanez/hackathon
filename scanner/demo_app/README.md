# demo_app/ — APP PROVISIONAL (solo para probar)

**No es parte del producto.** Sirve para probar captura + PDF desde el navegador mientras no existe
la integración real en la app (Wails). Se puede borrar esta carpeta entera sin afectar a nada:
usa `scan.scan()`, `scan.scan_live()`, `scan.convert_png()` y `capturar.CamaraViva`
(para la vista previa lee su último frame, un atributo interno: aceptable solo aquí).

## Arrancar
```
scanner\pdf\.venv\Scripts\python scanner\demo_app\server.py      # Windows
scanner/pdf/.venv/bin/python scanner/demo_app/server.py             # Linux/macOS
```
Abre http://localhost:8780 (solo escucha en 127.0.0.1; `--port` para cambiarlo, `--no-browser` para no
abrir el navegador). No usa el 8765 (app Wails) ni el 8766 (`capturar.py --servidor`). Requisitos: los de
`scanner/pdf` (`scanner/pdf/scripts/install.*`) y, en Windows, `ffmpeg` para ver los nombres de las cámaras.

## Qué permite
- Elegir cámara (por defecto la MX Brio si está), **Open camera** (usa `capturar.CamaraViva` de Pau: vista previa
  y captura comparten la cámara, ~0,4 s por captura) y **Scan**. Con la cámara cerrada hace una captura única.
- **Contorno en directo** sobre la vista previa (verde = documento detectado) con pistas para encuadrar:
  mejor sobre fondo oscuro, el documento entero y a 30–40 cm (más cerca, la cámara no enfoca).
- **PDF digital** (casilla «Also create a digital PDF»): documento reconstruido con texto real, y la lista de
  palabras que conviene revisar.
- **Send to the app**: envía el `document` a la app Go (`POST /message`, puerto 8765).
- **Adjust corners**: tras escanear, arrastrar las 4 esquinas sobre la captura y regenerar el PDF.
- Arrastrar una imagen (PNG; también JPG del móvil, que se pasa a PNG solo aquí).
- Ver el PDF (probar Ctrl+F y copiar), la página con las cajas del mensaje `document`, la detección,
  el texto con su confianza y el JSON completo.

Capturas en `scanner/capturas/` y PDF en `scanner/pdf/output/`; ambas carpetas están en `.gitignore`.
La interfaz está en inglés (regla «Idioma» de `AGENTS.md`); las claves que vienen de `capturar.py`
(`nitidez`, `resolucion_entregada`...) siguen en español porque son de Pau.
