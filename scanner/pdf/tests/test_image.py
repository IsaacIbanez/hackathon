import cv2
import numpy as np
import pytest

import synthetic as s
from scanner_pdf import image


def test_lighting_evens_out_the_shadow():
    shadow = s.with_shadow(s.page(), strength=0.45)
    corrected = image.correct_lighting(shadow)
    gray = cv2.cvtColor(corrected, cv2.COLOR_BGR2GRAY)
    # Paper without text: bottom strip (below the box). Left and right must look alike.
    strip = gray[int(gray.shape[0] * 0.93):, :]
    left, right = strip[:, :100].mean(), strip[:, -100:].mean()
    before = cv2.cvtColor(shadow, cv2.COLOR_BGR2GRAY)[int(gray.shape[0] * 0.93):, :]
    assert abs(left - right) < 0.25 * abs(before[:, :100].mean() - before[:, -100:].mean())
    assert right > 230


def test_lighting_does_not_erase_large_dark_areas():
    img = np.full((1200, 900, 3), 240, np.uint8)
    img[300:900, 200:700] = 30   # photo or filled box, much larger than a stroke
    corrected = image.correct_lighting(img)
    assert corrected[400:800, 300:600].mean() < 80


def test_lighting_keeps_the_text():
    corrected = image.correct_lighting(s.page())
    assert cv2.cvtColor(corrected, cv2.COLOR_BGR2GRAY).min() < 60  # the ink is still dark


@pytest.mark.parametrize("mode, ndim", [("color", 3), ("gray", 2), ("bw", 2)])
def test_modes(mode, ndim):
    out = image.apply_mode(s.page(), mode)
    assert out.ndim == ndim
    if mode == "bw":
        assert set(np.unique(out)) <= {0, 255}


def test_invalid_mode():
    with pytest.raises(ValueError):
        image.apply_mode(s.page(), "sepia")


def _quality(img, **kw):
    args = {"area_fraction": 0.5, "touches_border": False, "max_angle": 5, "effective_dpi": 200, **kw}
    return image.evaluate_quality(img, **args)


def test_quality_detects_blur_and_darkness():
    sheet = s.page()
    good = _quality(sheet)
    assert good["issues"] == [] and good["score"] == 1.0
    assert "blurry" in _quality(cv2.GaussianBlur(sheet, (0, 0), 6))["issues"]
    assert "dark" in _quality((sheet * 0.25).astype(np.uint8))["issues"]


def test_quality_uses_contract_vocabulary():
    r = _quality(s.page(), area_fraction=0.1, touches_border=True, max_angle=40, effective_dpi=80)
    # FrameIssue in api/openapi.yaml
    assert set(r["issues"]) <= {"blurry", "dark", "glare", "cropped", "tilted", "too_far"}
    assert {"cropped", "tilted", "too_far"} <= set(r["issues"])


def test_light_is_only_evened_out_on_light_paper():
    # Real case: brightening a dark poster or a whole scene left them washed out and burnt.
    assert image.light_paper(s.page())
    assert not image.light_paper(np.full((800, 600, 3), (40, 30, 60), np.uint8))
