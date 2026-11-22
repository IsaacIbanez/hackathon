# Preparar la demo: tres revisiones en paralelo

Fase de **pulido para la demo** (2026-11-22, decidido por Isaac). No se añaden funcionalidades: cada persona revisa su parte del código para que la demo no falle. El objetivo es que todo sea **muy robusto**: si algo falla, la app lo dice claro y se puede seguir.

| Persona | Ficha | Qué revisa |
|---|---|---|
| **Nil** | [`NIL.md`](NIL.md) | Gestos: cámara, menú del puño, modo cursor, burbuja, leer la selección con tres dedos y la cámara compartida |
| **Pau** | [`PAU.md`](PAU.md) | Leer papel y Transcribe: PDF Scanner de punta a punta (servicio Python, OCR, los dos PDF), Transcribe y la ventana (R5) |
| **Isaac** | [`ISAAC.md`](ISAAC.md) | El arranque y el overlay: claves y avisos al arrancar, menú, keypad, órdenes de voz, AI Summary, Read Text y visor de PDF, guion de la demo e integración final |

Didac no está en este reparto. Sus carpetas (`scanner/`, `web/src/document`, `backend/summary`) las revisan Pau e Isaac. Antes de tocar algo suyo, avisadle.

## Lo que ya sabemos que falla (2026-11-22)
- **Transcribe no funciona:** falta `TOGETHER_API_KEY` en el `.env` (Pau). Además, la app lo reintenta cada segundo y llena el log.
- **El escáner necesita su instalación** en cada equipo: `scanner\pdf\scripts\install.ps1`. Si no está, el servicio muere con `No module named cv2` y no sale ningún PDF (Pau e Isaac).
- **PDF Scanner** no encuentra los bordes de la hoja con la webcam (`page_not_detected`). Aun así funciona, pero recorta peor (Pau).
- **Órdenes de voz:** el PR #54 (borrar la selección y subir o bajar el volumen) está sin fusionar y sin probar con una voz real. Si el micro de Windows está silenciado, la app ya lo dice (Isaac).
- **El botón «Microphone» del menú del puño** silencia el micro de **Windows**, no el de la llamada. Si se queda silenciado, las órdenes de voz dejan de oír (Nil).
- **Ctrl+Alt+Espacio** está ocupado en el portátil de Isaac. En la demo se abre con la **tecla 1** del keypad.

## Cómo trabajar (las tres fichas)
1. `git pull` y una rama `demo/<persona>-<tema>`. Un arreglo = un commit, con su línea en el «Registro» de tu ficha.
2. **Reproduce el fallo con el `.exe` real antes de arreglarlo** (`task overlay` → `build/bin/lauzhack.exe`). Cierra antes cualquier otra copia. Mira `build/bin/lauzhack.log` y `build/bin/reading-service.log`.
3. **Robusto quiere decir:**
   - ningún error sin mensaje;
   - ningún bucle de reintentos sin pausa;
   - nada que se quede colgado sin límite de tiempo;
   - si falta algo (clave, cámara, micro, servicio), la app lo dice en pantalla con qué hacer.
4. **Cada agente prueba y fusiona lo suyo; nadie revisa lo de otros** (decidido por Isaac):
   - escribe o actualiza los tests de lo que arregla;
   - pasa `task check` y los tests de su parte (Python: los del escáner);
   - lo prueba con el `.exe` real;
   - abre un PR pequeño y, **con el CI en verde, lo fusiona él mismo a `main`** (`gh pr merge <n> --merge`);
   - antes de fusionar, `git pull` y vuelve a pasar los tests si `main` ha cambiado.
5. No toques carpetas de otra persona (`docs/MAPA.md`): apúntalo en su ficha y avísale.
6. Gasta pocos tokens: lee por rangos, filtra la salida y no lances subagentes.

## Ensayo general (cuando las tres fichas estén «hechas»)
Isaac, con el `.exe` de `main` en el portátil de la demo, sigue el guion de `docs/PITCH.md` dos veces seguidas sin reiniciar la app. Cada fallo va a la ficha de quien corresponda.
