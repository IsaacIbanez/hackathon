# Brief: PDF Scanner con vista previa del PDF (Didac)
Confirmado por Didac el 2026-11-22. Rama `feature/didac-scan-preview`.

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
