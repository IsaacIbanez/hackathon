# Brief: PDF Scanner con vista previa del PDF (Didac)
Confirmado por Didac el 2026-11-22. Rama `feature/didac-scan-preview`.

## Estado (2026-11-22)
La vista previa está en `main`. El escaneo fallaba mucho y se ha arreglado en `feature/didac-scan-fix` (abajo, «Registro»). **Falta probarlo con el `.exe` y la cámara** (cierra antes cualquier `scanner/service.py` viejo en el puerto 8770).

## Registro: por qué fallaba el lector y qué se ha cambiado
Medido con las 8 fotos reales del 2026-11-22 (`scanner/pdf/output/scan-20261122-*`, carta en catalán sostenida con las manos en la sala), pasando cada versión del pipeline por las mismas fotos.

**La primera versión (`feature/B-contexto-scanner`) fallaba igual con estas fotos**: el detector de la hoja es el mismo. Funcionaba porque se probaba con la hoja sobre la mesa y la MX Brio (`capturar.py`); con la hoja en la mano falla de la misma forma.

1. **Detector de la hoja: elegía un marco del fondo.** Síntoma: con la hoja en la mano se leían 0–6 palabras. Causa: las manos cortan el contorno de la hoja, que deja de ser candidata, y los marcos del techo, las ventanas y la pared formaban rectángulos «fiables»; entre los fiables gana el más grande. Esos rectángulos contenían solo el 7–11 % del texto impreso de la foto (las hojas reales, 61–81 %). Arreglo (`geometry.py`): se descarta todo candidato con menos del 35 % del texto sobre papel claro (`MIN_PAPER_TEXT`), y se usa el recorte del bloque de texto que ya existía. Resultado: 060901 pasa de 5 a **300 palabras** y 060206 de 6 a **334**; las fotos que ya iban bien no cambian (307 y 337). Test: `test_a_frame_in_the_background_is_not_the_sheet` (la versión anterior elegía el marco con confianza 0,94).
2. **El visor repetía el OCR.** Síntoma: tras escanear, «9 lines (OCR) in 5.6 s» en lugar de las 35 del escaneo, y voz en español para un texto en catalán. Causa: el texto invisible del PDF buscable no se extrae con pdfminer, así que el visor volvía a reconocer la imagen. Arreglo (`service.py`): el PDF del escaneo se abre con las líneas que ya leyó el escáner y su idioma. Resultado: 334 palabras al instante, en `ca-ES`.
3. **Fotos a 640×360.** Síntoma: la 2.ª y 3.ª foto seguidas salían a 640×360 (0–17 palabras). Causa: Gesture Control abre la misma cámara a 640×360 y Chromium comparte el dispositivo dentro de la página; si el stream anterior aún se está cerrando, el nuevo sale igual. Arreglo (`DocumentsMode.tsx`): si la cámara da menos de 1920 px de ancho, se cierra y se vuelve a pedir (hasta 4 veces); si no hay manera, se avisa en pantalla.
4. **Tiempo.** La orientación lee la página al derecho y al revés **a la vez** (5,0 → 3,3 s), y el pase de texto disperso (`psm 11`, para carteles) ya no se lanza si se han leído 60 palabras o más: costaba unos 10 s y nunca se elegía. Resultado: 060901 pasa de 18,5 a 11,1 s, 060240 de 26 a 17,4 s y 060308 de 9,1 a 5,2 s, con las mismas palabras.

**Pendiente:**
- 060240 está movida (la mitad derecha borrosa): la guía de encuadre hizo la foto con el papel en movimiento (`web/src/camera`, de Pau).
- Pasar el benchmark de N3 (`scanner/benchmark`, las fotos están en el equipo de Pau) con este cambio.

## Objetivo
Que el resultado del PDF Scanner vuelva a ser **el PDF**: tras la foto, la app enseña la vista previa del PDF generado y un botón para leerlo en voz alta. Hoy se salta el PDF y lee el texto en voz alta nada más escanear (`GuidedReader` con `autoPlay` en `DocumentsMode.tsx`).

## Estado actual (leído en el repo)
- El servicio de lectura sigue haciendo el PDF buscable (`scan-….pdf`) en `scanner/pdf/output/<scan>/`. Desde N3 responde en cuanto acaba el OCR y termina los PDF en segundo plano, así que la app no se entera de cuándo están.
- El PDF digital (modelo de visión de pago, ~0,002 $ por página) está desactivado por defecto desde R3 (`SCANNER_DIGITAL=1` para activarlo).
- El visor de N4 (`web/src/document/PdfViewer.tsx`) ya enseña la página y lee el PDF entero con un botón (no arranca solo).

## Qué se verá en la demo
La persona sostiene el papel, la guía de voz le dice cuándo está quieto, la app hace la foto y dice «Ya está». Aparece el PDF en el visor; con **Espacio** o el botón lo lee en voz alta. Con **Make digital PDF** sale la versión digital, que también se puede ver y leer.

## Alcance
- Servicio de lectura: un identificador por escaneo (`X-Scan-Id`), `GET /scan/<id>/pdf?kind=searchable|digital` (espera a que el PDF esté y lo abre como los de N4) y `POST /scan/<id>/digital` (hace el PDF digital solo cuando se pide).
- Go: el cliente (`backend/scanner`) y tres bindings nuevos en un archivo propio (`app_scanpdf.go`): `ScanPaper`, `ScanPDF` y `MakeDigitalPDF`.
- PDF Scanner (`DocumentsMode.tsx`): tras la foto, espera al PDF y lo abre en `PdfViewer`, con pestañas «Scanned PDF» / «Digital PDF» y el botón «Make digital PDF». Sin lectura automática.
- Se mantiene la guía de encuadre por voz y los avisos («un momento…», «no encuentro la hoja»). Al acabar dice: «Ya está. Pulsa Espacio para escucharlo».
- Si no hay PDF (por ejemplo, con `SCANNER_URL=fixture`), se ve el texto con el lector guiado, sin autoPlay.

## Fuera de alcance
- Pasar la pantalla Developer o Transcribe a Halo (R1, aparcado).
- Cambiar el contrato (`api/`): las rutas nuevas son del servicio de lectura y de los bindings, no del contrato de mensajes.
- Volver a activar el PDF digital por defecto.

## Criterios de «hecho»
- [ ] Escanear un papel con el `.exe` enseña el PDF en el visor y no suena el contenido hasta pulsar Espacio o el botón.
- [ ] «Make digital PDF» genera el digital y se puede ver y leer en su pestaña.
- [ ] Tests del servicio (`scanner/test_service*.py`) y `task check` en verde.

## Carpetas que toca
- Propias: `scanner/service.py`, sus tests, `docs/briefs/scan-preview.md`.
- De Isaac (aviso en el PR): `backend/scanner/` (cliente), `app_scanpdf.go` (archivo nuevo en la raíz), `web/src/app/overlay/DocumentsMode.tsx` y `desktop.ts`.

## Riesgos
- El PDF digital con modelo tarda ~15-30 s y cuesta dinero: solo con el botón, y el aviso lo dice.
- Esperar al PDF añade ~1 s tras el OCR (la capa de texto y la validación).
