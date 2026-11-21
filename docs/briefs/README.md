# Briefs por persona

Cada agente guarda aquí, en `docs/briefs/<persona>.md` (`isaac`, `didac`, `pau` o `nil`), el brief que su persona confirmó tras la entrevista de `docs/arranque/<persona>.md`. En una sesión nueva, el agente lee el brief y trabaja con él, sin repetir la entrevista.

Reglas:
- Un brief por persona. Lo escribe su agente y solo se guarda cuando la persona lo confirma.
- Si cambia el plan, se actualiza el brief antes que el código y se anota en «Cambios del brief».
- Los briefs de los demás se pueden leer para no solaparse, pero no se editan.

## Plantilla

```markdown
# Brief de <Persona> (P<n>)
Confirmado por <persona> el <AAAA-MM-DD HH:MM>. Última revisión: <AAAA-MM-DD HH:MM>.

## Objetivo
Una o dos frases: qué se construye, para quién y qué problema resuelve.

## Qué se verá en la demo
Lo que verá y oirá el jurado, en 2-4 frases.

## Alcance
- ...

## Fuera de alcance
- ...

## Flujo, desde el punto de vista del usuario
1. ...
Ejemplo concreto: entrada → salida.

## Criterios de «hecho» (medibles)
- [ ] ... (con la cifra, la prueba o el comando que lo demuestra)

## Carpetas que toca
- Propias: ...
- De otras personas, con su conformidad: ...

## Contrato (`api/openapi.yaml`)
- Consume: ...
- Añade o cambia: ... (en un PR aparte, revisado por ...)

## Modelos y coste
- Qué modelo o servicio usa, cuándo lo llama y con qué límite de coste.

## Si falla
- Cómo se degrada sin romper la app.

## Dependencias de otras personas
- ...

## Riesgos
- ...

## Preguntas abiertas
- ...

## Cambios del brief
- <AAAA-MM-DD HH:MM> — qué cambió y por qué.
```
