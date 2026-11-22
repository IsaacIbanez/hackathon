# Demo · Nil: gestos

Responsable: **Nil**. Plan común y reglas: `docs/demo/README.md`.

## Qué revisas
| Pieza | Dónde |
|---|---|
| Seguimiento de la mano y gestos (MediaPipe) | `web/src/input/` |
| Página de Gesture Control, menú del puño, modo cursor, nivel de volumen y brillo | `web/src/input/desktop/` (`gestureControl.ts`, `menu.ts`, `menuView.ts`, `gestureControl.css`) |
| El ayudante que pulsa teclas y mueve el ratón de verdad | `adapters/desktop/` |
| La cámara única compartida con PDF Scanner, la burbuja y «Main menu» | `web/src/app/overlay/gestureHost.ts` (de Isaac: avísale si lo tocas) |

## Qué tiene que funcionar en la demo
1. **Tecla 6** (Gesture Control): el overlay se reduce a la burbuja de cámara arriba a la izquierda y los gestos funcionan.
2. **La burbuja** solo salta a la otra esquina de arriba cuando el cursor de la mano se pone encima.
3. **Menú del puño:** se abre, cada opción se elige al mantener el gesto y se cierra sin dejar la ventana rara.
   - «Main menu» (antes «Close gestures») vuelve al menú principal del overlay **sin** apagar la cámara ni los gestos.
   - «Close app» cierra.
4. **Modo cursor:** mover el ratón con el dedo y hacer clic en botones del overlay. El más importante es «Take photo» de PDF Scanner.
5. **Tres dedos** leen en voz alta el texto seleccionado en otro programa; deslizar atrás vuelve a empezar y deslizar adelante termina.
6. **Volumen y brillo con la pinza**, sin saltos.
7. **Cámara compartida:** abrir PDF Scanner (tecla 2) pausa los gestos y, al salir, vuelven solos.

## Fallos y riesgos conocidos
- **«Microphone» del menú del puño silencia el micro de Windows.** Si se queda silenciado, las órdenes de voz (tecla 7) no oyen nada. Hay que hacerlo visible: que la opción diga claramente «Muted» o «On» y que el estado sea el real al abrir el menú (hoy empieza en «Microphone» hasta que se pulsa). Valora si en la demo debe estar.
- **Acciones involuntarias:** 5 minutos de uso sin que se dispare nada solo (R2). Vigila el log (`did:`).
- **La pinza** iba de 20 % a 100 % y a 0 % en un segundo. Está arreglado en R2: compruébalo.
- **La cámara sin luz o tapada:** la página tiene que decir qué pasa y no quedarse en negro.
- **Rendimiento:** el seguimiento de la mano va en el hilo principal. Si el overlay se nota lento con los gestos activos, mídelo (fotogramas) antes de cambiar nada.

## Cómo probar
`task overlay` → `build/bin/lauzhack.exe` con la MX Brio. Tecla 1 abre el menú y la 6 activa los gestos. Los tests están en `web/src/input/test/` (`task check`).

## Hecho cuando
- [ ] Los 7 puntos de arriba funcionan dos veces seguidas con el `.exe`.
- [ ] 5 minutos de uso sin acciones involuntarias.
- [ ] El estado del micro en el menú del puño es el real.
- [ ] Ningún error de la cámara o del ayudante sin un mensaje en pantalla.

## Prompt para tu agente
```
Lee AGENTS.md, docs/demo/README.md y docs/demo/NIL.md. Trabajas para Nil en la fase de pulido para la
demo: no añadas funcionalidades, haz robusto lo que hay. Revisa web/src/input, web/src/input/desktop y
adapters/desktop, uno a uno, con los puntos de «Qué tiene que funcionar» y «Fallos y riesgos». Antes de
cambiar código, reprodúcelo con el .exe (task overlay) y el log. Un arreglo = un commit en una rama
demo/nil-<tema>, con su línea en el Registro de docs/demo/NIL.md. task check en verde antes de subir.
Si necesitas tocar gestureHost.ts u otra carpeta, pregúntame primero.
Para cada arreglo escribe o actualiza sus tests, pasa task check (y los tests de tu parte) y
pruébalo con el .exe; abre un PR y, con el CI en verde, fusiónalo tú mismo a main
(gh pr merge <n> --merge). Nadie revisa lo de otros.
```

## Registro (lo rellena el agente)
Por cada fallo: síntoma → cómo reproducirlo → causa → arreglo → cómo se ha comprobado (con el `.exe`).

**1. «Close gestures» dejaba los gestos activos (2026-11-22)**
- Síntoma: tras «Close gestures» el overlay volvía, pero la mano seguía disparando acciones. Quedaba además código viejo que apagaba la cámara.
- Arreglo: «Close gestures» duerme los gestos (`HandInteraction.sleepNow`), apaga el modo cursor y vuelve al overlay; la cámara sigue encendida. Una palma abierta o abrir Gesture Control (tecla 6, `wakeNow`) los despierta.
- Comprobado: test nuevo en `experimental.test.ts`, `tsc`, 199 tests. Falta el `.exe` (lo prueba Nil en Windows).

**2. «Microphone» no mostraba el estado real (2026-11-22)**
- Síntoma: la opción decía «Microphone» hasta pulsarla. Además, tras pulsarla en Windows tampoco cambiaba: el ayudante responde «microphone on» y la página buscaba «unmuted».
- Arreglo: el ayudante tiene `GET /api/mic` (`{"muted": true|false}`, `Desktop.MicMuted` en Windows, Linux y macOS). La página lo lee al arrancar y al abrir el menú (como mucho cada 2 s); tras pulsar, usa la respuesta del ayudante (`micStateOf`). Si falla, vuelve a leer el estado real. Silenciado, avisa de que las órdenes de voz no oirán.
- Comprobado: `TestServerMicState` (Go), tests de `micStateOf` y `micMuted` (web), `go vet` Linux y Windows, 201 tests. Falta el `.exe` (Nil en Windows).

**3. «Close gestures» pasa a ser «Main menu» (2026-11-22, pedido por Nil tras probarlo)**
- Síntoma: hacía falta volver al menú general del overlay sin desactivar los gestos por completo; el arreglo 1 los dormía.
- Arreglo: ↖ «Main menu» muestra el menú principal del overlay (`gestures:main-menu` → `view = "menu"`) y, desde la burbuja, devuelve la ventana. Los gestos y el modo cursor siguen activos. Se quita `sleepNow`; queda `wakeNow` para la tecla 6.
- Comprobado: tests actualizados, `tsc`, 201 tests, build web. Falta el `.exe` (Nil en Windows).

**4. Pulgar a la izquierda = volver atrás y deshacer (2026-11-22, pedido por Nil)**
- Qué: el puño con el pulgar hacia la izquierda del usuario (`thumbs_left`, en `poses.ts`) vuelve atrás en el menú del puño (el pulgar hacia abajo ya no). Si el volumen o el brillo están esperando la pinza, lo cancela. Fuera del menú deshace la última acción (15 s): volumen y brillo al valor de antes, micro y modo cursor.
- Para restaurar el valor exacto, el ayudante lee el volumen y el brillo actuales: `GET /api/level?target=volume|brightness` (`Desktop.Level`; Windows por Core Audio y WMI, Linux con wpctl/pactl/amixer y brightnessctl/light, macOS solo el volumen).
- Comprobado: `TestServerLevel`, `TestParsePercent` (Go), tests de pose, menú, cancelación y `level()` (web), `go vet` Linux, Windows y macOS, 209 tests, build web. Falta el `.exe` (Nil en Windows).
