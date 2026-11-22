# Resumir con IA (N7)

Brief: `docs/briefs/N7.md`. Dueño: Isaac.

## Uso
- En el overlay, opción **2** (leer papel) o **3** (leer archivo), con el documento abierto, pulsa **«Summarize with AI»** o la tecla **S**.
- El resumen aparece en grande, con la lista de lo que hay que hacer, y se lee en voz alta. El lector guiado se pausa mientras tanto.
- Debajo sale lo que ha costado: dólares, segundos, tokens y modelo.
- **Necesita la clave** (`OPENROUTER_API_KEY` en `.env`). Sin ella, la app lo dice en voz alta.

## Medido el 2026-11-22 (perfil de la demo: Haiku barato, Sonnet si duda)
Con el texto de los 3 PDF de prueba de `scanner/pdf/samples/print/`:

| Documento | Modelo | Escaló | Latencia | Tokens (entrada + salida) | Coste |
|---|---|---|---|---|---|
| Carta de renovación (es) | Haiku 5.5 | no | 2,5 s | 759 + 316 | 0,00023 $ |
| Declaración de siniestro (es) | Haiku 5.5 | no | 1,6 s | 549 + 247 | 0,00018 $ |
| Aviso de recibo (ca) | Haiku 5.5 | no | 2,8 s | 665 + 503 | 0,00032 $ |
| Carta de renovación, otra vez | caché | no | 0 s | — | 0 $ |

- **Coste:** hasta 0,00032 $ por resumen, más de 15 veces por debajo del límite del brief (0,005 $). Con 10 € caben más de 30.000 resúmenes.
- **Qué recoge cada resumen:** el tipo de documento, quién lo envía y las acciones con fechas e importes. Por ejemplo, «comunique antes del 15 de diciembre de 2026», «pagar 76,29 € antes del 20 de desembre» o «enviar en un plazo de 7 días».
- **Observación:** también mencionan que el documento es de prueba, porque lo dice su pie de página.

## Cómo funciona
- **`backend/session/summary.go`:** el prompt (respuesta en JSON, `{summary, actions}`) y `Summarize`.
  - Si el modelo barato no devuelve un JSON con resumen, se escala al caro (`CompleteWithEscalation`).
  - Los textos de más de 8.000 caracteres se recortan y el resumen lo dice.
- **`app_summary.go`:** el binding de Wails. Devuelve también el coste total de la sesión (para N8).
- **`web/src/app/overlay/SummaryPanel.tsx` y `summary.ts`:** el botón, el panel y la línea de coste.
- **Para N6 (selección):** basta con llamar a `desktop().Summarize(textoSeleccionado, idioma)`.
