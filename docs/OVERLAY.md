# Overlay: una app que junta las funcionalidades

Rama `overlay`, creada el 2026-11-21. Brief de Isaac: `docs/briefs/isaac.md`.

La app de escritorio deja de ser una ventana normal y pasa a ser un **overlay**: una ventana siempre encima de las demás que se abre desde cualquier programa con **Ctrl+Alt+Espacio**. El **MX Keypad** de Logitech también puede abrirla si en Logi Options+ se asigna esa combinación a una de sus teclas. El overlay ofrece las funcionalidades del equipo como opciones:

| Tecla | Opción | De quién | Qué hace |
|---|---|---|---|
| **1** | Gestos con la mano | Nil (C) | **Gesture Control** dentro de la propia ventana: la cámara ve la mano y controla el ordenador (ratón, volumen, brillo, micrófono, apps, apagado, videollamada) |
| **2** | Leer un papel | Pau (B1) y Didac (B2) | Cámara con la guía de encuadre por voz → foto automática → servicio de lectura → **lectura guiada** en voz alta |
| **3** | Leer un archivo | Didac (B2) | Pide un documento del PC (PDF, texto o imagen) y lo lee en voz alta línea a línea (**lectura guiada**) |

Las tres opciones son **locales y gratuitas**: ninguna llama a un modelo de IA.

## Cómo se construye y se arranca
Requisitos:
- Go 1.26 o superior, Wails 2.17.1, Task y Node.
- El entorno de Python del escáner (`scanner/pdf/.venv`, ver `scanner/ENTREGA.md`).
- Tesseract, solo para las fotos, los PDF escaneados y las imágenes.

```
task overlay          # build/bin/lauzhack.exe (con Gesture Control dentro)
build\bin\lauzhack.exe
```
- `task overlay` hace `wails build`: un solo ejecutable. Gesture Control va dentro (paquete `adapters/desktop/control`). Si se quiere usar solo, sin el overlay, `task gestures` compila `build/bin/gesture-control` como antes.
- La app busca `scanner/service.py` subiendo desde su carpeta (hasta 4 niveles), así que `build/bin/lauzhack.exe` lo encuentra en el repo.
- Log en `build/bin/lauzhack.log`; el servicio de lectura escribe en `reading-service.log`, en la misma carpeta.

Variables opcionales:

| Variable | Para qué | Por defecto |
|---|---|---|
| `LAUZHACK_HOTKEY` | Otro atajo: `ctrl+shift+l`, `f13`… Una tecla sola solo se acepta de F13 a F24 | `ctrl+alt+space` |
| `LAUZHACK_PYTHON` | Otro intérprete de Python para el servicio de lectura | el de `scanner/pdf/.venv`; si no, `py -3` o `python3` |
| `LAUZHACK_GESTURES_DRY_RUN` | `1`: los gestos solo escriben en el log lo que harían, sin pulsar nada | apagado |
| `LAUZHACK_SCREEN` | Tamaño de pantalla para el ratón cuando no se detecta (Linux Wayland), por ejemplo `1920x1080` | se detecta |
| `LAUZHACK_APPS` | Ruta del `apps.json` del menú «Apps» de los gestos | se busca `apps.json` (ver `adapters/desktop/README.md`) |
| `SCANNER_URL` | Otro servicio de lectura, o `fixture` para el ejemplo fijo | `http://127.0.0.1:8770/scan` |

## Cómo se usa
- **Ctrl+Alt+Espacio:**
  - Si el overlay está oculto, lo muestra al frente con el teclado listo.
  - Si está abierto pero tapado por otra ventana (la de los gestos, por ejemplo), lo trae al frente.
  - Si está al frente, lo oculta.
- **En el menú:**
  - **1, 2 y 3** (también Num 1–3) eligen una opción.
  - **Esc** oculta el overlay.
  - **D** abre la pantalla de desarrollo anterior (`App.tsx`).
  - **Q** cierra la app y los programas que haya arrancado.
- **Dentro de una opción:** **Esc** vuelve al menú. Lo que se está leyendo sigue sonando aunque se oculte el overlay.
- **Lectura guiada** (opciones 2 y 3): Espacio o Num 5 pausa y sigue, ← o Num 4 va a la línea anterior, → o Num 6 a la siguiente, R o Num 8 repite, y un clic en una línea lee desde ahí.
- **Opción 1:** al entrar se abre la cámara de los gestos dentro de la ventana; **Esc** vuelve al menú y la apaga. Mientras está abierta, **el atajo** (o **M**) no oculta la ventana: la encoge a una **burbuja de cámara** en la esquina inferior derecha, siempre encima, y los gestos siguen funcionando. El atajo o un doble clic en la burbuja la devuelven a tamaño completo. (Una ventana oculta frenaría la cámara.) Desde la burbuja, al abrir el menú de gestos con ✊ (o al ajustar el volumen o el brillo) la ventana pasa a **pantalla completa transparente**: las opciones salen encima de lo que haya abierto y la cámara queda pequeña en una esquina; al terminar vuelve a la burbuja. Solo ocupa la pantalla mientras no hace falta el ratón, así que nunca se queda con los clics de otros programas. *Sin probar en Windows: si la transparencia no funciona, se verá un fondo oscuro detrás del menú.*
- **Opción 2:** la foto se hace sola cuando el papel está quieto (a los 8 s, la mejor que haya); **Intro** la hace en el momento. Si no hay hoja, lo dice en voz alta e **Intro** lo reintenta.
- **Opción 3:** se abre el diálogo de archivos; **O** abre otro archivo.

**MX Keypad:** en Logi Options+, asigna a una tecla la combinación Ctrl+Alt+Espacio y, si quieres, a otras teclas «1», «2» y «3» (o Num 1–3) y las de la lectura guiada (Num 4, 5, 6 y 8). No hace falta cambiar nada en la app. *Sin probar todavía con el keypad real.*

## Cómo está hecho
```
lauzhack.exe (Wails, ventana siempre encima)
├─ web/src/app/overlay/      menú y opciones (React)
│    modes.ts                lista de opciones: tecla, título, dueño, ready
│    Overlay.tsx             menú, teclas, Esc, pantalla de desarrollo
│    GesturesMode.tsx        1: monta la página de Gesture Control (web/src/input/desktop) en la ventana
│    DocumentsMode.tsx       2: openCamera + startFramingGuide (Pau) → ReadPhoto → GuidedReader (Didac)
│    ReadFileMode.tsx        3: OpenAndReadFile → GuidedReader
│    desktop.ts              acceso a los bindings de Go (window.go), sin depender de wailsjs/
├─ app_overlay.go            bindings: OverlayInfo, HideOverlay, Quit, EnsureReadingService,
│                            ReadPhoto, OpenAndReadFile, GestureCall, SetGesturesActive, SetCompact
├─ backend/overlay/          atajo global (RegisterHotKey de Windows), procesos auxiliares
└─ backend/scanner/          cliente del servicio de lectura: Scan (fotos) y ReadFile (archivos)

Procesos que arranca la app (y que para al cerrarla, con sus hijos):
  scanner/service.py         127.0.0.1:8770 (solo si no responde ya); POST /scan y POST /document
```

**Archivos del PC → documento.** El documento que sale es el `DocumentPayload` del contrato, sin cambiarlo.
- Texto (`.txt`, `.md`): lo lee Go (`scanner.FromText`). Una línea por bloque; los párrafos largos se cortan por frases.
- PDF e imágenes: van a `POST /document` del servicio de lectura (`scanner/documents.py`).
  - **PDF con texto:** las líneas salen del propio PDF, al instante y sin OCR.
  - **Página escaneada:** se renderiza a 300 ppp y pasa por el OCR, como mucho 8 páginas por PDF.
  - **PNG o JPEG:** pasa por el OCR, buscando la hoja si es una foto de un papel.
  - Las páginas se apilan de arriba abajo: la página p de n ocupa `y ∈ [p/n, (p+1)/n]`, así que se leen en orden.
- Para añadir un formato: `FileTypes` en `backend/scanner/document.go` y, si no es texto, un lector en `scanner/documents.py`.

## Decisiones (2026-11-21, Isaac con Didac)
1. **Rama `overlay`** a partir de `feature/didac-lectura-guiada`: la integración completa (#38), más el arranque por persona (#39) y la lectura guiada (#40). No se toca `main`.
2. **El atajo es Ctrl+Alt+Espacio**, configurable con `LAUZHACK_HOTKEY`. El keypad envía la misma combinación desde Logi Options+.
3. **Tres opciones de momento:** gestos (Nil), leer un papel (Pau y Didac) y leer un archivo (Didac). Añadir otra es una entrada en `modes.ts` y un componente.
4. **«Texto a voz» lee un documento del PC** (PDF, texto o imagen) y comparte el lector con los papeles escaneados. Formatos de ahora: PDF con texto, PDF escaneado, imágenes y TXT/Markdown. Más adelante se pueden añadir otros (Word…).
5. **El servicio de lectura lo arranca la app** si no responde, con el Python del repo, y lo para al cerrarse (solo si lo arrancó ella).
6. **Gesture Control va dentro de la app** (cambiado por Nil, 2026-11-22): un solo ejecutable. La página de la cámara se monta en la opción 1 y sus acciones van a Go por el binding `GestureCall`, que responde la misma API que el programa independiente (`control.Server.Call`) sin HTTP, puerto ni token. Con los gestos activos la ventana no se oculta, se encoge a una burbuja; además, la app pide a WebView2 que no frene la página cuando queda tapada (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`).
7. **Una cámara a la vez:** la opción 2 para los gestos antes de abrir la cámara.
8. **Los bindings devuelven JSON en texto.** Si devolvieran estructuras, Wails generaría `models.ts` con `namespace`, que el `tsconfig` del proyecto rechaza (`erasableSyntaxOnly`).
9. **Ventana:** normal, con marco, siempre encima y de 960×680. Se abre visible la primera vez. El diseño visual queda para después.
10. **Log:** primero el archivo y después stderr, y los fallos graves (panic) también van al log. Antes, `build/bin/lauzhack.log` se quedaba vacío porque una app sin consola no tiene stderr válido.

## Preparado para lo que aún no está definido
| Pendiente | Qué hay preparado | Quién lo decide |
|---|---|---|
| Abrir una opción **por voz o por gesto** (por ejemplo, la acción `scan_document`, «lee el documento») | Las opciones son una lista (`MODES`) y el menú solo necesita un `setView(id)`. El módulo de voz y gestos puede emitir esa orden cuando exista | Nil e Isaac |
| **Explicar** el documento con IA (como hace la app con `POST /scan`) | No está conectado, para no gastar. Bastaría con enviar el documento por el WebSocket (`document`): Go ya lo explica y el coste sale en `stats` | Equipo (coste, AXA) |
| **Más formatos** (Word, ePub…) | `FileTypes` en Go y un lector en `documents.py` | Didac |
| **MX Keypad** | El atajo y todas las teclas son combinaciones normales, sin código propio de Logitech | Probarlo con el keypad real |
| **Idioma** de la voz | Fijo en es-ES en la opción 2; el lector usa el idioma del documento si lo trae | Equipo |
| **Linux y macOS** | El atajo solo está hecho para Windows; en los demás sistemas la ventana se queda abierta | Si hace falta |
| **Diseño visual** | Funcional, con texto grande y alto contraste | Después |
| Qué pasa con la **pantalla anterior** (`App.tsx`, con «Send sample document» y el diagnóstico) | Se abre con **D** desde el menú | Isaac |

## Qué está probado
Probado en Windows 11 con el `.exe` real, enviando las teclas al sistema y comprobándolo con capturas y con el log:
- El atajo muestra y oculta el overlay desde cualquier programa, y lo trae al frente si está tapado. Esc lo oculta.
- **Opción 3:** con `01-carta-renovacion.pdf`, la app arrancó sola el servicio de lectura en 1 s. Leyó 21 líneas del PDF en 16 ms y empezó a leerlas en voz alta, con la línea resaltada.
- **Opción 2:** se abrió la cámara, la guía disparó a los 8 s y el servicio respondió 422 (no había ningún papel delante). La app lo dijo y ofreció reintentar. La imagen de la cámara salía con el icono de cámara tapada: hay que repetirlo con la MX Brio destapada y un papel.
- **Opción 1:** (antes de unirlo) Gesture Control arrancó con su ventana. **Gestos dentro de la app: sin probar aún en Windows** — solo con tests, compilación para Windows y una prueba en navegador con los bindings simulados.
- **Q y cerrar la ventana** paran también el servicio de lectura.
- **Tests:**
  - Go: `backend/overlay` (atajos, URL del servicio) y `backend/scanner` (texto, envío a `/document`, tipos no admitidos);
  - Python: `scanner/test_service.py` (PDF con texto, PDF de 2 páginas, PDF escaneado con OCR y archivo no válido): 33 de 33;
  - web: lint sin avisos, 136 tests y build.

**Sin probar:**
- el MX Keypad;
- un papel real con la cámara destapada;
- un PDF escaneado o una imagen desde la app (sí con los tests del servicio);
- Linux y macOS.

**Observado una vez:** en la primera prueba, el `.exe` se cerró solo, sin dejar nada en el log, que entonces no funcionaba. No se ha repetido. Si vuelve a pasar, ahora el motivo queda en `lauzhack.log`.
