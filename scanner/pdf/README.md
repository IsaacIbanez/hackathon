# scanner/pdf/ — Imagen a PDF buscable

Parte del subproyecto `scanner/` (reglas en `../AGENTS.md`). Dueño: Didac (P2-C).

## Qué hace
Recibe la imagen de un documento en papel y produce un **PDF buscable**: la imagen de la página
(fiel al original) más una capa de texto OCR invisible y bien posicionada, para poder seleccionar,
copiar y buscar. No reconstruye el documento con IA ni sustituye su aspecto.

## Interfaz (conceptual, pendiente de acordar)
- **Entrada:** imagen (ruta o bytes) + metadatos de captura opcionales + opciones (idiomas, color/grises, guardar intermedios).
- **Salida:** PDF final (ruta o bytes) + resultado estructurado: éxito/fallo, nº de páginas, idioma OCR,
  avisos, confianza/calidad e intermedios si se piden.
- El formato exacto de la imagen de entrada lo define quien hace la captura; aquí no se asume ninguna cámara.
- Relación con el contrato del repo (`api/openapi.yaml`): los bloques OCR (texto + caja + confianza) encajan
  con `TextBlock` del mensaje `document`. Si se integra, se acuerda con el rol A; aquí no se cambia el contrato.

## Pipeline previsto
1. **Entrada:** se guarda el original sin tocar (PNG) y sus metadatos.
2. **Preparación (OpenCV):** detección del borde de la hoja, perspectiva, rotación, recorte, iluminación.
   Conservador y configurable; si la detección duda, se avisa (recorte manual) en vez de generar una página mala.
3. **PDF base:** la página preparada a tamaño y proporción correctos (sin estirar).
4. **Capa OCR invisible:** Tesseract (spa, cat, eng) / OCRmyPDF, a evaluar. PaddleOCR solo si mejora de forma medida.
5. **Validación:** páginas, dimensiones, texto extraíble, búsqueda y copia en un lector PDF real.
6. **IA (opcional):** OpenRouter solo para casos dudosos y nunca como requisito para generar el PDF.

## Estructura
```
scanner/pdf/
├── README.md     este archivo
├── src/          código del pipeline
├── tests/        tests automáticos (geometría, OCR/PDF, fallos)
├── muestras/     imágenes de prueba (solo con permiso; ver muestras/README.md)
└── salida/       resultados locales (ignorado por git)
```

## Entorno (comprobado en el PC de Didac, Windows 11, 2026-11-21)
- Python 3.14.6 instalado. **Faltan:** Tesseract, OCRmyPDF, Ghostscript, qpdf, y los paquetes `opencv-python` y `reportlab`.
- Lenguaje propuesto: Python (lo que sugiere `../AGENTS.md`). Pendiente de confirmar con el equipo antes de instalar dependencias.

## Preguntas abiertas
Ver la sección 10 de `../AGENTS.md`. Las que afectan a esta parte: formato de la imagen de entrada,
una o varias páginas, idiomas, color o grises, y si se pueden mandar imágenes a OpenRouter.
