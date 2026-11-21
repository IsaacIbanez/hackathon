"""Construcción y validación del PDF.

- Página base: la imagen incrustada sin recodificar (img2pdf), con el tamaño físico exacto
  que da el DPI elegido: sin márgenes ni estiramientos.
- Capa de texto: el PDF de texto invisible de Tesseract se superpone a la página (pikepdf).
- Validación: nº de páginas, tamaño, resolución de la imagen incrustada, texto extraíble,
  alineación de la capa de texto y fidelidad visual (render vs imagen original).
"""

from __future__ import annotations

import io

import cv2
import img2pdf
import numpy as np
import pikepdf
from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTFigure, LTPage, LTTextContainer, LTTextLine
from PIL import Image

from .errores import ErrorEscaner

PT_POR_PULGADA = 72.0


def codificar_imagen(img: np.ndarray, dpi: tuple[float, float], formato: str = "png", calidad_jpeg: int = 92,
                     binaria: bool = False) -> bytes:
    """PNG sin pérdidas (por defecto) o JPEG 4:4:4. Lleva el DPI en los metadatos."""
    if img.ndim == 2:
        pil = Image.fromarray(img, "L")
        if binaria:
            pil = pil.convert("1", dither=Image.Dither.NONE)
    else:
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), "RGB")
    buf = io.BytesIO()
    if formato == "png" or binaria:
        pil.save(buf, "PNG", dpi=dpi, compress_level=6)
    elif formato == "jpeg":
        pil.save(buf, "JPEG", dpi=dpi, quality=calidad_jpeg, subsampling=0, optimize=True)
    else:
        raise ValueError(f"Formato de imagen desconocido: {formato!r} (válidos: png, jpeg)")
    return buf.getvalue()


def construir_pdf_base(imagen_codificada: bytes, dpi: tuple[float, float]) -> bytes:
    """PDF de una página con la imagen ocupándola entera, tamaño = píxeles / DPI."""
    try:
        return img2pdf.convert(imagen_codificada, layout_fun=img2pdf.get_fixed_dpi_layout_fun(dpi))
    except Exception as e:
        raise ErrorEscaner("pdf_fallo", f"No se pudo crear el PDF base: {e}") from e


def superponer_texto(pdf_base: bytes, pdf_texto: bytes, titulo: str | None = None) -> bytes:
    """Pone la capa de texto invisible encima de la página de imagen.

    Tesseract solo acepta un DPI entero, así que su página puede medir unas décimas de punto
    distinta. Se coloca como Form XObject con una escala exacta por eje (no `add_overlay`,
    que conserva la proporción y dejaría un desfase).
    """
    try:
        with pikepdf.open(io.BytesIO(pdf_base)) as base, pikepdf.open(io.BytesIO(pdf_texto)) as texto:
            if len(base.pages) != len(texto.pages):
                raise ErrorEscaner("pdf_fallo", "La capa de texto no tiene las mismas páginas que la imagen")
            for pagina, capa in zip(base.pages, texto.pages):
                pb, pc = [float(x) for x in pagina.mediabox], [float(x) for x in capa.mediabox]
                sx, sy = (pb[2] - pb[0]) / (pc[2] - pc[0]), (pb[3] - pb[1]) / (pc[3] - pc[1])
                forma = base.copy_foreign(capa.as_form_xobject())
                nombre = pagina.add_resource(forma, pikepdf.Name.XObject, prefix="OCR")
                orden = f"q {sx:.6f} 0 0 {sy:.6f} {pb[0] - pc[0] * sx:.4f} {pb[1] - pc[1] * sy:.4f} cm {nombre} Do Q"
                pagina.contents_add(pikepdf.Stream(base, orden.encode("ascii")), prepend=False)
            poner_metadatos(base, titulo)
            salida = io.BytesIO()
            base.save(salida)
            return salida.getvalue()
    except pikepdf.PdfError as e:
        raise ErrorEscaner("pdf_fallo", f"No se pudo superponer la capa de texto: {e}") from e


def poner_metadatos(pdf: pikepdf.Pdf, titulo: str | None) -> None:
    if titulo:
        pdf.docinfo["/Title"] = titulo
    pdf.docinfo["/Producer"] = "escaner_pdf (LauzHack 2026)"


def anadir_metadatos(pdf_bytes: bytes, titulo: str | None) -> bytes:
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        poner_metadatos(pdf, titulo)
        salida = io.BytesIO()
        pdf.save(salida)
        return salida.getvalue()


# ---------------------------------------------------------------- validación

def validar(pdf_bytes: bytes, imagen: np.ndarray, dpi: tuple[float, float], bloques: list[dict] | None) -> dict:
    """Comprueba el PDF final. Devuelve un dict con cada comprobación y `ok` global."""
    alto, ancho = imagen.shape[:2]
    esperado = (ancho / dpi[0] * PT_POR_PULGADA, alto / dpi[1] * PT_POR_PULGADA)
    v: dict = {}

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        v["paginas"] = len(pdf.pages)
        caja = [float(x) for x in pdf.pages[0].mediabox]
        tam = (caja[2] - caja[0], caja[3] - caja[1])
        v["tamano_pt"] = [round(tam[0], 2), round(tam[1], 2)]
        v["tamano_correcto"] = abs(tam[0] - esperado[0]) < 1.0 and abs(tam[1] - esperado[1]) < 1.0
        pagina = pdf.pages[0]
        imagenes = list(pagina.get_images().values()) if hasattr(pagina, "get_images") else list(pagina.images.values())
        dims = [(int(i.Width), int(i.Height)) for i in imagenes]
        v["imagen_resolucion_completa"] = (ancho, alto) in dims

    texto, lineas = _texto_y_lineas(pdf_bytes, esperado)
    v["caracteres_texto"] = len(texto.strip())
    if bloques:
        v["palabras_encontradas"] = _fraccion_palabras(bloques, texto)
        v["desfase_mediano"] = _desfase(bloques, lineas)
    v["psnr_db"] = _psnr_imagen(pdf_bytes, imagen)

    buscable = v["caracteres_texto"] > 0
    alineado = v.get("desfase_mediano") is None or v["desfase_mediano"] < 0.02
    v["buscable"] = buscable
    v["ok"] = bool(v["paginas"] == 1 and v["tamano_correcto"] and v["imagen_resolucion_completa"]
                   and v["psnr_db"] >= 35 and (not bloques or (buscable and alineado)))
    return v


def _texto_y_lineas(pdf_bytes: bytes, tam: tuple[float, float]) -> tuple[str, list[tuple[str, float, float]]]:
    """Texto completo y centro normalizado (origen arriba-izquierda) de cada línea, vía pdfminer."""
    partes, lineas = [], []

    def recorrer(elem) -> None:
        # La capa OCR va dentro de un Form XObject: pdfminer la entrega como LTFigure y hay que bajar.
        if isinstance(elem, LTTextLine):
            texto = elem.get_text()
            partes.append(texto)
            if texto.strip():
                x0, y0, x1, y1 = elem.bbox
                lineas.append((texto.strip(), (x0 + x1) / 2 / tam[0], 1 - (y0 + y1) / 2 / tam[1]))
        elif isinstance(elem, (LTTextContainer, LTFigure, LTPage)):
            for hijo in elem:
                recorrer(hijo)

    for pagina in extract_pages(io.BytesIO(pdf_bytes), laparams=LAParams(all_texts=True)):
        recorrer(pagina)
    return "".join(partes), lineas


def _fraccion_palabras(bloques: list[dict], texto: str) -> float:
    palabras = [w for b in bloques for w in b["text"].split()]
    if not palabras:
        return 1.0
    extraidas = set(texto.split())
    return round(sum(w in extraidas for w in palabras) / len(palabras), 3)


def _desfase(bloques: list[dict], lineas: list[tuple[str, float, float]]) -> float | None:
    """Mediana de la distancia vertical entre cada bloque OCR y la línea del PDF con su primera palabra."""
    distancias = []
    for b in bloques:
        primera = b["text"].split()[0]
        cy = b["box"]["y"] + b["box"]["h"] / 2
        candidatas = [abs(ly - cy) for t, _, ly in lineas if primera in t.split()]
        if candidatas:
            distancias.append(min(candidatas))
    return round(float(np.median(distancias)), 4) if distancias else None


def _psnr_imagen(pdf_bytes: bytes, imagen: np.ndarray) -> float:
    """Fidelidad: extrae la imagen incrustada en la página y la compara píxel a píxel con la página (gris).

    No se compara un render del visor: renderizar siempre reescala y desplaza fracciones de píxel, y
    eso medía el visor, no el PDF. 99 = idéntica (PNG sin pérdidas); JPEG ~40.
    """
    ref = imagen if imagen.ndim == 2 else cv2.cvtColor(imagen, cv2.COLOR_BGR2GRAY)
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        pagina = pdf.pages[0]
        imagenes = list(pagina.get_images().values()) if hasattr(pagina, "get_images") else list(pagina.images.values())
        for obj in imagenes:
            pil = pikepdf.PdfImage(obj).as_pil_image()
            if pil.size == (ref.shape[1], ref.shape[0]):
                incrustada = np.array(pil.convert("L"))
                mse = float(np.mean((incrustada.astype(np.float64) - ref.astype(np.float64)) ** 2))
                return 99.0 if mse == 0 else round(10 * np.log10(255.0 ** 2 / mse), 2)
    return 0.0
