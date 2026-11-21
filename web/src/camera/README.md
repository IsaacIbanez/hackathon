# web/src/camera — cámara y foto más nítida (rol B1, Pau)

Abre **una sola cámara** (la Logitech si está) y saca la **foto más nítida** para `POST /scan`.
Mismo criterio de nitidez que `scanner/capturar.py` (varianza del laplaciano).

## Interfaz (la que usan A y C)
```ts
import { openCamera, captureStill } from '../camera/index.ts'

const stream = await openCamera()        // MediaStream; la MX Brio si está conectada
video.srcObject = stream; await video.play()
// … gestos con el mismo <video> …
const foto = await captureStill(video)   // Blob image/png: el frame más nítido de ~0,5 s
await fetch('http://127.0.0.1:8765/scan', { method: 'POST', body: foto, headers: { 'Content-Type': foto.type } })
```

| Función | Qué hace |
|---|---|
| `openCamera(opts?)` | Prefiere la cámara cuyo nombre lleve «Brio», luego «Logitech» o «Logi»; ignora cámaras virtuales («Logi Capture»…). Si no hay ninguna, abre la que haya. Pide 3840x2160 a 30 fps (`width`, `height`, `frameRate`); la cámara entrega lo más parecido que soporte. Opciones: `prefer: /acer/i`, `deviceId`. |
| `captureStill(video, opts?)` | Mira los frames durante `durationMs` (500 por defecto), mide la nitidez de cada uno sobre una copia de 960 px de ancho (~5 ms) y devuelve el más nítido **a resolución completa**, sin espejo ni recorte. PNG sin pérdida por defecto; `type: 'image/jpeg'` (calidad 0,95) pesa menos y se codifica antes. |
| `captureStillDetailed(video, opts?)` | Igual, pero devuelve también `width`, `height`, `sharpness`, `brightness`, `frames` y `elapsedMs`. |
| `describeStream(stream)` | «MX Brio 3840x2160 @ 30 fps», para logs y diagnóstico. |

Notas:
- Los nombres de las cámaras solo se ven después de dar permiso. Si aún no se ven, `openCamera` abre la cámara por defecto y, si entonces aparece la Logitech, cambia a ella.
- El aviso «sujeta el papel quieto» lo pone la app (rol A) antes de llamar a `captureStill`.
- 4K por defecto porque la letra a mano tiene que leerse. Si los gestos van lentos en algún equipo, se puede abrir con `openCamera({ width: 1920, height: 1080 })`.
- No puede haber dos programas usando la MX Brio a la vez: si `scanner/capturar.py --servidor` está abierto, la app no la podrá abrir (y al revés).

## Probar
- Tests sin cámara: `cd web && npm test` (`src/camera/test/`).
- Página de prueba con la cámara: desde la raíz, `npx vite web/src/camera` y abre http://localhost:5173/demo/. Botones «Open camera» y «Capture still»; enseña la cámara elegida, la resolución, la nitidez, cuánto ha tardado y un enlace para descargar la foto.

## Archivos
- `open.ts`: `openCamera`, `describeStream`.
- `still.ts`: `captureStill`, `captureStillDetailed`.
- `select.ts`: elección de la cámara por nombre (sin DOM, con tests).
- `sharpness.ts`: brillo y nitidez (sin DOM, con tests).
- `demo/`: página de prueba. `test/`: tests.
