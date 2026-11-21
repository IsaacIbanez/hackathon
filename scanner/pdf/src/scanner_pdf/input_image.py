"""Loads and validates the input PNG.

The image comes from the capture side (capturar.py). The only assumption is that it is a PNG; it is
normalised to 8-bit BGR without alpha and the original bytes are kept untouched.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .errors import ScannerError

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MIN_SIDE = 200             # px; below this nothing useful can be read
MAX_MEGAPIXELS = 100       # protects memory against absurd images


@dataclass
class InputImage:
    image: np.ndarray             # BGR uint8, no alpha
    original_bytes: bytes         # the PNG exactly as received
    dpi: float | None             # from the pHYs chunk, if present
    info: dict = field(default_factory=dict)  # channels, bit depth, alpha...

    @property
    def width(self) -> int:
        return int(self.image.shape[1])

    @property
    def height(self) -> int:
        return int(self.image.shape[0])


def load_png(source: str | Path | bytes) -> InputImage:
    """Reads a PNG from a path or bytes. Raises ScannerError if it is not valid."""
    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)
    else:
        path = Path(source)
        if not path.is_file():
            raise ScannerError("input_not_found", f"File not found: {path}")
        data = path.read_bytes()

    if not data.startswith(PNG_SIGNATURE):
        raise ScannerError("input_not_png", "The input is not a PNG (wrong signature)")

    raw = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if raw is None or raw.size == 0:
        raise ScannerError("input_unreadable", "The PNG is damaged or cannot be decoded")

    height, width = raw.shape[:2]
    if min(height, width) < MIN_SIDE:
        raise ScannerError("input_too_small", f"Image is {width}x{height}; the shorter side must be at least {MIN_SIDE} px")
    if height * width > MAX_MEGAPIXELS * 1_000_000:
        raise ScannerError("input_too_large", f"Image is {width}x{height} (> {MAX_MEGAPIXELS} MP)")

    channels = 1 if raw.ndim == 2 else raw.shape[2]
    info = {"width": width, "height": height, "channels": channels, "bit_depth": raw.dtype.itemsize * 8,
            "had_alpha": channels in (2, 4)}

    return InputImage(image=_to_bgr8(raw), original_bytes=data, dpi=_read_dpi(data), info=info)


def _to_bgr8(img: np.ndarray) -> np.ndarray:
    """Converts any decoded PNG (gray/BGR/BGRA, 8 or 16 bits) to BGR uint8."""
    if img.dtype == np.uint16:
        img = (img.astype(np.float32) / 257.0 + 0.5).astype(np.uint8)
    elif img.dtype != np.uint8:
        raise ScannerError("input_unsupported_format", f"Unsupported colour depth: {img.dtype}")

    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 2:  # gray + alpha (OpenCV rarely returns this, but just in case)
        gray, alpha = img[..., 0], img[..., 1]
        return cv2.cvtColor(_over_white(gray[..., None], alpha)[..., 0], cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return _over_white(img[..., :3], img[..., 3])
    return img


def _over_white(color: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Composites over a white background (the paper), so transparent areas do not turn black."""
    a = alpha.astype(np.float32)[..., None] / 255.0
    return (color.astype(np.float32) * a + 255.0 * (1.0 - a) + 0.5).astype(np.uint8)


def _read_dpi(data: bytes) -> float | None:
    try:
        dpi = Image.open(io.BytesIO(data)).info.get("dpi")
    except Exception:
        return None
    if not dpi:
        return None
    value = float(dpi[0])
    return value if 30 <= value <= 2400 else None  # out-of-range values are junk metadata
