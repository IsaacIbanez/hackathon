# Arranque de Didac (P2, rol B2: lectura de documentos)

Guion para el agente de Didac. Úsalo solo si `docs/briefs/didac.md` no existe. Si existe, trabaja con el brief y pregunta solo lo que falte o haya cambiado. Reglas generales en `AGENTS.md`, «Al empezar una sesión».

## Contexto
Didac hará **una funcionalidad grande y distinta** del programa. No tiene por qué estar ligada a su trabajo anterior, y debe ser distinta de la de Pau.

## 1. Lee antes de preguntar
- `docs/ESTADO_PROYECTO.md`:
  - §1 (de punta a punta y lo que falta unir);
  - §2: F6 (`POST /scan`), F18 a F21 (pipeline, servicio de lectura, PDF digital, documentos de prueba) y F10 (interfaz);
  - §6 (decisiones pendientes) y §7 (seguridad de los servicios Python).
- Las ideas que dejó Didac en `docs/ideas/IDEAS.md`:
  - guía de encuadre por voz;
  - «guárdalo / envíalo»;
  - versión en letra grande;
  - lectura línea a línea.
- La agrupación de `docs/ideas/AGRUPACION.md`: la guía de encuadre está **repetida con Pau**, y Pau ya tiene `startFramingGuide`.
- Lo que hay de Didac: `scanner/ENTREGA.md`, `scanner/service.py` y `scanner/pdf/`. Las carpetas `web/src/document/` y `backend/ocr/` siguen vacías y son de B2.
- **Si ya existe `docs/briefs/pau.md`, léelo** para no solaparte con Pau.

Haz un resumen de 5 a 8 líneas de lo que hay y de lo que ya ocupa Pau (si lo sabes). Enséñaselo a Didac antes de la primera tanda.

## 2. Entrevista (tandas de 3 a 5 preguntas, con opciones)

**Tanda 1. La funcionalidad.**
- Cuál es la funcionalidad. Ofrece como opciones sus ideas y las de `IDEAS.md` que no estén cogidas, más «otra».
- Qué problema resuelve y para quién.
- Qué verá el jurado en la demo y qué challenge toca: Logitech, IMC o AXA.

**Tanda 2. Cómo funciona.**
- El paso a paso desde el punto de vista del usuario.
- Un ejemplo concreto de entrada y salida, por ejemplo: «foto de la carta de renovación → la voz dice “vence el 31 de diciembre; importe 284,60 €”».

**Tanda 3. Qué necesita.**
- De la cámara, de la voz y de los gestos, y del backend.
- Qué existe ya en el repo que pueda reutilizar:
  - el pipeline y `Result.document()`;
  - `pageCorners`;
  - la sesión de Go;
  - el lector frase a frase;
  - el dictado de campos.

**Tanda 4. Modelos y coste.**
- Qué modelos o servicios usaría y cuándo.
- Qué límite de coste acepta: el equipo tiene unos 10 € en total, y la frugalidad puntúa con AXA.
- Qué se puede hacer en local, sin IA.

**Tanda 5. Fallos, criterios y límites.**
- Qué pasa cuando falla: sin red, sin Tesseract, con una foto mala o con un modelo saturado. Cómo debe degradarse sin romper la app.
- Cómo se comprobará que está hecha, con criterios medibles.
- Qué queda fuera.
- Qué depende de otras personas: Isaac para el contrato y `web/src/app`, Nil para voz y gestos, Pau para la cámara.

## 3. El prompt detallado
1. Pídele a Didac que redacte **por escrito un prompt muy detallado** de su funcionalidad con la plantilla de `docs/arranque/plantilla-funcionalidad.md`. Dásela. Puede ayudarse de otra IA, por ejemplo Gemini.
2. Cuando te lo pase, **revísalo con ojo crítico**:
   - huecos: entradas sin ejemplo, fallos sin plan, criterios que no se pueden medir;
   - contradicciones con el código o con el contrato (`api/openapi.yaml`);
   - solapes con Pau o con Nil;
   - cosas irrealistas para el tiempo que queda: pregunta cuánto queda y recorta.
3. Haz las preguntas de seguimiento necesarias, en tandas pequeñas.

## 4. Cierre
1. Convierte el prompt revisado en el brief, con la plantilla de `docs/briefs/README.md`.
2. Enséñaselo a Didac y pide confirmación explícita.
3. Cuando lo confirme, guárdalo en `docs/briefs/didac.md` y haz commit (solo documentación).
4. Si cambia el contrato, abre ese PR aparte antes de construir encima.
