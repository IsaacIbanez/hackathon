# Diseño del overlay: «Halo»

> **Se está sustituyendo por `docs/DESIGN.md`** (2026-11-22). Para piezas nuevas o migradas manda `DESIGN.md`; este documento describe las pantallas que aún no se han migrado y pasará a `docs/historial/` al acabar.

Diseño final del overlay, decidido por Didac el 2026-11-22 (rama `feature/didac-diseno-overlay`). Todo lo que se añada al overlay debe seguir este sistema, para que todas las pantallas se vean iguales.

## Idea
- **Una capa sobre el PC**, como Xbox Game Bar. Ctrl+Alt+Espacio (o el MX Keypad) oscurece toda la pantalla, que se sigue viendo por detrás, y muestra las herramientas en el centro. Esc o un clic en el fondo vacío la quitan.
- **Menú radial:**
  - **Gesture Control** es el círculo grande del centro, con un halo que gira despacio.
  - Las demás herramientas están **en un arco por encima**, todas a la misma distancia del centro (ley de Fitts) y siempre en la misma dirección, así que con la práctica se encuentran sin mirar.
- **Cada herramienta abre un panel de cristal** sobre la misma capa, con la misma cabecera: volver, el icono en su color, el nombre y una frase de qué hace.
- **Excepciones:**
  - **Gesture Control** abre en una ventana normal y sólida, no en la capa a pantalla completa: sus clics tienen que llegar a los programas de debajo. Sigue teniendo su burbuja de cámara (Nil).
  - **AI Summary** es una burbuja junto al cursor.
- **Lo llamativo va en un solo sitio:** el círculo central y su halo. Todo lo demás es sobrio.
- **Para quién es:** personas con baja visión. Por eso el texto es grande (`html` al 125 %), el contraste es alto y el foco de teclado siempre se ve. Todo se puede usar con el ratón (N1) y también con el teclado.

```
┌ pantalla entera, oscurecida ────────────────────────────────────┐
│              (Read Text)      (AI Summary)                       │
│   (PDF Scanner)                              (Transcribe)        │  ← arco, 205°–335°
│                      ╭─────────────────╮                         │
│                      │ ✋ Gesture Control│  ← halo animado         │
│                      ╰─────────────────╯                         │
│              «Open a PDF, text file or image…»                   │  ← qué hace lo señalado
│     ( Ctrl Alt Space shows or hides this layer · Quit Q )        │  ← barra inferior
└──────────────────────────────────────────────────────────────────┘
```

## Tokens (`web/src/index.css`, `@theme`)
| Token | Valor | Uso |
|---|---|---|
| `--color-ink` | `#0A1128` | la capa y los paneles |
| `--color-snow` | `#F3F6FF` | texto |
| `--color-mist` | `#B4BFDC` | texto secundario (8:1 sobre ink) |
| `--color-line` | `rgb(196 210 255 / .18)` | bordes finos del cristal |
| `--color-mark` | `#FFD84D` | **lo que se está leyendo** y el **foco del teclado** |
| `--color-scan` | `#FFB547` | PDF Scanner (y los avisos) |
| `--color-read` | `#5CE1E6` | Read Text |
| `--color-ai` | `#B69CFF` | AI Summary |
| `--color-voice` | `#FF8A98` | Transcribe |
| `--color-hand`, `--color-hand-2` | `#49E3C4`, `#7C8CFF` | Gesture Control (el halo) |

- **Tipografía:** [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), diseñada por el Braille Institute para baja visión. Va en el paquete `@fontsource/atkinson-hyperlegible`, así que funciona sin internet. Una sola familia, en 400 y 700.
- **El color nunca va solo:** siempre acompaña a un icono y a un nombre.
- **Formas:**
  - círculos para las herramientas;
  - píldoras para los botones (`.btn`, al menos 48 px de alto);
  - un radio grande (`2rem`) para los paneles.

## Componentes
| Pieza | Dónde | Para qué |
|---|---|---|
| `.halo-layer` | `index.css` | La capa oscurecida de pantalla entera |
| `.glass` | `index.css` | La única superficie: cristal casi opaco, legible sobre cualquier fondo |
| `.btn`, `.btn-primary` | `index.css` | Botones. El primario toma el color de la herramienta (`--accent`) |
| `.kbd` | `index.css` | El atajo de teclado junto a su acción |
| `.reading-mark` | `index.css` | La línea que se está leyendo (amarillo) |
| `.orb`, `.hub-orb`, `.hub-halo` | `index.css` | Los círculos del menú |
| `Hub` | `web/src/app/overlay/Hub.tsx` | La pantalla principal (centro y arco) |
| `Panel`, `BackButton`, `Status`, `Icon` | `web/src/app/overlay/ui.tsx` | El panel de cada herramienta, el botón de volver, la línea de estado y los iconos (SVG propios, sin librerías) |

## Movimiento
- **Al abrir la capa**, las herramientas salen del centro en abanico (una sola vez).
- **El halo** gira despacio y es lo único que se mueve solo.
- **Al pasar el ratón o el foco**, el círculo se llena de su color.
- **Con «reducir movimiento»** activado en Windows, no se anima nada.

## Textos
- **En inglés**, con mayúscula solo al principio de la frase y verbos claros («Take the photo now», «Try again», «Open another file»).
- **Los errores dicen qué hacer**, por ejemplo: «No sheet found. Hold the whole page flat in front of the camera, then try again».
- **El nombre de una acción es el mismo en todo el flujo.**

## Añadir una herramienta
1. Una entrada en `MODES` (`web/src/app/overlay/modes.ts`): `title`, `description`, `icon`, `accent` (un token nuevo `--color-…` en `index.css` si no hay uno libre), `place: 'arc'` y `key`. El arco se reparte solo.
2. Su vista en `Overlay.tsx`, dentro de `Panel`. Usa `.btn`, `.btn-primary`, `Status` y los tokens; nada de colores sueltos.
3. Si el keypad debe abrirla, su acción en `keypad.ts`.

## Ventana (Go)
- **Sin marco** (`Frameless`, `main.go`): cada panel se arrastra por su cabecera (`--wails-draggable`).
- **Transparente**, como ya lo dejó Nil.
- **`SetLayer(on)`** (`app_overlay.go`) pone la ventana a pantalla completa para el menú y las herramientas de lectura, y la devuelve a su tamaño normal para Gesture Control.
- **La burbuja del resumen** sale de la pantalla completa y se coloca junto al cursor.

## De dónde sale
- **Skills de diseño instaladas** (fuentes oficiales):
  - `anthropics/skills@frontend-design`: dirección estética, tokens y autocrítica;
  - `vercel-labs/agent-skills@web-design-guidelines`: repaso de accesibilidad, foco, movimiento y textos;
  - `anthropics/knowledge-work-plugins@design-critique`.
- **Referencias consultadas:**
  - artículos sobre *glassmorphism* accesible (fondo con `rgba` y no con `opacity`; desenfoque solo en la capa superior; legibilidad);
  - Xbox Game Bar (barra flotante, widgets, espacio y animaciones discretas);
  - menús radiales (ley de Fitts y pocas opciones, de 3 a 12).
- No se han podido ver vídeos (midudev y otros canales): el agente no reproduce vídeo, así que se buscó su contenido escrito.

## Pendiente
- **Transcribe:** los subtítulos en directo de Pau aún no están en `main`. El círculo dice «Coming soon» y abre un panel que lo explica. Para conectarlo, se pone `ready: true` y su vista.
- **Gesture Control:** la página interior de la cámara es de Nil (`web/src/input/desktop`) y conserva su propio estilo. Habría que pasarle estos tokens.
