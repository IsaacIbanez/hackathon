# Estado — P2-C

- **Persona:** Didac
- **Herramienta:** Claude Code
- **Tarea actual:** Subproyecto B / scanner: imagen a PDF buscable (`scanner/pdf/`)
- **Rama:** feature/B-contexto-scanner
- **Estado:** en curso
- **Último cambio:** 2026-11-21

## Hecho
- `scanner/AGENTS.md` (y copia `AGENTS_B.md`): reglas y contexto del subproyecto scanner.
- `scanner/pdf/`: estructura (`src/`, `tests/`, `muestras/`, `salida/` ignorada) y README con alcance, interfaz conceptual y pipeline.
- Entorno comprobado: Python 3.14.6; faltan Tesseract, OCRmyPDF, Ghostscript, qpdf, opencv-python y reportlab.

## Pendiente
- Confirmar Python como lenguaje e instalar dependencias.
- Prototipo local: imagen -> página corregida -> PDF con capa OCR invisible -> validación.
- Conjunto de muestras con texto esperado.

## Bloqueos y preguntas para humanos
- ¿Quién genera la imagen de entrada (compañero / web/src/camera) y en qué formato?
- `scanner/` usa Python y OCRmyPDF; `AGENTS.md` prevé OCR en el navegador y Go. Falta alinear con Isaac (rol A) cómo se integra.
- Preguntas de la sección 10 de `scanner/AGENTS.md` (cámara, idiomas, una o varias páginas, color/grises, OpenRouter).

## Archivos tocados
`scanner/`, `estado/P2-C.md`.
