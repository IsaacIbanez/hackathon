# Diseño del overlay

**Léelo antes de tocar cualquier pantalla.**
- Sustituye a «Halo» (Isaac, 2026-11-22). La versión anterior está en `docs/historial/DISENO_halo.md` y en el historial de git.
- Tokens y clases: `web/src/index.css`. Componentes: `web/src/app/overlay/ui.tsx`.

## Principio: es un overlay, no una app
- **Encima del contenido, no en su lugar.** Nada de cabeceras grandes, barras laterales, rejillas de tarjetas ni paneles de dashboard.
- **Pocas cosas siempre visibles.** El resto aparece cuando hace falta y se va rápido.
- **Cada pieza ocupa y molesta lo mínimo.**
- **Para personas con baja visión:** la legibilidad manda sobre la estética. Contraste AA como mínimo, sobre cualquier fondo.

## Dirección
**Sereno, preciso, silencioso.**
- **Referencias:**
  - Spotlight y Raycast: una superficie, un foco claro y nada de decoración.
  - El HUD de volumen de macOS: aparece, informa y se va.
  - Xbox Game Bar: una capa encima de lo que haces.
- **Todo es neutro** (tinta, cristal y texto claro), salvo **un acento amarillo**. El acento marca:
  - lo que se está leyendo;
  - el foco del teclado;
  - lo que señala el ratón o la mano;
  - la acción principal.

## Piezas
| Pieza | Dónde | Cómo se ve |
|---|---|---|
| Capa | `.halo-layer` (`index.css`) | La pantalla oscurecida (`layer`); el escritorio se sigue viendo detrás |
| Menú | `Hub.tsx` | Gesture Control es el círculo grande del centro, con un anillo fino y quieto que se enciende con el foco. Las herramientas van en un arco, en círculos neutros que se llenan de amarillo bajo el puntero o el foco. Las distingue el icono, el nombre y el sitio, no el color |
| Panel de herramienta | `Panel` (`ui.tsx`) | Cristal (`surface`) con borde de 1 px. Cabecera: volver, icono neutro, nombre y una frase |
| Cámara | `CameraPanel` (`Overlay.tsx`), burbuja y página de gestos (`web/src/input/desktop`) | Borde de 1–2 px, sin sombra ni aros de color. La mano se dibuja en el color del texto; el amarillo es lo que se señala |
| Menú del puño | `gestureControl.css` | Velo (`scrim`, o `scrim-light` sobre el escritorio). Opciones de cristal; lo que se mantiene se llena de amarillo suave |
| Lectores | `DocumentsMode`, `GuidedReader`, `ReadFileMode`, `PdfViewer` | La línea que se lee, en amarillo (`.reading-mark`). La página del PDF, en `paper` |
| AI Summary | `SummarizeMode.tsx` | Una burbuja de cristal junto al cursor |
| Transcribe | `LiveCaptions.tsx` | Botones base: empezar es `btn-primary` y parar es `btn-danger`. Idioma en `Tag` |
| Avisos | `VoiceBanner`, `Status`, mensajes de la página de gestos | Píldora de cristal. Al grabar, el icono del micro en amarillo; con error, borde `warn` |
| Developer | `App.tsx`, `Gestures.tsx`, `DictationPanel.tsx` | Mismos tokens (pantalla de pruebas, fuera de la demo) |

## Tokens (`@theme static` en `index.css`)
| Grupo | Tokens | Regla |
|---|---|---|
| Texto | `fg`, `fg-muted`, `on-accent` (clases `text-fg`, `text-fg-muted`, `text-on-accent`) | `fg-muted` solo para lo secundario, nunca para acciones |
| Acento (uno) | `accent` (`#FFD84D`) | Ver «Dirección» |
| Estados | `warn`, `danger` | Siempre con un icono o con palabras, nunca solo el color |
| Superficies | `layer`, `surface`, `surface-solid`, `surface-opaque`, `scrim`, `scrim-light`, `backing`, `paper` | Ver «Transparencias» |
| Rellenos | `fill`, `fill-strong`, `fill-hover`, `edge`, `highlight` | Controles y bordes de 1 px |
| Tipo | `text-meta` · `text-body` · `text-lead` · `text-title` · `text-display` | Solo estos 5 tamaños, en 400 y 700, con Atkinson Hyperlegible |
| Radios | `rounded-chip` · `rounded-field` · `rounded-card` · `rounded-panel` · `rounded-full` | Se elige el radio según el tamaño de la pieza, no uno para todo |
| Elevación | `shadow-edge` (luz de 1 px) | Sin sombras grandes |
| Movimiento | `--duration-fast` (150 ms), `--duration-base` (200 ms), `ease-soft` | Ver «Movimiento» |
| Tamaño mínimo | `--target-min` (52 px al 125 %) | Nada clicable más pequeño |
| Espaciado | la escala de Tailwind: 1, 2, 3, 4, 6, 8 y 12 | Sin valores sueltos |

- **Prohibido en componentes:**
  - colores sueltos (`#…`, `rgb(…)`, `text-sky-300`, `bg-white/8`);
  - tamaños y radios sueltos (`rounded-[1.25rem]`, `text-[17px]`).
- **Si falta algo,** se añade un token aquí y en `index.css`.
- **Excepciones:**
  - la geometría del menú (posiciones y tamaños de los círculos);
  - el canvas de la cámara, que necesita valores fijos: los copia de los tokens en `HALO` (`web/src/input/overlay.ts`).
- **Nombres antiguos:** el primer bloque de `@theme` (`ink`, `snow`, `mist`, `line`, `mark`…) se queda por compatibilidad; el código nuevo usa los nombres de arriba.

## Transparencias (se conservan tal cual)
Contraste medido con la superficie encima de un escritorio blanco (el peor caso) y de uno negro:

| Token | Valor | Dónde | `fg` | `fg-muted` |
|---|---|---|---|---|
| `layer` | negro azulado al 82 % y un centro más claro | La capa de pantalla completa | 11,1 / 18,5 | 6,5 / 10,9 |
| `surface` | `rgb(16 24 50 / .9)`, desenfoque de 18 px | Paneles (la única superficie) | 12,2 / 16,6 | 7,2 / 9,8 |
| `surface-solid` | lo mismo al 96 % | Barras fijas que pasan por encima del contenido | — | — |
| `scrim` | negro azulado al 62 % | Menú del puño sobre la cámara | 5,2 / 18,7 | 3,1 / 11,0 |
| `scrim-light` | negro azulado al 40 % | Menú del puño sobre el escritorio | 2,5 / 19,0 | 1,5 / 11,2 |

- **El desenfoque** va solo en la superficie de arriba (paneles y barras) y nunca apilado: en el WebView de Windows cuesta GPU y la cámara tiene que ir fluida. Las opciones del menú del puño y las tarjetas de la página de gestos no llevan desenfoque: al 90 % de opacidad casi no se notaba.
- **Texto sobre `scrim` o `scrim-light`:** va siempre dentro de una superficie o con `.backing`, una placa suave detrás del texto (al 72 %). El centro del menú del puño sobre el escritorio ya la lleva. No se sube la opacidad de todo.
- **Relleno de lo que se mantiene** (gesto sostenido, nivel de volumen): amarillo al 38 %, con el texto claro encima a 3:1 o más (texto grande y en negrita).
- **Clic a través:** solo la capa y los paneles capturan el ratón. La pantalla de gestos deja pasar los clics (`docs/VENTANA.md`).

## Componentes
| Pieza | Clase o componente | Estados |
|---|---|---|
| Botón | `.btn`, `.btn-primary` (acento), `.btn-danger` (parar o borrar), `.btn-quiet` (sin relleno) | hover, foco, activo, desactivado (`disabled` o `aria-disabled`), cargando (`aria-busy`) |
| Botón de icono | `IconButton` (`.btn-icon`), con `label` obligatorio; también el botón de volver | Los mismos |
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
  - textos genéricos («Seamless», «Get started»);
  - animaciones que rebotan.
- **Sí:**
  - cada borde, número o etiqueta dice algo;
  - el radio y la elevación se eligen para cada pieza;
  - los textos son concretos: el verbo de la acción, y los errores dicen qué pasó y qué hacer.
- **Prueba del «por defecto»:** si una decisión aparecería en cualquier otra app parecida, se revisa antes de escribir el código.

## Movimiento
- **Duración:** de 150 a 200 ms, con `ease-soft` y sin rebote, solo como respuesta a algo que hace la persona.
- **Lo que se mueve solo:** nada. Al abrir la capa, las herramientas salen del centro una sola vez, en 200 ms.
- **Con «reducir movimiento»:** no se anima nada.
- **Una interacción rápida puede cortar la animación,** pero el estado final y el foco tienen que quedar bien.

## Accesibilidad (condición, no extra)
- **Foco:** anillo amarillo de 4 px, separado 3 px, siempre visible.
- **Contraste:** AA como mínimo para el texto, medido sobre fondo blanco y negro. El texto de lectura es grande (`html` al 125 %, líneas en `text-display`).
- **Uso con el ratón:** todo se puede hacer solo con el ratón, y lo clicable mide al menos `--target-min`.

## Añadir una herramienta
1. **Una entrada en `MODES`** (`modes.ts`), con `accent: 'var(--color-accent)'`.
2. **Su vista, dentro de `Panel`.** Usa los componentes y los tokens de arriba; nada de colores sueltos.
3. **Si el keypad debe abrirla,** su acción en `keypad.ts` (`docs/KEYPAD.md`).

## De dónde sale
- **Skills de diseño** (leídas como referencia, no instaladas):
  - `anthropics/skills` frontend-design;
  - Impeccable (`pbakaus/impeccable`);
  - UI/UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`);
  - Taste Skill (`Leonxlnx/taste-skill`);
  - avoid-ai-design (`funboy322/avoid-ai-design`).
- **Los vídeos no se pudieron ver:** el agente no reproduce vídeo.
