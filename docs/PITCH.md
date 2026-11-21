# Pitch y demo (T10)

Guion de la presentación y de la demo. Cifras medidas el 2026-11-21 (ver «Cifras»); lo que aún no funciona está marcado con ⏳ y **no se promete en el escenario**.

## La idea en una frase
Una persona con baja visión pone una carta o un formulario delante de la cámara; la app le dice qué es y qué tiene que rellenar, le lee el campo que señala con el dedo y le responde lo que pregunta, en lenguaje sencillo y casi sin coste de IA.

## Guion (3 minutos)
| Tiempo | Quién | Qué se dice / se hace |
|---|---|---|
| 0:00–0:30 | Isaac | **El problema.** Cartas del seguro, del banco, de la administración: para una persona con baja visión cada papel es una barrera y depende de que alguien se lo lea. |
| 0:30–0:45 | Isaac | **La solución.** La webcam de Logitech como ojos de la IA, la mano como puntero y la voz como interfaz. |
| 0:45–2:15 | Demo (ver abajo) | Papel delante de la cámara → explicación → señalar un campo → preguntar → coste en pantalla. |
| 2:15–2:45 | Isaac | **Cómo es frugal (AXA).** Lo local primero: encuadre, lectura del campo señalado y gestos no gastan IA. El modelo barato explica; el caro solo si el barato duda. El coste se ve en pantalla. |
| 2:45–3:00 | Isaac | **Impacto (IMC) y cierre.** Pensado con y para organizaciones de personas con discapacidad visual; funciona en local, en un portátil con una webcam. |

## La demo, paso a paso
Preparación: ver «Checklist». Pantalla: izquierda explicación + gestos + coste; derecha el documento en letra grande.

1. **Enseñar el formulario** (declaración de siniestro) a la MX Brio. ⏳ *Depende del scanner de B (`POST /message`).*
   La app dice en ~2 s: «Este documento es una declaración de siniestro de AXA Seguros… Debe escribir su nombre y apellidos, y la fecha del siniestro… Después tiene que firmar…». En pantalla se resaltan los campos.
2. **Señalar con el dedo** el campo de la fecha → la app lo lee al instante («Fecha del siniestro»), **sin IA**.
3. **Mantener el dedo quieto** (o preguntar «¿Qué tengo que poner aquí?» ⏳ *dictado por voz, rol C*) → «Aquí tiene que escribir la fecha en que ocurrió el siniestro… día, mes y año».
4. **Palma abierta** → se calla. **👍** → resume el documento.
5. **Señalar el recuadro de coste**: «todo esto ha costado 0,0003 $».

### Plan B (si algo falla en directo)
| Falla | Qué hacer |
|---|---|
| El scanner o la cámara del papel | «Developer tools» → **Send sample document** (mismo formulario); o `python api/examples/send_message.py api/fixtures/document.json` |
| Los gestos | Seguir con el resto; el puntero también se puede contar con la pantalla |
| Internet / OpenRouter | Quitar la clave del `.env` y reiniciar: la app responde con las respuestas de ejemplo (fixtures). Avisarlo con naturalidad («modo sin conexión») |
| El modelo gratis da 429 | No usar `LLM_PROFILE=dev` en la demo (ver Checklist) |

## Cómo encaja cada challenge
| Challenge | Qué valoran | Qué enseñamos (verificable) |
|---|---|---|
| **Logitech** | Webcam como ojos y oídos de la IA, entradas multimodales, flujos con contexto | MX Brio para el documento (captura 4K, frame más nítido, `scanner/`); manos con MediaPipe (`web/src/input`); el contexto se comparte: lo que se señala da sentido a lo que se pregunta («¿qué pongo **aquí**?») |
| **IMC Tech for Good** | Utilidad real, calidad técnica, impacto social, presentación; ONG de educación, inclusión o comunidad | Accesibilidad desde el diseño: letra grande, alto contraste, foco visible, todo por voz, confirmación de cada gesto (`aria-live`), lectura de líneas dudosas marcada como «(unclear)» |
| **AXA** | App real (no notebook), frugalidad, reto técnico propio, trabajo en equipo, presentación; se resta por «AI slop» | App de escritorio real (Wails + Go + React); enrutado barato → caro solo con duda; respuestas locales sin IA; caché; coste visible en pantalla; documento de seguros real como caso de uso |

**ONG para IMC (por confirmar por el equipo):** una federación de personas ciegas y con baja visión (por ejemplo, en Suiza la Fédération suisse des aveugles et malvoyants, o la ONCE en España). Comprobar el nombre exacto antes de citarla.

## Cifras (medidas, no estimadas)
| Qué | Valor | Cómo se midió |
|---|---|---|
| Explicar el formulario con Haiku (barato, de pago) | **1,8 s · 0,00012 $** | servidor real, `api/fixtures/document.json`, 2026-11-21 |
| Responder «¿Qué tengo que poner aquí?» | **1,7 s · 0,00017 $** | ídem |
| Leer el campo señalado | **instantáneo · 0 $** (local) | ídem |
| Lo mismo con modelos gratuitos (`LLM_PROFILE=dev`) | 2–4 s · 0 $ | nemotron, varias pruebas |
| Presupuesto de 10 $ | ≈ **70.000** explicaciones o preguntas con Haiku | 10 $ ÷ ~0,00014 $ |
| Captura de la MX Brio | 4K, ~0,4 s en modo servidor | `scanner/README.md` (Pau) |
| Tests automáticos | 49 del frontend + Go (sesión, cliente, WebSocket, contrato) | `task check`, CI en verde |

## Preguntas difíciles (y respuesta corta)
- **¿Y si la IA se equivoca?** Solo explica lo que el OCR ha leído y no inventa contenido (está en las instrucciones al modelo); marca las líneas dudosas; si la respuesta barata no es válida, escala al modelo caro.
- **¿Privacidad?** Cámara, gestos y OCR en local; los servidores solo escuchan en 127.0.0.1; al modelo solo va el texto del documento, no la imagen. La clave nunca está en el repositorio.
- **¿Por qué no mandar la foto a un modelo grande y ya?** Coste y latencia: con nuestro enrutado, señalar y encuadrar no cuestan nada y explicar cuesta 0,0001 $. Es el criterio de AXA.
- **¿Funciona sin internet?** El encuadre, la lectura del campo señalado y los gestos sí; la explicación necesita el modelo. Con un modelo local se podría (no lo hemos hecho).
- **¿Qué habéis construido vosotros?** Contrato y servidor en Go con sesión compartida, enrutado frugal con caché y contador, captura 4K con selección del frame más nítido, OCR a PDF buscable (⏳ en la rama de Didac), módulo de gestos con MediaPipe, puente gestos → IA. Ver `AGENTS.md` y los PRs.

## Checklist antes de presentar
- [ ] `git pull` en `main` y `task check` en verde en el portátil de la demo; `wails build` y abrir `build/bin/lauzhack.exe`.
- [ ] «Developer tools»: voces en español y cámara en «yes»; si algo falla, mirar `build/bin/lauzhack.log`.
- [ ] `.env` con la clave y **sin** `LLM_PROFILE=dev` (Haiku: más rápido y sin 429; coste de la demo < 0,01 $).
- [ ] MX Brio conectada y probada; webcam para las manos si se usan dos cámaras (decisión pendiente).
- [ ] Formulario impreso en grande, buena luz, sin reflejos.
- [ ] Volumen del portátil alto; voz en español instalada en el sistema.
- [ ] Ensayo completo cronometrado (3 min) al menos dos veces.
- [ ] Plan B probado: «Send sample document» y modo sin clave.

## Pendiente (equipo)
- ⏳ Scanner de B enviando `document` con `POST /message` (guía: `docs/INTEGRACION_SCANNER.md`).
- ⏳ Decidir quién usa cada cámara.
- ⏳ Dictado por voz (rol C, hook `onDictate` listo).
- ⏳ Elegir y confirmar la ONG para IMC.
- ⏳ Repartir quién habla en cada parte del guion.
