# Estado — P2-C

- **Persona:** Didac
- **Herramienta:** Claude Code
- **Tarea actual:** Subproyecto B / scanner: PNG a PDF buscable (`scanner/pdf/`)
- **Rama:** feature/B-contexto-scanner
- **Estado:** en curso (primera versión funcionando)
- **Último cambio:** 2026-11-21

## Hecho
- `scanner/AGENTS.md` (y copia `AGENTS_B.md`): reglas y contexto del subproyecto scanner.
- Lenguaje confirmado: Python. Dependencias instaladas (Tesseract 5.4 + spa/cat/eng, OpenCV, img2pdf, pikepdf, pdfminer, pypdfium2).
- `scanner/pdf/`: paquete `escaner_pdf` (PNG -> PDF buscable): detección de hoja, perspectiva con proporción real,
  ajuste a A4/Letter, orientación, iluminación, OCR en un pase, capa invisible alineada, validación automática.
- CLI (`python -m escaner_pdf`) y API (`convertir()` -> `Resultado`, con `documento()` = payload del contrato).
- 49 tests en verde; scripts de instalación para Windows y Linux/macOS.
- Medido: OCRmyPDF 2,07 s frente a 1,06 s con Tesseract directo (mismo texto, y además bloques con confianza).

## Pendiente
- Probar con PNG reales de la captura del compañero y calibrar los umbrales de calidad.
- Acordar con el rol A cómo se llama al escáner desde la app (Go/WebSocket).
- OpenRouter opcional para casos dudosos (no empezado).

## Bloqueos y preguntas para humanos
- ¿Cámara exacta (MX Brio o LogiInsight)? Afecta a la focal supuesta (`fov_diagonal`, 78° por defecto).
- ¿Una o varias páginas por documento? Ahora es una por llamada.
- ¿Se pueden mandar imágenes a OpenRouter (privacidad y presupuesto)?

## Archivos tocados
`scanner/`, `estado/P2-C.md`.
