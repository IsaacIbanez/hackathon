# Diseño del overlay

**Léelo antes de tocar cualquier pantalla.** Sustituye a «Halo» (`docs/DISENO.md`), que sigue describiendo las pantallas hasta que estén todas migradas (Isaac, 2026-11-22). Tokens y clases: `web/src/index.css`. Componentes: `web/src/app/overlay/ui.tsx`.

## Principio: es un overlay, no una app
- **Encima del contenido, no en su lugar.** Nada de cabeceras grandes, barras laterales, rejillas de tarjetas ni paneles de dashboard.
- **Pocas cosas siempre visibles.** El resto aparece cuando hace falta y se va rápido.
- **Cada pieza ocupa y molesta lo mínimo.**
- **Para personas con baja visión:** la legibilidad manda sobre la estética. Contraste AA como mínimo, sobre cualquier fondo.

## Dirección (propuesta, pendiente de aprobar)
**Sereno, preciso, silencioso.**
- **Referencias:**
  - Spotlight y Raycast: una superficie, un foco claro y nada de decoración.
  - El HUD de volumen de macOS: aparece, informa y se va.
  - Xbox Game Bar: una capa encima de lo que haces.
- **Lo llamativo va en un solo sitio:** el centro del menú. Todo lo demás es neutro.

## Tokens (`@theme` en `index.css`)
| Grupo | Tokens | Regla |
|---|---|---|
| Texto | `fg`, `fg-muted`, `on-accent` (clases `text-fg`, `text-fg-muted`) | `fg-muted` solo para información secundaria, nunca para acciones |
| Acento (uno) | `accent` (`#FFD84D`) | Lo que se está leyendo, el foco del teclado y la acción principal |
| Estados | `warn`, `danger` | Siempre con un icono o con palabras, nunca solo el color |
| Superficies | `layer`, `surface`, `surface-solid`, `scrim`, `scrim-light`, `backing` | Ver «Transparencias» |
| Rellenos | `fill`, `fill-strong`, `fill-hover`, `edge`, `highlight` | Controles y bordes de 1 px |
| Tipo | `text-meta` · `text-body` · `text-lead` · `text-title` · `text-display` | Solo estos 5 tamaños, en 400 y 700, con Atkinson Hyperlegible |
| Radios | `rounded-chip` · `rounded-field` · `rounded-card` · `rounded-panel` · `rounded-full` | Se elige el radio según el tamaño de la pieza, no uno para todo |
| Elevación | `shadow-edge` (luz de 1 px), `shadow-float`, `shadow-panel` | Borde de 1 px y luz suave antes que sombras grandes |
| Movimiento | `--duration-fast` (150 ms), `--duration-base` (200 ms), `ease-soft` | Ver «Movimiento» |
| Tamaño mínimo | `--target-min` (52 px al 125 %) | Nada clicable más pequeño |
| Espaciado | la escala de Tailwind: 1, 2, 3, 4, 6, 8 y 12 | Sin valores sueltos (`p-[13px]`) |

**Prohibido en componentes:** colores (`#…`, `rgb(…)`, `text-sky-300`, `bg-white/8`), tamaños y radios sueltos (`rounded-[1.25rem]`, `text-[17px]`). Si falta algo, se añade un token aquí y en `index.css`.

## Transparencias (se conservan tal cual)
Contraste medido con la superficie encima de un escritorio blanco (el peor caso) y de uno negro:

| Token | Valor | Dónde | `fg` | `fg-muted` |
|---|---|---|---|---|
| `layer` | negro azulado al 82 % y un centro más claro | La capa de pantalla completa | 11,1 / 18,5 | 6,5 / 10,9 |
| `surface` | `rgb(16 24 50 / .9)`, desenfoque de 18 px | Paneles (la única superficie) | 12,2 / 16,6 | 7,2 / 9,8 |
| `surface-solid` | lo mismo al 96 % | Barras fijas que pasan por encima del contenido | — | — |
| `scrim` | negro azulado al 62 % | Menú del puño sobre la cámara | 5,2 / 18,7 | **3,1** / 11,0 |
| `scrim-light` | negro azulado al 40 % | Menú del puño sobre el escritorio | **2,5** / 19,0 | **1,5** / 11,2 |

- **El desenfoque** va solo en la superficie de arriba y nunca apilado, porque en el WebView de Windows cuesta GPU y la cámara tiene que ir fluida. La burbuja de cámara no lleva desenfoque.
- **Texto sobre `scrim` o `scrim-light`:** va siempre dentro de una superficie o con `.backing` (una placa suave detrás del texto). No se sube la opacidad de todo.
- **Clic a través:** solo la capa y los paneles capturan el ratón. La pantalla de gestos deja pasar los clics (`docs/VENTANA.md`).

## Componentes
| Pieza | Clase o componente | Estados |
|---|---|---|
| Botón | `.btn`, `.btn-primary` (acento), `.btn-quiet` (sin relleno) | hover, foco, activo, desactivado (`disabled` o `aria-disabled`), cargando (`aria-busy`) |
| Botón de icono | `IconButton` (`.btn-icon`), con `label` obligatorio | Los mismos |
| Interruptor | `Switch` (`.switch`, `role="switch"`), con su texto al lado | Encendido, apagado, desactivado |
| Etiqueta | `Tag` (`.tag`), con `tone` `warn` o `danger` | — |
| Panel | `Panel` (`.glass`) | — |
| Estado | `Status` | info, aviso |
| Atajo | `.kbd` | — |
| Texto sobre velo | `.backing` | — |
| Iconos | `Icon`: una sola familia (rejilla de 24, trazo de 1,8, puntas redondas) | Sin emojis como iconos |

## Contra el aspecto «hecho por IA»
Lo resumen las skills consultadas (abajo):
- **No:**
  - degradados morados o azules, ni texto con degradado;
  - brillos de neón, ni vidrio en todo;
  - tarjetas idénticas con sombra, ni tarjetas dentro de tarjetas;
  - un icono en un cuadrado sobre cada título;
  - etiquetas en mayúsculas espaciadas;
  - numeración decorativa;
  - una palabra destacada en el título;
  - flechas en los botones;
  - textos genéricos («Seamless», «Get started»).
- **Sí:**
  - cada borde, número o etiqueta dice algo;
  - el radio y la elevación se eligen para cada pieza;
  - los textos son concretos: el verbo de la acción, y los errores dicen qué pasó y qué hacer.
- **Prueba del «por defecto»:** si una decisión aparecería en cualquier otra app parecida, se revisa antes de escribir el código.

## Movimiento
- **Duración:** de 150 a 200 ms, con `ease-soft`, y solo como respuesta a algo que hace la persona.
- **Lo que se mueve solo:** como mucho, una cosa.
- **Con «reducir movimiento»:** no se anima nada (ya está en `index.css`).
- **Una interacción rápida puede cortar la animación,** pero el estado final y el foco tienen que quedar bien.

## Accesibilidad (condición, no extra)
- **Foco:** anillo amarillo de 4 px, separado 3 px, siempre visible.
- **Contraste:** AA como mínimo para el texto, medido sobre fondo blanco y negro. El texto de lectura es grande (`html` al 125 %).
- **Uso con el ratón:** todo se puede hacer solo con el ratón, y lo clicable mide al menos `--target-min`.

## Migración (un PR por área)
1. **Sistema:** tokens, componentes base y este documento (PR 1).
2. **Capa y menú:** `Hub.tsx`, `Overlay.tsx` (barra de herramientas, aviso del keypad), `Panel`, `BackButton`.
3. **Cámara:** el panel de arriba a la izquierda (`Overlay.tsx`), la burbuja y la página de gestos con el menú del puño y el control de volumen y brillo (`web/src/input/desktop`, de Nil: solo la apariencia).
4. **Lectores:** PDF Scanner (`DocumentsMode.tsx`), lector guiado (`GuidedReader.tsx`), Read Text (`ReadFileMode.tsx`) y visor de PDF (`PdfViewer.tsx`).
5. **AI Summary** (`SummarizeMode.tsx`) y **Transcribe** (`LiveCaptions.tsx`).
6. **Avisos:** el aviso de voz (`useVoiceCommand.tsx`), `Status` y los mensajes de la página de gestos. Después, pantalla Developer (`App.tsx`, `DocumentText.tsx`, `Cost.tsx`) y `Gestures.tsx` antiguo. Al acabar, `DISENO.md` pasa a `docs/historial/`.

## Decisiones pendientes de aprobar
1. **Un solo acento:** hoy hay 6 colores, uno por herramienta más el amarillo. Propuesta: la herramienta se reconoce por su icono, su nombre y su sitio, y el color se queda solo en el icono o desaparece.
2. **El halo del centro** (degradado verde a índigo girando sin parar): es el patrón que las skills marcan. Propuesta: un anillo fino y quieto que se ilumina con el foco o con la mano.
3. **Sombras grandes** en paneles y burbujas: pasar a borde de 1 px y luz suave (`shadow-edge`).
4. **Tipografía:** hoy se usan 8 tamaños; pasar a 5. Se mantiene Atkinson Hyperlegible.
5. **El emoji 🎙 del aviso de voz:** cambiarlo por el icono `mic`.

## De dónde sale
- Skills de diseño (leídas como referencia, no instaladas):
  - `anthropics/skills` frontend-design;
  - Impeccable (`pbakaus/impeccable`);
  - UI/UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`);
  - Taste Skill (`Leonxlnx/taste-skill`);
  - avoid-ai-design (`funboy322/avoid-ai-design`).
- Los vídeos no se pudieron ver: el agente no reproduce vídeo.
