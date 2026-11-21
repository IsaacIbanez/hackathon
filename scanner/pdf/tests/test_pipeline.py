import json

import cv2
import numpy as np
import pytest
from pdfminer.high_level import extract_text

import synthetic as s
from scanner_pdf import Options, Result, convert, ocr
from scanner_pdf.errors import ScannerError


@pytest.fixture(scope="module")
def desk_png() -> bytes:
    return s.png(s.with_shadow(s.on_desk(s.page(), s.PERSPECTIVE_CORNERS)))


@pytest.mark.ocr
def test_end_to_end(tmp_path, desk_png):
    r = convert(desk_png, tmp_path, name="test")
    assert r.status == "ok", (r.error, r.warnings, r.validation)
    assert r.searchable and r.pages == 1
    assert r.page["paper"] == "A4"
    v = r.validation
    assert v["size_ok"] and v["full_resolution_image"]
    assert v["psnr_db"] >= 40                      # the PDF image is the page, not re-encoded
    assert v["words_found"] > 0.95
    assert v["median_offset"] < 0.01               # text layer aligned with the image

    text = extract_text(r.pdf)
    for word in ("siniestro", "Barcelona", "asegurado", "Dirección"):
        assert word in text

    # Original untouched, intermediates and result saved.
    assert open(r.intermediates["original"], "rb").read() == desk_png
    for key in ("page", "base_pdf", "detection"):
        assert r.intermediates[key]
    saved = json.loads((tmp_path / "test" / "result.json").read_text(encoding="utf-8"))
    assert saved["status"] == "ok"


@pytest.mark.ocr
def test_document_matches_the_contract(tmp_path, desk_png):
    r = convert(desk_png, tmp_path)
    d = r.document()
    assert set(d) >= {"blocks", "quality"}
    assert 0 <= d["quality"]["score"] <= 1
    assert d["imageWidth"] == r.page["width_px"]
    assert d["blocks"], "there must be blocks"
    for b in d["blocks"]:
        assert set(b) == {"id", "text", "box", "confidence"}
        assert 0 <= b["confidence"] <= 1
        box = b["box"]
        assert all(0 <= box[k] <= 1 for k in "xywh")
        assert box["x"] + box["w"] <= 1.0001 and box["y"] + box["h"] <= 1.0001
    assert len({b["id"] for b in d["blocks"]}) == len(d["blocks"])
    # pageCorners (contract 0.5): the sheet corners on the photo, normalised, document TL first.
    expected = s.PERSPECTIVE_CORNERS / np.array([1920, 1440])
    got = np.array([[p["x"], p["y"]] for p in d["pageCorners"]])
    assert np.abs(got - expected).max() < 0.003


@pytest.mark.parametrize("degrees, first", [(0, 0), (90, 3), (180, 2), (270, 1)])
def test_page_corners_follow_the_rotation(degrees, first):
    # Photo corners TL, TR, BR, BL; after rotating the page clockwise by `degrees` to read it, the
    # document's top-left is a different photo corner.
    photo = [[100, 50], [900, 60], [880, 700], [90, 690]]
    r = Result(status="ok", input={"width": 1000, "height": 800},
               detection={"found": True, "corners": photo}, page={"rotation_degrees": degrees})
    tl = r.page_corners()[0]
    assert (tl["x"], tl["y"]) == (photo[first][0] / 1000, photo[first][1] / 800)
    assert Result(status="ok", input={"width": 1000, "height": 800}, detection={"found": False}).page_corners() is None


@pytest.mark.ocr
@pytest.mark.parametrize("photo_rotation, correction", [(cv2.ROTATE_90_CLOCKWISE, 270),
                                                        (cv2.ROTATE_90_COUNTERCLOCKWISE, 90), (cv2.ROTATE_180, 180)])
def test_rotated_page_is_straightened(tmp_path, photo_rotation, correction):
    # Real case: portrait sheet photographed in landscape (90/270) or upside down on the desk (180).
    rotated = cv2.rotate(s.page(), photo_rotation)
    r = convert(s.png(rotated), tmp_path)
    assert r.status == "ok", (r.error, r.warnings)
    assert r.page["rotation_degrees"] == correction
    assert r.page["height_px"] > r.page["width_px"]
    assert "siniestro" in extract_text(r.pdf)


@pytest.mark.ocr
def test_portrait_sheet_photographed_in_landscape_on_the_desk(tmp_path):
    sheet = cv2.rotate(s.page(), cv2.ROTATE_90_CLOCKWISE)          # the sheet lies sideways on the desk
    corners = s.camera_corners(10, -5, distance_mm=480, paper_mm=(297.0, 210.0))
    r = convert(s.png(s.on_desk(sheet, corners)), tmp_path)
    assert r.status == "ok", (r.error, r.warnings)
    assert r.detection["found"] and r.page["rotation_degrees"] == 270
    assert r.page["paper"] == "A4" and r.page["height_px"] > r.page["width_px"]
    # The sheet was turned clockwise on the desk: the document's top-left is the photo's top-right corner.
    tl = r.document()["pageCorners"][0]
    assert abs(tl["x"] - corners[1][0] / 1920) < 0.003 and abs(tl["y"] - corners[1][1] / 1440) < 0.003
    assert "siniestro" in extract_text(r.pdf)


@pytest.mark.ocr
@pytest.mark.parametrize("mode, fmt", [("gray", "png"), ("bw", "png"), ("color", "jpeg")])
def test_modes_and_formats(tmp_path, desk_png, mode, fmt):
    r = convert(desk_png, tmp_path, Options(mode=mode, image_format=fmt))
    assert r.status == "ok", (r.error, r.warnings, r.validation)
    assert "siniestro" in extract_text(r.pdf)


def test_without_ocr_gives_image_only_pdf(tmp_path, desk_png):
    r = convert(desk_png, tmp_path, Options(ocr=False, orient=False))
    assert r.status == "partial" and not r.searchable
    assert r.validation["pages"] == 1 and r.validation["full_resolution_image"]


def test_without_tesseract_still_makes_a_pdf(tmp_path, desk_png, monkeypatch):
    def fail():
        raise ScannerError("ocr_unavailable", "simulated")
    monkeypatch.setattr(ocr, "prepare_tesseract", fail)
    r = convert(desk_png, tmp_path)
    assert r.status == "partial" and r.pdf
    assert "no_ocr_layer:ocr_unavailable" in r.warnings


def test_invalid_input_returns_error_without_raising(tmp_path):
    r = convert(b"this is not a png", tmp_path)
    assert r.status == "error" and r.error["code"] == "input_not_png" and r.pdf is None


def test_invalid_options(tmp_path, desk_png):
    r = convert(desk_png, tmp_path, Options(mode="sepia"))
    assert r.error["code"] == "options_invalid"


def test_does_not_overwrite_results(tmp_path, desk_png):
    op = Options(ocr=False, orient=False, save_intermediates=False)
    a = convert(desk_png, tmp_path, op, name="doc")
    b = convert(desk_png, tmp_path, op, name="doc")
    assert a.folder != b.folder and b.folder.endswith("doc-2")


def test_manual_crop(tmp_path):
    corners = s.camera_corners(20, -12)
    img = s.on_desk(s.page(), corners)
    r = convert(s.png(img), tmp_path, Options(corners=corners.tolist(), ocr=False, orient=False))
    assert r.detection["method"] == "manual" and r.page["paper"] == "A4"


def test_no_sheet_uses_whole_image_and_warns(tmp_path):
    rng = np.random.default_rng(3)
    noise = cv2.GaussianBlur((rng.random((800, 1000, 3)) * 255).astype(np.uint8), (0, 0), 3)
    r = convert(s.png(noise), tmp_path, Options(ocr=False, orient=False))
    assert "page_not_detected" in r.warnings
    assert (r.page["width_px"], r.page["height_px"]) == (1000, 800)
