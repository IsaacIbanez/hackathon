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

## Puertos
| Puerto | Quién | Para qué |
|---|---|---|
| 8765 | app Go (`task dev` / `task server`) | `/ws`, `POST /message`, `/health` |
| 8766 | `scanner/capturar.py --servidor` (Pau) | `GET /captura` |
| 8080 | `task mock` | respuestas de ejemplo |

## Pendiente de decidir (equipo)
Quién usa la cámara: si el scanner tiene la MX Brio, los gestos (navegador) deben usar otra cámara (la del portátil). Ver `estado/P1-C.md`.
