# Arranque de Pau (P4, rol B1: cámara en la app)

Guion para el agente de Pau. Úsalo solo si `docs/briefs/pau.md` no existe. Si existe, trabaja con el brief y pregunta solo lo que falte o haya cambiado. Reglas generales en `AGENTS.md`, «Al empezar una sesión».

## Contexto
Pau hará **una funcionalidad grande y distinta** del programa. No tiene por qué estar ligada a su trabajo anterior, y debe ser distinta de la de Didac.

## 1. Lee antes de preguntar
- `docs/ESTADO_PROYECTO.md`:
  - §1 (de punta a punta y lo que falta unir);
  - §2: F15 (`openCamera`, `captureStill`), F16 (guía de encuadre y disparo automático), F17 (captura de la MX Brio) y F10 (interfaz);
  - §6 (decisiones pendientes 1, 2 y 4: apertura de la cámara, cómo llega el documento a la app y capas de avisos de encuadre).
- Las ideas que dejó Pau en `docs/ideas/IDEAS.md`:
  - disparo automático;
  - guía de encuadre por voz;
  - lupa sobre la zona señalada;
  - «el papel está al revés».
- La agrupación de `docs/ideas/AGRUPACION.md`: la guía de encuadre está **repetida con Didac** y la lupa, **con Nil**.
- Lo que hay de Pau:
  - `web/src/camera/README.md` (`guide.ts`, `framing.ts`, `shutter.ts`);
  - `scanner/capturar.py`, aún en español; si lo traduce, hay que avisar a Didac porque `scan.py` y `demo_app` usan sus nombres;
  - su estado anterior en `docs/historial/estado/P4-C.md`.
- **Si ya existe `docs/briefs/didac.md`, léelo** para no solaparte con Didac.

Haz un resumen de 5 a 8 líneas de lo que hay y de lo que ya ocupa Didac (si lo sabes). Enséñaselo a Pau antes de la primera tanda.

## 2. Entrevista (tandas de 3 a 5 preguntas, con opciones)

**Tanda 1. La funcionalidad.**
- Cuál es la funcionalidad. Ofrece como opciones sus ideas y las de `IDEAS.md` que no estén cogidas, más «otra».
- Qué problema resuelve y para quién.
- Qué verá el jurado en la demo y qué challenge toca: Logitech, IMC o AXA.

**Tanda 2. Cómo funciona.**
- El paso a paso desde el punto de vista del usuario.
- Un ejemplo concreto de entrada y salida, por ejemplo: «señalo la fecha y mantengo el dedo → la zona aparece ampliada a pantalla completa en alto contraste».

**Tanda 3. Qué necesita.**
- De la cámara, de la voz y de los gestos, y del backend.
- Qué existe ya en el repo que pueda reutilizar:
  - `openCamera`, `captureStill` y `startFramingGuide`;
  - `pageCorners`;
  - el puntero;
  - `POST /scan`;
  - el lector de voz.

**Tanda 4. Modelos y coste.**
- Qué modelos o servicios usaría y cuándo.
- Qué límite de coste acepta: el equipo tiene unos 10 € en total, y la frugalidad puntúa con AXA.
- Qué se puede hacer en local, sin IA.

**Tanda 5. Fallos, criterios y límites.**
- Qué pasa cuando falla: sin cámara Logitech, con poca luz, con un papel que se mueve o sin red. Cómo debe degradarse sin romper la app.
- Cómo se comprobará que está hecha, con criterios medibles.
- Qué queda fuera.
- Qué depende de otras personas: Isaac para el contrato y `web/src/app`, Nil para voz y gestos, Didac para la lectura.

## 3. El prompt detallado
1. Pídele a Pau que redacte **por escrito un prompt muy detallado** de su funcionalidad con la plantilla de `docs/arranque/plantilla-funcionalidad.md`. Dásela. Puede ayudarse de otra IA, por ejemplo Gemini.
2. Cuando te lo pase, **revísalo con ojo crítico**:
   - huecos: entradas sin ejemplo, fallos sin plan, criterios que no se pueden medir;
   - contradicciones con el código o con el contrato (`api/openapi.yaml`);
   - solapes con Didac o con Nil;
   - cosas irrealistas para el tiempo que queda: pregunta cuánto queda y recorta.
3. Haz las preguntas de seguimiento necesarias, en tandas pequeñas.

## 4. Cierre
1. Convierte el prompt revisado en el brief, con la plantilla de `docs/briefs/README.md`.
2. Enséñaselo a Pau y pide confirmación explícita.
3. Cuando lo confirme, guárdalo en `docs/briefs/pau.md` y haz commit (solo documentación).
4. Si cambia el contrato, abre ese PR aparte antes de construir encima.
