# scanner/pdf/ — Imagen PNG a PDF buscable

Parte del subproyecto `scanner/` (reglas en `../AGENTS.md`). Dueño: Didac (P2-C).

Recibe el **PNG** que genera la parte de captura y produce un **PDF buscable**: la página con su
aspecto real (enderezada, recortada, con la iluminación igualada) más una capa de texto OCR
invisible y alineada, para seleccionar, copiar y buscar. No reconstruye el documento con IA.

## Instalación
```
# Windows (Python 3.10+; instala Tesseract con winget y descarga spa/cat/eng a tessdata/)
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\instalar.ps1
# Linux / macOS
bash scanner/pdf/scripts/instalar.sh
```
Los dos scripts acaban ejecutando los tests.

## Uso
```
cd scanner/pdf
.venv\Scripts\python -m escaner_pdf captura.png -o salida        # Windows
.venv/bin/python -m escaner_pdf captura.png -o salida            # Linux/macOS
```
Opciones útiles: `--modo gris|bn`, `--tamano A4|Letter|imagen`, `--esquinas x1,y1,...,x4,y4`
(recorte manual), `--sin-recorte`, `--jpeg`, `--json`. Ver `--help`.
Código de salida: 0 = ok, 2 = PDF generado pero parcial (p. ej. sin OCR), 1 = error.

Desde Python:
```python
from escaner_pdf import convertir, Opciones
r = convertir("captura.png", "salida/")            # también acepta los bytes del PNG
r.estado        # "ok" | "parcial" | "error"
r.pdf           # ruta del PDF final
r.avisos        # p. ej. ["pagina_no_detectada"]
r.error         # {"codigo": ..., "mensaje": ...} si estado == "error"
r.documento()   # payload del mensaje `document` del contrato (api/openapi.yaml)
```
`convertir` no lanza excepciones por errores esperables: siempre devuelve un `Resultado`.

## Qué genera (`salida/<nombre>/`)
| Archivo | Qué es |
|---------|--------|
| `<nombre>.pdf` | PDF final: imagen + capa de texto invisible |
| `original.png` | el PNG recibido, byte a byte (nunca se modifica) |
| `pagina.png` | la página preparada (lo que va dentro del PDF) |
| `base.pdf` | PDF solo imagen, antes del OCR |
| `deteccion.jpg` | la captura con la hoja detectada dibujada (verde = usada, rojo = descartada) |
| `entrada.json`, `resultado.json` | metadatos de entrada y resultado completo |

Si el nombre ya existe se crea `<nombre>-2`, `-3`…: nunca se sobrescribe un resultado.

## Pipeline (`src/escaner_pdf/`)
1. `entrada.py` — valida el PNG (firma, tamaño, 8/16 bits, alfa sobre blanco, DPI del PNG).
2. `geometria.py` — detecta la hoja (bordes + umbral, puntuando soporte de borde, contraste,
   ángulos y tamaño), refina las esquinas a resolución completa (< 1 px de error en pruebas),
   calcula la **proporción real** con el modelo de cámara de Zhang y He y la ajusta a A4/Letter/A5/Legal
   si coincide. Si no está segura, **no recorta** y avisa (`pagina_no_detectada`).
3. `ocr.py` — orientación 90/180/270 (OSD de Tesseract) y OCR en **un solo pase** que da a la vez
   la capa de texto invisible (renderizador "sandwich") y las palabras con caja y confianza.
   Si la página tiene menos de 300 DPI, Tesseract lee una copia ampliada; el PDF guarda la original.
4. `imagen.py` — iluminación (ganancia por canal limitada a 1,8: quita sombras sin borrar zonas
   oscuras grandes), modos `color` / `gris` / `bn` (este último solo si se pide) y calidad con el
   vocabulario `FrameIssue` del contrato (`blurry`, `dark`, `glare`, `cropped`, `tilted`, `too_far`).
5. `pdf.py` — img2pdf incrusta la imagen **sin recodificar** al tamaño físico exacto; pikepdf superpone
   la capa de texto con escala exacta; y se valida: páginas, tamaño, resolución de la imagen
   incrustada, texto extraíble, alineación de la capa y fidelidad (render vs imagen, PSNR).

## Decisiones (medidas, no supuestas)
- **Tesseract directo en vez de OCRmyPDF.** Sobre la misma página: OCRmyPDF 2,07 s; nuestro camino
  1,06 s con el mismo texto, y además devuelve los bloques con confianza que pide el contrato
  (OCRmyPDF obligaría a un segundo pase). OCRmyPDF 17 tampoco necesita Ghostscript.
- **Sin ReportLab:** img2pdf + pikepdf bastan y no recodifican la imagen.
- **PNG sin pérdidas por defecto** (PSNR 99 dB entre la página y el PDF). `--jpeg` es opcional.
- **Sin IA por ahora.** OpenRouter queda como mejora opcional para casos dudosos (no hace falta para el PDF).

## Estado de las pruebas
`pytest` (49 tests, ~15 s): entrada, geometría con 7 poses de cámara realistas, casos sin hoja
(textura, negro, hoja que llena el encuadre), iluminación, calidad, extremo a extremo con acentos,
página girada, modos y formatos, fallos (sin Tesseract, entrada inválida, opciones inválidas).
Las imágenes de prueba son **sintéticas** (`tests/sinteticos.py`).

## Limitaciones y pendientes
- Falta probar con **capturas reales** de la cámara de Logitech: los umbrales de calidad (nitidez,
  brillo, reflejos) son heurísticos y hay que calibrarlos. Muestras en `muestras/`.
- Con la hoja inclinada en **un solo eje**, la focal no se puede deducir y se supone una webcam de
  78° de campo diagonal (`Opciones.fov_diagonal`). Si la cámara real es distinta, ajustarlo.
- Una sola página por llamada. Sin deskew fino (Tesseract tolera inclinaciones pequeñas).
- Escritura a mano: Tesseract no la reconoce bien; la imagen sí se conserva fiel.
- Integración con la app (Go/WebSocket): pendiente de acordar con el rol A. `Resultado.documento()`
  ya da el payload `document` sin cambiar el contrato.
