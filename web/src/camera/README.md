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

### Guía de encuadre y disparo automático (T19)
```ts
import { startFramingGuide } from '../camera/index.ts'

const guide = startFramingGuide(video, {
  lang: 'es-ES',
  onHint: (hint, text) => speaker.say(text),        // la app lo dice en voz alta
  onCapture: (foto, info) => enviarAScan(foto),     // Blob PNG; info.reason = 'ready' | 'timeout'
  timeoutMs: 8000,                                  // opcional
})
// guide.stop() si el usuario cancela
```
- Mira cada fotograma del vídeo, en local y sin IA, y da avisos: `dark` («hay poca luz»), `moving` («el papel se mueve»), `blurry` («sale borrosa: aléjalo un poco»), `hold_still` («así, no lo muevas»). Textos en español, catalán e inglés (`hintText`); para otro idioma, inglés.
- Un aviso tiene que durar 0,3 s antes de decirse (un fotograma raro no habla), no se repite mientras sigue igual y se repite a los 5 s si el problema continúa.
- **Disparo automático:** cuando el papel lleva **0,7 s quieto**, tiene **luz** y la **nitidez es estable** (el autoenfoque ha terminado), guarda el fotograma más nítido de ese momento quieto a resolución completa, suena un pitido corto, dice «Foto hecha» (`onHint('ready', …)`) y llama a `onCapture`. Después se para sola.
- Si en `timeoutMs` (8 s) no lo consigue, dispara igualmente con la mejor foto vista (`info.reason = 'timeout'`).
- Lo que depende de la hoja (cortada, lejos, inclinada) lo dice Go con el `document` del escáner; aquí no se detecta.
- Umbrales (`thresholds`, ver `DEFAULT_THRESHOLDS` en `framing.ts`), medidos con la MX Brio:
  - Quieto si la diferencia media entre fotogramas (copia de 960 px reducida 4x4) es menor que **4,5**. Con la escena quieta, la MX Brio da 1,4 de media y menos de 2,8 en el 95 % de los fotogramas.
  - Oscuro si el gris medio es menor que **50**. Una hoja blanca iluminada pasa de 100.
  - La nitidez absoluta depende mucho de la escena (de 24 a 700 con la misma cámara), así que «borrosa» solo salta por debajo de **15**, cuando no hay ningún detalle. Lo que de verdad decide el disparo es que la nitidez sea **estable**: los últimos 4 fotogramas, con un margen del 15 %.
- La página de prueba enseña estos valores en directo para ajustarlos.

Notas:
- Los nombres de las cámaras solo se ven después de dar permiso. Si aún no se ven, `openCamera` abre la cámara por defecto y, si entonces aparece la Logitech, cambia a ella.
- El aviso «sujeta el papel quieto» lo pone la app (rol A) antes de llamar a `captureStill`.
- 4K por defecto porque la letra a mano tiene que leerse. Si los gestos van lentos en algún equipo, se puede abrir con `openCamera({ width: 1920, height: 1080 })`.
- No puede haber dos programas usando la MX Brio a la vez: si `scanner/capturar.py --servidor` está abierto, la app no la podrá abrir (y al revés).

## Probar
- Tests sin cámara: `cd web && npm test` (`src/camera/test/`).
- Página de prueba con la cámara: desde la raíz, `npx vite web/src/camera` y abre http://localhost:5173/demo/. Botones «Open camera», «Capture still» y «Start framing guide» (dice los avisos en voz alta con la voz del navegador y enseña luz, nitidez y movimiento en directo); enseña la cámara elegida, la resolución, la nitidez, cuánto ha tardado y un enlace para descargar la foto.

## Archivos
- `open.ts`: `openCamera`, `describeStream`.
- `still.ts`: `captureStill`, `captureStillDetailed`.
- `guide.ts`: `startFramingGuide` (vídeo → avisos y disparo).
- `framing.ts`: lógica de la guía, `FramingJudge` y `HintGate`, y los textos (sin DOM, con tests).
- `frames.ts`: utilidades de canvas y fotogramas que comparten `still.ts` y `guide.ts`.
- `shutter.ts`: pitido de «foto hecha», al estilo de los de la voz (`src/input/voice/earcons.ts`).
- `select.ts`: elección de la cámara por nombre (sin DOM, con tests).
- `sharpness.ts`: brillo, nitidez y movimiento (sin DOM, con tests).
- `demo/`: página de prueba. `test/`: tests.
