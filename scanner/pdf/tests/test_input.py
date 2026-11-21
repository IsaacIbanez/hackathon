import io

import cv2
import numpy as np
import pytest
from PIL import Image

from scanner_pdf.errors import ScannerError
from scanner_pdf.input_image import load_png


def _png(arr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", arr)
    assert ok
    return buf.tobytes()


def test_loads_colour_png_and_keeps_bytes():
    data = _png(np.full((300, 400, 3), 200, np.uint8))
    e = load_png(data)
    assert (e.width, e.height) == (400, 300)
    assert e.image.dtype == np.uint8 and e.image.shape == (300, 400, 3)
    assert e.original_bytes == data


def test_from_path(tmp_path):
    path = tmp_path / "a.png"
    path.write_bytes(_png(np.zeros((250, 250, 3), np.uint8)))
    assert load_png(path).width == 250


@pytest.mark.parametrize("data, code", [
    (b"GIF89a" + b"\0" * 100, "input_not_png"),
    (b"\x89PNG\r\n\x1a\n" + b"garbage" * 20, "input_unreadable"),
])
def test_rejects_invalid_inputs(data, code):
    with pytest.raises(ScannerError) as e:
        load_png(data)
    assert e.value.code == code


def test_rejects_missing_file(tmp_path):
    with pytest.raises(ScannerError) as e:
        load_png(tmp_path / "no.png")
    assert e.value.code == "input_not_found"


def test_rejects_tiny_image():
    with pytest.raises(ScannerError) as e:
        load_png(_png(np.zeros((50, 500, 3), np.uint8)))
    assert e.value.code == "input_too_small"


def test_alpha_is_composited_over_white():
    rgba = np.zeros((300, 300, 4), np.uint8)  # fully transparent black
    e = load_png(_png(rgba))
    assert e.image.min() == 255 and e.info["had_alpha"]


def test_16_bit_grey_becomes_bgr8():
    gray16 = np.full((300, 300), 65535 // 2, np.uint16)
    e = load_png(_png(gray16))
    assert e.image.shape == (300, 300, 3) and e.image.dtype == np.uint8
    assert abs(int(e.image[0, 0, 0]) - 128) <= 1
    assert e.info["bit_depth"] == 16


def test_reads_png_dpi():
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, "PNG", dpi=(300, 300))
    assert round(load_png(buf.getvalue()).dpi) == 300
