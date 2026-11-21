# Lectura guiada (rol B2, Didac)

Lee en voz alta el documento escaneado **línea a línea**, sin ayuda de nadie:
- La línea que suena se resalta en letra grande y se mantiene centrada en pantalla.
- La lectura es **local y gratuita**: usa la voz del sistema (Web Speech API) y ningún modelo. No envía nada a Go.

Brief: `docs/briefs/didac.md`.

## Uso
```tsx
import { GuidedReader } from '../document'

<GuidedReader doc={doc} />
```
- `doc`: el `DocumentPayload` actual. Al llegar uno nuevo, el lector vuelve a la primera línea y no habla hasta que se le pide.
- `voice`: opcional. Si no se pasa, usa la voz del sistema; sin síntesis de voz, solo mueve el resaltado.
- `autoPlay`: empieza a leer en cuanto llega el documento (lo usan las opciones del overlay). Desactivado por defecto.
- `keyboard`: atajos globales. Están activos por defecto y se ignoran mientras se escribe en un campo.

| Acción | Teclas | Botón |
|---|---|---|
| Leer / pausa | Espacio · Num 5 | ▶ Read / ⏸ Pause |
| Anterior | ← · Num 4 | ⏮ Previous |
| Siguiente | → · Num 6 | Next ⏭ |
| Repetir | R · Num 8 | ↻ Repeat |

Además, hacer clic en una línea la lee y sigue desde ahí. Las teclas del teclado numérico son las que podrá emitir el keypad de Logitech más adelante.

## Comportamiento
- **Orden de lectura:** de arriba abajo y de izquierda a derecha, igual que `DocumentText`. Las líneas vacías se saltan.
- **Líneas dudosas** (`confidence` < 0,6): se leen igualmente, precedidas de «No se lee bien:», y se marcan con «(unclear)».
- **Final:** al acabar, el lector dice «Fin del documento.». Pulsar «Read» de nuevo empieza otra vez desde el principio.
- **Otra voz:** si la app habla mientras tanto (por ejemplo, el `speak` de Go con la respuesta), el lector se pausa en su línea y no habla a la vez. Para seguir, pulsa «Read».
- **Idioma:** las frases del lector van en el idioma del documento (`lang`: es, ca o en). Si no hay voz de ese idioma, usa la voz por defecto y lo avisa en pantalla.

## Página de prueba (sin Go)
Desde `web/`:
```
npx vite src/document --config vite.config.ts
```
Abre http://localhost:5173/demo/. Carga la carta inventada de `scanner/pdf/samples/print/01-carta-renovacion.pdf`, leída con el pipeline del escáner (20 líneas). La casilla convierte la línea 11 en dudosa, para oír cómo se anuncia.

Medido en Chrome con la voz Microsoft Helena (es-ES):
- cada tecla cambia de línea en menos de 20 ms;
- la carta se lee entera hasta «Fin del documento.»;
- una voz que interrumpe deja el lector en pausa;
- leerla no llama a ningún modelo.

## Archivos
| Archivo | Contenido |
|---|---|
| `reader.ts` | Lógica pura, sin interfaz: `LineReader`, el orden de lectura, los atajos y las frases |
| `voice.ts` | La voz del sistema (`webSpeechVoice`) y la alternativa sin síntesis de voz (`silentVoice`) |
| `GuidedReader.tsx` | La vista |
| `demo/` | La página de prueba |
| `test/` | Los tests (`npm test`) |

## Montarlo en la app (para Isaac, `web/src/app/App.tsx`)
```diff
+import { GuidedReader } from '../document'
 ...
         <section aria-label="Document view" className="rounded-2xl border border-slate-700 p-6">
-          <DocumentText doc={doc} highlight={last?.highlightBlockIds ?? []} values={values} draft={draft} />
+          <GuidedReader doc={doc} />
         </section>
```
Si `DocumentText` se mantiene para el dictado de formularios (`values` y `draft`), las dos vistas pueden convivir, por ejemplo con una pestaña «Read» y otra «Fill in». Esa decisión es de Isaac.
