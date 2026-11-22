# Estado — P2-C

- **Persona:** Didac
- **Herramienta:** Claude Code
- **Tarea actual:** T13: servicio de lectura `POST /scan` (8770) + documentos reales en `api/fixtures/real/`
- **Rama:** feature/T13-scan-service (sale de `main` tras #26)
- **Estado:** T5 fusionada (#26). T13: servicio hecho; faltan los documentos reales anonimizados
- **Último cambio:** 2026-11-21 20:45

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

- Documento digital con **modelo de visión** (OpenRouter, `ia.py`): Haiku 5.5 maqueta por bloques, la posición se
  ajusta al OCR local y se compone con tipografía uniforme (sin superposiciones); escalado a Sonnet si la
  concordancia con el OCR es < 60 %; respaldo local sin clave o sin red. Carta real: 343/344 palabras, 0,002 $.
  Clave en `scanner/.env` (ignorado por git). 74 tests (el modelo se simula: sin red).

- Documento digital cerrado: imágenes (firmas, logos) como rectángulo con sus trazos claros y color; tamaño de
  cuerpo por ancho de párrafo; títulos solo mayores, nunca menores; flujo vertical en orden de lectura con huecos
  uniformes. Carta real: 344/344 palabras, firma completa, sin superposiciones, 0,002 $. 77 tests.

- Entrega: `scanner/ENTREGA.md` (funcionamiento, integración, costes, decisiones, pendientes). Fusionado `main`
  (captura de Pau #12, `POST /message` #13). `escanear.py`: `--enviar` / `enviar_a_app()` según
  `docs/INTEGRACION_SCANNER.md` y cámara disponible si no hay MX Brio (decisión #21). Revisión: código muerto
  fuera, OCR psm 3/6 en paralelo y modelo en paralelo con el OCR (escaneo 10,5 → 8 s; con digital 24,6 → 17,5 s),
  código de salida "parcial" 2 → 5 (chocaba con "cámara no encontrada"). Tests: 77 + 23.

- Código traducido al inglés (regla «Idioma»): paquete `escaner_pdf` → `scanner_pdf` (`convert`, `Options`,
  `Result`, `document()`), `escanear.py` → `scan.py` (`scan`, `scan_live`, `send_to_app`, `--send`),
  `app_prueba/` → `demo_app/` (interfaz en inglés), `instalar.*` → `install.*`, `muestras/` → `samples/`, salida
  en `pdf/output/`. Variables de modelo como `backend/llm` (`LLM_CHEAP_MODEL`, `LLM_EXPENSIVE_MODEL`). Datos de
  ejemplo en español. Actualizados `ENTREGA.md`, `pdf/README.md` y la sección del scanner de
  `docs/INTEGRACION_SCANNER.md`. Tests 77 + 23; prueba real con la carta: 15,3 s, Haiku, concordancia 0,992, 0,0018 $.

- T13: `scanner/service.py`, servicio de lectura en 127.0.0.1:8770. `POST /scan` (PNG o JPEG) → 200 con el
  `document` + `pageCorners`; 422 `page_not_detected` en ≈ 0,2 s sin OCR (con `quality.issues`); 400/413/503/500.
  `Result.page_corners()` en el pipeline: esquinas de la hoja normalizadas sobre la foto, en orden del documento
  (giran con la página). Carta real 4K girada 90°: 200 en 8,0 s, esquinas y bloques bien proyectados sobre la foto.
  Tests 81 + 29.

## Pendiente
- T13 (segunda parte): 2–3 documentos reales anonimizados en `api/fixtures/real/`.
- Probar con más documentos en papel reales (formularios) con la MX Brio y calibrar los umbrales de calidad (nitidez, brillo, reflejos).
- Acordar con el rol A qué dispara el escaneo en la demo (botón, tecla, gesto o automático).

## Bloqueos y preguntas para humanos
- **Formato de `pageCorners` (para Isaac, T11):** propongo `[{x, y}] x4` (como `box` y `PointerPayload`), orden
  TL, TR, BR, BL **del documento**, normalizado sobre la foto. Si el contrato 0.5 lo define distinto, lo adapto.
- Puertos resueltos: app Go 8765, `capturar.py --servidor` 8766, app de prueba 8780. Envío a la app hecho
  (`POST /message`, `scan.send_to_app`).
- `capturar.py` (Pau) sigue en español: si lo traduce, actualizar las llamadas de `scan.py` y `demo_app/server.py`.
- Vista previa de la app de prueba: lee `CamaraViva.recientes` (interno). Pedir a Pau un método público
  (`ultimo_frame()`) si se quiere usar fuera de la app provisional.
- Cámara: MX Brio (confirmada). Su campo de visión es configurable (65/78/90°); si no es 78°, ajustar `fov_diagonal`.
- ¿Una o varias páginas por documento? Ahora es una por llamada.
- OpenRouter: aprobado por Didac para el documento digital (clave del equipo en `scanner/.env`). Con documentos
  reales con datos personales, decidir si se usa `digital_ia=False`. La clave se pegó en un chat: rotarla tras la hackathon.

## Archivos tocados
`scanner/`, `estado/P2-C.md`.
