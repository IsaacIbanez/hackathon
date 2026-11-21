# scanner/pdf/ — paquete `scanner_pdf`

Referencia técnica del paquete. **Para integrarlo en la app, empieza por [`../ENTREGA.md`](../ENTREGA.md)**.
Dueño: Didac (P2-C). Reglas del subproyecto: `../AGENTS.md`.

Recibe el **PNG** de una página y produce:
- un **PDF escaneado buscable**: la página con su aspecto real (recortada, enderezada, girada, con la
  iluminación igualada y el texto oscuro sobre papel blanco) + una capa de texto OCR invisible y alineada;
- opcionalmente, un **PDF digital**: página en blanco con el texto escrito de verdad y las imágenes
  (firma, logo, sello) en su sitio, como si el documento se hubiera hecho en el ordenador;
- el payload del mensaje **`document`** del contrato (`api/openapi.yaml`), listo para enviar a la app.

## Instalación
```
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\install.ps1     # Windows
bash scanner/pdf/scripts/install.sh                                          # Linux / macOS
```
Crean `scanner/pdf/.venv`, instalan Tesseract (+ spa, cat, eng) y, en Windows, ffmpeg; acaban ejecutando
los tests. Un solo entorno para todo `scanner/` (OpenCV *headless* también captura de la cámara).

## Uso
```
.venv\Scripts\python -m scanner_pdf captura.png -o output [--digital] [--json]
```
Opciones: `--mode gray|bw`, `--paper-size A4|Letter|image`, `--corners x1,y1,...,x4,y4` (recorte manual),
`--no-crop`, `--no-lighting`, `--no-enhance`, `--no-orient`, `--no-ocr`, `--jpeg`, `--digital`.
Código de salida: 0 ok · 2 PDF generado pero parcial (p. ej. sin OCR) · 1 error.

```python
from scanner_pdf import convert, Options
r = convert("captura.png", "output/", Options(digital=True))   # también acepta los bytes del PNG
r.status, r.pdf, r.digital_pdf, r.warnings, r.error, r.document()
```
`convert` no lanza excepciones por errores esperables: siempre devuelve un `Result`.

## Módulos (`src/scanner_pdf/`)
| Módulo | Qué hace |
|--------|----------|
| `input_image.py` | Valida el PNG (firma, tamaño, 8/16 bits, alfa sobre blanco, DPI) y guarda los bytes originales. |
| `geometry.py` | Detecta la hoja (contornos, umbral y rectas largas de Hough; filtros de soporte de borde, contraste por lado, contenido, ángulos, razón de lados, marco), refina esquinas, proporción real (Zhang y He), ajuste a A4/Letter/A5/Legal. Si no está segura, no recorta. |
| `image.py` | Iluminación y **realce de documento** solo en papel claro (papel normalizado localmente, tinta a casi negro, sin dominantes, nitidez suave); modos color/gray/bw; calidad con `FrameIssue`; máscara de letras. |
| `ocr.py` | Tesseract: orientación (OSD sobre la zona con más letras + lectura de comprobación), OCR con pases psm 3 y 6 **en paralelo** (+ psm 11 si casi no lee), capa invisible "sandwich" + palabras con caja y confianza. |
| `pdf.py` | Imagen sin recodificar (img2pdf) al tamaño físico exacto, superposición exacta de la capa (pikepdf), validación. |
| `vision.py` | Cliente de OpenRouter (biblioteca estándar): maqueta de la página con un modelo de visión. |
| `digital.py` | PDF digital: con la maqueta del modelo (`digitalize_layout`) o solo con el OCR local (`digitalize`). ReportLab escribe el texto. |
| `pipeline.py` | `convert()`: une todo, mide tiempos, guarda intermedios y `result.json`. |
| `errors.py` | `ScannerError(code, message)`: errores esperables con un código estable. |

Detalle de cada decisión, medidas y costes: `../ENTREGA.md`.

## Tests
```
.venv\Scripts\python -m pytest -q          # 77 tests, ~37 s; sin red (el modelo de visión se simula)
```
Imágenes sintéticas (`tests/synthetic.py`): ningún documento real en el repositorio. Los textos de
ejemplo imitan un formulario en español y se quedan en español (regla «Idioma» de `AGENTS.md`).
