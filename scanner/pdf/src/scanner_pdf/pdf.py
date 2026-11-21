"""PDF building and validation.

- Base page: the image embedded without re-encoding (img2pdf), with the exact physical size given by
  the chosen DPI: no margins, no stretching.
- Text layer: Tesseract's invisible-text PDF is overlaid on the page (pikepdf).
- Validation: page count, size, resolution of the embedded image, extractable text, text-layer
  alignment and visual fidelity (embedded image vs page).
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

from .errors import ScannerError

PT_PER_INCH = 72.0


def encode_image(img: np.ndarray, dpi: tuple[float, float], fmt: str = "png", jpeg_quality: int = 92,
                 binary: bool = False) -> bytes:
    """Lossless PNG (default) or 4:4:4 JPEG. Carries the DPI in its metadata."""
    if img.ndim == 2:
        pil = Image.fromarray(img, "L")
        if binary:
            pil = pil.convert("1", dither=Image.Dither.NONE)
    else:
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), "RGB")
    buf = io.BytesIO()
    if fmt == "png" or binary:
        pil.save(buf, "PNG", dpi=dpi, compress_level=6)
    elif fmt == "jpeg":
        pil.save(buf, "JPEG", dpi=dpi, quality=jpeg_quality, subsampling=0, optimize=True)
    else:
        raise ValueError(f"Unknown image format: {fmt!r} (valid: png, jpeg)")
    return buf.getvalue()


def build_base_pdf(encoded_image: bytes, dpi: tuple[float, float]) -> bytes:
    """One-page PDF with the image filling it, size = pixels / DPI."""
    try:
        return img2pdf.convert(encoded_image, layout_fun=img2pdf.get_fixed_dpi_layout_fun(dpi))
    except Exception as e:
        raise ScannerError("pdf_failed", f"Could not create the base PDF: {e}") from e


def overlay_text(base_pdf: bytes, text_pdf: bytes, title: str | None = None) -> bytes:
    """Puts the invisible text layer on top of the image page.

    Tesseract only accepts an integer DPI, so its page can differ by a few tenths of a point. It is
    placed as a Form XObject with an exact per-axis scale (not `add_overlay`, which keeps the aspect
    ratio and would leave an offset).
    """
    try:
        with pikepdf.open(io.BytesIO(base_pdf)) as base, pikepdf.open(io.BytesIO(text_pdf)) as text:
            if len(base.pages) != len(text.pages):
                raise ScannerError("pdf_failed", "The text layer does not have the same pages as the image")
            for page, layer in zip(base.pages, text.pages):
                pb, pl = [float(x) for x in page.mediabox], [float(x) for x in layer.mediabox]
                sx, sy = (pb[2] - pb[0]) / (pl[2] - pl[0]), (pb[3] - pb[1]) / (pl[3] - pl[1])
                form = base.copy_foreign(layer.as_form_xobject())
                name = page.add_resource(form, pikepdf.Name.XObject, prefix="OCR")
                ops = f"q {sx:.6f} 0 0 {sy:.6f} {pb[0] - pl[0] * sx:.4f} {pb[1] - pl[1] * sy:.4f} cm {name} Do Q"
                page.contents_add(pikepdf.Stream(base, ops.encode("ascii")), prepend=False)
            set_metadata(base, title)
            out = io.BytesIO()
            base.save(out)
            return out.getvalue()
    except pikepdf.PdfError as e:
        raise ScannerError("pdf_failed", f"Could not overlay the text layer: {e}") from e


def set_metadata(pdf: pikepdf.Pdf, title: str | None) -> None:
    if title:
        pdf.docinfo["/Title"] = title
    pdf.docinfo["/Producer"] = "scanner_pdf (LauzHack 2026)"


def add_metadata(pdf_bytes: bytes, title: str | None) -> bytes:
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        set_metadata(pdf, title)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


# ---------------------------------------------------------------- validation

def validate(pdf_bytes: bytes, img: np.ndarray, dpi: tuple[float, float], blocks: list[dict] | None) -> dict:
    """Checks the final PDF. Returns a dict with every check and an overall `ok`."""
    height, width = img.shape[:2]
    expected = (width / dpi[0] * PT_PER_INCH, height / dpi[1] * PT_PER_INCH)
    v: dict = {}

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        v["pages"] = len(pdf.pages)
        box = [float(x) for x in pdf.pages[0].mediabox]
        size = (box[2] - box[0], box[3] - box[1])
        v["size_pt"] = [round(size[0], 2), round(size[1], 2)]
        v["size_ok"] = abs(size[0] - expected[0]) < 1.0 and abs(size[1] - expected[1]) < 1.0
        v["full_resolution_image"] = (width, height) in [(int(i.Width), int(i.Height)) for i in _images(pdf.pages[0])]

    text, lines = _text_and_lines(pdf_bytes, expected)
    v["text_chars"] = len(text.strip())
    if blocks:
        v["words_found"] = _found_fraction(blocks, text)
        v["median_offset"] = _offset(blocks, lines)
    v["psnr_db"] = _image_psnr(pdf_bytes, img)

    searchable = v["text_chars"] > 0
    aligned = v.get("median_offset") is None or v["median_offset"] < 0.02
    v["searchable"] = searchable
    v["ok"] = bool(v["pages"] == 1 and v["size_ok"] and v["full_resolution_image"]
                   and v["psnr_db"] >= 35 and (not blocks or (searchable and aligned)))
    return v


def _images(page) -> list:
    return list(page.get_images().values()) if hasattr(page, "get_images") else list(page.images.values())


def _text_and_lines(pdf_bytes: bytes, size: tuple[float, float]) -> tuple[str, list[tuple[str, float, float]]]:
    """Full text and the normalised centre (top-left origin) of every line, via pdfminer."""
    parts, lines = [], []

    def walk(elem) -> None:
        # The OCR layer is inside a Form XObject: pdfminer returns it as an LTFigure, so go down.
        if isinstance(elem, LTTextLine):
            text = elem.get_text()
            parts.append(text)
            if text.strip():
                x0, y0, x1, y1 = elem.bbox
                lines.append((text.strip(), (x0 + x1) / 2 / size[0], 1 - (y0 + y1) / 2 / size[1]))
        elif isinstance(elem, (LTTextContainer, LTFigure, LTPage)):
            for child in elem:
                walk(child)

    for page in extract_pages(io.BytesIO(pdf_bytes), laparams=LAParams(all_texts=True)):
        walk(page)
    return "".join(parts), lines


def _found_fraction(blocks: list[dict], text: str) -> float:
    words = [w for b in blocks for w in b["text"].split()]
    if not words:
        return 1.0
    extracted = set(text.split())
    return round(sum(w in extracted for w in words) / len(words), 3)


def _offset(blocks: list[dict], lines: list[tuple[str, float, float]]) -> float | None:
    """Median vertical distance between each OCR block and the PDF line holding its first word."""
    distances = []
    for b in blocks:
        first = b["text"].split()[0]
        cy = b["box"]["y"] + b["box"]["h"] / 2
        candidates = [abs(ly - cy) for t, _, ly in lines if first in t.split()]
        if candidates:
            distances.append(min(candidates))
    return round(float(np.median(distances)), 4) if distances else None


def _image_psnr(pdf_bytes: bytes, img: np.ndarray) -> float:
    """Fidelity: extracts the image embedded in the page and compares it pixel by pixel (grey).

    A viewer render is not compared: rendering always rescales and shifts by fractions of a pixel,
    which measured the viewer, not the PDF. 99 = identical (lossless PNG); JPEG ~40.
    """
    ref = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        for obj in _images(pdf.pages[0]):
            pil = pikepdf.PdfImage(obj).as_pil_image()
            if pil.size == (ref.shape[1], ref.shape[0]):
                embedded = np.array(pil.convert("L"))
                mse = float(np.mean((embedded.astype(np.float64) - ref.astype(np.float64)) ** 2))
                return 99.0 if mse == 0 else round(10 * np.log10(255.0 ** 2 / mse), 2)
    return 0.0


def validate_digital(pdf_bytes: bytes, words: list[dict]) -> dict:
    """The digital PDF opens, has one page and its text contains the OCR words."""
    with pikepdf.open(io.BytesIO(pdf_bytes)) as doc:
        pages = len(doc.pages)
    text, _ = _text_and_lines(pdf_bytes, (1.0, 1.0))
    extracted = set(text.split())
    found = sum(w["text"] in extracted for w in words) / len(words) if words else 1.0
    return {"pages": pages, "words_found": round(found, 3), "valid": pages == 1 and found > 0.9}
