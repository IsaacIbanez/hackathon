import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # to import synthetic

from scanner_pdf import ocr  # noqa: E402
from scanner_pdf.errors import ScannerError  # noqa: E402


def _tesseract_available() -> bool:
    try:
        t = ocr.prepare_tesseract()
    except ScannerError:
        return False
    return "spa" in t.languages


TESSERACT = _tesseract_available()


def pytest_collection_modifyitems(config, items):
    if TESSERACT:
        return
    skip = pytest.mark.skip(reason="Tesseract with 'spa' not available (see scripts/install.*)")
    for item in items:
        if "ocr" in item.keywords:
            item.add_marker(skip)
