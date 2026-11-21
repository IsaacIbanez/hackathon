import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # para importar sinteticos

from escaner_pdf import ocr  # noqa: E402
from escaner_pdf.errores import ErrorEscaner  # noqa: E402


def _tesseract_disponible() -> bool:
    try:
        t = ocr.preparar_tesseract()
    except ErrorEscaner:
        return False
    return "spa" in t.idiomas


TESSERACT = _tesseract_disponible()


def pytest_collection_modifyitems(config, items):
    if TESSERACT:
        return
    saltar = pytest.mark.skip(reason="Tesseract con 'spa' no disponible (ver scripts/instalar.*)")
    for item in items:
        if "ocr" in item.keywords:
            item.add_marker(saltar)
