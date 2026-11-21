# scanner/pdf/ — paquete `escaner_pdf`

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
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\instalar.ps1     # Windows
bash scanner/pdf/scripts/instalar.sh                                          # Linux / macOS
```
Crean `scanner/pdf/.venv`, instalan Tesseract (+ spa, cat, eng) y, en Windows, ffmpeg; acaban ejecutando
los tests. Un solo entorno para todo `scanner/` (OpenCV *headless* también captura de la cámara).

## Uso
```
.venv\Scripts\python -m escaner_pdf captura.png -o salida [--digital] [--json]
```
Opciones: `--modo gris|bn`, `--tamano A4|Letter|imagen`, `--esquinas x1,y1,...,x4,y4` (recorte manual),
`--sin-recorte`, `--sin-iluminacion`, `--sin-realce`, `--sin-orientar`, `--sin-ocr`, `--jpeg`, `--digital`.
Código de salida: 0 ok · 2 PDF generado pero parcial (p. ej. sin OCR) · 1 error.

```python
from escaner_pdf import convertir, Opciones
r = convertir("captura.png", "salida/", Opciones(digital=True))   # también acepta los bytes del PNG
r.estado, r.pdf, r.pdf_digital, r.avisos, r.error, r.documento()
```
`convertir` no lanza excepciones por errores esperables: siempre devuelve un `Resultado`.

## Módulos (`src/escaner_pdf/`)
| Módulo | Qué hace |
|--------|----------|
| `entrada.py` | Valida el PNG (firma, tamaño, 8/16 bits, alfa sobre blanco, DPI) y guarda los bytes originales. |
| `geometria.py` | Detecta la hoja (contornos, umbral y rectas largas de Hough; filtros de soporte de borde, contraste por lado, contenido, ángulos, razón de lados, marco), refina esquinas, proporción real (Zhang y He), ajuste a A4/Letter/A5/Legal. Si no está segura, no recorta. |
| `imagen.py` | Iluminación y **realce de documento** solo en papel claro (papel normalizado localmente, tinta a casi negro, sin dominantes, nitidez suave); modos color/gris/bn; calidad con `FrameIssue`; máscara de letras. |
| `ocr.py` | Tesseract: orientación (OSD sobre la zona con más letras + lectura de comprobación), OCR con pases psm 3 y 6 **en paralelo** (+ psm 11 si casi no lee), capa invisible "sandwich" + palabras con caja y confianza. |
| `pdf.py` | Imagen sin recodificar (img2pdf) al tamaño físico exacto, superposición exacta de la capa (pikepdf), validación. |
| `ia.py` | Cliente de OpenRouter (biblioteca estándar): maqueta de la página con un modelo de visión. |
| `digital.py` | PDF digital: con la maqueta del modelo (`digitalizar_maqueta`) o solo con el OCR local (`digitalizar`). ReportLab escribe el texto. |
| `pipeline.py` | `convertir()`: une todo, mide tiempos, guarda intermedios y `resultado.json`. |

Detalle de cada decisión, medidas y costes: `../ENTREGA.md`.

## Tests
```
.venv\Scripts\python -m pytest -q          # 77 tests, ~37 s; sin red (el modelo de visión se simula)
```
Imágenes sintéticas (`tests/sinteticos.py`): ningún documento real en el repositorio.
