# Plantilla del prompt de una funcionalidad

La usan los guiones de Didac, Pau e Isaac (si Isaac elige hacer una funcionalidad). El agente se la da a su persona para que redacte, por escrito y con mucho detalle, la funcionalidad que quiere construir. Puede ayudarse de otra IA (Gemini u otro modelo). Después, el agente la revisa con ojo crítico y la convierte en el brief (`docs/briefs/<persona>.md`).

```markdown
# Funcionalidad: <nombre corto>

## Objetivo
Qué problema resuelve y por qué importa (1-3 frases).

## Usuario
Para quién es (por ejemplo, una persona con baja visión, con poca movilidad o una persona mayor) y en qué situación lo usa.

## Qué verá el jurado
La escena de la demo en 30 segundos: qué hace la persona y qué responde la app. Qué challenges toca (Logitech, IMC, AXA) y por qué.

## Flujo paso a paso
1. La persona hace… (voz, gesto, botón o cámara)
2. La app… (qué se ve, qué se oye)
3. ...

## Entradas y salidas, con ejemplos
- Entrada: <ejemplo concreto: una foto de una carta, la frase «…», el gesto …>
- Salida: <ejemplo concreto: la voz dice «…», en pantalla aparece …, se guarda el archivo …>
- (Al menos 2 ejemplos, y uno de ellos de un caso difícil.)

## Qué necesita
- De la cámara: ...
- De la voz o los gestos: ...
- Del backend o del contrato (mensajes o endpoints): ...
- Qué hay ya en el repo que reutiliza: ...

## Modelos y coste
Qué modelo o servicio usa, cuándo lo llama, coste por uso y límite total. Qué se hace en local, sin IA.

## Cuando falla
Qué pasa si no hay red, si falla el modelo, si la foto es mala o si no se entiende la voz. Cómo se degrada sin romper la app.

## Criterios de hecho
Comprobables con un número o una prueba (por ejemplo «responde en menos de 3 s en 9 de 10 intentos con las 3 cartas de prueba»).

## Restricciones
Tiempo disponible, hardware, privacidad, idioma, accesibilidad.

## Carpetas implicadas
Las propias y las de otras personas (con su conformidad).

## Fuera de alcance
Lo que NO se hará en esta hackathon.
```
