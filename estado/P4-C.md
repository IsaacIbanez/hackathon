# Estado — P4-C

- **Persona:** Pau
- **Herramienta:** Claude Code
- **Tarea actual:** T12 — `web/src/camera` (`openCamera`, `captureStill`); después, traducir `capturar.py` avisando a Didac
- **Rama:** feature/T12-camara
- **Estado:** en revisión
- **Último cambio:** 2026-11-21 21:00

## Hecho
- #12 (fusionado): `scanner/capturar.py`, captura de la MX Brio (única ≈2,7 s, modo servidor ≈0,4 s, puerto 8766).
- T12: `web/src/camera`:
  - `openCamera(opts?)`: prefiere la cámara cuyo nombre lleve «Brio» > «Logitech» > «Logi»; ignora las virtuales; si no hay, abre la que haya. Pide 3840x2160 a 30 fps.
  - `captureStill(video, opts?)`: el frame más nítido de ~0,5 s (varianza del laplaciano sobre una copia de 960 px, como `capturar.py`), a resolución completa, PNG sin pérdida (o JPEG 0,95).
  - Tests sin DOM (11) en `src/camera/test/`; página de prueba en `src/camera/demo/` (`npx vite web/src/camera` → `/demo/`).
  - `tsc -b`, `npm run build`, `npm test` (80 tests) y oxlint en verde.

## Pendiente
- Probar la página de prueba con la MX Brio dentro de la ventana de Wails (WebView2): resolución entregada y tiempo de `captureStill`.
- Traducir `capturar.py` al inglés en un PR aparte, dejando `capturar.py` como alias de los nombres antiguos para no romper `scan.py` ni `demo_app` de Didac.
- T16: 3 ideas en `docs/IDEAS.md` (PR aparte).

## Bloqueos y preguntas para humanos
- Isaac (A) / Nil (C): `openCamera` pide 4K por defecto para que se lea la letra a mano. Si los gestos van lentos con 4K, se puede abrir a 1080p con `openCamera({ width: 1920, height: 1080 })`; la decisión es vuestra al integrarlo en `Gestures.tsx`.
- `oxlint` de `web/node_modules` no arranca en Windows (falta el binario nativo `@oxlint/binding-win32-*` en `package-lock.json`); con `npx oxlint@1.90.0` funciona. No es de mi carpeta: aviso a A.
- La MX Brio no la pueden usar dos programas a la vez: con `capturar.py --servidor` abierto, la app no puede abrirla.

## Archivos tocados
- `web/src/camera/{index,open,still,select,sharpness}.ts`, `web/src/camera/README.md`, `web/src/camera/test/*`, `web/src/camera/demo/*`
- `estado/P4-C.md`
