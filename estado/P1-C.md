# Estado — P1-C

- **Persona:** Isaac
- **Herramienta:** Claude Code
- **Tarea actual:** T10 (pitch y demo); T8 a la espera del equipo
- **Rama:** feature/T8-desktop-build
- **Estado:** en curso
- **Último cambio:** 2026-11-21

## Hecho
- T2 (contrato, mock, Taskfile, CI, Wails + React): fusionada (5acd70f, #2). CI de Linux en verde.
- T7 (`backend/llm`: niveles cheap/expensive, caché, contador, `CompleteWithEscalation`): fusionada (#3).
- T8 parte 1: la app Wails sirve `/health` y `/ws` en `127.0.0.1:8765` (#4). Probado con el ejecutable y un cliente WebSocket sin navegador.
- Tests de módulos del frontend (`node --test`) dentro de `task check`, y `test/` y `demo/` fuera del build de la app (#5).
- Limpieza: `.gitattributes` (LF en el código), `task fmt` y comprobación de `gofmt` en el CI.
- T8 parte 2: lógica real en `backend/session` (document → explicación, pointer → lectura local, utterance → respuesta con contexto, consejos de encuadre locales, `stats`). Probada de punta a punta con la clave real y modelos gratis: 0 $. `task server` para probar sin ventana.
- T8 parte 3: puente gestos → contrato (`web/src/app/bridge.ts`, `Gestures.tsx`, `voice.ts`) y búsqueda del bloque bajo el dedo en Go. Probado contra el servidor real: señalar → lectura local; mantener → explicación; 👍 → lectura del documento. 0 $.
- T8 parte 4: sesión compartida (`ws.Hub`) y `POST /message` para el scanner, con guía `docs/INTEGRACION_SCANNER.md` y ejemplo en Python sin dependencias (`api/examples/send_message.py`). Probado: POST del «scanner» → la interfaz oye la explicación. 0 $.
- Revisado y fusionado el PR #12 de Pau (captura MX Brio) con permiso de Isaac; comentarios en el PR.
- T8 parte 5: Go reenvía el `document` aceptado a la pantalla (contrato 0.4.0) y vista accesible del documento (`DocumentText.tsx`: letra grande, orden de lectura, línea resaltada con `aria-current`, «(unclear)» si el OCR duda). Pantalla reorganizada: explicación + gestos + coste | documento; herramientas de desarrollo plegadas.
- T10: guion del pitch y de la demo en `docs/PITCH.md`, con cifras medidas (Haiku: 1,8 s y 0,00012 $ por explicación; 0 $ con modelos gratis), plan B, encaje con cada challenge, preguntas difíciles y checklist.
- Ejecutable de escritorio comprobado: arrancado desde `build/bin` encuentra el `.env` de la raíz, responde al scanner y escribe `lauzhack.log`. Diagnóstico de la ventana (WebView2): voz de salida sí (3 voces es-ES), cámara sí, API de reconocimiento de voz presente (falta probar que funcione de verdad: rol C).
- Revisada la rama de Didac (`feature/B-contexto-scanner`): `Resultado.documento()` ya cumple el contrato. Añadido a `docs/INTEGRACION_SCANNER.md` el código exacto para `escanear.py` (`enviar_a_app`, POST /message). Su estado tenía desfasados el conflicto de puertos (resuelto: Pau en 8766) y el modo de envío (ahora POST).
- Revisados #19 (voz de Nil: aprobado y fusionado) y #20 (Gesture Control: cambios pedidos, falta validar la cabecera `Host` contra DNS rebinding).

## Pendiente
- T8: sustituir las respuestas de ejemplo por la lógica real (`backend/llm` + B2).

## Bloqueos y preguntas para humanos
- **Qué dispara el escaneo en la demo** (botón/tecla en la app de B, automático cuando la hoja está quieta, o un gesto → haría falta un mensaje nuevo en el contrato).
- **Para Nil:** en la ventana de escritorio existe `webkitSpeechRecognition`, pero hay que probar que reconoce de verdad (en Edge/WebView2 depende de un servicio en la nube). Probarlo pronto con el micro dentro de `task dev`.
- **Cámara decidida (Isaac):** la que haya; la Logitech si está conectada. Queda por resolver quién abre la cámara cuando solo hay una (scanner o navegador). Mientras tanto, `Gestures.tsx` usa la imagen entera como documento.
- **Cómo llega el scanner de B a Go.** B trabaja en Python (`scanner/`: captura con la MX Brio, OCR con Tesseract, PDF buscable), no en el navegador. Propuesta: el scanner envía `document` (bloques con caja y confianza, que Tesseract ya da) a `ws://127.0.0.1:8765/ws`, y Go responde con `speak`. Encaja con el contrato sin cambiarlo. Falta que Didac, Pau e Isaac lo acuerden.
- **Para Nil (rama `claude/kind-cray-863b6t`):** probada en local sobre `main`, sus 43 tests pasan en `task check`. Falla un único error de TypeScript: `web/src/input/interaccion.ts:230`, `esperarSoltarPinza` está declarada y no se usa (`noUnusedLocals`). Hay que quitarla o usarla antes del PR.
- Hace falta Go ≥ 1.26 y `task`.

## Archivos tocados
`api/`, `backend/{ws,mock,llm,cmd}`, `main.go`, `app.go`, `wails.json`, `Taskfile.yml`, `.github/workflows/ci.yml`, `.gitattributes`, `.gitignore`, `web/` (salvo `camera`, `document`, `input`), `AGENTS.md`, `docs/ARQUITECTURA.md`.
