# Estado del proyecto: dónde estamos y adónde vamos

Última actualización: **2026-11-22, madrugada** (Pau). **Mantenlo al día:** si cierras un arreglo o cambias algo que afecta a todos, cambia aquí la línea correspondiente. El detalle va en la ficha, no aquí.

## La app hoy
El **overlay** (`task overlay` → `build/bin/lauzhack.exe`): Ctrl+Alt+Espacio o la tecla 1 del keypad oscurecen la pantalla y muestran las herramientas.

| Herramienta | Qué hace | Estado |
|---|---|---|
| **Gesture Control** (centro, tecla 8) | Gestos con la mano → acciones del PC y de las videollamadas; menú del puño, volumen y brillo con la pinza; burbuja de cámara | En Halo y seguro (acciones de energía desactivadas, pinza sin saltos). Comprobado por Pau con el `.exe` y la mano |
| **PDF Scanner** (tecla 2) | Papel ante la cámara → foto **solo al pulsar «Take photo»** (o Enter; con el modo cursor, con la mano) → OCR → **dos PDF siempre**: el escaneado (la foto, con texto buscable) y la **versión con IA** (el documento rehecho por el modelo de visión, ~30 s más y ~0,03 $). Se ven en el visor, que solo lee al pulsar Espacio | Arreglado el 2026-11-22: el servicio no arrancaba en un equipo sin `scanner\pdf\.venv` (`No module named cv2`); hay que pasar `scanner\pdf\scripts\install.ps1` una vez por equipo |
| **Read Text** (tecla 5) | Abre un PDF, una imagen o un texto y lo lee línea a línea | Probado |
| **Visor de PDF** | Lee el PDF entero en voz alta, página a página (N4) | Hecho; algunas partes, con el estilo viejo (R1) |
| **AI Summary** (tecla 7) | Resume el texto seleccionado en cualquier programa, en una burbuja junto al cursor | Probado (modelo barato) |
| **Transcribe** | Subtítulos en directo del micro o de una llamada: quién habla, idioma, barbarismos entre comillas, traducción, `.txt` | En `main` desde hoy (`GET /captions`, Together AI). Probado en el navegador; **falta el `.exe`** |
| **MX Keypad** | Teclas 1–9 → acciones (`docs/KEYPAD.md`) | Hecho; teclas reasignadas por Isaac (`docs/KEYPAD.md`); **falta probar la orden de voz (tecla 7) con micro** (R4) |

## Fase de arreglos (va antes que cualquier funcionalidad nueva)
| ID | Arreglo | Persona | Estado |
|---|---|---|---|
| R1 | Una sola interfaz (Halo) en todas las pantallas | Didac | Gesture Control ya en Halo. **Falta:** pantalla Developer (`App.tsx`, `DocumentText.tsx`, `Cost.tsx`) y visor de PDF (`PdfViewer.tsx`), o sacarlas del recorrido de la demo |
| R2 | Gesture Control seguro y estable | Nil | Energía desactivada y pinza estable, en `main`. **Falta:** 5 min de uso con el `.exe` sin acciones involuntarias; compartir la cámara con PDF Scanner |
| R3 | PDF Scanner de punta a punta (y Transcribe) | Pau | PDF digital de pago **desactivado** por defecto y Transcribe conectado, en `main`. **Falta:** 5 escaneos seguidos con la Brio desde el `.exe`; aviso por voz si falta el servicio o Tesseract |
| R5 | Flujo de ventanas: el overlay manda y los gestos conviven (`docs/VENTANA.md`) | Pau | Controlador único de la forma de la ventana, probado con el `.exe` y el log. **Falta:** que Pau lo pruebe con la mano (menú del puño, modo cursor, AI Summary) |
| R4 | Arranque: versión visible, instalación, keypad y voz | Isaac | PR #51 abierto. **Falta:** versión en la barra, `task setup`, aviso de otra instancia, voz con micro |

Fichas con el «Hecho cuando» y el registro: `docs/arreglos/R1.md` … `R4.md`.

## Después de los arreglos (tablero `TAREAS.md`)
- **N5** modo cursor (parcial) → **N6** seleccionar texto con el cursor (parcial) → **N7** resumir el documento entero (falta; la selección ya funciona) → **N8** demostrar que es eficiente (pendiente).
- **N9** volumen por voz (parcial).
- Ideas aparcadas: `docs/historial/ideas/`.

## Para la demo
- Guion: `docs/PITCH.md`. Pruebas de humo: `docs/COMO_PROBAR.md`.
- Hace falta: `.env` con `OPENROUTER_API_KEY` (y `TOGETHER_API_KEY` para Transcribe); el escáner instalado (`scanner\pdf\scripts\install.ps1`); la MX Brio y el MX Keypad conectados.

## Decisiones vigentes (el porqué, en `docs/DECISIONES.md`)
- **Sistema de diseño del overlay** (`docs/DESIGN.md`): sustituye a Halo (en `docs/historial/`); todas las pantallas migradas, un solo acento amarillo. Gesture Control va dentro de la app (un solo ejecutable).
- **Keypad** leído por USB, sin Options+; atajos de respaldo Ctrl+Alt+Shift+N.
- **Modelos:** `cheap` Haiku 5.5, `expensive` Sonnet 5.5 (OpenRouter); transcripción de respaldo con Gemini Flash Lite; Transcribe con Together AI (Parakeet + Qwen3.5-9B). **Presupuesto del equipo: 10 €**; `LLM_PROFILE=dev` mientras se desarrolla.
- **Escáner:** responde con el `document` en cuanto acaba el OCR y hace los PDF en segundo plano; el PDF digital (de pago) solo con `SCANNER_DIGITAL=1`. Sin hoja pero con texto, devuelve el texto sin `pageCorners`.
- **Ventana:** una sola forma a la vez, decidida por `app_window.go` con una jerarquía fija; los gestos nunca abren, cierran ni encogen el overlay (`docs/VENTANA.md`).
- **API local** solo para 127.0.0.1 y los orígenes de la app (`ws.Guard`).

## Problemas conocidos
- Un gesto llegó a suspender el PC (arreglado en R2; vigilar el log `did:`).
- Ctrl+Alt+Espacio puede estar ocupado por otro programa: usar la tecla 1 del keypad.
- Fotos desenfocadas: el escáner no las lee (normal); la guía de encuadre de la app espera al enfoque.
- El servicio de lectura necesita su entorno (`scanner\pdf\scripts\install.ps1`, una vez por equipo). Sin él, la app arranca el Python del sistema y el servicio muere con `No module named cv2` (se ve en `build/bin/reading-service.log`).
