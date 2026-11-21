# Estado — P2-C

- **Persona:** Didac
- **Herramienta:** Claude Code
- **Tarea actual:** Subproyecto B / scanner: PNG a PDF buscable (`scanner/pdf/`)
- **Rama:** feature/B-contexto-scanner
- **Estado:** en curso (primera versión funcionando)
- **Último cambio:** 2026-11-21 19:15

## Hecho
- `scanner/AGENTS.md` (y copia `AGENTS_B.md`): reglas y contexto del subproyecto scanner.
- Lenguaje confirmado: Python. Dependencias instaladas (Tesseract 5.4 + spa/cat/eng, OpenCV, img2pdf, pikepdf, pdfminer, pypdfium2).
- `scanner/pdf/`: paquete `escaner_pdf` (PNG -> PDF buscable): detección de hoja, perspectiva con proporción real,
  ajuste a A4/Letter, orientación, iluminación, OCR en un pase, capa invisible alineada, validación automática.
- CLI (`python -m escaner_pdf`) y API (`convertir()` -> `Resultado`, con `documento()` = payload del contrato).
- Tests en verde; scripts de instalación para Windows y Linux/macOS.
- Medido: OCRmyPDF 2,07 s frente a 1,06 s con Tesseract directo (mismo texto, y además bloques con confianza).
- Fusionada la captura de Pau (`feature/B-scanner-captura`) y `main`. Conector `scanner/escanear.py`
  (captura -> PDF, con metadatos de cámara) + `scanner/test_escanear.py`. Instalado ffmpeg (nombres de cámaras).
- App provisional de prueba en `scanner/app_prueba/` (localhost:8780), en commits aparte; no es parte del producto.
- Probado con la webcam integrada (1280x720): vista previa, captura y PDF en ~4,4 s.
- Adaptado a la captura nueva de Pau (fe7327a): `capturar()` devuelve también el hilo de cierre (se espera tras
  guardar); `escanear_viva()` usa su `CamaraViva` (captura en ~0,4 s). App de prueba movida al puerto 8780 y con
  CamaraViva (vista previa y captura comparten la cámara).
- Probado con la **MX Brio** (3840x2160 MJPG): cámara abierta + escaneo correcto; A4 en 4K ~2,1 s de PDF.
- Con capturas reales (tarjeta y móvil sujetos con la mano) el OCR leía 0 palabras: segundo pase psm 11 solo si
  el primero duda; filtros de detección para no recortar mal (soporte, confianza, razón de lados). 57 tests.

- Revisión con 12 capturas reales (cartel oscuro, tarjeta, móvil): se recortaba la mesa vacía o la escena y la
  imagen salía lavada. Nueva detección (rectas largas, contraste por lado, contenido, marco), luz solo en papel
  claro, orientación verificada leyendo (cartel del revés). App de prueba: contorno en directo y ajuste manual
  de esquinas. 60 tests.

- Segunda revisión con cartas reales (MX Brio): orientación con OSD sobre recorte de texto + lectura (12/12,
  incluida la hoja vertical en horizontal), realce de documento (tinta negra, papel blanco), contenido medido con
  letras (las cartas blancas ya se detectan), hoja más alta que el encuadre. Medido: la Brio da 4K real; lo blando
  es enfoque/distancia. 63 tests.
- La actualización nueva de Pau no está en GitHub (último commit suyo: fe7327a); pendiente de comparar cuando la suba.

- Nueva opción **documento digital** (`Opciones(digital=True)`, `--digital`, casilla en la app): página en blanco
  con el texto real (líneas por geometría, tamaño/negrita/color medidos) y las imágenes en su sitio; palabras
  ilegibles como recorte, dudosas listadas en `a_revisar`. Además: realce con papel normalizado localmente y OCR
  con segundo pase psm 6 si la cobertura es baja (carta real: 128 -> 378 palabras). 69 tests.

## Pendiente
- Probar con documentos en papel reales (A4, formulario) con la MX Brio y calibrar los umbrales de calidad (nitidez, brillo, reflejos).
- Acordar con el rol A cómo se llama al escáner desde la app (Go/WebSocket).
- OpenRouter opcional para casos dudosos (no empezado).

## Bloqueos y preguntas para humanos
- **Puerto 8765 triplicado:** lo usan la app Wails (WebSocket, decisión de Isaac) y `capturar.py --servidor`
  (Pau) por defecto. Si el servidor de Pau está abierto, la app Wails se va a otro puerto y el scanner no la
  encuentra. Propuesta: que `capturar.py --servidor` use otro puerto (p. ej. 8766). La app de prueba ya usa 8780.
- **Envío a la app:** Isaac propone que el scanner mande `document` a `ws://127.0.0.1:8765/ws`.
  `Resultado.documento()` ya da ese payload; falta acordarlo para implementarlo en `escanear.py`.
- Vista previa de la app de prueba: lee `CamaraViva.recientes` (interno). Pedir a Pau un método público
  (`ultimo_frame()`) si se quiere usar fuera de la app provisional.
- Cámara: MX Brio (confirmada). Su campo de visión es configurable (65/78/90°); si no es 78°, ajustar `fov_diagonal`.
- ¿Una o varias páginas por documento? Ahora es una por llamada.
- ¿Se pueden mandar imágenes a OpenRouter (privacidad y presupuesto)?

## Archivos tocados
`scanner/`, `estado/P2-C.md`.
