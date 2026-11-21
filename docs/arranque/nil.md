# Arranque de Nil (P3, rol C: interacción)

Guion para el agente de Nil. Úsalo solo si `docs/briefs/nil.md` no existe. Si existe, trabaja con el brief y pregunta solo lo que falte o haya cambiado. Reglas generales en `AGENTS.md`, «Al empezar una sesión».

## Contexto
Nil sigue trabajando con la cámara y su entorno:
- el reconocimiento de voz;
- el detector de cara y de manos;
- funcionalidades básicas del teclado «y más».

Tu trabajo es averiguar qué quiere exactamente, con qué límites y cómo se comprueba, y dejarlo en un brief.

## 1. Lee antes de preguntar (no preguntes lo que ya está aquí)
- `docs/ESTADO_PROYECTO.md`: F11 (puente y puntero), F12 (manos), F13 (voz), F14 (Gesture Control) y F16 (encuadre); §6, decisiones pendientes 1, 3, 4, 5, 6 y 13; §7, seguridad de Gesture Control.
- `web/src/input/README.md`: tabla de gestos por contexto (`document`, `form`, `pc`, `call`).
- `web/src/input/`: `actions.ts`, `head.ts` (FaceLandmarker: asentir y negar), `tracker.ts` y la carpeta `voice/` (Whisper en un Worker, VAD, dictado de campos, `speaker.ts`).
- `adapters/desktop/README.md`: atajos, ratón, volumen, videollamadas, `-dry-run`, token y `Host`.
- `docs/VOZ.md` (medidas de whisper-tiny, whisper-small y modelos en la nube) y `docs/PROBAR_GESTOS.md`.
- Tu estado anterior: `docs/historial/estado/P3-C.md`. Las ideas de Nil: `docs/ideas/IDEAS.md`.

Haz un resumen de 5 a 8 líneas de lo que hay (y de lo que está **sin verificar**) y enséñaselo a Nil antes de la primera tanda. Así no pregunta lo que ya está hecho.

## 2. Entrevista (tandas de 3 a 5 preguntas, con opciones)

**Tanda 1. Qué quiere conseguir.**
- Qué significa para él «funcionalidades básicas del teclado y más». Qué acciones debería poder disparar la cámara, la voz o las manos. Ofrece opciones sacadas del repo:
  - escribir por dictado en cualquier aplicación;
  - atajos (copiar, pegar, deshacer, cambiar de pestaña);
  - desplazarse por la página;
  - pulsar teclas con gestos;
  - mover y pulsar el ratón;
  - controles de videollamada;
  - otras.
- Cuáles son **imprescindibles para la demo** y cuáles solo deseables.
- Si es para la app (Wails), para todo el ordenador (Gesture Control) o para las dos cosas.

**Tanda 2. Cada acción, una por una** (repite la tanda si hay muchas):
- Qué entrada la activa: voz, gesto de mano o cara (asentir o negar).
- Qué debe pasar exactamente.
- En qué situaciones fallaría: luz, otra persona en la imagen, ruido, gestos sin querer, mano fuera del encuadre.
- Cómo debe comportarse entonces: no hacer nada, avisar por voz o pedir confirmación.

**Tanda 3. Voz.**
- Idiomas (es, ca, en) y si se fuerza el idioma.
- Entornos ruidosos: la demo es en una sala con gente.
- Local frente a nube: `whisper-small` local primero; `POST /transcribe` cuesta dinero con Gemini y el modelo gratuito comete errores. Pregunta qué coste máximo acepta.
- Qué latencia acepta.

**Tanda 4. Control del sistema operativo** (solo si va a pulsar teclas o el ratón del ordenador).
- Avisa de los riesgos: un gesto mal leído puede enviar un mensaje, cerrar una ventana o borrar algo, y una web podría intentar usar la API local.
- Propón límites y pregunta cuáles acepta:
  - lista cerrada de atajos permitidos;
  - confirmación (voz o asentir) para Enter, enviar, cerrar y borrar;
  - prohibido escribir en campos de contraseña y hacer compras o pagos;
  - **botón y gesto de parada** siempre disponibles, más un modo dormido (`requireWake`);
  - indicador visible de que está activo;
  - se apaga solo tras un rato de inactividad;
  - `-dry-run` en la primera prueba de cada atajo nuevo.
- Mantén la protección que ya existe (token, `Host`, solo 127.0.0.1).

**Tanda 5. Qué conservar.** De voz, gestos, cabeza, encuadre y detección: qué quiere conservar, mejorar o reemplazar. Pregunta también por los duplicados de §6: la apertura de la cámara (`Gestures.tsx` frente a `openCamera`) y la salida de voz (`voice.ts` frente a `speaker.ts`).

**Tanda 6. Contrato y otras personas.**
- Qué eventos de la cámara, la voz o los gestos necesitan las funcionalidades de Didac y Pau. Lee sus briefs si existen.
- Si hace falta un mensaje nuevo en `api/`: propónlo en un PR aparte, revisado por otra persona.
- La acción `scan_document` («lee el documento») y el puntero con `pageCorners` siguen pendientes. Pregunta si los asume.

**Tanda 7. Cómo se comprueba.**
- El protocolo de prueba: qué gestos y frases, cuántas repeticiones, con qué luz y con qué ruido.
- Números objetivo, por ejemplo:
  - latencia del gesto a la acción menor de 300 ms;
  - dictado correcto en 9 de 10 frases;
  - 0 disparos sin querer en 2 minutos de uso normal.
- Qué hardware tiene para probar: MX Brio o webcam del portátil, micrófono, sistema operativo.

## 3. Cierre
1. Redacta el brief con la plantilla de `docs/briefs/README.md`. Incluye la lista de acciones con su entrada, los límites de seguridad acordados y los criterios medibles.
2. Enséñaselo a Nil y pide confirmación explícita. Corrige lo que diga.
3. Cuando lo confirme, guárdalo en `docs/briefs/nil.md`, haz commit (solo documentación) y empieza a trabajar en sus carpetas: `web/src/input/`, `web/src/app/Gestures.tsx` y `adapters/desktop/`.
