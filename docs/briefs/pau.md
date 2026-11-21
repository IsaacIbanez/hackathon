# Brief de Pau (P4)
Confirmado por Pau el 2026-11-21 23:12. Última revisión: 2026-11-21 23:12.

## Objetivo
Subtítulos en directo de lo que se oye en una conferencia o una reunión (el micrófono y, si se quiere, el audio de una llamada), con quién habla y traducción automática al idioma elegido, y la transcripción guardada en un documento de texto. Para quien no oye bien, no entiende el idioma o necesita la letra muy grande. Es una utilidad base de la app.

## Qué se verá en la demo
- Alguien habla en español delante de la MX Brio, cuyos micros captan el audio, y los subtítulos aparecen palabra a palabra en letra muy grande y alto contraste, con «Speaker 1» o «Speaker 2».
- Al terminar cada frase sale debajo su traducción, por ejemplo al inglés, y se ve el coste acumulado.
- Se comparte una pestaña con un vídeo o una llamada y también la subtitula.
- Al parar, queda un `.txt` con la transcripción original y la traducción.

## Alcance
- **Go, en un paquete nuevo `backend/captions`:** un WebSocket `GET /captions` en el 8765 que recibe audio PCM del navegador y lo pasa al modo en directo de Together (`wss://api.together.ai/v1/realtime`).
  - Modelo `nvidia/nemotron-3.5-asr-streaming-0.6b`, que se cambia con `CAPTIONS_ASR_MODEL`.
  - Clave en `TOGETHER_API_KEY`, en `.env` y nunca en el repo.
  - El navegador nunca ve la clave.
- **Parciales y frases finales:** el texto parcial se actualiza mientras se habla, y la frase queda fija con la pausa (VAD de Together).
- **Traducción:** solo de las frases finales, con `Qwen/Qwen3.5-9B` en Together (`CAPTIONS_TRANSLATE_MODEL`). Las frases repetidas salen de una caché. El idioma de destino se elige y se puede cambiar en directo, o se deja en «no traducir».
- **Idioma hablado:** se detecta solo o se elige. Lo que importa es el español y el inglés; el catalán no es prioritario.
- **Diarización (quién habla):**
  - En directo, aproximada: cada 30 s, con tramos solapados 10 s, Go manda el audio a `openai/whisper-large-v3` por lotes con `diarize=true` y etiqueta por la hora las frases ya mostradas. Las voces de un tramo y del siguiente se emparejan con el texto que comparten.
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
- [ ] `git grep tgp_v1` no encuentra nada, y `task check` pasa.

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
| Subtítulos en directo | Nemotron 3.5 (o Parakeet si Nemotron no entiende español) | 0,0045 $/min (Parakeet, 0,0035) ≈ 0,27 $/h |
| Diarización en directo | `whisper-large-v3` por lotes, tramos de 30 s con 10 s de solape | ≈ 0,0015 $/min × 1,33 ≈ 0,12 $/h |
| Diarización final | `whisper-large-v3` por lotes, una sola pasada | ≈ 0,09 $/h |
| Traducción | `Qwen/Qwen3.5-9B` (0,17 $ / 0,25 $ por millón de tokens), solo frases finales y con caché | < 0,01 $/h |
| Respaldo | Whisper local | 0 $ |

Total: unos 0,5 $/h. El tope por sesión es de 1 $ (`CAPTIONS_LIMIT_USD`).

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
- **Idiomas de Nemotron:** no está documentado que Nemotron 3.5 entienda español en directo. Es lo primero que se prueba. Si no, por defecto `nvidia/parakeet-tdt-0.6b-v3`, que entiende 25 idiomas europeos, español incluido, y los detecta solo.
- **Autenticación de Together:** su documentación da dos formas distintas para el modo en directo. Se usa la de la referencia (cabecera `Authorization: Bearer`) y se prueba con la clave real.
- **Etiquetas en directo:** las de quién habla pueden cambiar entre tramos. Son aproximadas por diseño; las buenas son las del `.txt` final.
- **Audio de la llamada en Wails:** WebView2 puede no permitirlo. La demo de esa parte se puede hacer en Chrome.
- **Go:** no estaba instalado en el PC de Pau. Se instala con `winget install GoLang.Go`.
- **La clave:** se pegó en el chat de la sesión. Hay que regenerarla en Together después de la hackathon.

## Preguntas abiertas
- Qué modelo de subtítulos se queda por defecto (Nemotron o Parakeet): se decide tras la primera prueba en español.
- Dónde exactamente registra Isaac la ruta, si prefiere otro sitio que `mux.go`.

## Cambios del brief
- 2026-11-21 23:12 — Primera versión, confirmada por Pau: diarización (en directo aproximada y final exacta), transcripción guardada en `.txt`, historial que no desaparece y catalán no prioritario.
