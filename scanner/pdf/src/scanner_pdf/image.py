"""Conservative page enhancement and quality measurement.

Rule: nothing destructive by default. Lighting is corrected with a limited gain (it does not erase
large dark areas such as photos, stamps or filled boxes) and black-and-white is only applied when
explicitly requested.
"""

from __future__ import annotations

import cv2
import numpy as np

MODES = ("color", "gray", "bw")
PAPER_WHITE = 245.0        # level the paper is brought to (not 255, so detail is not burnt)
MAX_GAIN = 1.8             # enough for normal shadows; large black areas stay dark
MIN_GAIN = 0.85
INK_TARGET = 40.0          # grey the typical ink is brought to (not 0: strokes are not flattened)
MAX_INK_GAIN = 3.0         # more gain amplifies noise and shadows (measured with real captures)
MAX_PAPER_GAIN = 2.0       # cap when whitening the paper locally: a large dark fill is not erased
SHARPEN_AMOUNT = 0.5       # unsharp mask amount
LIGHT_PAPER_MEDIAN = 150.0 # page grey median above which it counts as light paper


def light_paper(img: np.ndarray) -> bool:
    """Is the page light paper (where evening out the light helps)? Dark posters, coloured cards or a
    whole scene are not: brightening them washes them out (seen with real captures)."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = 400.0 / max(gray.shape[:2])
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return float(np.median(small)) >= LIGHT_PAPER_MEDIAN


def gray_1600(img: np.ndarray) -> tuple[np.ndarray, float]:
    """Grey image downscaled to a 1600 px longer side (for fast analysis) and the scale used."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = 1600.0 / max(gray.shape[:2])
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def letter_mask(gray: np.ndarray) -> np.ndarray:
    """Pixels of dark letter-sized blobs (on a ~1600 px grey image). Keys, a mouse and shadows
    (large blobs) are left out."""
    b = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    height, width, area = stats[:, cv2.CC_STAT_HEIGHT], stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_AREA]
    letter = (height >= 3) & (height <= 40) & (width <= 60) & (area >= 4) & (area <= 600)
    letter[0] = False
    return letter[labels].astype(np.float32)


def enhance_document(img: np.ndarray) -> tuple[np.ndarray, dict]:
    """Scanner look for light paper: even white paper, near-black ink and gentle sharpening.

    1. Local paper white: the paper white is estimated at a scale of ~3 letter heights (local maximum
       per channel) and the image is divided by it. This removes paper blotches (uneven light, camera
       compression) that a plain global stretch turned into a grey mottle (measured with real MX Brio
       letters). The gain is capped: a large dark fill (logo) is not erased.
    2. Ink: the typical letter grey is brought to INK_TARGET (stretch with the paper fixed at 255).
    3. Paper without residual colour and a gentle unsharp mask.
    """
    g, scale = gray_1600(img)
    letters = letter_mask(g)
    if letters.sum() < 200:
        return img, {"applied": False, "reason": "no text"}
    letter_height = _letter_height(letters) / scale                   # in original image pixels

    # 1. Local paper white, computed on a downscaled copy (fast) and upscaled.
    reduction = min(1.0, 12.0 / max(letter_height, 1.0))             # ~12 px letters in the copy
    small = cv2.resize(img, None, fx=reduction, fy=reduction, interpolation=cv2.INTER_AREA)
    k = max(7, int(3 * letter_height * reduction) | 1)
    background = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    background = cv2.GaussianBlur(background, (0, 0), k / 2.0)
    background = cv2.resize(background, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    gain = np.clip(255.0 / np.maximum(background, 1.0), 1.0, MAX_PAPER_GAIN)
    f = img.astype(np.float32) * gain

    # 2. Ink: stretch with the paper (255) fixed.
    gray_norm = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
    letters_full = cv2.resize(letters, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    ink = float(np.median(gray_norm[letters_full]))
    if 255.0 - ink < 15:
        return img, {"applied": False, "reason": "no contrast", "ink": round(ink)}
    ink_gain = float(np.clip((255.0 - INK_TARGET) / (255.0 - ink), 1.0, MAX_INK_GAIN))
    f = 255.0 - (255.0 - f) * ink_gain

    # 3. Paper and shadows without colour; dark ink (blue signature, stamp) keeps its colour.
    lum = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    paperness = np.clip((lum - 140.0) / 80.0, 0.0, 1.0)[..., None]
    f = f * (1.0 - paperness) + lum[..., None] * paperness
    f = f + (255.0 - f) * np.clip((f - 205.0) / 35.0, 0.0, 1.0)      # near white -> white (smooth paper, no halos)
    sigma = max(0.8, letter_height / 25.0)
    f = f + SHARPEN_AMOUNT * (f - cv2.GaussianBlur(f, (0, 0), sigma))
    return np.clip(f + 0.5, 0, 255).astype(np.uint8), {"applied": True, "ink": round(ink),
                                                        "ink_gain": round(ink_gain, 2),
                                                        "letter_height_px": round(letter_height, 1)}


def _letter_height(letters: np.ndarray) -> float:
    """Median height (px) of the letter-sized blobs."""
    _, _, stats, _ = cv2.connectedComponentsWithStats((letters > 0).astype(np.uint8), connectivity=8)
    heights = stats[1:, cv2.CC_STAT_HEIGHT]
    return float(np.median(heights)) if len(heights) else 10.0


def correct_lighting(img: np.ndarray) -> np.ndarray:
    """Evens out the paper lighting (shadows, gradients, colour cast) channel by channel."""
    height, width = img.shape[:2]
    scale = 512.0 / max(height, width)
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    # Background = paper without ink: dilation erases dark strokes, the median smooths.
    side = max(7, int(min(small.shape[:2]) / 20) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (side, side))
    background = cv2.dilate(small, kernel)
    background = cv2.medianBlur(background, side * 2 + 1)  # side is odd and small (512 px image)
    background = cv2.GaussianBlur(background, (0, 0), side / 2.0)
    background = cv2.resize(background, (width, height), interpolation=cv2.INTER_LINEAR).astype(np.float32)

    gain = np.clip(PAPER_WHITE / np.maximum(background, 1.0), MIN_GAIN, MAX_GAIN)
    return np.clip(img.astype(np.float32) * gain + 0.5, 0, 255).astype(np.uint8)


def apply_mode(img: np.ndarray, mode: str) -> np.ndarray:
    """color: unchanged; gray: luminance; bw: adaptive binarisation (only when requested)."""
    if mode == "color":
        return img
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if mode == "gray":
        return gray
    if mode == "bw":
        block = max(15, int(min(gray.shape) / 30) | 1)
        return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 12)
    raise ValueError(f"Unknown mode: {mode!r} (valid: {', '.join(MODES)})")


def sharpness(img: np.ndarray) -> float:
    """Variance of the Laplacian on a 1000 px wide copy (comparable across sizes)."""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = 1000.0 / gray.shape[1]
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def evaluate_quality(raw_page: np.ndarray, *, area_fraction: float | None, touches_border: bool,
                     max_angle: float | None, effective_dpi: float) -> dict:
    """Score 0..1 and issues with the FrameIssue vocabulary (api/openapi.yaml).

    The thresholds are initial heuristics; calibrate them with real camera samples.
    """
    gray = cv2.cvtColor(raw_page, cv2.COLOR_BGR2GRAY)
    measures = {
        "sharpness": round(sharpness(gray), 1),
        "mean_brightness": round(float(gray.mean()), 1),
        "saturated_fraction": round(float((gray >= 250).mean()), 4),
        "paper_brightness": round(float(np.percentile(gray, 90)), 1),
        "effective_dpi": round(effective_dpi, 1),
    }
    issues: list[str] = []
    penalty = 0.0
    if measures["sharpness"] < 60:
        issues.append("blurry"); penalty += 0.35
    if measures["mean_brightness"] < 90:
        issues.append("dark"); penalty += 0.25
    if measures["saturated_fraction"] > 0.01 and measures["paper_brightness"] < 240:
        issues.append("glare"); penalty += 0.15  # burnt spots on a paper that is not pure white
    if touches_border:
        issues.append("cropped"); penalty += 0.2
    if max_angle is not None and max_angle > 25:
        issues.append("tilted"); penalty += 0.1
    if (area_fraction is not None and area_fraction < 0.3) or effective_dpi < 120:
        issues.append("too_far"); penalty += 0.2
    return {"score": round(max(0.0, 1.0 - penalty), 2), "issues": issues, "measures": measures}
