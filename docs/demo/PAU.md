# Demo · Pau: leer papel y Transcribe

Responsable: **Pau**. Plan común y reglas: `docs/demo/README.md`. Parte del código es de Didac (`scanner/`, `web/src/document`): avísale antes de cambiarlo.

## Qué revisas
| Pieza | Dónde |
|---|---|
| Servicio de lectura (Python, puerto 8770): foto → hoja → OCR → PDF escaneado y versión con IA | `scanner/service.py`, `scanner/pdf/src/scanner_pdf/` |
| Cliente Go del servicio y bindings de PDF Scanner | `backend/scanner/`, `app_scanpdf.go` (de Isaac: avísale) |
| Pantalla de PDF Scanner | `web/src/app/overlay/DocumentsMode.tsx` (de Isaac: avísale) |
| Cámara | `web/src/camera/` |
| Transcribe | `backend/captions/`, `web/src/captions/` |
| La forma de la ventana (R5) | `app_window.go` |

## Qué tiene que funcionar en la demo
1. **PDF Scanner (tecla 2):**
   1. Se ve la cámara.
   2. La foto se hace **solo** al pulsar «Take photo», con Enter o con el cursor de la mano.
   3. Primero sale el **PDF escaneado** y, unos 15–30 s después, la **versión con IA**.
   4. Se cambia entre los dos con «Scanned PDF» y «AI version», y Espacio los lee.
2. **Cinco escaneos seguidos** con la MX Brio sin reiniciar la app, con «Read another paper».
3. **Transcribe (tecla 5):** subtítulos en directo del micro, quién habla y el `.txt` guardado.
4. **La ventana** no se queda en una forma rara al pasar de una herramienta a otra.

## Fallos y riesgos conocidos
- **Transcribe no funciona: falta `TOGETHER_API_KEY`** en el `.env` del portátil de la demo. Añádela (nunca en el repo ni en un chat). Además:
  - **Sin clave**, el log repite `captions: no_key` **cada segundo**: el cliente reintenta sin pausa. Tiene que decirlo una vez en pantalla y dejar de reintentar.
  - **Si Together falla o no hay red**, tiene que decirlo y no colgarse.
- **El servicio de lectura necesita su entorno** (`scanner\pdf\scripts\install.ps1`, una vez por equipo). Sin él, la app arranca el Python del sistema y el servicio muere con `No module named cv2`. La pantalla solo dice «The reading service did not start». Que diga qué hacer (coordínalo con Isaac, que mira el aviso al arrancar).
- **Bordes de la hoja:** con la webcam no los encuentra (`page_not_detected` en `result.json`). Funciona igual, pero sin corregir la luz.
  - Didac tiene sin subir `60070a2` y cambios en `service.py` que buscan las esquinas con IA (`ai_corners`). Pídele que los suba y revísalos antes de la demo.
- **Versión con IA:** tarda 15–30 s y cuesta ~0,03 $ (presupuesto del equipo: 10 €).
  - El umbral de «papel claro» ya es 150 (antes 200, que rechazaba las fotos de webcam).
  - Comprueba qué pasa si falla OpenRouter: tiene que quedar el PDF escaneado y un mensaje.
- **Timeouts:** `ScanPDF` tiene 75 s y `MakeDigitalPDF` 160 s. Que ninguna espera se quede sin límite y que «Read another paper» corte la anterior.
- **Cámara compartida con los gestos** (con Nil): PDF Scanner pausa los gestos. Comprueba que la cámara no llega a 640×360 cuando Gesture Control la tenía abierta.
- **Puerto 8770 ocupado** por un `service.py` viejo: la app lo reutiliza sin las rutas nuevas. Detéctalo o documéntalo en `docs/COMO_PROBAR.md`.

## Cómo probar
- **App:** `task overlay` → `build/bin/lauzhack.exe`. Logs: `build/bin/lauzhack.log` y `build/bin/reading-service.log`. Resultados de cada escaneo: `scanner/pdf/output/scan-*/` (`result.json`, `original.png`).
- **Tests:**
  - `cd scanner/pdf && .venv/Scripts/python -m pytest -q` (81);
  - `cd scanner && pdf/.venv/Scripts/python -m unittest discover -s .`;
  - `task check`.

## Hecho cuando
- [ ] Cinco escaneos seguidos con la MX Brio, cada uno con los dos PDF.
- [ ] Transcribe funciona con la clave y, sin ella, lo dice una vez y no reintenta en bucle.
- [ ] Sin el entorno del escáner, la pantalla dice exactamente qué comando pasar.
- [ ] Ninguna espera sin límite y ningún error sin mensaje.

## Prompt para tu agente
```
Lee AGENTS.md, docs/demo/README.md y docs/demo/PAU.md. Trabajas para Pau en la fase de pulido para la
demo: no añadas funcionalidades, haz robusto lo que hay. Revisa PDF Scanner (scanner/, backend/scanner,
DocumentsMode.tsx, web/src/camera), Transcribe (backend/captions, web/src/captions) y app_window.go, con
los puntos de «Qué tiene que funcionar» y «Fallos y riesgos». Empieza por el reintento en bucle de
Transcribe sin TOGETHER_API_KEY. Reproduce cada fallo con el .exe y los logs antes de cambiar nada. Un
arreglo = un commit en una rama demo/pau-<tema>, con su línea en el Registro de docs/demo/PAU.md. Las
carpetas de Didac (scanner/, web/src/document) y los archivos de Isaac: pregúntame antes de tocarlos.
Nunca imprimas ni subas claves.
Para cada arreglo escribe o actualiza sus tests, pasa task check (y los tests de tu parte) y
pruébalo con el .exe; abre un PR y, con el CI en verde, fusiónalo tú mismo a main
(gh pr merge <n> --merge). Nadie revisa lo de otros.
```

## Registro (lo rellena el agente)
Por cada fallo: síntoma → cómo reproducirlo → causa → arreglo → cómo se ha comprobado (con el `.exe`).

- **Transcribe sin clave reintentaba en bucle.**
  - **Síntoma:** sin `TOGETHER_API_KEY`, el log repetía `captions: no_key` cada segundo.
  - **Reproducir:** un servidor sin `.env` (`backend/cmd/server` desde una carpeta vacía) y dos conexiones a `/captions`: cada una recibe `no_key` (`retryable: false`) y se cierra.
  - **Causa:** el cliente (`LiveCaptions.tsx`) tomaba ese cierre por una caída y reconectaba al cabo de 1 s, y ponía el contador de reintentos a 0 en cada conexión, así que nunca llegaba al límite de 3.
  - **Arreglo:** `web/src/captions/reconnect.ts` (función pura y con tests).
    - Un error definitivo (`no_key`, clave rechazada, tope de coste) no se reintenta: se para el micro, Go cierra la sesión y guarda el `.txt`, y se dice una sola vez qué hacer.
    - El contador solo vuelve a 0 con `ready`: 3 reintentos (1, 2 y 4 s) y después se ofrece Whisper local.
  - **Comprobado:**
    - tests de `reconnect.ts` (200 en verde);
    - con el `.exe` y una clave no válida: **un solo** `captions:` en el log en 10 s (antes, uno por segundo), el aviso «Together AI refused the key. Check TOGETHER_API_KEY…» y el botón «Use local Whisper»;
    - el caso sin clave no se puede montar con el `.exe` (Windows no admite una variable vacía y la app lee el `.env`), así que se comprobó con el servidor y los tests.
- **El servicio de lectura no decía qué hacer** (archivos de Isaac, `backend/overlay/procs.go`, y de Didac, `scanner/service.py`, con permiso de Pau).
  - **Síntomas:**
    - sin `scanner/pdf/.venv`, la app arrancaba el Python del sistema, que moría con `No module named cv2`, y la pantalla solo decía «exited on start (see …log)»;
    - un `service.py` viejo en el 8770 se daba por bueno, aunque le faltaban las rutas nuevas.
  - **Reproducir:** un servidor de prueba en el 8770 que contesta a `/health` sin versión (como uno viejo) → `.exe` → tecla 2.
  - **Causa:** `Healthy` aceptaba cualquier servicio que contestara a `/health`, y `Ensure` no miraba ni el entorno ni el log.
  - **Arreglo:**
    - `/health` dice su versión de rutas (`"api": 3`), y la app rechaza un servicio más viejo, explicando cómo cerrarlo; nunca lo mata, porque no es suyo;
    - sin `scanner/pdf/.venv` (y sin `LAUZHACK_PYTHON`), no arranca el Python del sistema y da el comando de instalación;
    - si el servicio muere al arrancar, lee el final de `reading-service.log`: `No module named …` → el comando de instalación; puerto ocupado → cerrarlo.
  - **Comprobado:**
    - tests de Go (`procs_test.go`: versión buena, servicio viejo, motivos de la caída, entorno) y de Python (`/health` con `api`), 42 en verde;
    - con el `.exe` y el servicio falso en el 8770: PDF Scanner muestra «an older reading service is answering on port 8770… Close it… then try again».

- **Visto de paso (pendiente):**
  - En una pantalla de 1536 px **los paneles del overlay** (Transcribe, PDF Scanner…) se salen por la derecha y cortan texto y botones: es del diseño del overlay (Isaac).
  - Un `server.exe` viejo (`go run ./backend/cmd/server`) ocupaba el 8765: la app usa otro puerto, pero las pruebas a mano contra el 8765 hablaban con el código viejo.
