# Arranque de Isaac (P1, rol A: núcleo e integración)

Guion para el agente de Isaac. Úsalo solo si `docs/briefs/isaac.md` no existe. Si existe, trabaja con el brief y pregunta solo lo que falte o haya cambiado. Reglas generales en `AGENTS.md`, «Al empezar una sesión».

## Contexto
Isaac tiene que decidir entre tres caminos:
- **(a)** seguir con el backend, que lo conecta todo;
- **(b)** hacer una funcionalidad grande;
- **(c)** ayudar a otra persona con su código.

**No decidas por él.** Tu trabajo es darle la evidencia, una recomendación honesta y, cuando elija, un brief.

## 1. Lee antes de preguntar
- `docs/ESTADO_PROYECTO.md` entero. Es el informe de su propia integración; comprueba que sigue siendo cierto con `git log` y `git status` de `main` y de las ramas abiertas.
- Los briefs que ya existan en `docs/briefs/`, para saber qué han elegido los demás.
- El estado real del backend: `backend/`, `api/openapi.yaml`, `web/src/app/`, `task check` y el CI de `main`.

## 2. Presenta los tres caminos, con evidencia
Prepara una comparación corta (una tabla o una lista por camino) con datos del repo, no con opiniones:
- **(a) Backend e integración.** Qué está frágil o pendiente. Punto de partida (compruébalo):
  - el flujo «lee el documento» sin unir en la interfaz (§1);
  - el puntero sin `pageCorners`;
  - `transcribeRemote` sin conectar;
  - el escalado provisional (`DefaultDoubt`);
  - `LLM_PROFILE=dev`, que no es gratis;
  - el 503 dicho como error genérico;
  - los servicios Python sin protección de `Host`;
  - los tests de Python fuera del CI;
  - la demo sin red;
  - las 17 decisiones pendientes de §6.
  
  Indica qué de esto **solo puede hacer él** sin pisar a nadie: `api/`, `backend/` y `web/src/app/` son suyos.
- **(b) Una funcionalidad grande.** Candidatas de `docs/ideas/` que no hayan cogido los demás según sus briefs. Para cada una: impacto en la demo, esfuerzo y qué tocaría.
- **(c) Ayudar a otra persona.** Quién va más cargado o más bloqueado: compara el alcance de cada brief con el tiempo que queda, mira los PR abiertos y lo que está «sin verificar». En qué partes concretas ayudaría.

Termina con **tu recomendación razonada** y **qué te haría cambiar de opinión**. Sé crítico y honesto: si el backend es el cuello de botella de la demo, dilo; si no lo es, dilo también.

## 3. Entrevista (tandas de 3 a 5 preguntas, con opciones)

**Tanda 1:**
- Cuánto tiempo queda hasta la demo.
- Qué le interesa más.
- Qué camino prefiere: (a), (b) o (c). Pon primero el recomendado.

**Si elige (c), ayudar:**
- A quién ayuda y en qué partes concretas (archivos o piezas).
- Acordad carpetas y ramas para no pisar el trabajo de esa persona: rama propia, PRs hacia su rama o el contrato como frontera.
- Todo pasa por el contrato y con la **conformidad de esa persona**. Apunta en el brief que ella está de acuerdo.

**Si elige (b), una funcionalidad:**
- Haz las mismas preguntas que en los guiones de Didac y Pau:
  - qué funcionalidad es, qué problema resuelve y para quién, y qué verá el jurado;
  - el paso a paso con un ejemplo de entrada y salida;
  - qué necesita de la cámara, la voz y el backend, y qué hay para reutilizar;
  - modelos y límite de coste;
  - cómo se degrada si falla;
  - criterios medibles;
  - qué queda fuera y qué depende de otros.
- Después pídele el prompt detallado con `docs/arranque/plantilla-funcionalidad.md` y revísalo con ojo crítico, buscando huecos, contradicciones con el código o el contrato y cosas irrealistas para el tiempo que queda.

**Si elige (a), el backend:**
- Ordena con él las prioridades:
  - el contrato;
  - la sesión;
  - la estabilidad;
  - el empaquetado (`wails build`);
  - el coste y la latencia;
  - la fiabilidad de la demo: plan B sin red y sin modelos de pago.
- Para cada prioridad, un criterio medible.

En cualquier caso, recuerda que Isaac también revisa PRs, fusiona y lleva el pitch (`docs/PITCH.md`). Pregunta cuánto tiempo reserva para eso.

## 4. Cierre
1. Redacta el brief con la plantilla de `docs/briefs/README.md`. Incluye el camino elegido y por qué.
2. Enséñaselo a Isaac y pide confirmación explícita.
3. Cuando lo confirme, guárdalo en `docs/briefs/isaac.md` y haz commit (solo documentación).
