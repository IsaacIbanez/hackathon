"""PDFs page by page, for the PDF viewer that reads a whole PDF aloud (task N4, docs/briefs/N4.md).

The reading service keeps the last few opened PDFs in memory and serves each page on its own:
- its image (JPEG, rendered with pypdfium2) for the viewer;
- its lines in reading order, each with a box normalised to that page: from the PDF's own text when
  the page has it, otherwise from the OCR pipeline (scanned page, ~3-8 s).
There is no page limit: the viewer starts reading the first page while it asks for the next one.
"""

from __future__ import annotations

import io
import re
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

from scanner_pdf.errors import ScannerError

import documents

KEEP_OPEN = 3            # PDFs kept in memory (the oldest is closed)
DEFAULT_WIDTH = 1100     # page image width in pixels
MAX_WIDTH = 2400

_COMMON = {
    "es-ES": "el la de que y los las para con su una se del por al es en un no".split(),
    "ca-ES": "el la de que i els les per amb seu una es del al és en un no".split(),
    "en-GB": "the of and to a is for with your you in that this be are on".split(),
}


def detect_lang(text: str) -> str:
    """Spanish, Catalan or English by their most common words (Spanish if unsure)."""
    words = re.findall(r"[a-zàáèéíïòóúüçñ·']+", text.lower())
    if not words:
        return "es-ES"
    counts = {lang: sum(words.count(w) for w in common) for lang, common in _COMMON.items()}
    # Words only one language has decide between Spanish and Catalan (both share "el", "la", "de"…).
    counts["es-ES"] += 2 * sum(words.count(w) for w in ("y", "los", "las", "para", "con", "su"))
    counts["ca-ES"] += 2 * sum(words.count(w) for w in ("i", "els", "les", "per", "amb", "seu"))
    return max(counts, key=lambda k: (counts[k], k == "es-ES"))


@dataclass
class OpenPdf:
    id: str
    name: str
    data: bytes
    pages: int
    lines: dict[int, dict] = field(default_factory=dict)    # page index -> {"lines", "ocr"}
    lang: str = "es-ES"


class PdfStore:
    """The open PDFs (thread-safe). OCR goes through `ocr_lock`, shared with POST /scan."""

    def __init__(self, output_dir: Path, to_png, ocr_lock: threading.Lock | None = None,
                 languages: str = "spa+cat+eng"):
        self.output_dir = Path(output_dir)
        self.to_png = to_png
        self.ocr_lock = ocr_lock or threading.Lock()
        self.languages = languages
        self._open: OrderedDict[str, OpenPdf] = OrderedDict()
        self._lock = threading.Lock()

    def open(self, data: bytes, name: str = "document.pdf") -> dict:
        """Keeps the PDF and returns {id, name, pages, lang}. Raises ScannerError (input_*)."""
        if not data.startswith(documents.PDF_SIGNATURE):
            raise ScannerError("input_not_pdf", "The file is not a PDF")
        import pypdfium2 as pdfium
        try:
            pages = len(pdfium.PdfDocument(data))
        except Exception as e:  # noqa: BLE001 - damaged or encrypted
            raise ScannerError("input_unreadable", f"Could not open the PDF: {type(e).__name__}") from e
        if pages == 0:
            raise ScannerError("input_unreadable", "The PDF has no pages")
        pdf = OpenPdf(id=secrets.token_hex(6), name=name, data=data, pages=pages)
        # The language of the voice comes from the first page with text (instant: no OCR here).
        for index in range(min(pages, 3)):
            text_lines = self._text_lines(pdf, index)
            if text_lines:
                pdf.lang = detect_lang(" ".join(line["text"] for line in text_lines))
                pdf.lines[index] = {"lines": text_lines, "ocr": False}
                break
        with self._lock:
            self._open[pdf.id] = pdf
            while len(self._open) > KEEP_OPEN:
                self._open.popitem(last=False)
        return {"id": pdf.id, "name": name, "pages": pages, "lang": pdf.lang}

    def get(self, pdf_id: str) -> OpenPdf:
        with self._lock:
            pdf = self._open.get(pdf_id)
            if pdf is None:
                raise KeyError(pdf_id)
            self._open.move_to_end(pdf_id)
            return pdf

    def _check(self, pdf: OpenPdf, index: int) -> None:
        if not 0 <= index < pdf.pages:
            raise IndexError(index)

    @staticmethod
    def _text_lines(pdf: OpenPdf, index: int) -> list[dict] | None:
        """The page's lines from the PDF's own text, or None if it has (almost) none."""
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LAParams
        for layout in extract_pages(io.BytesIO(pdf.data), laparams=LAParams(), page_numbers=[index]):
            return documents.layout_lines(layout)
        return None

    def page_lines(self, pdf_id: str, index: int) -> dict:
        """{page, lines: [{id, text, box, confidence}], ocr}: lines in reading order, boxes on this page."""
        pdf = self.get(pdf_id)
        self._check(pdf, index)
        cached = pdf.lines.get(index)
        if cached is None:
            lines, ocr = self._text_lines(pdf, index), False
            if lines is None:
                with self.ocr_lock:
                    png = documents._render_pdf_page(pdf.data, index)
                    lines, _ = documents._ocr_lines(png, self.output_dir, True, self.languages)
                ocr = True
            cached = {"lines": lines, "ocr": ocr}
            pdf.lines[index] = cached
        ordered = sorted(cached["lines"], key=lambda line: (round(line["box"]["y"], 3), line["box"]["x"]))
        return {
            "page": index,
            "ocr": cached["ocr"],
            "lines": [{"id": f"p{index + 1}-l{i + 1}", "text": line["text"],
                       "confidence": round(float(line.get("confidence", 1.0)), 3),
                       "box": {k: round(float(v), 4) for k, v in line["box"].items()}}
                      for i, line in enumerate(ordered)],
        }

    def page_image(self, pdf_id: str, index: int, width: int = DEFAULT_WIDTH) -> bytes:
        """The page as a JPEG `width` pixels wide."""
        import pypdfium2 as pdfium
        pdf = self.get(pdf_id)
        self._check(pdf, index)
        width = max(200, min(int(width), MAX_WIDTH))
        page = pdfium.PdfDocument(pdf.data)[index]
        scale = width / page.get_width()
        img = page.render(scale=scale).to_pil().convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        return buf.getvalue()
