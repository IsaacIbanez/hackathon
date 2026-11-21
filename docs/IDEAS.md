# Lluvia de ideas: funciones nuevas (T16)

Cada persona añade **al menos 3 ideas** (una línea cada una). En el siguiente punto de sincronización se eligen 1–2 por su relación **impacto para la demo / esfuerzo**, y pasan a `TAREAS.md`.

Criterios (ver `docs/PITCH.md`): sirve de verdad a una persona con baja visión · se ve en una demo de 3 min · encaja con Logitech (cámara con contexto), IMC (inclusión) o AXA (IA frugal) · cabe en las horas que quedan.

| Idea | Quién la propone | Challenge | Impacto (1–3) | Esfuerzo (1–3) | Notas |
|---|---|---|---|---|---|
| **Rellenar el formulario por voz**: «dicta tu nombre» → se apunta en el campo y se lee para confirmar | Isaac | IMC, Logitech | 3 | 3 | Está en la idea original; hay que guardar las respuestas por campo. **Hecho por Nil en #29** (deletreo, lectura letra a letra, solo se guarda al confirmar) |
| **Plazos e importes**: «tienes que responder antes del 15 de diciembre; importe: 230 €» al leer una carta | Isaac | IMC, AXA | 3 | 1 | Solo prompt + resaltar los bloques |
| **Aviso de posible estafa** (cartas que piden datos o pagos urgentes) | Isaac | IMC | 2 | 1 | Solo prompt; cuidado con no asustar |
| **Varias páginas**: «siguiente página» con ✋↔ y el documento se acumula | Isaac | Logitech | 2 | 2 | El contrato ya tiene ids por bloque |
| **«¿Dónde firmo?» guiado**: la app lleva el dedo hasta el campo con voz y un pitido que se acelera («más a la derecha… baja… ahí») | Nil | Logitech, IMC | 3 | 2 | Puntero + cajas de los bloques (ya existen); con `pageCorners` funciona sobre el papel real |
| **Lupa por gesto**: señalar y mantener → la zona del papel aparece ampliada en pantalla, en alto contraste | Nil | IMC, Logitech | 3 | 1 | Recortar la foto alrededor del puntero; sin modelo (0 $). Coincide con la de Pau |
| **Pedir ayuda por videollamada con gestos**: «llama a mi hija» y, en la llamada, ✋ levanta la mano y 👍 silencia (Meet, Zoom, Teams) | Nil | Logitech | 2 | 1 | Gesture Control (#20) ya pulsa los atajos de las llamadas |
| **Sí/no con la cabeza** para quien no puede usar las manos: asentir = «sí, guárdalo / sigue», negar = «no / para» | Nil | IMC | 2 | 1 | `HeadGestureDetector` ya existe; conectarlo a la confirmación del dictado (#29) |
| **Disparo automático**: la foto se hace sola cuando el papel está quieto y nítido, sin buscar un botón | Pau | Logitech, IMC | 3 | 1 | `captureStill` ya mide la nitidez; falta comparar frames seguidos para saber que no se mueve. Se avisa con un pitido |
| **Guía de encuadre por voz** antes de la foto: «acércalo», «muévelo a la izquierda», «hay un reflejo» | Pau | IMC, AXA | 3 | 2 | En local, sin IA: brillo, nitidez y `pageCorners` (si la hoja se sale o está lejos). Sin esto, quien no ve no sabe si el papel está dentro |
| **Lupa sobre la zona señalada**: ampliar en pantalla, con alto contraste, lo que hay bajo el dedo | Pau | IMC, Logitech | 2 | 1 | Para quien tiene resto visual. Es recortar la foto 4K alrededor del puntero; no gasta IA |
| **«El papel está al revés»**: detectarlo y pedir que lo gire antes de leer | Pau | IMC, AXA | 2 | 2 | Con la confianza del OCR (baja al revés) o probando la foto girada 180°; evita una lectura absurda y una llamada cara |
| **Guía de encuadre por voz** antes de leer: «acerca el papel», «hay un reflejo», «inclínalo menos», «ya está, quieto» | Didac | Logitech, IMC, AXA | 3 | 1 | El scanner ya da `quality.issues` (`too_far`, `glare`, `tilted`, `cropped`, `blurry`) y las esquinas; solo hay que decirlo en voz y repetir la foto. No se gasta IA con una mala foto |
| **«Guárdalo» / «envíalo»**: el documento queda como PDF buscable (o el digital, limpio) listo para mandar a la aseguradora o a un familiar | Didac | AXA, IMC | 2 | 1 | Los dos PDF ya se generan (`scan.py`); falta la orden de voz y dónde se guarda o a quién se manda (con confirmación) |
| **Versión en letra grande**: el PDF digital rehecho a 24 pt y alto contraste, para leerlo en pantalla o imprimirlo | Didac | IMC | 2 | 2 | Sale de la maqueta del PDF digital (bloques en orden de lectura); solo cambia la composición, 0 $ más |
| **Lectura en voz alta línea a línea**, resaltando en la pantalla la línea que se lee y con «repite» / «sigue» | Didac | IMC, Logitech | 3 | 2 | Usa las cajas de los `blocks` (una por línea) y el `speak` que ya existe |
| | | | | | |
