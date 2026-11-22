# scanner/ — lectura de documentos (Python)

Contexto general: `AGENTS.md` y `docs/ESTADO.md` en la raíz. Dueño: **Didac** (pipeline y servicio); de **Pau**: `capturar.py` y `benchmark/`. Detalle técnico: `scanner/README.md`, `scanner/pdf/README.md` y `scanner/ENTREGA.md`.

## Qué hace
Foto (o archivo) → detecta la hoja → endereza y orienta → mejora la luz → OCR local con Tesseract (español, catalán, inglés) → `document` del contrato (líneas con caja, `pageCorners`) y PDF buscable.

| Pieza | Qué es |
|---|---|
| `service.py` | **Servicio de lectura** en 127.0.0.1:8770: `POST /scan` (foto → `document`), `POST /document` (archivo del PC → líneas), `GET /health`. Lo llama Go (`backend/scanner`) |
| `pdf/src/scanner_pdf/` | El pipeline (`convert`): `geometry.py` (hoja), `ocr.py` (orientación y OCR), `image.py`, `pdf.py`, `digital.py` y `vision.py` (PDF digital con IA) |
| `documents.py` | Lectura de archivos (PDF con o sin texto, imágenes) |
| `capturar.py` | Captura de la MX Brio a 4K (Pau) |
| `benchmark/` | Medida del escaneo con fotos reales, antes y después de cada cambio (Pau) |
| `scan.py`, `demo_app/` | Conector por línea de comandos y app de prueba (8780), fuera del recorrido de la demo |

## Comportamiento acordado (no cambiar sin avisar)
- **Responde en cuanto el `document` está listo**; el PDF buscable y el digital se terminan en segundo plano (cabecera `X-Scan-Folder`).
- **422 «no sheet found»** solo si no hay hoja **ni** texto sobre papel; con texto y sin hoja, `document` sin `pageCorners`.
- **PDF digital con IA, desactivado** por defecto (es de pago): `?digital=1` o `SCANNER_DIGITAL=1`.
- Todo lo demás es **local y gratis**. Las fotos y los resultados son documentos reales: **nunca al repositorio** (`capturas/`, `pdf/output/`, `benchmark/results/` están ignorados).

## Instalar y probar
```powershell
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1   # .venv, Tesseract e idiomas (una vez)
scanner\pdf\.venv\Scripts\python -m pip install pypdfium2              # aún no está en requirements.txt
cd scanner\pdf; .venv\Scripts\python -m pytest -q                       # pipeline
cd scanner;     pdf\.venv\Scripts\python -m unittest test_service test_scan test_capturar
scanner\pdf\.venv\Scripts\python scanner\service.py                     # el servicio, a mano
```
Si cambias la detección, la orientación o el OCR, **mídelo** con `benchmark/` (mismas fotos antes y después) y apúntalo en `docs/medidas/`.

## Reglas de este directorio
- Cambios pequeños y locales; no toques Go ni la web desde aquí (si hace falta otra interfaz, pídesela a su dueño).
- Sin búsquedas por todo el repositorio: lee los archivos de esta carpeta que necesites.
- Los modelos de pago solo cuando el usuario los activa.
