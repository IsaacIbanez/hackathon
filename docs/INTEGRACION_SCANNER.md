# Integración del scanner (rol B) con la app

Cómo llega lo que lee el scanner (Python, `scanner/`) a la pantalla y a la voz de la app.

## Resumen
1. La app (o `task server` sin ventana) escucha en `127.0.0.1:8765`.
2. El scanner, cuando tiene una página leída, hace **`POST /message`** con un mensaje `document`.
3. Go explica el documento (modelo barato; caro si duda) y envía `speak` + `stats` a la **interfaz**, que lo lee en voz alta y resalta los bloques.
4. A partir de ahí, señalar con el dedo y preguntar por voz funcionan sobre **ese** documento (la sesión es compartida).

No hace falta ninguna librería: `urllib` de la biblioteca estándar basta.

## El mensaje `document`
```json
{
  "type": "document",
  "id": "doc-<único>",
  "ts": 1795262400000,
  "payload": {
    "blocks": [
      { "id": "b1", "text": "Nombre y apellidos: ______", "box": { "x": 0.08, "y": 0.18, "w": 0.6, "h": 0.04 }, "confidence": 0.92 }
    ],
    "quality": { "score": 0.85, "issues": [] },
    "imageWidth": 1240, "imageHeight": 1754, "lang": "es"
  }
}
```
- **Bloques:** mejor por **línea** (no por palabra): la app lee un bloque entero cuando se señala.
- **Cajas normalizadas** a [0, 1] sobre la **página recortada** (después de corregir la perspectiva), origen arriba a la izquierda: `x = left / ancho`, `y = top / alto`, etc.
- **`confidence`** del OCR en [0, 1] (Tesseract da 0–100: dividir entre 100).
- **`quality.score`** en [0, 1] y **`issues`** de `blurry`, `dark`, `glare`, `cropped`, `tilted`, `too_far`. Si `score` < 0,5, la app **no gasta IA**: da en voz alta un consejo de encuadre («la imagen está borrosa…»). Usad la nitidez que ya mide `capturar.py`.
- `id` de los bloques estables dentro del documento (`b1`, `b2`…).

Si un cliente escucha el WebSocket (no hace falta para el scanner, que usa `POST`), recibirá también el `document` reenviado: subid su límite de tamaño de mensaje (en Go, `conn.SetReadLimit(4 << 20)`; el navegador no tiene límite).

## Ejemplo
`api/examples/send_message.py` tiene `document_from_ocr_lines(...)` (de líneas de OCR en píxeles al mensaje) y `post(...)`:
```
task server                                              # terminal 1 (necesita .env con la clave)
python api/examples/send_message.py --demo-ocr           # terminal 2: simula el scanner
python api/examples/send_message.py mi_documento.json    # o un sobre ya hecho
```
Para ver lo que oye la interfaz: `npm run dev` en `web/` con `VITE_WS_URL=ws://127.0.0.1:8765/ws`.

Probado el 2026-11-21: `--demo-ocr` → la interfaz oye «Este documento es una declaración de siniestro de AXA Seguros. Debe escribir su nombre y apellidos… También debe escribir su número de póliza…», con los 3 bloques resaltados. Coste: 0 $ (`LLM_PROFILE=dev`).

## `scanner/scan.py` (Didac): envío hecho
Revisado en la rama `feature/B-contexto-scanner` (2026-11-21): `Result.document()` **cumple el contrato** (bloques por línea, cajas normalizadas sobre la página recortada, `confidence` en [0, 1], `issues` con los valores del contrato, `lang` en BCP-47). El envío ya está implementado en `scan.send_to_app(result)` (POST /message, devuelve `True` con 202 y `False` si la app no está abierta) y en la CLI con `--send`:

```
scanner\pdf\.venv\Scripts\python scanner\scan.py --send                  # captura + PDF + envío
scanner\pdf\.venv\Scripts\python scanner\scan.py --png captura.png --send
```

Nombres en inglés desde el 2026-11-21 (antes `escanear.py`, `enviar_a_app`, `Resultado.documento()`, paquete `escaner_pdf`). Detalle completo en `scanner/ENTREGA.md`. Notas:
- La app **no gasta IA** si `quality.score` < 0,5: da un consejo de encuadre en voz alta. Con vuestras penalizaciones, solo «borroso» deja 0,65 y sí se explica; ajustad si queréis que «borroso» corte antes.
- El `id` del sobre debe ser único por escaneo; los `id` de los bloques (`b1`, `b2`…) solo tienen que ser estables dentro del documento.
- El documento digital con modelo de visión (`vision.py`) gasta del mismo presupuesto de OpenRouter, pero su coste no sale en el contador de la app; el envío a la app usa solo el OCR local (0 $).
- Pendiente de decidir en equipo: **qué dispara el escaneo** en la demo (botón o tecla en vuestra app, escaneo automático cuando la hoja está quieta, o un gesto). Si queréis un gesto, hace falta un mensaje nuevo en el contrato: avisad.

## Servicio de lectura para la app (T13, Didac): lo que Go espera
Desde el contrato 0.5, la app manda la foto a Go (`POST /scan`) y **Go se la pasa a vuestro servicio**:

```
POST http://127.0.0.1:8770/scan        (Go lo lee de SCANNER_URL)
Content-Type: image/jpeg | image/png | image/webp
<bytes de la foto, hasta 40 MB>

200  application/json   → un DocumentPayload (lo de Result.document()) + pageCorners
422  {"error": "..."}   → no hay hoja en la foto (Go le dice al usuario «No encuentro la hoja…»)
otro                     → error (Go dice «No he podido leer el documento»)
```

**`pageCorners`** (nuevo, opcional): las 4 esquinas de la hoja **en la foto recibida**, normalizadas a [0, 1] sobre esa foto (`x / ancho_foto`, `y / alto_foto`), en este orden: **arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda de la hoja tal como se lee** (después de orientarla). Si giráis la hoja 90° o 180° para leerla, rotad también el orden de las esquinas: el puntero las usa para saber qué parte del papel señala el dedo. Si no se detectó la hoja (se usó la foto entera), no lo pongáis.

Ejemplo: `api/fixtures/document.json` (`"pageCorners": [{"x":0.31,"y":0.07}, {"x":0.70,"y":0.09}, {"x":0.72,"y":0.94}, {"x":0.29,"y":0.92}]`).

**Cómo probarlo de punta a punta:** vuestro servicio en 8770 + `task server` (o `task dev`) + `curl -X POST -H "Content-Type: image/png" --data-binary @foto.png http://127.0.0.1:8765/scan`. La interfaz oye «Un momento, estoy leyendo el documento», recibe el documento y lo explica.

**Mientras el servicio no existe**, el resto del equipo prueba con `SCANNER_URL=fixture`: Go responde a cada foto con el formulario de ejemplo (con esquinas).

## Puertos
| Puerto | Quién | Para qué |
|---|---|---|
| 8765 | app Go (`task dev` / `task server`) | `/ws`, `POST /message`, `/health` |
| 8766 | `scanner/capturar.py --servidor` (Pau) | `GET /captura` |
| 8770 | servicio de lectura (Didac, T13) | `POST /scan`: foto → `document` con `pageCorners` |
| 8780 | `scanner/demo_app` (Didac, provisional) | vista previa y escaneo |
| 8080 | `task mock` | respuestas de ejemplo |

## Pendiente de decidir (equipo)
Quién usa la cámara: si el scanner tiene la MX Brio, los gestos (navegador) deben usar otra cámara (la del portátil). Ver `estado/P1-C.md`.
