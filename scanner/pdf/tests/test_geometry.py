import cv2
import numpy as np
import pytest

import synthetic as s
from scanner_pdf import geometry as g

A4 = 210 / 297

# (tilt x, tilt y, focal px, distance mm): physically possible camera poses
POSES = [(0, 0, 1500, 520), (5, 3, 1500, 520), (20, -12, 1500, 520), (35, 10, 1500, 520),
         (30, -25, 1100, 520), (25, -30, 1300, 500), (40, 0, 1500, 450)]


@pytest.mark.parametrize("ix, iy, focal, dist", POSES)
def test_detects_sheet_and_recovers_a4_aspect(ix, iy, focal, dist):
    corners = s.camera_corners(ix, iy, focal_px=focal, distance_mm=dist)
    img = s.with_shadow(s.on_desk(s.page(), corners))
    d = g.detect_page(img)
    assert d.found
    assert np.abs(d.corners - corners).max() < 2.0          # corners within 2 px
    aspect = g.real_aspect_ratio(d.corners, img.shape[:2])
    assert abs(aspect - A4) / A4 < 0.02
    assert g.nearest_paper(aspect) == "A4"


@pytest.mark.parametrize("name", ["texture", "black", "sheet_fills_frame"])
def test_does_not_invent_sheets(name):
    if name == "texture":
        rng = np.random.default_rng(1)
        img = cv2.GaussianBlur((rng.random((1440, 1920, 3)) * 255).astype(np.uint8), (0, 0), 3)
    elif name == "black":
        img = np.zeros((1440, 1920, 3), np.uint8)
    else:  # no background around it: the printed box inside must not be cropped
        img = s.page()
    assert not g.detect_page(img).found


def test_cut_off_sheet_is_not_badly_cropped():
    corners = s.camera_corners(5, 3, distance_mm=520, offset_mm=(280, 0))
    assert corners[:, 0].max() > 1920  # precondition: the sheet leaves the frame on the right
    d = g.detect_page(s.on_desk(s.page(), corners))
    # Either it is not detected (better not to crop) or it warns that it touches the border.
    assert (not d.found) or d.touches_border


def test_order_corners_does_not_depend_on_order():
    pts = np.array([[10, 10], [100, 12], [98, 200], [8, 190]], np.float32)
    for perm in ([2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]):
        assert np.array_equal(g.order_corners(pts[perm]), pts)


@pytest.mark.parametrize("aspect, paper", [(A4, "A4"), (1 / A4, "A4"), (215.9 / 279.4, "Letter"), (1.0, None)])
def test_nearest_paper(aspect, paper):
    assert g.nearest_paper(aspect) == paper


def test_4_3_frame_is_not_a_paper_with_strict_tolerance():
    assert g.nearest_paper(4 / 3, g.UNDETECTED_PAPER_TOLERANCE) is None


def test_rectify_keeps_aspect_and_does_not_downscale():
    corners = s.camera_corners(20, -12)
    img = s.on_desk(s.page(), corners)
    flat = g.rectify(img, corners, A4)
    height, width = flat.shape[:2]
    assert abs(width / height - A4) < 0.01
    vertical_side = max(np.linalg.norm(corners[3] - corners[0]), np.linalg.norm(corners[2] - corners[1]))
    assert height >= 0.99 * vertical_side


def test_rejects_shapes_with_very_different_opposite_sides():
    # Real case (Discord card): the purple panel cut by a drawing gave sides of 178 and 323 px.
    img = np.full((720, 1280, 3), 230, np.uint8)
    quad = np.array([[550, 164], [1023, 160], [1039, 483], [552, 342]], np.int32)
    cv2.fillConvexPoly(img, quad, (120, 40, 60))
    assert not g.detect_page(img).found


def test_sheet_tilted_45_degrees_is_still_accepted():
    corners = s.camera_corners(45, 0, focal_px=1100, distance_mm=400)
    d = g.detect_page(s.on_desk(s.page(), corners))
    assert d.found and np.abs(d.corners - corners).max() < 2.0


def _dark_poster(width=1240, height=1754):
    """Dark poster with light labels (like the concert one in the real captures)."""
    sheet = np.full((height, width, 3), (30, 35, 60), np.uint8)
    for i in range(8):
        y = int(height * (0.08 + i * 0.11))
        cv2.rectangle(sheet, (int(width * 0.08), y), (int(width * 0.45), y + 60), (200, 240, 240), -1)
        cv2.putText(sheet, f"{10 + i}.11  Concierto", (int(width * 0.1), y + 45), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (20, 20, 20), 3)
    return sheet


def test_dark_document_on_white_desk():
    # Real case: dark poster on a white desk. The empty desk next to it used to be cropped.
    corners = s.camera_corners(10, -6, distance_mm=520)
    img = s.on_desk(_dark_poster(), corners, background=(225, 228, 230))
    d = g.detect_page(img)
    assert d.found
    assert np.abs(d.corners - corners).max() < 6.0


def test_does_not_pick_a_piece_of_empty_desk():
    corners = s.camera_corners(5, 3, distance_mm=520, offset_mm=(-90, 0))  # poster on the left
    img = s.on_desk(_dark_poster(), corners, background=(225, 228, 230))
    d = g.detect_page(img)
    if d.found:  # if it detects something, it must be the poster, not the desk on the right
        assert np.abs(d.corners - corners).max() < 6.0


def _held_sheet_next_to_a_framed_panel() -> np.ndarray:
    """A sheet held against a light jacket (no outline: white on near-white) next to a framed grey panel
    with a little print in the background (poster, window, notice board)."""
    img = np.full((1440, 1920, 3), 232, np.uint8)
    img[250:250 + 1075, 1050:1050 + 760] = cv2.resize(s.page(), (760, 1075))
    cv2.rectangle(img, (120, 160), (820, 760), (35, 35, 35), -1)
    cv2.rectangle(img, (150, 190), (790, 730), (150, 150, 150), -1)
    for i in range(6):
        cv2.putText(img, "AVIS IMPORTANT 2026", (190, 260 + i * 75), cv2.FONT_HERSHEY_SIMPLEX, 1.1,
                    (20, 20, 20), 2, cv2.LINE_AA)
    return img


def test_a_frame_in_the_background_is_not_the_sheet():
    # Real scans of a sheet held in the hand (2026-11-22): ceiling and window frames were taken as the
    # sheet (the hands cut its outline) and the OCR read 0-6 words. A sheet holds most of the print.
    img = _held_sheet_next_to_a_framed_panel()
    assert not g.detect_page(img).found
    crop, box, _ = g.text_region(img)
    x0, y0, x1, y1 = box
    assert 1000 <= x0 and x1 <= 1830 and 230 <= y0 < y1 <= 1340 and x1 - x0 > 500   # inside the held sheet
