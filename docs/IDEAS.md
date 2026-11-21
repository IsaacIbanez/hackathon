# Lluvia de ideas: funciones nuevas (T16)

Cada persona añade **al menos 3 ideas** (una línea cada una). En el siguiente punto de sincronización se eligen 1–2 por su relación **impacto para la demo / esfuerzo**, y pasan a `TAREAS.md`.

Criterios (ver `docs/PITCH.md`): sirve de verdad a una persona con baja visión · se ve en una demo de 3 min · encaja con Logitech (cámara con contexto), IMC (inclusión) o AXA (IA frugal) · cabe en las horas que quedan.

| Idea | Quién la propone | Challenge | Impacto (1–3) | Esfuerzo (1–3) | Notas |
|---|---|---|---|---|---|
| **Rellenar el formulario por voz**: «dicta tu nombre» → se apunta en el campo y se lee para confirmar | Isaac | IMC, Logitech | 3 | 3 | Está en la idea original; hay que guardar las respuestas por campo |
| **Plazos e importes**: «tienes que responder antes del 15 de diciembre; importe: 230 €» al leer una carta | Isaac | IMC, AXA | 3 | 1 | Solo prompt + resaltar los bloques |
| **Aviso de posible estafa** (cartas que piden datos o pagos urgentes) | Isaac | IMC | 2 | 1 | Solo prompt; cuidado con no asustar |
| **Varias páginas**: «siguiente página» con ✋↔ y el documento se acumula | Isaac | Logitech | 2 | 2 | El contrato ya tiene ids por bloque |
| **Guía de encuadre por voz** antes de leer: «acerca el papel», «hay un reflejo», «inclínalo menos», «ya está, quieto» | Didac | Logitech, IMC, AXA | 3 | 1 | El scanner ya da `quality.issues` (`too_far`, `glare`, `tilted`, `cropped`, `blurry`) y las esquinas; solo hay que decirlo en voz y repetir la foto. No se gasta IA con una mala foto |
| **«Guárdalo» / «envíalo»**: el documento queda como PDF buscable (o el digital, limpio) listo para mandar a la aseguradora o a un familiar | Didac | AXA, IMC | 2 | 1 | Los dos PDF ya se generan (`scan.py`); falta la orden de voz y dónde se guarda o a quién se manda (con confirmación) |
| **Versión en letra grande**: el PDF digital rehecho a 24 pt y alto contraste, para leerlo en pantalla o imprimirlo | Didac | IMC | 2 | 2 | Sale de la maqueta del PDF digital (bloques en orden de lectura); solo cambia la composición, 0 $ más |
| **Lectura en voz alta línea a línea**, resaltando en la pantalla la línea que se lee y con «repite» / «sigue» | Didac | IMC, Logitech | 3 | 2 | Usa las cajas de los `blocks` (una por línea) y el `speak` que ya existe |
| | | | | | |
