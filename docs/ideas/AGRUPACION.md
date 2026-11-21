# Agrupación de las ideas (neutral)

Las 16 ideas de `IDEAS.md` (4 de Isaac, 4 de Pau, 4 de Didac y 4 de Nil), agrupadas por tema para ver qué se repite. Los grupos van **en orden alfabético**: no están ordenados por mérito y aquí no se elige ninguna. La columna «Código relacionado» solo dice qué existe ya en el repositorio y tiene que ver con la idea; no es una recomendación.

| Tema | Ideas (autor) | ¿Repetida? | Código relacionado que ya existe |
|---|---|---|---|
| Accesibilidad sin manos | Sí/no con la cabeza (Nil) | No | `HeadGestureDetector` en `web/src/input/head.ts` |
| Ayuda de otra persona | Pedir ayuda por videollamada con gestos (Nil) | No | Contexto de videollamada de Gesture Control (`adapters/desktop`, `web/src/input/actions.ts`) |
| Comprensión del contenido | Plazos e importes (Isaac); Aviso de posible estafa (Isaac) | No | Prompts de `backend/session/prompts.go` |
| Encuadre antes de la foto | Guía de encuadre por voz (Pau); Guía de encuadre por voz (Didac); Disparo automático (Pau) | **Sí**: la guía la proponen Pau y Didac; el disparo automático va con ella | `startFramingGuide` (`web/src/camera/guide.ts`, T19); avisos locales de Go (`framingHint` en `backend/session/prompts.go`); 422 «no sheet found» del servicio de lectura |
| Guiado hasta un campo | «¿Dónde firmo?» guiado (Nil) | No | Puntero y cajas de los bloques (`web/src/app/pointing.ts`, `backend/session`) |
| Hoja mal colocada | «El papel está al revés» (Pau) | No | El pipeline ya orienta la página (OSD + lectura, `scanner/pdf/src/scanner_pdf/ocr.py`) |
| Lectura | Lectura en voz alta línea a línea (Didac) | En parte: leer el campo señalado y el lector frase a frase ya existen | Lectura del bloque señalado (`backend/session`), `Speaker` frase a frase (`web/src/input/voice/speaker.ts`) |
| Lupa | Lupa sobre la zona señalada (Pau); Lupa por gesto (Nil) | **Sí**: la misma idea, de Pau y de Nil | Puntero en coordenadas del documento; foto 4K (`captureStill`) |
| Rellenar formularios | Rellenar el formulario por voz (Isaac) | No (Nil anotó que la hizo en #29) | Dictado de campos de Nil (`web/src/input/voice/`, deletreo y confirmación) |
| Salidas del documento | «Guárdalo» / «envíalo» (Didac); Versión en letra grande (Didac) | No | PDF buscable y PDF digital (`scanner/`); vista en letra grande (`web/src/app/DocumentText.tsx`) |
| Varios documentos o páginas | Varias páginas (Isaac) | No | Gesto de deslizar (`swipe`) del módulo de manos; hoy, una página por escaneo |

Duplicados exactos: **la guía de encuadre** (Pau y Didac) y **la lupa** (Pau y Nil).
