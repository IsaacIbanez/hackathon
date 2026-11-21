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
UPRIGHT_WORDS = 15      # confident words in the crop to accept the orientation as upright
OCR_DPI = 300.0         # resolution Tesseract reads best at
MAX_UPSCALE = 3.0       # do not upscale more (cost ~ factor^2 and it invents no detail)
MAX_OCR_MEGAPIXELS = 8.5   # largest image Tesseract reads: a whole 4K frame (8.3 MP) is not upscaled
ROTATIONS = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}

MIN_WORDS = 8           # fewer than this on a page = the first pass probably did not segment well
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

    Measured with real captures (portrait sheet photographed in landscape, letter and poster upside
    down): OSD on the whole downscaled page fails a lot; on a native-resolution crop of the area with
    most letters it is right with high confidence (8-15) in ~0.5 s. So:
    1. OSD on that crop; if it is confident (>= OSD_CONFIDENCE), follow it.
    2. If in doubt, actually read: first as is (usually it is already upright and it stops there);
       if it does not read well, the OSD suggestion, 180 and the rest, stopping as soon as one clearly wins.
    """
    crop = _text_crop(img, 800)
    if crop is None:
        return img, 0, None  # no letters to look at
    osd_degrees, confidence = 0, None
    try:
        osd = pytesseract.image_to_osd(_to_rgb(crop), output_type=pytesseract.Output.DICT, timeout=30)
        osd_degrees, confidence = int(osd.get("rotate", 0)) % 360, float(osd.get("orientation_conf", 0.0))
    except Exception:
        pass  # little text in the crop: decide by reading
    if confidence is not None and confidence >= OSD_CONFIDENCE:
        return rotate(img, osd_degrees), osd_degrees, confidence

    upright = _confident_words(crop)
    if upright >= UPRIGHT_WORDS:
        return img, 0, confidence
    best, best_n = 0, upright
    tried = 0
    for degrees in dict.fromkeys([osd_degrees, 180, 90, 270]):
        if degrees == 0:
            continue
        n = _confident_words(rotate(crop, degrees))
        tried += 1
        if n > best_n:
            best, best_n = degrees, n
        if best and best_n >= max(UPRIGHT_WORDS, 2 * upright + 3):
            break
        if tried >= 2 and best_n <= 2:
            break  # unreadable in every orientation (blurry photo): do not spend more time
    if best and best_n >= 2 * upright + 3:
        return rotate(img, best), best, confidence
    return img, 0, confidence


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


def _confident_words(img: np.ndarray) -> int:
    """Words of 3+ letters read with high confidence (English is enough: same alphabet). Only to compare."""
    try:
        d = pytesseract.image_to_data(_to_rgb(img), lang="eng", config="--psm 6",
                                      output_type=pytesseract.Output.DICT, timeout=2)
    except Exception:
        return 0
    return sum(1 for w, c in zip(d["text"], d["conf"])
               if float(c) >= 80 and sum(ch.isalpha() for ch in str(w)) >= 3)


def recognize(img: np.ndarray, languages: str, dpi: float, level: str = "line", timeout: int = 180) -> OcrResult:
    """OCR with Tesseract: invisible text PDF + TSV of words.

    - If the page has a low resolution, Tesseract reads an upscaled copy up to ~OCR_DPI (it reads much
      better at 300 DPI). The text layer has the same size in points: the PDF keeps the original image.
    - Page segmentation (psm 3) and block segmentation (psm 6) run at the same time in two Tesseract
      processes: psm 3 is the right one for letters and forms, but in photos with lines that are not
      quite straight it skips whole paragraphs (measured: 205 vs 282 reliable words), and then psm 6 is
      used. In parallel it takes as long as the slowest (measured on a 4K letter: 7.4 s serial -> 5.0 s).
    - Sparse text (psm 11) only if almost nothing was read: posters, cards, phone screens.
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
    if _doubtful(words):
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
