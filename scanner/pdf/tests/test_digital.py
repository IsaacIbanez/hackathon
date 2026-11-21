"""Digital document: blank page with real text and images in place."""

import io

import cv2
import numpy as np
import pikepdf
import pytest
from pdfminer.high_level import extract_pages, extract_text
from pdfminer.layout import LTTextContainer

import synthetic as s
from scanner_pdf import Options, convert, digital, vision
from scanner_pdf.errors import ScannerError


def _with_signature(sheet: np.ndarray) -> np.ndarray:
    """Adds a "signature" (curved blue stroke) inside the bottom box."""
    sheet = sheet.copy()
    height, width = sheet.shape[:2]
    t = np.linspace(0, 4 * np.pi, 400)
    xs = (width * 0.2 + t / (4 * np.pi) * width * 0.35).astype(np.int32)
    ys = (height * 0.82 + np.sin(t * 1.5) * height * 0.025).astype(np.int32)
    cv2.polylines(sheet, [np.stack([xs, ys], axis=1).reshape(-1, 1, 2)], False, (150, 40, 20), 5)
    return sheet


def _images(pdf_path) -> list[tuple[int, int]]:
    with pikepdf.open(pdf_path) as pdf:
        return [(int(i.Width), int(i.Height)) for i in pdf.pages[0].get_images().values()]


@pytest.mark.ocr
def test_real_text_and_no_page_photo(tmp_path):
    img = s.with_shadow(s.on_desk(_with_signature(s.page()), s.PERSPECTIVE_CORNERS))
    r = convert(s.png(img), tmp_path, Options(digital=True, digital_ai=False))
    assert r.status == "ok" and r.digital_pdf, (r.warnings, r.digital)
    assert r.digital["valid"] and r.digital["text_words"] >= 25
    text = extract_text(r.digital_pdf)
    for word in ("siniestro", "Barcelona", "asegurado", "Dirección"):
        assert word in text
    # No image fills the page: only crops (signature, box).
    width, height = r.page["width_px"], r.page["height_px"]
    for w, h in _images(r.digital_pdf):
        assert w * h < 0.35 * width * height
    # The scanned PDF is still made the same way.
    assert r.pdf and r.validation["ok"]


@pytest.mark.ocr
def test_signature_goes_as_an_image(tmp_path):
    r = convert(s.png(_with_signature(s.page())), tmp_path, Options(digital=True, digital_ai=False))
    assert r.digital_pdf and r.digital["image_regions"] >= 1
    assert _images(r.digital_pdf)


@pytest.mark.ocr
def test_dark_poster_is_not_digitalized(tmp_path):
    poster = np.full((1754, 1240, 3), (30, 35, 60), np.uint8)
    for i in range(6):
        cv2.putText(poster, f"Concierto {i}", (100, 200 + i * 220), cv2.FONT_HERSHEY_SIMPLEX, 3, (230, 240, 240), 6)
    r = convert(s.png(poster), tmp_path, Options(digital=True, digital_ai=False))
    assert r.pdf and r.digital_pdf is None
    assert "digital_not_applicable" in r.warnings


def test_without_ocr_there_is_no_digital(tmp_path):
    r = convert(s.png(s.page()), tmp_path, Options(digital=True, digital_ai=False, ocr=False, orient=False))
    assert r.digital_pdf is None and "digital_no_text" in r.warnings


def test_physical_lines_with_tilted_text():
    # Two lines of 6 words tilted ~3 degrees: Tesseract sometimes splits them; here they must give 2 lines.
    words, boxes = [], []
    for row in range(2):
        for k in range(6):
            x0 = 100 + k * 120
            y1 = 300 + row * 60 + int(k * 120 * 0.05)
            words.append({"text": "palabra", "conf": 90, "line": [1, 1, 7]})
            boxes.append((x0, y1 - 20, x0 + 100, y1))
    lines = digital._physical_lines(words, boxes, list(range(len(words))))
    assert len(lines) == 2 and all(len(line) == 6 for line in lines)


def test_applicable_only_on_light_paper():
    assert digital.applicable(np.full((100, 100, 3), 250, np.uint8))
    assert not digital.applicable(np.full((100, 100, 3), 60, np.uint8))


# ---------------------------------------------------------------- with a vision model (simulated: no network)

LAYOUT = {"blocks": [
    {"type": "text", "bbox": [70, 70, 500, 100], "lines": ["DECLARACIÓN DE PRUEBA"], "align": "left", "bold": False},
    {"type": "text", "bbox": [70, 120, 600, 390], "lines": [
        "Nombre y apellidos: María Peña Güell", "Dirección: Carrer de la Pau 12, Barcelona",
        "Fecha del siniestro: 21/11/2026", "Descripción: el vehículo sufrió daños leves.", "Firma del asegurado"],
     "align": "left", "bold": False},
    {"type": "image", "bbox": [180, 780, 600, 870], "description": "signature"},
]}


def _simulate_model(monkeypatch, answers):
    calls = []

    def page_layout(page, model, timeout=120):
        calls.append(model)
        a = answers[model]
        if isinstance(a, Exception):
            raise a
        return vision.clean_layout(a), {"model": model, "seconds": 0.1, "input_tokens": 1, "output_tokens": 1,
                                        "cost_usd": 0.001}

    monkeypatch.setattr(vision, "page_layout", page_layout)
    monkeypatch.setattr(vision, "api_key", lambda: "test-key")
    return calls


@pytest.mark.ocr
def test_digital_with_the_cheap_model(tmp_path, monkeypatch):
    calls = _simulate_model(monkeypatch, {vision.CHEAP_MODEL: LAYOUT, vision.EXPENSIVE_MODEL: LAYOUT})
    r = convert(s.png(_with_signature(s.page())), tmp_path, Options(digital=True))
    assert r.digital_pdf and r.digital["method"] == "model"
    assert calls == [vision.CHEAP_MODEL]                        # agrees with the OCR: no escalation
    assert r.digital["ocr_agreement"] >= 0.9 and r.digital["ai_cost_usd"] == 0.001
    text = extract_text(r.digital_pdf)
    assert "Güell" in text and "siniestro" in text              # the model text, with its diaeresis
    assert r.digital["image_regions"] == 1                      # the signature


@pytest.mark.ocr
def test_digital_escalates_to_the_expensive_model_when_it_disagrees(tmp_path, monkeypatch):
    invented = {"blocks": [{"type": "text", "bbox": [100, 100, 900, 300], "lines": ["Texto que no está en la hoja"],
                            "align": "left", "bold": False}]}
    calls = _simulate_model(monkeypatch, {vision.CHEAP_MODEL: invented, vision.EXPENSIVE_MODEL: LAYOUT})
    r = convert(s.png(s.page()), tmp_path, Options(digital=True))
    assert calls == [vision.CHEAP_MODEL, vision.EXPENSIVE_MODEL]
    assert r.digital["ocr_agreement"] >= 0.9


@pytest.mark.ocr
def test_digital_without_connection_uses_the_local_ocr(tmp_path, monkeypatch):
    _simulate_model(monkeypatch, {vision.CHEAP_MODEL: ScannerError("ai_no_connection", "simulated"),
                                  vision.EXPENSIVE_MODEL: ScannerError("ai_no_connection", "simulated")})
    r = convert(s.png(s.page()), tmp_path, Options(digital=True))
    assert r.digital_pdf and r.digital["method"] == "local_ocr"
    assert "digital_ai_unavailable:ai_no_connection" in r.warnings


def test_invalid_layout_is_rejected():
    with pytest.raises(ScannerError):
        vision.clean_layout({"blocks": [{"type": "text", "bbox": [1, 2], "lines": ["x"]}]})
    m = vision.clean_layout({"blocks": [{"type": "text", "bbox": [100, 100, 900, 200], "lines": ["hola"], "align": "odd"}]})
    assert m["blocks"][0]["bbox"] == [0.1, 0.1, 0.9, 0.2] and m["blocks"][0]["align"] == "left"


def test_blocks_do_not_overlap():
    page = np.full((1754, 1240, 3), 255, np.uint8)
    overlapping = {"blocks": [
        {"type": "text", "bbox": [100, 100, 900, 200], "lines": ["uno uno uno", "dos dos dos", "tres tres"],
         "align": "justify", "bold": False},
        {"type": "text", "bbox": [100, 170, 900, 250], "lines": ["cuatro cuatro", "cinco cinco"], "align": "left", "bold": False},
    ]}
    data, _ = digital.digitalize_layout(page, vision.clean_layout(overlapping), [], 150.0)
    boxes = [e.bbox for p in extract_pages(io.BytesIO(data)) for e in p if isinstance(e, LTTextContainer)]
    boxes.sort(key=lambda b: -b[3])
    for a, b in zip(boxes, boxes[1:]):
        assert b[3] <= a[1] + 0.5                               # each block starts below the previous one


def _page_with_signature():
    """White page with a light-stroke signature."""
    page = np.full((1754, 1240, 3), 255, np.uint8)
    t = np.linspace(0, 4 * np.pi, 400)
    xs = (300 + t / (4 * np.pi) * 300).astype(np.int32)
    ys = (1100 + np.sin(t * 1.5) * 40).astype(np.int32)
    cv2.polylines(page, [np.stack([xs, ys], axis=1).reshape(-1, 1, 2)], False, (205, 190, 160), 3)  # soft pen
    return page


def test_light_stroke_signature_comes_out_whole():
    layout = vision.clean_layout({"blocks": [{"type": "image", "bbox": [230, 600, 510, 660], "description": "signature"}]})
    data, info = digital.digitalize_layout(_page_with_signature(), layout, [], 150.0)
    assert info["image_regions"] == 1
    with pikepdf.open(io.BytesIO(data)) as pdf:
        (w, h), = [(int(i.Width), int(i.Height)) for i in pdf.pages[0].get_images().values()]
    assert w >= 290 and h >= 70                                   # the whole signature (300 x 80 px), not only the dark part


def test_reading_order_wins_even_if_the_box_is_displaced():
    # The model places "Signat," below the signature, but lists it first: it must end up above.
    layout = vision.clean_layout({"blocks": [
        {"type": "text", "bbox": [230, 640, 320, 650], "lines": ["Signat,"], "align": "left", "bold": False},
        {"type": "image", "bbox": [230, 600, 510, 660], "description": "signature"},
    ]})
    page = _page_with_signature()
    height = page.shape[0]
    s_ = 72 / 150
    texts, _ = digital._text_blocks(layout, [], [], 1240, height, 20.0, s_)
    digital._typography(texts, s_)
    images = digital._image_blocks(layout, page, cv2.cvtColor(page, cv2.COLOR_BGR2GRAY), [], 20.0)
    for t in texts:
        t["height_px"] = ((len(t["lines"]) - 1) * t["line_spacing"] + 0.925 * t["size"]) / s_
    digital._flow(texts + images, 20.0, height)
    assert texts[0]["y"] + texts[0]["height_px"] <= images[0]["y"]


def test_short_heading_is_not_smaller_than_the_body():
    texts = [
        {"lines": ["Un párrafo normal con bastantes palabras para llenar la línea entera",
                   "y una segunda línea del mismo párrafo justificado"], "align": "justify",
         "bold": False, "box": [100, 300, 1100, 360], "ocr_size": None},
        {"lines": ["CERTIFICA"], "align": "left", "bold": True, "box": [100, 250, 180, 262], "ocr_size": 6.0},
    ]
    body = digital._typography(texts, 72 / 150)
    assert texts[1]["size"] == body
