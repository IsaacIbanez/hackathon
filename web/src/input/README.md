# Módulo de manos (rol C — T6, parte de gestos)

Convierte los landmarks de la mano (MediaPipe HandLandmarker, en el navegador) en eventos y acciones
de la app. Sin dependencias de npm: MediaPipe se carga en tiempo de ejecución desde jsDelivr
(`@mediapipe/tasks-vision@0.10.21`) y el modelo desde Google Storage.

## Gestos y acciones por defecto
| Gesto | Cómo | Acción (`accionDe`) |
|---|---|---|
| 👍 pulgar arriba | mantener ~0,3 s, mano quieta | `leer` |
| ✋ palma abierta | mantener ~0,3 s, mano quieta | `pausar` |
| ✌️ victoria | mantener ~0,3 s | `repetir` |
| mano abierta deslizando | ≥20 % del ancho en ≤0,4 s | `siguiente` (a la derecha del usuario) / `anterior` |
| ☝️ señalar | el puntero sigue la punta del índice | evento `puntero` (~15 por segundo como máximo) |
| ☝️ señalar quieto | ~0,9 s dentro de un radio pequeño | `explicar_aqui` (evento `seleccion`) |

El mapa de gestos a acciones está en `acciones.ts` (`MAPA_GESTOS`) y los tiempos y umbrales en
`OPCIONES_POR_DEFECTO` (`interaccion.ts`). Pensado para accesibilidad: gestos que se mantienen
(no hace falta precisión ni rapidez), filtro One Euro contra el temblor y "clic por permanencia".

## Uso
```ts
import { InteraccionManos, crearRastreador, accionDe } from "./input/index.ts";

const interaccion = new InteraccionManos();      // { espejo: false } si la cámara mira al papel desde arriba
interaccion.on((e) => {
  const accion = accionDe(e);                    // "leer" | "pausar" | ... | null
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
- `interaccion.ts`: estabilización de gestos, deslizar, puntero filtrado y selección por permanencia.
- `acciones.ts`: eventos a acciones de la app.
- `geometria.ts`, `filtro.ts`: homografía y filtro One Euro.
- `rastreador.ts`: único archivo que depende de MediaPipe y del DOM.
- `demo/`: página de prueba. `test/`: tests con manos sintéticas.
