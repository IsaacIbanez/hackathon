"""Test image generators (no real documents or personal data)."""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Sample data imitating a Spanish insurance form (kept in Spanish on purpose).
LINES = [
    "DECLARACIÓN DE PRUEBA",
    "Nombre y apellidos: María Peña Güell",
    "Dirección: Carrer de la Pau 12, Barcelona",
    "Fecha del siniestro: 21/11/2026",
    "Descripción: el vehículo sufrió daños leves.",
    "Firma del asegurado",
]


FONTS = ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/TTF/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")


def font(size: int) -> ImageFont.FreeTypeFont | None:
    """A system font with accents (Pillow's default one has none). None if there is none."""
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return None


def page(width: int = 1240, height: int = 1754, lines: list[str] = LINES, font_size: int = 40) -> np.ndarray:
    """White sheet (A4 at 150 DPI by default) with black text and a box. BGR uint8."""
    img = Image.new("RGB", (width, height), (250, 250, 248))
    d = ImageDraw.Draw(img)
    f = font(font_size)
    if f is None:  # no system font: text without accents so it stays legible
        import unicodedata
        lines = ["".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn") for t in lines]
        f = ImageFont.load_default(size=font_size)
    y = int(height * 0.08)
    for text in lines:
        d.text((int(width * 0.08), y), text, fill=(15, 15, 15), font=f)
        y += int(font_size * 2.2)
    d.rectangle([int(width * 0.08), int(height * 0.75), int(width * 0.92), int(height * 0.9)], outline=(30, 30, 30), width=3)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def on_desk(sheet: np.ndarray, target_corners: np.ndarray, size: tuple[int, int] = (1920, 1440),
            background: tuple[int, int, int] = (60, 45, 35)) -> np.ndarray:
    """Places the sheet on a dark background with the given perspective (corners TL, TR, BR, BL)."""
    width, height = size
    h, w = sheet.shape[:2]
    source = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(source, target_corners.astype(np.float32))
    desk = np.full((height, width, 3), background, np.uint8)
    noise = np.random.default_rng(0).normal(0, 6, desk.shape)
    desk = np.clip(desk + noise, 0, 255).astype(np.uint8)
    return cv2.warpPerspective(sheet, m, (width, height), dst=desk, borderMode=cv2.BORDER_TRANSPARENT)


def with_shadow(img: np.ndarray, strength: float = 0.45) -> np.ndarray:
    """Darkens in a gradient from left (shadow) to right (light)."""
    width = img.shape[1]
    grad = np.linspace(1.0 - strength, 1.0, width, dtype=np.float32)[None, :, None]
    return np.clip(img.astype(np.float32) * grad, 0, 255).astype(np.uint8)


def png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def camera_corners(tilt_x: float = 20.0, tilt_y: float = -12.0, spin_z: float = 4.0,
                   distance_mm: float = 520.0, focal_px: float = 1500.0, size: tuple[int, int] = (1920, 1440),
                   paper_mm: tuple[float, float] = (210.0, 297.0), offset_mm: tuple[float, float] = (0.0, 0.0)
                   ) -> np.ndarray:
    """Image corners of a real sheet seen by a pinhole camera (optical centre in the middle).

    So the perspective is physically possible, as in a real photo.
    """
    w, h = paper_mm
    sheet = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], dtype=np.float64)
    sheet[:, 0] += offset_mm[0]
    sheet[:, 1] += offset_mm[1]
    rx, ry, rz = np.radians([tilt_x, tilt_y, spin_z])
    rot_x = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    rot_y = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    rot_z = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    points = sheet @ (rot_z @ rot_y @ rot_x).T + np.array([0, 0, distance_mm])
    u = focal_px * points[:, 0] / points[:, 2] + size[0] / 2
    v = focal_px * points[:, 1] / points[:, 2] + size[1] / 2
    return np.stack([u, v], axis=1).astype(np.float32)


PERSPECTIVE_CORNERS = camera_corners()
