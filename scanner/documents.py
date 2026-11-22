"""Files from the computer -> contract `document` (overlay option "Read a file", see docs/OVERLAY.md).

POST /document of the reading service (service.py) uses this. Supported now:
- PDF with a text layer: the lines are taken from the PDF itself (exact text, instant, no OCR).
- PDF pages without text (scanned): rendered at 300 dpi and read with the OCR pipeline.
- PNG / JPEG: the OCR pipeline, with sheet detection (a photo of a paper) or the whole image (a screenshot).
Text files (.txt, .md) are read by Go, without this service.

Pages are stacked top to bottom: page p of n takes y in [p/n, (p+1)/n], so reading order (by y) goes
page by page. To add a format, add a reader below and its signature in `read_document`.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from pathlib import Path

from scanner_pdf import Options, convert
from scanner_pdf.errors import ScannerError

log = logging.getLogger("scan-service")

PDF_SIGNATURE = b"%PDF"
MAX_PAGES = 30          # pages read from one PDF
MAX_OCR_PAGES = 8       # scanned pages OCR'd from one PDF (~3-8 s each)
MIN_TEXT_CHARS = 3      # fewer characters than this on a PDF page: it is a scan, use OCR
RENDER_DPI = 300


def layout_lines(layout) -> list[dict] | None:
    """A pdfminer page layout's text lines [{text, box}] (box normalised to that page), or None if the page
    has (almost) no text, i.e. it is a scan."""
    from pdfminer.layout import LTTextContainer, LTTextLine

    w, h = float(layout.width) or 1.0, float(layout.height) or 1.0
    lines = []
    for element in layout:
        if not isinstance(element, LTTextContainer):
            continue
        for line in element:
            if not isinstance(line, LTTextLine):
                continue
            text = " ".join(line.get_text().split())
            if not text:
                continue
            x0, y0, x1, y1 = line.bbox
            lines.append({"text": text, "box": {
                "x": max(0.0, x0 / w), "y": max(0.0, (h - y1) / h),
                "w": max(0.0, min(1.0, (x1 - x0) / w)), "h": max(0.0, min(1.0, (y1 - y0) / h))}})
    chars = sum(len(line["text"]) for line in lines)
    return lines if chars >= MIN_TEXT_CHARS else None


def _pdf_text_pages(data: bytes) -> list[list[dict] | None]:
    """Per page, its text lines [{text, box}] (box normalised to that page), or None if it has no text."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams

    return [layout_lines(layout) for layout in extract_pages(io.BytesIO(data), laparams=LAParams(), maxpages=MAX_PAGES)]


def _render_pdf_page(data: bytes, index: int) -> bytes:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    img = pdf[index].render(scale=RENDER_DPI / 72).to_pil().convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=1)
    return buf.getvalue()


def _ocr_lines(png: bytes, output_dir: Path, whole_image: bool, languages: str) -> tuple[list[dict], str | None]:
    """OCR one image with the pipeline; its blocks as lines (boxes normalised to the read page)."""
    corners = None
    if whole_image:     # a rendered PDF page: it *is* the page, no sheet to look for
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
        hgt, wid = img.shape[:2]
        corners = [[0, 0], [wid - 1, 0], [wid - 1, hgt - 1], [0, hgt - 1]]
    name = datetime.now().strftime("file-%Y%m%d-%H%M%S-%f")[:-3]
    result = convert(png, output_dir, Options(languages=languages, corners=corners, save_intermediates=False),
                     name=name, metadata={"source": "read-file"})
    if result.error:
        raise ScannerError(result.error["code"], result.error["message"])
    if any(w.startswith("no_ocr_layer:ocr_unavailable") for w in result.warnings):
        raise ScannerError("ocr_unavailable", "Tesseract is not installed (scanner/pdf/scripts/install.*)")
    doc = result.document()
    return [{"text": b["text"], "box": b["box"], "confidence": b["confidence"]} for b in doc["blocks"]], doc.get("lang")


def _stack(pages: list[list[dict]]) -> list[dict]:
    """Blocks of all pages in one document, page p of n in y [p/n, (p+1)/n]."""
    n = max(1, len(pages))
    blocks = []
    for p, lines in enumerate(pages):
        for i, line in enumerate(lines):
            b = line["box"]
            blocks.append({"id": f"p{p + 1}-l{i + 1}", "text": line["text"],
                           "confidence": round(float(line.get("confidence", 1.0)), 3),
                           "box": {"x": round(b["x"], 4), "y": round((p + b["y"]) / n, 5),
                                   "w": round(b["w"], 4), "h": round(b["h"] / n, 5)}})
    return blocks


def read_document(data: bytes, output_dir: Path, to_png, languages: str = "spa+cat+eng", ocr_lock=None) -> dict:
    """The file's lines as a contract DocumentPayload. `to_png` turns PNG/JPEG bytes into PNG bytes (service.py).
    Raises ScannerError (input_*, ocr_unavailable)."""
    from contextlib import nullcontext
    lock = ocr_lock or nullcontext()
    warnings: list[str] = []
    lang = None
    if data.startswith(PDF_SIGNATURE):
        try:
            text_pages = _pdf_text_pages(data)
        except Exception as e:  # noqa: BLE001 - damaged or encrypted PDF
            raise ScannerError("input_unreadable", f"Could not read the PDF: {type(e).__name__}") from e
        if not text_pages:
            raise ScannerError("input_unreadable", "The PDF has no pages")
        pages, ocr_done = [], 0
        for index, lines in enumerate(text_pages):
            if lines is not None:
                pages.append(lines)
                continue
            if ocr_done >= MAX_OCR_PAGES:
                warnings.append(f"page_{index + 1}_skipped_ocr_limit")
                pages.append([])
                continue
            with lock:
                lines, lang = _ocr_lines(_render_pdf_page(data, index), output_dir, True, languages)
            ocr_done += 1
            pages.append(lines)
        kind = "pdf_text" if ocr_done == 0 else ("pdf_scanned" if ocr_done == len(pages) else "pdf_mixed")
    else:
        with lock:
            lines, lang = _ocr_lines(to_png(data), output_dir, False, languages)
        pages, kind = [lines], "image"
    blocks = _stack(pages)
    log.info("document: %s, %d pages, %d lines%s", kind, len(pages), len(blocks),
             f", {warnings}" if warnings else "")
    doc = {"blocks": blocks, "quality": {"score": 1.0, "issues": []}, "source": kind}
    if lang:
        doc["lang"] = lang
    if warnings:
        doc["warnings"] = warnings
    return doc
