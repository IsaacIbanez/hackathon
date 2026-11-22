# Brief de Pau (P4)
Confirmado por Pau el 2026-11-21 23:12. Última revisión: 2026-11-22 00:35 (idiomas mezclados, barbarismos y mejor diarización, pedidos por Pau).

## Objetivo
Subtítulos en directo de lo que se oye en una conferencia o una reunión (el micrófono y, si se quiere, el audio de una llamada), con quién habla y traducción automática al idioma elegido, y la transcripción guardada en un documento de texto. Para quien no oye bien, no entiende el idioma o necesita la letra muy grande. Es una utilidad base de la app.

## Qué se verá en la demo
- Alguien habla en español delante de la MX Brio, cuyos micros captan el audio, y los subtítulos aparecen palabra a palabra en letra muy grande y alto contraste, con «Speaker 1» o «Speaker 2».
- Al terminar cada frase sale debajo su traducción, por ejemplo al inglés, y se ve el coste acumulado.
- Se comparte una pestaña con un vídeo o una llamada y también la subtitula.
- Al parar, queda un `.txt` con la transcripción original y la traducción.

## Alcance
- **Go, en un paquete nuevo `backend/captions`:** un WebSocket `GET /captions` en el 8765 que recibe audio PCM del navegador y lo pasa al modo en directo de Together (`wss://api.together.ai/v1/realtime`).
  - Modelo `nvidia/parakeet-tdt-0.6b-v3`, que se cambia con `CAPTIONS_ASR_MODEL`. Detecta solo 25 idiomas europeos y entiende frases con dos idiomas mezclados.
  - Clave en `TOGETHER_API_KEY`, en `.env` y nunca en el repo.
  - El navegador nunca ve la clave.
- **Parciales y frases finales:** el texto parcial se actualiza mientras se habla, y la frase queda fija con la pausa (VAD de Together).
- **Idioma, barbarismos y traducción:** una sola llamada por frase final a `Qwen/Qwen3.5-9B` en Together (`CAPTIONS_TRANSLATE_MODEL`, sin razonamiento), con las frases anteriores y el idioma habitual de quien habla como contexto. Hace tres cosas:
  - da el idioma principal de la frase;
  - pone entre comillas las palabras de otro idioma (`el "meeting"`; `Okay, "hasta luego"` dicho por quien habla inglés);
  - la traduce al idioma de destino, que se elige y se cambia en directo (o «no traducir»).
  - Go comprueba que el modelo solo ha añadido comillas; si ha cambiado alguna palabra, se queda el texto original.
  - Cuando se sabe quién la dijo y esa persona suele hablar otro idioma, la frase se revisa otra vez. El cambio solo se acepta si el idioma cambia y el modelo marca palabras extranjeras.
- **Idioma hablado:** se detecta solo, y cada persona puede hablar uno distinto, o se fuerza uno. Lo que importa es el español y el inglés; el catalán no es prioritario.
- **Diarización (quién habla):**
  - Selector «People speaking» (no sé, 1–6): se pasa a la diarización (`max_speakers` en directo; `min_speakers = max_speakers` en la pasada final).
  - En directo, aproximada: cada 15 s, con tramos de 45 s solapados 30 s, Go manda el audio a `nvidia/parakeet-tdt-0.6b-v3` por lotes con `diarize=true`. Etiqueta por la hora las frases ya mostradas, y empareja las voces de un tramo y del siguiente por lo que dicen en el solape.
  - El idioma también sirve de pista: con 2 personas o más y tantos idiomas como personas (cada una habla el suyo), cada idioma es de una persona. Las frases de 4 palabras o más siguen al idioma; las cortas de una persona conocida siguen a la voz, porque ahí están los barbarismos. Si no se dice cuántas personas hay, no se parte en dos a una persona bilingüe.
  - La pasada final conserva la numeración que ya se veía en pantalla.
  - Al parar, exacta: una pasada con diarización sobre toda la grabación, para el documento guardado.
- **Página propia (`web/src/captions/`):**
  - el micrófono que se elija (la MX Brio si está) y, opcionalmente, el audio de una pestaña o de una llamada (`getDisplayMedia`), mezclados y convertidos a 16 kHz mono de 16 bits;
  - **historial que no desaparece**: lista que crece, con hora, persona, original y traducción, y que baja sola al final salvo que se haya subido a leer (botón «Jump to latest»);
  - letra de 32 px como mínimo, alto contraste y `aria-live` en las frases finales;
  - botón «Download transcript».
- **Documento guardado:** Go escribe `Documentos/LauzHack/captions-AAAA-MM-DD-HHMM.txt`, fuera del repo, cada minuto y al parar. Primero va el original con la hora y la persona; después, si se ha traducido, la traducción.
- **Coste visible** en la página, con un tope por sesión de **1 $** (`CAPTIONS_LIMIT_USD`): al llegar se para y se avisa.
- **Si falla Together o la red:**
  - aviso claro y reintento solo 3 veces (a 1, 2 y 4 s);
  - si sigue fallando, se ofrece **Whisper local** (`WhisperListener` de Nil), por frases y sin parciales ni diarización, con un aviso de que es peor que el modelo en línea.
- **Botón «Live captions»** en la app, que lo añade Isaac en `web/src/app`.

## Fuera de alcance
- Poner nombre propio a cada persona.
- Subtítulos por encima de otras aplicaciones (ventana flotante).
- Traducir los parciales.
- Leer la traducción en voz alta.
- Catalán como prioridad.

## Flujo, desde el punto de vista del usuario
1. Abro «Live captions» y elijo el micrófono, el idioma hablado («auto» por defecto) y el idioma de destino.
2. Si quiero, pulso «Add call audio» y elijo la pestaña o la pantalla con sonido.
3. Pulso «Start». Al hablar aparece el texto parcial y, al hacer una pausa, la frase queda fija en el historial.
4. Su traducción aparece debajo, y la etiqueta de quién habla llega a los pocos segundos.
5. Pulso «Stop». Se guarda el `.txt` con las etiquetas definitivas y la página dice dónde está.

Ejemplo concreto: digo «¿Cuándo vence el plazo del seguro?» y otra persona responde «El quince de diciembre».
- **En pantalla:**
  - `[00:00:03] Speaker 1: ¿Cuándo vence el plazo del seguro?` / *When does the insurance deadline expire?*
  - `[00:00:07] Speaker 2: El quince de diciembre.` / *On the fifteenth of December.*
- **En el `.txt`:**
  ```
  Live captions — 2026-11-21 23:30 — spoken: es — translated to: en
  == Original ==
  [00:00:03] Speaker 1: ¿Cuándo vence el plazo del seguro?
  [00:00:07] Speaker 2: El quince de diciembre.
  == Translation (en) ==
  [00:00:03] Speaker 1: When does the insurance deadline expire?
  [00:00:07] Speaker 2: On the fifteenth of December.
  ```

## Criterios de «hecho» (medibles)
- [ ] `go test ./backend/captions` con un Together falso: parcial → final → traducción, etiquetas por hora, tope de coste, falta de clave (error `no_key`), caída y reconexión, y el formato del `.txt`.
- [ ] Prueba real con el micrófono, una frase en español: el primer parcial en menos de 1,5 s y la traducción en menos de 2 s después de la frase final.
- [ ] Con dos personas hablando por turnos durante 2 minutos, el `.txt` final tiene bien la persona en al menos el 80 % de las frases.
- [ ] El audio de una pestaña con un vídeo se subtitula (en Chrome).
- [ ] Después de 5 minutos, la página sigue mostrando la primera frase, y el `.txt` tiene las dos secciones.
- [ ] El coste en pantalla coincide con la suma de lo que se usa (±10 %), y la sesión se corta en 1 $.
- [ ] Sin red: aviso en menos de 3 s, 3 reintentos y después se ofrece Whisper local, que funciona.
- [ ] Ninguna clave en el repo: buscar el prefijo de las claves de Together (`tgp_` + `v1_`) en todo el historial solo encuentra esta línea. Y `task check` pasa.

## Carpetas que toca
- **Propias (nuevas):** `backend/captions/` (acordado con Isaac) y `web/src/captions/`.
- **De otras personas, con su conformidad:**
  - Isaac:
    - una línea en `backend/session/mux.go` (o donde él diga) para registrar `/captions`, sin tocar nada más de su código;
    - el botón en `web/src/app`, que lo pone él;
    - la nota en `AGENTS.md`, que pidió Pau.
  - Nil: solo se usa su `WhisperListener` (`web/src/input/voice`), sin modificarlo.

## Contrato (`api/openapi.yaml`)
- Consume: nada de lo que hay.
- Añade `GET /captions`, en un PR aparte que revisa Isaac:
  - WebSocket con `?lang=auto|<ISO 639-1>&target=none|<ISO 639-1>`;
  - del navegador a Go: trozos binarios de PCM s16le, 16 kHz, mono (~100 ms) y `{"type":"config","target":"en"}` para cambiar el idioma de destino;
  - de Go al navegador:
    - `partial` `{text}`;
    - `final` `{id, start, text}`;
    - `speaker` `{id, speaker}`;
    - `translation` `{id, lang, text}`;
    - `cost` `{costUsd, limitUsd}`;
    - `saved` `{path}`;
    - `error` `{code, message, retryable}`.

## Modelos y coste
| Para qué | Modelo | Coste |
|---|---|---|
| Subtítulos en directo | Parakeet v3 | 0,0035 $/min ≈ 0,21 $/h |
| Diarización en directo | Parakeet v3 por lotes, tramos de 45 s cada 15 s | ≈ 0,0015 $/min × 3 ≈ 0,27 $/h |
| Diarización final | Parakeet v3 por lotes, una sola pasada | ≈ 0,09 $/h |
| Idioma, barbarismos y traducción | `Qwen/Qwen3.5-9B` (0,17 $ / 0,25 $ por millón de tokens), una llamada de ~650 tokens por frase final | ≈ 0,06 $/h |
| Respaldo | Whisper local | 0 $ |

Total: unos 0,6 $/h; medido: 0,0041 $ por 28 s de diálogo bilingüe. El tope por sesión es de 1 $ (`CAPTIONS_LIMIT_USD`).

## Si falla
- **Sin clave:** error `no_key`. La página dice «Live captions need TOGETHER_API_KEY in .env» y ofrece Whisper local.
- **Sin red o Together caído:** aviso grande y 3 reintentos (1, 2 y 4 s). Si siguen fallando, se ofrece Whisper local con su aviso de calidad. El resto de la app no se ve afectado.
- **Falla la diarización:** las frases se quedan sin etiqueta, pero los subtítulos siguen.
- **Falla la traducción:** se ve el original y se marca «translation unavailable».
- **Tope alcanzado:** la sesión se para, el `.txt` se guarda y se avisa.
- **No se puede capturar el audio de la llamada** (por ejemplo, en WebView2): se sigue solo con el micrófono, y se avisa.

## Dependencias de otras personas
- **Isaac:** revisa el PR del contrato y el registro de la ruta, y pone el botón «Live captions» en la app.
- **Nil:** su `WhisperListener` es el respaldo local. Si cambia su interfaz, hay que avisar.

## Riesgos
- **La diarización de Together con dos idiomas que se turnan:** mezcla las voces. Con Whisper se pierden además las frases del otro idioma, porque solo transcribe uno. Mitigado con Parakeet y con el idioma como pista. Con un solo idioma funciona bien (5/5 y 18/18).
- **Frases cortas con una voz mal asignada** (por ejemplo «Perfecto. Gracias.»): siguen a la voz y pueden salir con la persona equivocada.
- **Errores de oído en los barbarismos:** «hasta luego» dicho con acento inglés sale como «Asta Luego». Se marca entre comillas, pero no se corrige la ortografía, porque el modelo no puede cambiar palabras.
- **Autenticación de Together:** su documentación da dos formas distintas para el modo en directo. Se usa la de la referencia (cabecera `Authorization: Bearer`) y se prueba con la clave real.
- **Etiquetas en directo:** las de quién habla pueden cambiar entre tramos. Son aproximadas por diseño; las buenas son las del `.txt` final.
- **Audio de la llamada en Wails:** WebView2 puede no permitirlo. La demo de esa parte se puede hacer en Chrome.
- **Go:** no estaba instalado en el PC de Pau. Se instala con `winget install GoLang.Go`.
- **La clave:** se pegó en el chat de la sesión. Hay que regenerarla en Together después de la hackathon.

## Preguntas abiertas
- Probar la diarización con voces humanas reales: las pruebas son con voces sintéticas de Windows, que el servicio separa peor.
- Dónde exactamente registra Isaac la ruta, si prefiere otro sitio que `mux.go`.

## Cambios del brief
- 2026-11-22 00:35 — A petición de Pau: mejor diarización, una persona en cada idioma y barbarismos entre comillas.
  - Parakeet v3 pasa a ser el modelo de subtítulos y de diarización. Con idiomas mezclados, Nemotron partía palabras y se inventaba texto; Whisper solo transcribe uno de los idiomas.
  - Una llamada a Qwen por frase final para el idioma, las comillas y la traducción.
  - Selector «People speaking», el idioma como pista para saber quién habla, tramos en directo de 45 s y numeración estable.
  - Contrato 0.8: `speakers`, `revise` y `lang` en `final`.
  - Medido con voces sintéticas, diálogo español/inglés de 28 s: idioma, comillas y traducción bien en 8/8 frases; quién habla, 7/8 (antes, 2/8 y 3 frases sin persona). El diálogo solo en español sigue en 5/5.
- 2026-11-21 23:50 — Probado con Together de verdad (diálogo sintético de 2 voces, 17 y 52 s):
  - Nemotron 3.5 entiende el español y se queda como modelo por defecto: primer parcial ~0,7 s después de empezar a hablar; la frase se cierra ~0,3 s tras la pausa.
  - Traducción con el razonamiento de Qwen desactivado: 0,1–0,4 s por frase.
  - Quién habla: 18/18 frases bien en el `.txt` y 10/10 en directo.
  - La diarización en directo pasa de cada 30 s a cada 15 s, para que las etiquetas lleguen antes (+0,03 $/h).
  - Coste real: 0,0025 $ por 17 s de audio, con todo.
- 2026-11-21 23:12 — Primera versión, confirmada por Pau: diarización (en directo aproximada y final exacta), transcripción guardada en `.txt`, historial que no desaparece y catalán no prioritario.
