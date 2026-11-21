# Estado — P3-C

- **Persona:** Nil
- **Herramienta:** Claude Code
- **Tarea actual:** T6 (rol C), parte de gestos de mano. La voz queda para después.
- **Rama:** `claude/kind-cray-863b6t` (la que asigna la sesión en la nube; se puede renombrar a `feature/T6-gestos-mano` al abrir el PR)
- **Estado:** en revisión (prototipo aislado, a falta del contrato de T2)
- **Último cambio:** 2026-11-21

## Hecho
- Módulo `web/src/input/` sin dependencias de npm (MediaPipe se carga desde jsDelivr en tiempo de ejecución).
- Poses: señalar, palma, puño, pulgar arriba, victoria, pinza.
- Gestos estables (hay que mantenerlos ~0,3 s con la mano quieta), deslizar izquierda/derecha, puntero suavizado (One Euro) y selección por permanencia (~0,9 s señalando quieto).
- Traducción a acciones: `leer`, `pausar`, `repetir`, `siguiente`, `anterior`, `explicar_aqui`.
- Puntero en coordenadas del documento mediante homografía a partir de las 4 esquinas del papel.
- Tests con manos sintéticas (`node --test 'web/src/input/test/*.test.ts'`) y comprobación de tipos con `tsc`.
- Gestos experimentales: modo dormido/despierto, 👎 pulgar abajo, 🤏 pinza de nivel (volumen según la separación pulgar–índice, con la línea entre ambos en pantalla), ✌️ menú radial que se elige señalando hacia un lado, gestos de cabeza (asentir y negar; el parpadeo se quitó a petición del equipo), contextos (documento, formulario, PC), perfil de movilidad reducida y señalar + voz (solo en la demo). 30 tests.
- Demo en `web/src/input/demo/`, con interruptores para cada experimental y chuleta del contexto actual. Probada en Chromium sin interfaz con cámara falsa: el modelo carga y analiza frames. Falta probarla con una mano real.

## Pendiente
- Decidir qué experimentales se quedan tras probarlos con la cámara.
- Probar con la webcam y una mano real; ajustar umbrales (`OPCIONES_POR_DEFECTO`, `UMBRALES_POR_DEFECTO`).
- Conectar con el WebSocket cuando T2 publique el contrato.
- Cuando exista `web/package.json` (T2): añadir `@mediapipe/tasks-vision@0.10.21` y pasar `cargarVision: () => import("@mediapipe/tasks-vision")`; servir el modelo en local para no depender de la red en la demo. Borrar entonces `web/src/input/tsconfig.json`.
- Voz (micro → `utterance`), la otra mitad de T6.

## Bloqueos y preguntas para humanos
- **Controlar el PC** (Intro, pestañas, clic, scroll reales) lo tendría que hacer Go con una librería de automatización del sistema: hablarlo con Isaac (T2). Ahora solo se emiten las acciones.
- **Propuesta para el contrato (T2, Isaac):** mensaje `pointer` = `{ "type": "pointer", "x": 0.42, "y": 0.31, "space": "document" | "image", "select": false, "t": 1234 }`, con `select: true` en la selección por permanencia. Y un mensaje para las acciones de gesto, p. ej. `{ "type": "action", "action": "leer" | "pausar" | "siguiente" | "anterior" | "repetir" | "explicar_aqui", "source": "gesture" }`. Mi módulo emite eventos locales; adaptarlos a esa forma es trivial.
- **Para B1:** necesito las 4 esquinas del documento en coordenadas de imagen normalizadas (sup-izq, sup-der, inf-der, inf-izq) para traducir el puntero a coordenadas del documento.
- El frontend tiene que importar con extensión `.ts` (`allowImportingTsExtensions`, como la plantilla react-ts de Vite) para que los tests corran con `node --test` sin compilar.

## Archivos tocados
- `web/src/input/**`
- `estado/P3-C.md`
