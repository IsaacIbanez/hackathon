# app_prueba/ — APP PROVISIONAL (solo para probar)

**No es parte del producto.** Sirve para probar captura + PDF desde el navegador mientras no existe
la integración real en la app (Wails). Se puede borrar esta carpeta entera sin afectar a nada:
solo usa la interfaz pública `escanear.escanear()` y `escanear.convertir_png()`.

## Arrancar
```
scanner\pdf\.venv\Scripts\python scanner\app_prueba\servidor.py      # Windows
scanner/pdf/.venv/bin/python scanner/app_prueba/servidor.py             # Linux/macOS
```
Abre http://localhost:8765 (solo escucha en 127.0.0.1). Requisitos: los de `scanner/pdf`
(`scanner/pdf/scripts/instalar.*`) y, en Windows, `ffmpeg` para ver los nombres de las cámaras.

## Qué permite
- Elegir cámara (por defecto la MX Brio si está), vista previa y **Escanear** (captura a resolución completa + PDF).
- Arrastrar una imagen (PNG; también JPG del móvil, que se pasa a PNG solo aquí).
- Ver el PDF (probar Ctrl+F y copiar), la página con las cajas del mensaje `document`, la detección,
  el texto con su confianza y el JSON completo.

Capturas en `scanner/capturas/` y PDF en `scanner/pdf/salida/`; ambas carpetas están en `.gitignore`.
