# Demo · Nil: gestos

Responsable: **Nil**. Plan común y reglas: `docs/demo/README.md`.

## Qué revisas
| Pieza | Dónde |
|---|---|
| Seguimiento de la mano y gestos (MediaPipe) | `web/src/input/` |
| Página de Gesture Control, menú del puño, modo cursor, nivel de volumen y brillo | `web/src/input/desktop/` (`gestureControl.ts`, `menu.ts`, `menuView.ts`, `gestureControl.css`) |
| El ayudante que pulsa teclas y mueve el ratón de verdad | `adapters/desktop/` |
| La cámara única compartida con PDF Scanner, la burbuja y «Close gestures» | `web/src/app/overlay/gestureHost.ts` (de Isaac: avísale si lo tocas) |

## Qué tiene que funcionar en la demo
1. **Tecla 6** (Gesture Control): el overlay se reduce a la burbuja de cámara arriba a la izquierda y los gestos funcionan.
2. **La burbuja** solo salta a la otra esquina de arriba cuando el cursor de la mano se pone encima.
3. **Menú del puño:** se abre, cada opción se elige al mantener el gesto y se cierra sin dejar la ventana rara.
   - «Close gestures» vuelve al overlay **sin** apagar la cámara.
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
```

## Registro (lo rellena el agente)
Por cada fallo: síntoma → cómo reproducirlo → causa → arreglo → cómo se ha comprobado (con el `.exe`).
