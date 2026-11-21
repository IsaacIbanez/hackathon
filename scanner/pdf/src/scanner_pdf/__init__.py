"""scanner_pdf: PNG image of a document -> searchable PDF (faithful image + invisible OCR layer).

Minimal use:
    from scanner_pdf import convert, Options
    r = convert("capture.png", "output/")
    if r.ok: print(r.pdf)
"""

from .errors import ScannerError
from .pipeline import Options, Result, convert

__all__ = ["convert", "Options", "Result", "ScannerError"]
__version__ = "0.1.0"
