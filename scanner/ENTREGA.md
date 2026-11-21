# Entrega del scanner (rol B): de la cámara a un PDF y a la app

Documento para quien integra el código general. Explica qué hace `scanner/`, cómo se instala y se usa,
cómo se conecta a la app (Go/Wails), cuánto cuesta y tarda, qué decisiones se tomaron (con medidas) y
qué queda pendiente. Autores: Pau (captura, P4) y Didac (PDF y documento digital, P2). Fecha: 2026-11-21.

---

## 1. Qué hace, en una frase
Una persona pone un documento en papel delante de la **MX Brio**; el scanner lo fotografía a 4K, lo
recorta, endereza, gira y limpia, lo **lee (OCR local)** y entrega tres cosas:

| Salida | Para qué | Coste |
|--------|----------|-------|
| **PDF escaneado buscable** (`<nombre>.pdf`) | Copia fiel del papel con texto seleccionable y buscable | 0 $ (local) |
| **PDF digital** (`<nombre>-digital.pdf`, opcional) | El documento rehecho "como en el ordenador": texto real, firma y logos como imágenes | ~0,002 $ por página (Haiku) |
| **Mensaje `document`** del contrato | Lo que la app necesita para explicar, resaltar y responder | 0 $ (local) |

## 2. Piezas y flujo
```
 MX Brio ──► capturar.py (Pau)  ──PNG 4K──►  escaner_pdf.convertir() (Didac)  ──►  PDF escaneado + document
             · elige cámara                  · detecta y recorta la hoja        └─► (opcional) PDF digital
             · espera al enfoque             · perspectiva, giro, luz, realce          con modelo de visión
             · el frame más nítido           · OCR local (Tesseract)
                    ▲                                     │
                    └──────── escanear.py (conector) ─────┴──► POST /message ──► app Go (127.0.0.1:8765)
                                                                                 explica, resalta, voz
```

| Ruta | Dueño | Qué es |
|------|-------|--------|
| `scanner/capturar.py` | Pau | Captura de la MX Brio: única (≈2,7 s) o modo servidor con la cámara abierta (≈0,4 s/captura, puerto 8766). Ver `scanner/README.md`. |
| `scanner/escanear.py` | Didac | **Conector**: captura → PDF → (opcional) envío a la app. Es lo que hay que llamar desde fuera. |
| `scanner/pdf/` | Didac | Paquete `escaner_pdf` (PNG → PDF). Referencia técnica: `scanner/pdf/README.md`. |
| `scanner/app_prueba/` | Didac | **Provisional**: app en el navegador (localhost:8780) para probar. No es parte del producto. |
| `scanner/capturas/`, `scanner/pdf/salida/` | — | Resultados locales (en `.gitignore`: son documentos reales). |

## 3. Instalación (una vez por ordenador)
```
powershell -ExecutionPolicy Bypass -File scanner\pdf\scripts\instalar.ps1     # Windows
bash scanner/pdf/scripts/instalar.sh                                          # Linux / macOS
```
- Crea `scanner/pdf/.venv` (Python 3.10+; probado con 3.14) con todo: OpenCV *headless*, img2pdf,
  pikepdf, pdfminer, pytesseract, ReportLab.
- Instala **Tesseract 5** con español, catalán e inglés (en Windows, los idiomas van a
  `scanner/pdf/tessdata/`, sin tocar `Program Files`) y, en Windows, **ffmpeg** (lo usa `capturar.py`
  para saber el nombre de cada cámara).
- Acaba ejecutando los tests.
- **PDF digital con modelo** (opcional): clave de OpenRouter en el entorno (`OPENROUTER_API_KEY`) o en
  `scanner/.env` (está en `.gitignore`; la clave se pasa por chat, **nunca** por git):
  `OPENROUTER_API_KEY=sk-or-v1-...`

## 4. Cómo usarlo

### 4.1 Línea de comandos (lo más simple para integrar)
```
scanner\pdf\.venv\Scripts\python scanner\escanear.py [opciones]
```
| Opción | Qué hace |
|--------|----------|
| *(ninguna)* | Captura con la MX Brio (o la cámara que haya si no está) → PDF escaneado |
| `--camara 0` / `--camara acer` | Cámara concreta (índice o parte del nombre) |
| `--png foto.png` | Sin cámara: convierte un PNG ya capturado |
| `--digital` | Además, el PDF digital (con modelo si hay clave; si no, local) |
| `--enviar` | Envía el `document` a la app (`POST http://127.0.0.1:8765/message`) |
| `--json` | Imprime el resultado completo en JSON (para leerlo desde otro proceso) |
| `--modo gris\|bn`, `--idiomas spa+cat+eng`, `--calentamiento 1.4`, `--salida carpeta` | Ajustes |

Código de salida: `0` ok · `1` error del PDF · `5` PDF generado pero parcial (p. ej. sin texto) ·
`2/3/4` errores de cámara (`capturar.py`: no encontrada / no se abre / sin frame).

### 4.2 Desde Python
```python
import sys; sys.path.insert(0, "scanner")
import capturar, escanear
from escaner_pdf import Opciones

esc = escanear.escanear(opciones=Opciones(digital=True))   # captura única
# o, con la cámara siempre abierta (≈0,4 s por captura):
viva = capturar.CamaraViva(capturar.elegir_camara(capturar.listar_camaras(), None), 3840, 2160, 1.4)
esc = escanear.escanear_viva(viva, opciones=Opciones())    # ...y al acabar: viva.cerrar()

r = esc.resultado                     # None si falló la cámara (ver esc.error_captura)
r.estado, r.pdf, r.pdf_digital, r.avisos
escanear.enviar_a_app(r)              # POST /message -> True si la app lo aceptó (202)
```
Sin cámara: `escanear.convertir_png(Path("foto.png"))` o `escaner_pdf.convertir(png, carpeta, Opciones())`.
Ninguna de estas funciones lanza excepciones por errores esperables: el error va en el resultado.

### 4.3 `Opciones` (todas tienen valor por defecto)
| Campo | Defecto | Qué hace |
|-------|---------|----------|
| `idiomas` | `"spa+cat+eng"` | Idiomas de Tesseract |
| `modo` | `"color"` | `color`, `gris` o `bn` (blanco y negro: solo si se pide, es destructivo) |
| `recortar` / `esquinas` | `True` / `None` | Detectar la hoja / recorte manual con 4 puntos en px del original |
| `iluminacion` / `realce` | `True` / `True` | Igualar la luz y dar aspecto de escáner (solo en papel claro) |
| `orientar` | `True` | Girar 90/180/270 si hace falta |
| `tamano` | `"auto"` | `auto` (A4/Letter/A5/Legal si coincide), `imagen`, o un papel fijo |
| `fov_diagonal` | `78` | Campo de visión de la cámara (grados) para la proporción en perspectiva |
| `digital` / `digital_ia` | `False` / `True` | PDF digital / usar el modelo de visión si hay clave |
| `formato_imagen` | `"png"` | `png` (sin pérdidas) o `jpeg` (más ligero) |
| `guardar_intermedios` | `True` | Guardar página, PDF base, detección, maqueta |

### 4.4 `Resultado` (y `resultado.json` en la carpeta de salida)
| Campo | Contenido |
|-------|-----------|
| `estado` | `ok` · `parcial` (hay PDF pero sin texto o no valida) · `error` |
| `pdf`, `pdf_digital`, `carpeta` | Rutas |
| `avisos`, `error` | Ver §7 |
| `pagina` | px, DPI, papel, tamaño en mm, giro, si se corrigió la luz y el realce |
| `calidad` | `puntuacion` 0-1, `problemas` (vocabulario `FrameIssue`), medidas |
| `ocr` | motor, modo (psm), pasadas, palabras, confianza media, `bloques` |
| `digital` | método (`modelo`/`ocr_local`), llamadas al modelo con **coste y tokens**, concordancia, palabras a revisar |
| `validacion` | páginas, tamaño, imagen a resolución completa, texto extraíble, alineación, PSNR |
| `tiempos_ms` | por etapa |
| `documento()` | **payload del mensaje `document`** del contrato |

## 5. Integración con la app (para el código general)
Acordado en `AGENTS.md` y documentado por Isaac en `docs/INTEGRACION_SCANNER.md`: el scanner es un
**proceso Python aparte** que envía `document` a la app con **`POST /message`** a `127.0.0.1:8765`.
El contrato no cambia. Ya está implementado: `escanear.enviar_a_app()` y la opción `--enviar`.

**El mensaje** (ya validado por Isaac contra el contrato):
- `blocks`: un bloque **por línea**, caja **normalizada [0, 1] sobre la página recortada** (origen arriba a
  la izquierda), `confidence` en [0, 1], ids estables `b1`, `b2`…
- `quality`: `score` en [0, 1] e `issues` de `blurry`, `dark`, `glare`, `cropped`, `tilted`, `too_far`
  (si `score` < 0,5 la app no gasta IA y da un consejo de encuadre).
- `imageWidth`, `imageHeight`; `lang` si se pidió un solo idioma.

**Formas de llamarlo desde la app** (de más simple a más integrada):
1. **Proceso por escaneo**: la app lanza `python scanner/escanear.py --enviar --json` cuando el usuario pide
   escanear, y lee el JSON de la salida estándar (rutas de los PDF, avisos). La explicación llega a la
   interfaz por el `POST /message`. Tarda ≈ 2,7 s de captura + ≈ 8 s de PDF en una carta 4K.
2. **Cámara siempre abierta**: un proceso Python con `CamaraViva` + `escanear_viva()` (como hace
   `scanner/app_prueba/servidor.py`) para capturas en ≈ 0,4 s. Hay que exponerle una orden (HTTP local).
3. **Solo el PDF**: si la imagen llega de otro sitio (p. ej. el navegador), `escanear.py --png foto.png`.

**Pendiente de decidir en equipo** (no depende del scanner):
- **Qué dispara el escaneo** en la demo: botón en la app, tecla, gesto (necesitaría un mensaje nuevo en el
  contrato) o automático cuando la hoja está quieta.
- **Cámara única**: si el scanner usa la MX Brio, los gestos (navegador) no pueden abrirla a la vez.
- El coste del **PDF digital** (OpenRouter desde Python) **no aparece en el contador** de la app (`stats`):
  va en `resultado.digital["coste_ia_usd"]`. Si se quiere en pantalla, hay que pasarlo a Go.

## 6. Cómo funciona por dentro
### 6.1 Captura (Pau, `capturar.py`)
4K MJPG (3840×2160; los ajustes se pasan al abrir la cámara, si no se queda en YUY2 a ~5 fps), espera a
que el autoenfoque de la MX Brio se reajuste (≈1,1–1,25 s) y guarda el frame **más nítido** (varianza del
laplaciano), PNG sin pérdida + JSON con metadatos. Sin MX Brio, `escanear.py` usa la primera cámara real.

### 6.2 PDF escaneado (`escaner_pdf.convertir`)
1. **Entrada**: valida el PNG; el original se guarda siempre, byte a byte.
2. **Hoja**: tres fuentes de candidatos (contornos, umbral, rectas largas de Hough —aguanta dedos sobre el
   borde—) y filtros medidos con capturas reales: soporte de borde, contraste **a través de cada lado**
   (distingue el borde del papel de una fila de texto), contenido con forma de letra (descarta la mesa
   vacía), ángulos, razón de lados, como mucho un lado en el marco. Gana el mayor de los fiables. Si no hay
   uno fiable **no recorta** (aviso `pagina_no_detectada`): mejor la foto entera que un recorte equivocado.
3. **Perspectiva**: esquinas refinadas a resolución completa (< 1 px de error en pruebas), proporción real
   con el modelo de cámara de Zhang y He, ajuste a A4/Letter/A5/Legal si coincide (±3,5 %).
4. **Luz y realce** (solo papel claro): blanco del papel normalizado localmente (sin manchas de luz ni de
   la compresión de la cámara), tinta a casi negro, sin dominantes de color, nitidez suave. En carteles
   oscuros o fotos de escena no se toca (antes los dejaba lavados).
5. **Orientación**: OSD de Tesseract sobre la zona con más letras a resolución nativa (8-15 de confianza
   en ≈0,5 s) y, si duda, se lee cada orientación. 12/12 en capturas reales (hoja vertical en horizontal,
   cartas y carteles del revés).
6. **OCR**: Tesseract psm 3 y psm 6 **en paralelo** (el 6 rescata cartas con líneas no rectas: 205 → 282
   palabras fiables) y psm 11 solo si casi no lee (carteles, pantallas: de 0 a leer el texto). Una sola
   lectura da la capa invisible y las palabras con caja y confianza.
7. **PDF**: imagen **sin recodificar** (PNG sin pérdidas, PSNR 99 dB) al tamaño físico exacto + capa de
   texto superpuesta con escala exacta + **validación** (texto extraíble, alineación, fidelidad).

### 6.3 PDF digital (`Opciones(digital=True)`)
- **Con modelo** (por defecto si hay clave): Haiku 5.5 vía OpenRouter transcribe la página por bloques en
  orden de lectura (líneas exactas, alineación, negrita; firmas/logos/sellos/fotos/QR como imágenes).
  La llamada empieza **en paralelo con el OCR local**. Después:
  - cada bloque se sitúa con las palabras del OCR que coinciden con su texto (geometría precisa);
  - tipografía uniforme: cuerpo deducido del **ancho** de los párrafos justificados (la altura de las
    letras sale inflada en fotos borrosas), títulos solo mayores (negrita o centrado), interlineado común;
  - **imágenes como imágenes**: el rectángulo con sus trazos claros y su color, sin el texto vecino;
  - flujo vertical en orden de lectura: huecos entre párrafos uniformes, saltos grandes respetados,
    nada se pisa;
  - **control**: concordancia con el OCR local; si es < 60 % o el JSON falla, se repite con Sonnet 5.5.
- **Sin clave o sin conexión**: reconstrucción solo con el OCR local (peor en fotos imperfectas) y aviso
  `digital_ia_no_disponible:<código>`. Si falla el modelo, **el PDF escaneado no se ve afectado**.
- Solo en **papel claro**: en carteles o tarjetas de color no se crea (aviso `digital_no_aplicable`).
- **Privacidad**: con el modelo, la imagen de la página sale hacia OpenRouter. Con documentos reales con
  datos personales, valorar `digital_ia=False`.

## 7. Avisos y errores
**Avisos** (`resultado.avisos`; el PDF se genera igual):
| Aviso | Significado |
|-------|-------------|
| `pagina_no_detectada` | No se encontró la hoja con seguridad: se usa la imagen entera |
| `ocr_sin_texto`, `ocr_texto_disperso`, `ocr_cobertura_baja` | Sin texto / leído en modo disperso / se han quedado letras sin leer |
| `sin_capa_ocr:<código>` | Sin Tesseract o falló: PDF solo imagen (estado `parcial`) |
| `idioma_no_instalado:<idioma>` | Ese idioma se ignora |
| `validacion_fallida` | El PDF no pasó alguna comprobación (ver `resultado.validacion`) |
| `digital_sin_texto`, `digital_no_aplicable` | PDF digital no creado: sin texto / fondo no claro |
| `digital_ia_no_disponible:<código>` | Sin modelo (`ia_sin_clave`, `ia_sin_conexion`…): se usó el OCR local |

**Errores** (`resultado.error.codigo`, estado `error`): `entrada_no_encontrada`, `entrada_no_png`,
`entrada_ilegible`, `entrada_demasiado_pequena`, `entrada_demasiado_grande`, `entrada_formato_no_soportado`,
`opciones_invalidas`, `pdf_fallo`, `salida_no_disponible`, `interno`. Errores de cámara en
`escaneo.error_captura` con los códigos de `capturar.py`.

## 8. Costes y tiempos (medidos el 2026-11-21, carta A4 real, MX Brio 4K, portátil Windows de 16 núcleos)
| Paso | Tiempo | Coste |
|------|--------|-------|
| Captura única (abrir, enfocar, frame más nítido) | ≈ 2,7 s | 0 $ |
| Captura con la cámara abierta (`CamaraViva`) | ≈ 0,4 s | 0 $ |
| PDF escaneado (todo el pipeline) | **≈ 8 s** (OCR 5,2 s, realce 1,1 s, giro 0,6 s) | 0 $ |
| + PDF digital con modelo (en paralelo con el OCR) | **≈ 17,5 s en total** | **≈ 0,002 $** (Haiku) |
| Si escala a Sonnet (concordancia baja) | +≈ 11 s | ≈ +0,02 $ |

Precios de OpenRouter consultados el mismo día: Haiku 5.5 0,10 $/M entrada y 0,50 $/M salida; Sonnet 5.5
2 $/10 $. Con los 10 $ del equipo, unas 4.000 páginas digitales con Haiku. El escaneo y el envío a la app
son locales (0 $).

## 9. Calidad y pruebas
- **Tests**: `scanner/pdf` 77 (`pytest`) y `scanner/` 23 (`unittest`), sin cámara y **sin red** (el modelo
  se simula). Imágenes sintéticas: ningún documento real en el repositorio.
  ```
  cd scanner/pdf && .venv\Scripts\python -m pytest -q
  cd scanner && pdf\.venv\Scripts\python -m unittest discover -s .
  ```
- **Con capturas reales** (21/11): carta A4 en papel → PDF escaneado buscable con 378 palabras y PDF digital
  con 343-344/344 palabras, firma completa y sin superposiciones; carteles, tarjetas y pantallas de móvil
  bien recortados y con su color; orientación 12/12.

## 10. Historial de cambios y mejoras (resumen)
| Cambio | Por qué (medido) |
|--------|------------------|
| Tesseract directo en vez de OCRmyPDF | Mismo texto en la mitad de tiempo (1,06 s frente a 2,07 s) y da las cajas con confianza del contrato |
| Detección con rectas largas, contraste por lado y contenido | Con capturas reales se recortaba la mesa vacía, la escena o un trozo del cartel |
| Luz y realce solo en papel claro; papel normalizado localmente | Carteles lavados y papel moteado en gris |
| Segundo pase psm 11 / psm 6 | Tarjetas y pantallas: 0 palabras; cartas fotografiadas: párrafos enteros sin leer (128 → 378 palabras) |
| Orientación con OSD sobre la zona de texto + lectura | La hoja vertical en horizontal no se giraba (OSD de la página entera: confianza 0,3-0,6) |
| Validación con la imagen incrustada (no un render) | El render del visor desplaza fracciones de píxel y daba falsos fallos |
| PDF digital con modelo de visión + geometría del OCR | Solo con el OCR local había errores y superposiciones en fotos reales |
| Tipografía por ancho, flujo en orden de lectura, imágenes completas | Tamaños dispares, huecos irregulares, firmas recortadas o fuera de sitio |
| OCR en paralelo y modelo en paralelo con el OCR | Escaneo 10,5 → 8 s; con digital 24,6 → 17,5 s |
| Conector `escanear.py`: `--enviar` (POST /message) y cámara disponible sin MX Brio | Integración acordada con Isaac y decisión de equipo sobre la cámara |

## 11. Limitaciones conocidas y consejos de captura
- **Para que salga bien**: la hoja **entera** dentro del encuadre, **plana**, a **30-40 cm** (más cerca la
  MX Brio no enfoca) y, si el papel es blanco, sobre **fondo oscuro**.
- Hoja blanca sobre mesa blanca: el borde no se distingue y no se recorta (se usa la imagen entera).
  La app de prueba deja ajustar las esquinas a mano (`Opciones.esquinas`).
- Una foto **desenfocada** no se puede arreglar después: ni se lee ni se puede orientar.
- Una página por llamada. Escritura a mano: el modelo la transcribe mejor que Tesseract, pero no se ha medido.
- El PDF digital es una reconstrucción: el **escaneado es la referencia fiel**. Palabras que el OCR local no
  confirma: `resultado.digital["a_revisar"]`.

## 12. Pendiente
- **Idioma del código**: la regla del equipo (`AGENTS.md`, «Idioma») pide código en inglés. El código de
  `scanner/pdf`, `escanear.py` y `app_prueba` está en español; según la regla, se traduce en un PR aparte,
  sin mezclarlo con otros cambios. `docs/INTEGRACION_SCANNER.md` cita `enviar_a_app` y `Resultado.documento()`:
  actualizarlo a la vez.
- `scanner/app_prueba/` es provisional: decidir si entra en `main` o se quita al fusionar.
- La clave de OpenRouter se compartió por chat: **revocarla tras la hackathon**.
- Decisiones de equipo de §5 (qué dispara el escaneo, cámara única, coste del digital en el contador).
