# Overlay design

**Read this before touching any screen.**
- Replaces «Halo» (Isaac, 2026-11-22). The previous version is in `docs/historial/DISENO_halo.md` and in the git history.
- Tokens and classes: `web/src/index.css`. Components: `web/src/app/overlay/ui.tsx`.

## Principle: it is an overlay, not an app
- **On top of the content, not in its place.** No large headers, side bars, card grids or dashboard panels.
- **Few things always visible.** The rest appears when needed and goes away quickly.
- **Each piece takes up and gets in the way as little as possible.**
- **For people with low vision:** legibility rules over aesthetics. AA contrast at least, over any background.

## Direction: «large print»
- **The menu is a large-print page.** Each MX Keypad key is a line of text, in order from 1 to 8 (9 is the menu itself), all the same size and with their number in a fixed column.
- **Choosing is like reading.** The line under the pointer, the hand or the focus is marked with the highlighter band (`mark`), the same mark as the line being read.
- **One palette, Night:** a blue-green ink (`#101A1F`) with highlighter yellow (`#F2C94C`). Its 10 base colours (`--t-*` in `index.css`) feed every role. Five palettes were tried (Night, Day, Magnifier, Contrast and Warm; commit `55953a0`) and disabled: another palette is a block of 10 colours.
- **Swiss order:** a single left-aligned column, to the right of the camera panel, and clear type steps.
- **Skills applied:**
  - installed in `~/.claude/skills`: Impeccable, UI/UX Pro Max, Taste Skill, avoid-ai-design and web-design-guidelines;
  - plus the frontend-design plugin.

## Pieces
| Piece | Where | How it looks |
|---|---|---|
| Layer | `.halo-layer` (`index.css`) | The dimmed screen (`layer`); the desktop can still be seen behind it |
| Menu | `Hub.tsx`, `.print-line` | A list of lines from 1 to 8 (number, name and icon), in `text-display`, with the highlighter when pointed at. A sentence below says what the pointed line does |
| Tool panel | `Panel` (`ui.tsx`) | Glass (`surface`) with a 1 px border. Header: back, neutral icon, name and a sentence |
| Camera | `CameraPanel` (`Overlay.tsx`), the bubble and the gesture page (`web/src/input/desktop`) | 1–2 px border, no shadow or coloured rings. The hand is drawn in the text colour; yellow is what is pointed at |
| Fist menu | `gestureControl.css`, `menuView.ts` | The nine positions around the hand. Each option has an icon, a name and a state if it is a toggle. Holding the gesture fills it with a soft yellow; choosing it, with the highlighter. «Close app» has its icon and border in red |
| Readers | `DocumentsMode`, `GuidedReader`, `ReadFileMode`, `PdfViewer` | The line being read, in yellow (`.reading-mark`). The PDF page, in `paper` |
| AI Summary | `SummarizeMode.tsx` | A glass bubble next to the cursor |
| Transcribe | `LiveCaptions.tsx` | Base buttons: start is `btn-primary` and stop is `btn-danger`. Language in a `Tag` |
| Notices | `VoiceBanner`, `Status`, the gesture page's messages | A glass pill. While recording, the mic icon in yellow; on error, a `warn` border |
| Developer | `App.tsx`, `Gestures.tsx`, `DictationPanel.tsx` | The same tokens (test screen, out of the demo) |

## Tokens (`@theme static` in `index.css`)
| Group | Tokens | Rule |
|---|---|---|
| Text | `fg`, `fg-muted`, `on-accent` (classes `text-fg`, `text-fg-muted`, `text-on-accent`) | `fg-muted` only for secondary things, never for actions |
| Accent (one) | `accent` (`#FFD84D`) | See «Direction» |
| States | `warn`, `danger` | Always with an icon or with words, never colour alone |
| Surfaces | `layer`, `surface`, `surface-solid`, `surface-opaque`, `scrim`, `scrim-light`, `backing`, `paper` | See «Transparencies» |
| Fills | `fill`, `fill-strong`, `fill-hover`, `edge`, `highlight` | Controls and 1 px borders |
| Type | `text-meta` · `text-body` · `text-lead` · `text-title` · `text-display` | Only these 5 sizes, in 400 and 700, with Atkinson Hyperlegible |
| Radii | `rounded-chip` · `rounded-field` · `rounded-card` · `rounded-panel` · `rounded-full` | The radius is chosen by the piece's size, not one for everything |
| Elevation | `shadow-edge` (1 px light) | No large shadows |
| Motion | `--duration-fast` (150 ms), `--duration-base` (200 ms), `ease-soft` | See «Motion» |
| Minimum size | `--target-min` (52 px at 125 %) | Nothing clickable smaller |
| Spacing | the Tailwind scale: 1, 2, 3, 4, 6, 8 and 12 | No loose values |

- **Forbidden in components:**
  - loose colours (`#…`, `rgb(…)`, `text-sky-300`, `bg-white/8`);
  - loose sizes and radii (`rounded-[1.25rem]`, `text-[17px]`).
- **If something is missing,** a token is added here and in `index.css`.
- **Exceptions:**
  - the menu's geometry (positions and sizes of the circles);
  - the camera canvas, which needs fixed values: it copies them from the tokens in `HALO` (`web/src/input/overlay.ts`).
- **Old names:** the first `@theme` block (`ink`, `snow`, `mist`, `line`, `mark`…) stays for compatibility; new code uses the names above.

## Transparencies (kept as they are)
Contrast measured with the surface over a white desktop (the worst case) and a black one:

| Token | Value | Where | `fg` | `fg-muted` |
|---|---|---|---|---|
| `layer` | bluish black at 82 % and a lighter centre | The full-screen layer | 11.1 / 18.5 | 6.5 / 10.9 |
| `surface` | `rgb(16 24 50 / .9)`, 18 px blur | Panels (the only surface) | 12.2 / 16.6 | 7.2 / 9.8 |
| `surface-solid` | the same at 96 % | Fixed bars that pass over the content | — | — |
| `scrim` | bluish black at 62 % | Fist menu over the camera | 5.2 / 18.7 | 3.1 / 11.0 |
| `scrim-light` | bluish black at 40 % | Fist menu over the desktop | 2.5 / 19.0 | 1.5 / 11.2 |

- **The blur** goes only on the top surface (panels and bars) and is never stacked: in the Windows WebView it costs GPU and the camera has to run smoothly. The fist menu's options and the gesture page's cards have no blur: at 90 % opacity it was barely noticeable.
- **Text over `scrim` or `scrim-light`:** always inside a surface or with `.backing`, a soft plate behind the text (at 72 %). The centre of the fist menu over the desktop already has it. The opacity of everything is not raised.
- **Fill of what is being held** (a sustained gesture, the volume level): yellow at 38 %, with the light text on top at 3:1 or more (large, bold text).
- **Click-through:** only the layer and the panels capture the mouse. The gesture screen lets clicks through (`docs/VENTANA.md`).

## Components
| Piece | Class or component | States |
|---|---|---|
| Button | `.btn`, `.btn-primary` (accent), `.btn-danger` (stop or delete), `.btn-quiet` (no fill) | hover, focus, active, disabled (`disabled` or `aria-disabled`), loading (`aria-busy`) |
| Icon button | `IconButton` (`.btn-icon`), with a mandatory `label`; also the back button | The same |
| Toggle | `Switch` (`.switch`, `role="switch"`), with its text next to it | On, off, disabled |
| Tag | `Tag` (`.tag`), with `tone` `warn` or `danger` | — |
| Panel | `Panel` (`.glass`) | — |
| Status | `Status` | info, warning |
| Shortcut | `.kbd` | — |
| Text over a scrim | `.backing` | — |
| Icons | `Icon`: a single family (24 grid, 1.8 stroke, round caps) | No emojis as icons |

## Against the «made by AI» look
Summed up by the skills consulted (below):
- **No:**
  - purple or blue gradients, nor gradient text;
  - neon glows, nor glass on everything;
  - identical cards with a shadow, nor cards inside cards;
  - an icon in a square over every title;
  - spaced-out uppercase labels;
  - decorative numbering;
  - a highlighted word in the title;
  - arrows on buttons;
  - generic copy («Seamless», «Get started»);
  - bouncing animations.
- **Yes:**
  - every border, number or label says something;
  - the radius and the elevation are chosen for each piece;
  - the copy is concrete: the verb of the action, and errors say what happened and what to do.
- **The «default» test:** if a decision would appear in any other similar app, it is reviewed before writing the code.

## Motion
- **Duration:** from 150 to 200 ms, with `ease-soft` and no bounce, only in response to something the person does.
- **What moves on its own:** nothing. When the layer opens, the menu lines slide in from the left once, and the highlighter runs along the line when it is pointed at.
- **With «reduce motion»:** nothing is animated.
- **A fast interaction can cut the animation short,** but the final state and the focus have to end up right.

## Accessibility (a condition, not an extra)
- **Focus:** a 4 px yellow ring, 3 px apart, always visible.
- **Contrast:** AA at least for text, measured over a white and a black background. The reading text is large (`html` at 125 %, lines in `text-display`).
- **Mouse use:** everything can be done with the mouse alone, and anything clickable measures at least `--target-min`.

## Adding a tool
1. **An entry in `MODES`** (`modes.ts`), with `accent: 'var(--color-accent)'`.
2. **Its view, inside `Panel`.** Use the components and the tokens above; no loose colours.
3. **If the keypad should open it,** its action in `keypad.ts` (`docs/KEYPAD.md`).

## Where it comes from
- **Design skills** (read as a reference, not installed):
  - `anthropics/skills` frontend-design;
  - Impeccable (`pbakaus/impeccable`);
  - UI/UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`);
  - Taste Skill (`Leonxlnx/taste-skill`);
  - avoid-ai-design (`funboy322/avoid-ai-design`).
- **The videos could not be watched:** the agent does not play video.
