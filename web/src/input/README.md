# Módulo de manos (rol C — T6, parte de gestos)

Convierte los landmarks de la mano (MediaPipe HandLandmarker, en el navegador) en eventos y acciones
de la app. Sin dependencias de npm: MediaPipe se carga en tiempo de ejecución desde jsDelivr
(`@mediapipe/tasks-vision@0.10.21`) y el modelo desde Google Storage.

## Gestos
Pocos gestos, muchas acciones: el significado depende del **contexto** (`documento`, `formulario`, `pc`),
definido en `acciones.ts` (`MAPAS`). Los marcados como EXP son experimentales.

| Gesto | Documento | Formulario | PC |
|---|---|---|---|
| 👍 pulgar arriba (mantener ~0,3 s) | leer | confirmar campo | Intro |
| ✋ palma quieta, mirando a la cámara | pausar | pausar | Escape |
| ✋↔ deslizar a la derecha / izquierda del usuario | siguiente / anterior | campo siguiente / anterior | pestaña siguiente / anterior |
| ☝️ señalar | puntero | puntero | puntero |
| ☝️ señalar quieto ~0,9 s | explicar aquí | dictar campo | clic |
| 👎 pulgar abajo (EXP) | deshacer | borrar campo | deshacer |
| ✌️ menú → ajustar volumen, y 🤏 juntar y separar pulgar e índice; quieto ~1 s para fijar (EXP) | volumen | volumen | volumen |
| ✌️ victoria → menú; ☝️ puntero encima de una opción ~0,5 s (EXP) | ↑ ajustar volumen · ↓ repetir · pedir ayuda en el lado contrario a la mano (sin mano detectada: → dictar, ← pedir ayuda) | igual | igual |
| 🙂 asentir (EXP, cabeza) | leer | confirmar campo | Intro |
| 🙂 negar (EXP, cabeza) | pausar | borrar campo | Escape |

Opciones experimentales (en `OpcionesInteraccion`):
- `requiereDespertar`: modo dormido/despierto. Se ignoran los gestos hasta mantener ✋ ~1 s (o asentir);
  vuelve a dormirse tras `dormirMs` sin actividad. Evita gestos accidentales.
- `PERFIL_MOVILIDAD_REDUCIDA`: tiempos más largos y radios más amplios para temblor o movilidad reducida.
- Volumen con la pinza (evento `nivel`), deliberadamente simple. **Solo se activa desde el menú**
  (opción «ajustar volumen», que llama a `iniciarNivel()`), para que no se dispare sin querer; si no se
  juntan los dedos en `esperaNivelMs` (8 s), se cancela:
  - Medida = distancia en pantalla entre las puntas de pulgar e índice ÷ tamaño de la mano en
    pantalla (muñeca → nudillo del corazón), `separacionEnPantalla`. Es la línea que se dibuja; dividir
    por el tamaño de la mano hace que no dependa de la distancia a la cámara.
  - Medida ≤ `nivelCero` (0,25) = 0 %; ≥ `nivelLleno` (1,0) = 100 %; en medio, lineal, redondeado a
    escalones de 10 % (`pasoNivel`) con un poco de histéresis (`histeresisNivel`).
  - Para empezar se juntan los dedos por debajo de `nivelCero` ~0,15 s (con el índice no metido en un
    puño). Se confirma quedándose quieto ~1 s (`confirmarNivelMs`).
  - Calibración guiada: `fijarEscalaNivel(juntos, abiertos)`; en la demo, botón «Calibrar volumen» y
    deslizadores para los umbrales. En la demo ajusta de verdad el volumen de la voz.
- Palma: solo cuenta si la palma (no el dorso) mira a la cámara (`palmaHaciaCamara`), según la mano
  detectada y el orden de los nudillos en la imagen.
- Puño: desactivado por defecto (`usarPuno: false`): no se emite ni termina el ajuste de volumen.
- Menú: tras abrirlo con ✌️, se pone ☝️ y se lleva el puntero (la punta del índice) encima de una
  opción, manteniéndolo `elegirMenuMs` (~0,5 s). Las opciones ocupan zonas fijas de la pantalla en
  cruz (tercios, `sectorEnPantalla`); con ✌️ o en el centro no se elige nada; se cierra solo a los 5 s.
- Mano usada: se detecta qué mano usa el usuario (`manoUsada`, votación suavizada de la etiqueta de
  MediaPipe; `invertirLateralidad` por si sale al revés). En el menú se quita el lado de esa mano
  (`sectoresMenu`, `menuPara`): quedan ↑ ajustar volumen, ↓ repetir y, en el lado contrario, pedir ayuda.
  Si no se sabe la mano, salen las 4 (→ dictar).
- Cabeza: `crearRastreador(..., { cara: true })` o `rastreador.activarCara(true)` (otro modelo, ~4 MB;
  se analiza 1 de cada 2 frames).
- Señalar + voz: solo en la demo, con el reconocimiento de voz del navegador (Chrome/Edge; Firefox no lo tiene).

Los tiempos y umbrales están en `OPCIONES_POR_DEFECTO` (`interaccion.ts`) y `OPCIONES_CABEZA` (`cabeza.ts`).

## Uso
```ts
import { InteraccionManos, crearRastreador, accionDe } from "./input/index.ts";

const interaccion = new InteraccionManos();      // { espejo: false } si la cámara mira al papel desde arriba
interaccion.on((e) => {
  const accion = accionDe(e, "documento");       // "leer" | "pausar" | ... | null
  // e.tipo === "puntero" / "seleccion": e.documento es {x,y} en [0,1] dentro del documento, o null
});
await crearRastreador(videoElement, (frame) => interaccion.procesar(frame));
interaccion.fijarDocumento(esquinas);            // esquinas del papel en la imagen (de B1)
```

Coordenadas: `imagen` es la posición normalizada [0,1] en el frame de la cámara **sin espejo**
(las mismas que usa B1). `documento` se calcula con una homografía a partir de las 4 esquinas del
papel (sup-izq, sup-der, inf-der, inf-izq), así encaja con las cajas de texto del mensaje `document`.

## Probar
```bash
node --test 'web/src/input/test/*.test.ts'
```
Demo con la cámara (necesita Vite; se puede lanzar sin instalar nada en el repo):
```bash
npx vite@5.4.11 web/src/input
```
y abrir http://localhost:5173/demo/. Para marcar el documento, pulsa el botón y haz clic en sus 4
esquinas tal como las ves. Sin acceso a jsDelivr, sirve `@mediapipe/tasks-vision` en local y pasa
`?mp=<ruta>`.

## Archivos
- `tipos.ts`: tipos e índices de los landmarks.
- `poses.ts`: pose estática (rectitud de cada dedo; no depende de la rotación ni la distancia).
- `interaccion.ts`: estabilización de gestos, deslizar, puntero filtrado, selección por permanencia y los experimentales (dormir/despertar, nivel con la pinza, menú radial, cabeza).
- `acciones.ts`: eventos a acciones de la app, por contexto, y opciones del menú radial.
- `cabeza.ts`: asentir y negar (experimental).
- `geometria.ts`, `filtro.ts`: homografía y filtro One Euro.
- `rastreador.ts`: único archivo que depende de MediaPipe y del DOM.
- `demo/`: página de prueba. `test/`: tests con manos sintéticas.
