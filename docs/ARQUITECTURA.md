# Arquitectura y plan de 24 horas

Resumen corto en `AGENTS.md`. Este archivo guarda el detalle.

## Estructura de carpetas prevista
```
hackathon/
├── AGENTS.md, CLAUDE.md, GEMINI.md
├── Taskfile.yml          # task gen / mock / check
├── api/openapi.yaml      # contrato backend <-> frontend
├── api/fixtures/         # un ejemplo JSON de cada mensaje
├── api/gen/              # tipos Go generados (no editar)
├── backend/              # Go
│   ├── cmd/mock/         # servidor mock sin Wails
│   └── {ws,session,llm,ocr}/   # sin "internal/"
├── web/                  # React + Vite + TS + Tailwind
│   └── src/{api,app,camera,document,input}/   # src/api: tipos TS generados
├── adapters/logitech/    # solo si el SDK exige Python o C#
├── docs/
└── .github/workflows/ci.yml
```

## Flujo de datos
1. La cámara y el micro se capturan en el navegador (`getUserMedia`).
2. B1 detecta y recorta el documento y hace OCR local.
3. El mensaje `document` (bloques de texto con caja en la imagen y confianza) viaja por WebSocket a Go.
4. B2 decide: si el OCR es fiable, estructura en local; si duda, escala a un modelo mayor vía OpenRouter.
5. C aporta `pointer` (zona señalada con la mano) y `utterance` (lo que dice el usuario).
6. Go responde con `speak` y con los campos a resaltar. La UI muestra y lee en voz alta.
7. A registra coste y latencia de cada llamada y los muestra en pantalla.

## Cómo se coordinan los agentes
- Por archivos y git, no por mensajes: `TAREAS.md`, `estado/`, la sección Decisiones de `AGENTS.md` y el contrato en `api/`.
- Una tarea, una rama, un PR; nadie mergea a `main` sin revisión humana.
- `task check` (go vet, go test, build del front) antes de abrir un PR.
- Un cambio de contrato se anota en Decisiones y se avisa al resto.

## Cronograma de 24 h
| Horas | Qué |
|-------|-----|
| H0–1 | Repo, CI, contrato, prueba de cámara en todos los SO y qué ofrece el SDK de Logitech para la cámara |
| H1–4 | Esqueleto de punta a punta: la cámara manda un frame, Go responde, la UI lo muestra |
| H4–16 | Módulos en paralelo (captura, comprensión, interacción) |
| H16–20 | Accesibilidad y flujo de la demo |
| H20–24 | Congelar funcionalidades, pulir y ensayar |

## Criterios de los challenges (para no perderlos de vista)
- **AXA:** una app real puntúa más que un notebook o diapositivas; se resta por "AI slop"; se valora la frugalidad (no tirarlo todo a un modelo grande), el reto técnico propio, el trabajo en equipo y la presentación.
- **IMC:** utilidad real, calidad técnica, impacto social potencial y presentación; orientado a una ONG en educación, inclusión o comunidad.
- **Logitech:** webcam como ojos y oídos de la IA, con entradas multimodales y flujos con contexto.

## Pendiente de averiguar en el stand de Logitech
- Qué expone el SDK para la cámara más allá de un vídeo normal (enfoque, zoom...) y el enlace a su documentación.
- Si hace falta Python o C# y para qué parte exacta.
