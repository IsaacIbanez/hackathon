# Probar los gestos y la voz (5 minutos, sin escáner)

No hace falta papel: la app usa un **formulario de ejemplo** y **toda la imagen de tu webcam hace de papel**. Los campos se dibujan encima de tu imagen, así que ves dónde está cada uno y dónde apunta tu dedo.

## 1. Arrancar
1. En la raíz del repo: `task dev` (la primera vez tarda un poco).
2. Abajo, despliega **Developer tools** → pulsa **Send sample document**. A la derecha sale el formulario en letra grande y la app lo explica en voz alta.
3. Pulsa **Turn on hand gestures** y da permiso a la cámara.

Verás tu imagen (como un espejo) con **cuatro recuadros blancos**: título arriba, nombre y fecha debajo, firma abajo a la derecha.

## 2. Señalar
- Levanta la mano y **estira solo el índice** (los otros dedos cerrados), con la palma mirando a la cámara o de lado.
- Sale un **punto azul** donde apunta tu dedo y, encima del vídeo, el texto **«☝️ Pointing»**. Si no sale, el gesto no se reconoce: acerca la mano, mejora la luz o cierra más los otros dedos.
- Lleva el punto azul a un recuadro: se **pone amarillo**, arriba aparece **su texto en grande** y la app **lo lee** al instante (sin IA).
- Sal del recuadro y vuelve: lo **vuelve a leer**. Quedarte dentro no repite.

## 3. Preguntar con la voz
- Con **Ask with my voice** marcado, **mantén el punto azul quieto ~1 s** sobre un recuadro → «Listening…» y un pitido → pregunta en voz alta, por ejemplo **«¿Qué tengo que poner aquí?»**.
- Tu frase sale en azul; la respuesta llega en 2–5 s, hablando del campo señalado. La primera vez descarga el modelo de voz (~40 MB).
- Si no dices nada, pregunta por defecto «¿qué pone aquí?».
- Sin la casilla, mantener quieto pide directamente la explicación del campo.

## 4. Otros gestos
| Gesto | Hace |
|---|---|
| ✋ palma abierta, quieta | calla |
| 👍 | continúa lo que se pausó (o resume el documento) |
| ✌️ y luego apuntar a una opción | menú: repetir, volumen, ayuda |

## Si algo no va
| Pasa | Prueba |
|---|---|
| No sale el punto azul | más luz, mano más cerca (40–70 cm), solo el índice estirado |
| El punto va al revés | no debería: avisa (se corrigió el espejo el 2026-11-21) |
| Lee el campo de al lado | los recuadros tienen un margen de alcance; apunta al centro del recuadro |
| No responde a preguntas | mira «Developer tools» (dictado y voces) y `build/bin/lauzhack.log` si usas el `.exe` |

Cuando el escáner esté conectado, los recuadros serán los del papel real y no la imagen entera.
