# Brief de Didac (P2): lectura guiada
Confirmado por Didac el 2026-11-21. Última revisión: 2026-11-21.

## Objetivo
Una persona con baja visión escucha un documento escaneado **línea a línea sin perderse**:
- la línea que suena aparece resaltada en pantalla, en letra grande y con alto contraste;
- se controla con botones y con el teclado (más adelante, con el keypad de Logitech);
- la lectura es local y gratuita, y la IA solo entra si la persona pregunta «¿qué significa esta línea?».

## Qué se verá en la demo (foco: AXA, IA frugal)
1. Se escanea la carta de renovación y se pulsa Espacio (o Num5).
2. La app lee la carta entera, con la línea actual resaltada y centrada.
3. Con ← se vuelve al plazo y con E se pregunta «¿qué significa?»: el modelo barato responde.
4. El contador enseña la diferencia: leer la carta entera, 0 llamadas y 0 $; la explicación, 1 llamada y milésimas de dólar.

## Alcance
Todo va en `web/src/document/`.
- **`reader.ts`**, la lógica pura, sin interfaz:
  - Ordena las líneas para leerlas y avanza sola.
  - Órdenes: pausa/sigue, anterior, siguiente, repetir e ir a una línea concreta.
  - Avisa de las líneas dudosas y del final del documento.
  - Tiene tests con `node --test`.
- **`GuidedReader.tsx`**, la vista:
  - Todas las líneas en letra grande; la actual, resaltada, centrada en pantalla, con `aria-current` y anunciada en una región `aria-live`.
  - Botones grandes: Anterior, Pausa/Sigue, Siguiente, Repetir y ¿Qué significa?
- **Líneas dudosas.** Se considera dudosa una línea con `confidence` < 0,6, el mismo umbral que `DocumentText`. Se lee igual, se marca en pantalla y antes se dice «no se lee bien:».
- **Atajos de teclado.** Se ignoran mientras se escribe en un campo de texto. Con las teclas del teclado numérico, el keypad de Logitech podrá emitirlos más adelante.

  | Acción | Teclas |
  |---|---|
  | Pausa / sigue | Espacio o Num5 |
  | Anterior | ← o Num4 |
  | Siguiente | → o Num6 |
  | Repetir | R o Num8 |
  | ¿Qué significa? | E o Num0 |

- **«¿Qué significa?»**: pausa la lectura y llama a `onAsk(pregunta)`. En la app se convierte en un `utterance` del tipo «¿Qué significa esta línea: «…»?». Go ya responde con el documento como contexto, así que el contrato no cambia.
- **Página de prueba** sin Go en `web/src/document/demo/`, con el `document` de la carta inventada, generado con el pipeline del escáner.
- **En el PR**, el diff exacto para que Isaac monte el componente en `App.tsx`.

## Fuera de alcance
- Controlar la lectura por voz o con gestos (es de Nil).
- Señalar una línea con el dedo.
- Ver la foto con un recuadro sobre la línea.
- El keypad de Logitech: llegará después, con las mismas teclas.
- Simplificar cada línea con IA.
- Documentos de varias páginas.
- Modo paso a paso.

## Criterios de «hecho» (medibles)
- [ ] `task check` en verde, con tests de `reader.ts` que comprueban:
  - el orden de lectura y el avance automático;
  - anterior y siguiente en el principio y en el final del documento;
  - repetir;
  - pausar y reanudar en la misma línea;
  - las líneas dudosas;
  - el final del documento;
  - la interrupción por otra voz.
- [ ] En la página de prueba, la carta (unas 36 líneas) se lee de principio a fin sin cortes.
- [ ] Cada tecla cambia de línea en menos de 300 ms.
- [ ] Todo se puede usar solo con teclado, y el lector de pantalla anuncia la línea actual.
- [ ] Leer el documento entero hace 0 llamadas a modelos y cuesta 0 $.
- [ ] En la app real, «¿Qué significa?» hace 1 llamada al modelo barato, responde en menos de 6 s y el coste aparece en `stats`.

## Carpetas que toca
- Propias: `web/src/document/` y este brief.
- De otras personas:
  - `web/src/app/App.tsx`: lo monta Isaac, con el diff que le paso en el PR.
  - `chooseVoice` de `web/src/input/voice/speaker.ts` (Nil): solo se importa, no se modifica.

## Contrato (`api/openapi.yaml`)
- Consume: `document` (`blocks`, `confidence`, `lang`) y `stats`.
- Envía: `utterance` (a través de `onAsk`, conectado por la app).
- No añade ni cambia nada.

## Modelos y coste
- Lectura: ningún modelo. Usa la voz del sistema (Web Speech API), 0 $.
- «¿Qué significa?»: el modelo barato de Go (`backend/llm`), 1 llamada por pregunta, menos de 0,001 $ cada una, con el coste visible en `stats`.

## Si falla
| Problema | Qué hace |
|---|---|
| No hay voz en español | Usa la voz por defecto y lo dice en pantalla |
| No hay voz del sistema | Solo resalta las líneas y lo avisa |
| No hay documento | Muestra «Escanea un documento primero» |
| Sin conexión con Go (no se pasa `onAsk`) | Desactiva el botón «¿Qué significa?»; la lectura sigue |
| Otra voz (un `speak` de Go) interrumpe | El lector se pausa en su línea y no habla a la vez |

## Dependencias de otras personas
- Isaac:
  - montar `GuidedReader` en `App.tsx` y conectar `onAsk` al envío de `utterance`;
  - decidir si sustituye a `DocumentText` o si conviven.

## Riesgos
- **Dos voces a la vez.** La app (`Speaker`) y el lector comparten `speechSynthesis`. Cuando una cancela a la otra, el lector se pausa.
- **Tiempo: menos de 4 horas.** Orden de trabajo: primero la lógica y los tests, después la vista con los atajos y la página de prueba, y al final el pulido.

## Preguntas abiertas
- ¿Sustituye a `DocumentText` o conviven? Lo decide Isaac.

## Cambios del brief
- 2026-11-21 — Primera versión, tras la entrevista.
