"""Local OCR with Tesseract: setup, orientation and recognition.

One Tesseract pass produces at the same time:
- a PDF with only the invisible text layer (`textonly_pdf=1`, the same "sandwich" renderer OCRmyPDF
  uses), later overlaid on the image page;
- the TSV with every word, its box and its confidence, for the result and the `document` message.
"""

from __future__ import annotations

import csv
import io
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pytesseract

from . import image
from .errors import ScannerError

WINDOWS_PATHS = (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")
LOCAL_TESSDATA = Path(__file__).resolve().parents[2] / "tessdata"   # scanner/pdf/tessdata (ignored by git)
OSD_CONFIDENCE = 2.5    # OSD on the text crop: trusted from here (measured failure at 1.96)
SIDEWAYS_BELOW = 8      # words read upright and upside down below which 90/270 are tried too
OCR_DPI = 300.0         # resolution Tesseract reads best at
MAX_UPSCALE = 3.0       # do not upscale more (cost ~ factor^2 and it invents no detail)
MAX_OCR_MEGAPIXELS = 8.5   # largest image Tesseract reads: a whole 4K frame (8.3 MP) is not upscaled
ROTATIONS = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}

MIN_WORDS = 8           # fewer than this on a page = the first pass probably did not segment well
SPARSE_MAX_WORDS = 60   # with this many words read it is a page of text, not a poster or a card: the sparse
                        # pass (psm 11) is not tried. On blurry photos of full letters it cost ~10 s and was
                        # never chosen (real scans held in the hand, 2026-11-22)
DOUBTFUL_CONFIDENCE = 70.0  # mean confidence (0-100) below which the sparse-text pass is tried
RELIABLE_CONFIDENCE = 60.0
MIN_COVERAGE = 0.6      # fraction of the page letters that should fall inside recognised words


@dataclass
class Tesseract:
    executable: str
    tessdata: str | None
    version: str
    languages: list[str]


@dataclass
class OcrResult:
    text_pdf: bytes                  # PDF with only the invisible text layer
    blocks: list[dict]               # contract TextBlock: id, text, box (normalised), confidence
    words: int
    mean_confidence: float | None    # 0..1, weighted by word length
    warnings: list[str] = field(default_factory=list)
    psm: int = 3                     # segmentation mode used (3 = page, 6 = block, 11 = sparse text)
    passes: int = 1
    words_detail: list[dict] = field(default_factory=list)  # each word: text, conf (0-100), line, x, y, w, h in [0, 1]


def prepare_tesseract() -> Tesseract:
    """Finds Tesseract and its languages. Raises ScannerError('ocr_unavailable') if it is missing."""
    executable = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if not executable:
        executable = next((p for p in WINDOWS_PATHS if Path(p).is_file()), None)
    if not executable:
        raise ScannerError("ocr_unavailable", "Tesseract not found (install it or set TESSERACT_CMD)")

    if not os.environ.get("TESSDATA_PREFIX") and LOCAL_TESSDATA.is_dir():
        os.environ["TESSDATA_PREFIX"] = str(LOCAL_TESSDATA)
    pytesseract.pytesseract.tesseract_cmd = executable
    try:
        version = str(pytesseract.get_tesseract_version())
        languages = sorted(pytesseract.get_languages(config=""))
    except Exception as e:  # broken executable, no permissions...
        raise ScannerError("ocr_unavailable", f"Tesseract does not respond: {e}") from e
    return Tesseract(executable, os.environ.get("TESSDATA_PREFIX"), version, languages)


def resolve_languages(requested: str, available: list[str]) -> tuple[str, list[str]]:
    """Filters 'spa+cat+eng' to the installed ones. Returns (string for Tesseract, warnings)."""
    wanted = [lang for lang in requested.split("+") if lang]
    valid = [lang for lang in wanted if lang in available]
    warnings = [f"language_not_installed:{lang}" for lang in wanted if lang not in available]
    if not valid:
        raise ScannerError("ocr_no_languages", f"None of the requested languages is installed: {requested}")
    return "+".join(valid), warnings


def orient(img: np.ndarray) -> tuple[np.ndarray, int, float | None]:
    """Rotates the page 90/180/270 degrees if needed. Returns (image, degrees, OSD confidence).

    1. OSD on native-resolution crops of the areas with most letters (several: when the sheet was not
       found, the area with most "letters" can be a drink can or a keyboard); if one is confident
       (>= OSD_CONFIDENCE), follow it (~0.5 s per crop).
    2. Otherwise, actually read the whole page, scaled so its letters are ~28 px, upright and upside
       down; the sideways orientations only if neither reads anything. The most words wins.

    Measured with the N3 benchmark (24 MX Brio photos of 3 printed letters, half of them upside down):
    the old step 2 read one 800 px crop, at native size and confidence >= 80, and gave 0-2 words in
    every orientation for grey, blurry or far text, so pages stayed upside down (2-10 % of their words
    read). Reading the whole page picked the right side 9 of 9 times (e.g. 85 words vs 8), in ~1-1.7 s.
    """
    crops = _text_crops(img, 800)
    if not crops:
        return img, 0, None  # no letters to look at
    osd_degrees, confidence = 0, None
    for crop in crops:
        try:
            osd = pytesseract.image_to_osd(_to_rgb(crop), output_type=pytesseract.Output.DICT, timeout=30)
        except Exception:
            continue  # little text in this crop
        degrees, conf = int(osd.get("rotate", 0)) % 360, float(osd.get("orientation_conf", 0.0))
        if confidence is None or conf > confidence:
            osd_degrees, confidence = degrees, conf
        if conf >= OSD_CONFIDENCE:
            return rotate(img, degrees), degrees, conf

    page = _reading_size(img)
    counts = _words_by_rotation(page, (0, 180))
    if max(counts.values()) < SIDEWAYS_BELOW:
        counts.update(_words_by_rotation(page, (90, 270)))
    best = max(counts, key=lambda d: (counts[d], d == 0, d == osd_degrees))
    if best == 0 or counts[best] <= counts[0]:
        return img, 0, confidence
    return rotate(img, best), best, confidence


def _words_by_rotation(page: np.ndarray, rotations: tuple[int, ...]) -> dict[int, int]:
    """Confident words read in each rotation, in parallel Tesseract processes (same result as one after
    the other, half the time: a sheet held in the hand spent ~5 s here, real scans 2026-11-22)."""
    with ThreadPoolExecutor(max_workers=len(rotations)) as pool:
        futures = {d: pool.submit(_confident_words, rotate(page, d), 50) for d in rotations}
        return {d: f.result() for d, f in futures.items()}


def _reading_size(img: np.ndarray, target: float = 28.0, cap: int = 2200) -> np.ndarray:
    """The page scaled so its median letter is ~`target` px tall, with a longer side of at most `cap`."""
    gray, scale = image.gray_1600(img)
    _, _, stats, _ = cv2.connectedComponentsWithStats((image.letter_mask(gray) > 0).astype(np.uint8), connectivity=8)
    heights = stats[1:, cv2.CC_STAT_HEIGHT]
    letter = float(np.median(heights)) / scale if heights.size else target
    f = min(target / max(1.0, letter), cap / max(img.shape[:2]))
    interp = cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC
    return cv2.resize(img, None, fx=f, fy=f, interpolation=interp)


def rotate(img: np.ndarray, degrees: int) -> np.ndarray:
    return img if degrees == 0 else cv2.rotate(img, ROTATIONS[degrees])


def _text_crop(img: np.ndarray, side: int = 1000) -> np.ndarray | None:
    """Square crop, at native resolution, of the area with most letters (fast and legible to read)."""
    gray, scale = image.gray_1600(img)
    side = min(side, *img.shape[:2])
    k = max(3, int(side * scale))
    density = cv2.boxFilter(image.letter_mask(gray), -1, (k, k))
    if float(density.max()) < 0.005:
        return None
    y, x = np.unravel_index(int(np.argmax(density)), density.shape)
    y0 = int(np.clip(y / scale - side / 2, 0, img.shape[0] - side))
    x0 = int(np.clip(x / scale - side / 2, 0, img.shape[1] - side))
    return img[y0:y0 + side, x0:x0 + side]


def _text_crops(img: np.ndarray, side: int = 1000, count: int = 3) -> list[np.ndarray]:
    """Up to `count` square crops, at native resolution, of the areas with most letters, apart from
    each other (each one blanks its surroundings before looking for the next)."""
    gray, scale = image.gray_1600(img)
    side = min(side, *img.shape[:2])
    k = max(3, int(side * scale))
    density = cv2.boxFilter(image.letter_mask(gray), -1, (k, k))
    crops = []
    for _ in range(count):
        if float(density.max()) < 0.005:
            break
        y, x = np.unravel_index(int(np.argmax(density)), density.shape)
        y0 = int(np.clip(y / scale - side / 2, 0, img.shape[0] - side))
        x0 = int(np.clip(x / scale - side / 2, 0, img.shape[1] - side))
        crops.append(img[y0:y0 + side, x0:x0 + side])
        density[max(0, y - k):y + k, max(0, x - k):x + k] = 0
    return crops


def _confident_words(img: np.ndarray, min_conf: float = 60.0) -> int:
    """Words of 3+ letters read with fair confidence (English is enough: same alphabet). Only to compare
    orientations. The contrast is stretched first: grey, blurry camera text (a far sheet) gave 1-2 words
    at >= 80 in every orientation (N3 benchmark), so the page stayed upside down."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    lo, hi = np.percentile(gray, (2, 98))
    if hi - lo > 10:
        gray = np.clip((gray.astype(np.float32) - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)
    try:
        d = pytesseract.image_to_data(gray, lang="eng", config="--psm 6",
                                      output_type=pytesseract.Output.DICT, timeout=3)
    except Exception:
        return 0
    return sum(1 for w, c in zip(d["text"], d["conf"])
               if float(c) >= min_conf and sum(ch.isalpha() for ch in str(w)) >= 3)


def recognize(img: np.ndarray, languages: str, dpi: float, level: str = "line", timeout: int = 180) -> OcrResult:
    """OCR with Tesseract: invisible text PDF + TSV of words.

    - If the page has a low resolution, Tesseract reads an upscaled copy up to ~OCR_DPI (it reads much
      better at 300 DPI). The text layer has the same size in points: the PDF keeps the original image.
    - Page segmentation (psm 3) and block segmentation (psm 6) run at the same time in two Tesseract
      processes: psm 3 is the right one for letters and forms, but in photos with lines that are not
      quite straight it skips whole paragraphs (measured: 205 vs 282 reliable words), and then psm 6 is
      used. In parallel it takes as long as the slowest (measured on a 4K letter: 7.4 s serial -> 5.0 s).
    - Sparse text (psm 11) only if little was read, or it was doubtful: posters, cards, phone screens.
    """
    factor = min(MAX_UPSCALE, max(1.0, OCR_DPI / dpi))
    # Size cap: with no detected sheet the DPI is a guess, and upscaling a whole 4K frame only costs
    # time (measured with the MX Brio: 12 MP and two passes -> 4.5 s of OCR).
    factor = min(factor, max(1.0, (MAX_OCR_MEGAPIXELS * 1e6 / (img.shape[0] * img.shape[1])) ** 0.5))
    if factor > 1.05:
        img = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        dpi *= factor

    with ThreadPoolExecutor(max_workers=2) as pool:
        f3 = pool.submit(_ocr_pass, img, languages, dpi, 3, timeout)
        f6 = pool.submit(_ocr_pass, img, languages, dpi, 6, timeout)
        pdf, words = f3.result()
        pdf6, words6 = f6.result()
    psm, passes = 3, 2
    coverage = _coverage(img, words)
    if coverage is not None and coverage < MIN_COVERAGE and _reliable_chars(words6) > _reliable_chars(words):
        pdf, words, psm = pdf6, words6, 6
        coverage = _coverage(img, words)
    if _doubtful(words) and len(words) < SPARSE_MAX_WORDS:
        pdf11, words11 = _ocr_pass(img, languages, dpi, 11, timeout)
        passes = 3
        if _reliable_chars(words11) > _reliable_chars(words):
            pdf, words, psm = pdf11, words11, 11
            coverage = _coverage(img, words)

    height, width = img.shape[:2]
    blocks = _group(words, width, height, level)
    total = sum(len(w["text"]) for w in words)
    mean = sum(w["conf"] * len(w["text"]) for w in words) / total / 100.0 if total else None
    warnings = [] if words else ["ocr_no_text"]
    if psm == 11:
        warnings.append("ocr_sparse_text")
    if words and coverage is not None and coverage < MIN_COVERAGE:
        warnings.append("ocr_low_coverage")
    detail = [{"text": w["text"], "conf": w["conf"], "line": list(w["key"]),
               "x": w["x"] / width, "y": w["y"] / height, "w": w["w"] / width, "h": w["h"] / height} for w in words]
    return OcrResult(pdf, blocks, len(words), None if mean is None else round(mean, 3), warnings,
                     psm=psm, passes=passes, words_detail=detail)


def _doubtful(words: list[dict]) -> bool:
    if len(words) < MIN_WORDS:
        return True
    total = sum(len(w["text"]) for w in words)
    return sum(w["conf"] * len(w["text"]) for w in words) / total < DOUBTFUL_CONFIDENCE


def _coverage(img: np.ndarray, words: list[dict]) -> float | None:
    """Fraction of the page letters (letter-sized blobs) that fall inside some recognised word.
    None if the page has almost no letters."""
    gray, scale = image.gray_1600(img)
    letters = image.letter_mask(gray) > 0
    total = int(letters.sum())
    if total < 200:
        return None
    inside = np.zeros_like(letters)
    for w in words:
        x0, y0 = int(w["x"] * scale) - 1, int(w["y"] * scale) - 1
        inside[max(0, y0):y0 + int(w["h"] * scale) + 3, max(0, x0):x0 + int(w["w"] * scale) + 3] = True
    return float((letters & inside).sum()) / total


def _reliable_chars(words: list[dict]) -> int:
    """Characters in high-confidence words: what a pass really contributes."""
    return sum(len(w["text"]) for w in words if w["conf"] >= RELIABLE_CONFIDENCE)


def _ocr_pass(img: np.ndarray, languages: str, dpi: float, psm: int, timeout: int) -> tuple[bytes, list[dict]]:
    with tempfile.TemporaryDirectory(prefix="scanner_ocr_") as tmp:
        source, base = Path(tmp, "page.png"), Path(tmp, "out")
        if not cv2.imwrite(str(source), img):  # lossless PNG: Tesseract reads exactly the page
            raise ScannerError("ocr_failed", "Could not prepare the image for Tesseract")
        command = [pytesseract.pytesseract.tesseract_cmd, str(source), str(base), "-l", languages,
                   "--dpi", str(int(round(dpi))), "--psm", str(psm), "-c", "textonly_pdf=1", "pdf", "tsv"]
        try:
            proc = subprocess.run(command, capture_output=True, timeout=timeout, env=os.environ.copy())
        except subprocess.TimeoutExpired as e:
            raise ScannerError("ocr_timeout", f"Tesseract took longer than {timeout} s") from e
        except OSError as e:
            raise ScannerError("ocr_unavailable", f"Could not run Tesseract: {e}") from e
        pdf_path, tsv_path = base.with_suffix(".pdf"), base.with_suffix(".tsv")
        if proc.returncode != 0 or not pdf_path.is_file() or not tsv_path.is_file():
            detail = proc.stderr.decode("utf-8", "replace").strip()[-500:]
            raise ScannerError("ocr_failed", f"Tesseract failed (code {proc.returncode}): {detail}")
        return pdf_path.read_bytes(), _read_tsv(tsv_path.read_text(encoding="utf-8", errors="replace"))


def _read_tsv(tsv: str) -> list[dict]:
    words = []
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
        text = (row.get("text") or "").strip()
        try:
            conf = float(row.get("conf", -1))
        except ValueError:
            continue
        if row.get("level") != "5" or not text or conf < 0:
            continue
        if "\ufffd" in text or not any(c.isalnum() for c in text):
            continue  # noise: only punctuation or undecodable characters
        words.append({
            "key": (int(row["block_num"]), int(row["par_num"]), int(row["line_num"])),
            "text": text, "conf": conf,
            "x": int(row["left"]), "y": int(row["top"]), "w": int(row["width"]), "h": int(row["height"]),
        })
    return words


def _group(words: list[dict], width: int, height: int, level: str) -> list[dict]:
    """Groups words into lines or paragraphs with a box normalised to [0, 1] (like TextBlock)."""
    if level not in ("line", "paragraph"):
        raise ValueError("level must be 'line' or 'paragraph'")
    groups: dict[tuple, list[dict]] = {}
    for w in words:
        key = w["key"] if level == "line" else w["key"][:2]
        groups.setdefault(key, []).append(w)

    blocks = []
    for i, (_, ws) in enumerate(sorted(groups.items()), start=1):
        x0, y0 = min(w["x"] for w in ws), min(w["y"] for w in ws)
        x1, y1 = max(w["x"] + w["w"] for w in ws), max(w["y"] + w["h"] for w in ws)
        letters = sum(len(w["text"]) for w in ws)
        conf = sum(w["conf"] * len(w["text"]) for w in ws) / letters / 100.0
        blocks.append({
            "id": f"b{i}",
            "text": " ".join(w["text"] for w in ws),
            "box": {"x": round(x0 / width, 4), "y": round(y0 / height, 4),
                    "w": round((x1 - x0) / width, 4), "h": round((y1 - y0) / height, 4)},
            "confidence": round(min(1.0, max(0.0, conf)), 3),
        })
    return blocks


def _to_rgb(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
