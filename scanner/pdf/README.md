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

## Conexión con la captura (`scanner/escanear.py`)
Une la captura de Pau (`scanner/capturar.py`) con este paquete, usando solo sus interfaces públicas:
```
scanner\pdf\.venv\Scripts\python scanner\escanear.py                 # MX Brio -> PNG -> PDF
scanner\pdf\.venv\Scripts\python scanner\escanear.py --camara 0      # otra cámara
scanner\pdf\.venv\Scripts\python scanner\escanear.py --png foto.png  # sin cámara
```
Desde Python: `escanear.escanear()` (captura única: abre, espera al enfoque —1,4 s como mucho— y cierra
en paralelo con el guardado) o `escanear.escanear_viva(viva)` con una `capturar.CamaraViva` ya abierta
(captura en ~0,4 s: el frame más nítido tras la orden). Ambas devuelven `Escaneo(png, metadatos_captura, resultado)`;
los errores de cámara vuelven en `error_captura` (mismos códigos que `capturar.py`). Los metadatos de la cámara
quedan en `resultado.entrada["metadatos"]` y el PDF se llama igual que la captura.
Un solo entorno para todo: `scanner/pdf/.venv` (OpenCV *headless* también captura; no instalar a la vez
`opencv-python`, chocan). Tests sin cámara: `python -m unittest discover -s scanner`.

Para probar desde el navegador hay una app **provisional** en `scanner/app_prueba/` (no es parte del producto).

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
2. `geometria.py` — detecta la hoja con tres fuentes de candidatos: contornos de bordes (Canny con umbral fijo;
   el marco de la imagen cuenta como borde para documentos cortados), regiones por umbral y **rectas largas**
   (Hough; aguanta dedos encima del borde). Cada candidato pasa filtros medidos con capturas reales: soporte
   de borde, contraste dentro/fuera y **a través de cada lado**, contenido (descarta mesa vacía), ángulos,
   razón de lados y como mucho un lado sobre el marco. Entre los fiables gana el de mayor área. Luego refina
   las esquinas a resolución completa, calcula la **proporción real** (Zhang y He) y ajusta a A4/Letter/A5/Legal
   si coincide. Si no está segura, **no recorta** y avisa (`pagina_no_detectada`).
3. `ocr.py` — orientación 90/180/270: OSD de Tesseract y, si duda, comprobación leyendo de verdad 0°/180°
   (un cartel real del revés: 0 palabras seguras frente a 22). OCR que da a la vez la capa de texto invisible
   (renderizador "sandwich") y las palabras con caja y confianza: psm 3 y, **solo si duda**, psm 11 (texto
   disperso: carteles, tarjetas, pantallas). Páginas de menos de 300 DPI se leen ampliadas (tope 8,5 MP).
4. `imagen.py` — iluminación **solo en papel claro recortado** (ganancia por canal limitada a 1,8; en carteles
   oscuros o en la escena entera lo dejaba todo lavado), modos `color` / `gris` / `bn` (este último solo si se pide) y calidad con el
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

## Capturas reales (MX Brio y webcam 720p, documentos sujetos con la mano)
- Tarjeta y pantalla de móvil sujetas delante de la cámara: con solo psm 3 se leían **0 palabras**;
  con el segundo pase se lee "DISCORD · SCAN TO JOIN", "Leave the server and rejoin using this QR code…",
  "CUSTOM HOODIE · FRONT DESIGN".
- Tarjeta blanca delante de una sudadera blanca y con dedos en los bordes: el borde no se ve y salían
  recortes absurdos. Ahora se descartan (soporte de borde < 0,4, confianza < 0,65, lados opuestos con
  razón > 1,75) y se usa el fotograma entero con aviso `pagina_no_detectada`. **Para la demo: fondo oscuro
  detrás del papel.**
- Tiempos con la MX Brio (4K): A4 detectado ~2,1 s de PDF + 0,4 s de captura con la cámara abierta.
  Fotograma sin documento: ~5 s (dos pases de OCR sobre 8 MP).

Con las 12 capturas reales del 21/11 (MX Brio y webcam): antes de estos cambios se recortaba la mesa vacía
o la escena; ahora la tarjeta, el móvil y los carteles sobre la mesa salen bien recortados y con su color, y el
cartel del revés se gira. Siguen fallando el cartel sujeto con la mano delante de toda la sala, los documentos
que se salen del encuadre por dos lados y las capturas desenfocadas por estar demasiado cerca: para eso la app
de prueba enseña el contorno en directo y deja ajustar las esquinas a mano (`Opciones.esquinas`).

## Estado de las pruebas
`pytest` (60 tests, ~18 s): entrada, geometría con 7 poses de cámara realistas, casos sin hoja
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
