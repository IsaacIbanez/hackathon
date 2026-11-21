"""Digital document: a blank page with the real text written on it and the images in place.

From the rectified, enhanced page and the OCR words (with their boxes), a PDF is created as if the
document had been made on a computer. Two ways:
- `digitalize_layout`: from the layout of a vision model (vision.py), fitted to the local OCR geometry.
  The default when there is an API key.
- `digitalize`: only with the local OCR (no network). Fallback without a key or without connection.

An OCR mistake written as text would be a visible mistake in the document. In the local mode,
illegible words are not rewritten: they go as an image crop (plus invisible text so they can be
found). The scanned PDF is still the faithful reference; this is an extra option.
"""

from __future__ import annotations

import difflib
import io
import statistics
import unicodedata

import cv2
import numpy as np
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

FONT, BOLD_FONT = "Helvetica", "Helvetica-Bold"
CAP_HEIGHT = 0.718           # Helvetica: capital and ascender height / font size
X_HEIGHT = 0.523             # Helvetica: height of "x" / font size
DESCENDER = 0.207            # Helvetica: how far a "p" goes below the baseline / font size
TEXT_CONFIDENCE = 50.0       # below this the word is illegible: it goes as an image crop
SAFE_CONFIDENCE = 75.0       # between the two: written as text but flagged for review
PAGE_MARGIN = 0.05           # minimum right margin (fraction of the width) when a line is allowed to grow
INK_THRESHOLD = 170          # grey (enhanced page: paper 255, ink ~40) below which there is "something"
DESCENDERS = set("gjpqyçQ,;()[]{}|/")
ASCENDERS = set("bdfhkltß0123456789ÁÉÍÓÚÀÈÒÏÜÑÇ'\"!?%&@#")


def applicable(page: np.ndarray) -> bool:
    """Only light paper: on a dark poster or a coloured card a "blank page" makes no sense."""
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY) if page.ndim == 3 else page
    return float(np.percentile(gray[::4, ::4], 50)) >= 200


# ---------------------------------------------------------------- local OCR only

def digitalize(page: np.ndarray, words: list[dict], dpi: float, title: str | None = None,
               min_confidence: float = TEXT_CONFIDENCE) -> tuple[bytes, dict]:
    """Digital PDF of one page from the local OCR. `words`: OcrResult.words_detail (normalised boxes)."""
    if page.ndim == 2:
        page = cv2.cvtColor(page, cv2.COLOR_GRAY2BGR)
    height, width = page.shape[:2]
    s = 72.0 / dpi                                  # points per pixel
    width_pt, height_pt = width * s, height * s
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)

    boxes = [_box_px(w, width, height) for w in words]
    # Only words on paper: anything "read" in the background showing at an edge (keys...) is not the document.
    on_paper = [i for i in range(len(words)) if _on_paper(gray, boxes[i])]
    text = [i for i in on_paper if words[i]["conf"] >= min_confidence]
    illegible = [i for i in on_paper if words[i]["conf"] < min_confidence]
    to_review = [i for i in text if words[i]["conf"] < SAFE_CONFIDENCE]

    lines = _physical_lines(words, boxes, text)
    # Noise: a lone 1-2 character "word" on its own line (keys showing, specks).
    lone = {line[0] for line in lines if len(line) == 1 and len(words[line[0]]["text"]) <= 2}
    lines = [line for line in lines if line[0] not in lone]
    text = [i for i in text if i not in lone]
    to_review = [i for i in to_review if i not in lone]
    text_height = float(np.median([boxes[i][3] - boxes[i][1] for i in text])) if text else 10.0
    regions, remaining = _image_regions(gray, [boxes[i] for i in text], text_height)
    mean_ink = _mean_ink(gray, [boxes[i] for i in text])

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(width_pt, height_pt), pageCompression=1)
    if title:
        c.setTitle(title)
    c.setCreator("scanner_pdf (LauzHack 2026) - digital document")

    # 1. Images (signature, logos, stamps, rules, illegible words): only their ink, on white.
    for x0, y0, x1, y1 in regions:
        mask = remaining[y0:y1, x0:x1] > 0
        piece = np.full_like(page[y0:y1, x0:x1], 255)
        piece[mask] = page[y0:y1, x0:x1][mask]
        crop = Image.fromarray(cv2.cvtColor(piece, cv2.COLOR_BGR2RGB))
        c.drawImage(ImageReader(crop), x0 * s, height_pt - y1 * s, width=(x1 - x0) * s, height=(y1 - y0) * s)

    # 2. Text: every physical line straight and in one piece (like a document made on a computer), at
    #    the height of its centre (so lines do not overlap even if they fan out in the photo). One font
    #    size for the page except clearly larger lines (headings); a line with a large gap (columns,
    #    tabs) is split into segments.
    line_sizes = [_line_font_size(line, words, boxes, s) for line in lines]
    common = float(np.median(line_sizes)) if line_sizes else 10.0
    sizes = []
    for line, line_size in zip(lines, line_sizes):
        # Own size only for reliable lines (headings): with bad OCR boxes sizes came out absurd.
        reliable = len(line) >= 2 and float(np.mean([words[i]["conf"] for i in line])) >= 80
        size = line_size if reliable and abs(line_size - common) > 0.25 * common else common
        size = round(size * 2) / 2
        sizes.append(size)
        baseline = _line_baseline(line, words, boxes, size / s)
        center_x = (boxes[line[0]][0] + boxes[line[-1]][2]) / 2
        base_y = baseline(center_x)
        density = float(np.median([_ink_density(gray, boxes[i]) for i in line]))
        font = BOLD_FONT if mean_ink and density > 1.35 * mean_ink else FONT
        color = _ink_color(page, gray, _union([boxes[i] for i in line]))
        for segment in _segments(line, boxes, size / s):
            x0, x1 = boxes[segment[0]][0], boxes[segment[-1]][2]
            string = " ".join(words[i]["text"] for i in segment)
            _write(c, string, font, size, x0 * s, height_pt - base_y * s, (x1 - x0) * s, color)

    # 3. Illegible words: visible in their crop; also invisible text so they can be found and copied.
    for i in illegible:
        x0, y0, x1, y1 = boxes[i]
        size = max(4.0, (y1 - y0) * s / 0.9)
        _write(c, words[i]["text"], FONT, size, x0 * s, height_pt - (y1 - 0.2 * (y1 - y0)) * s,
               (x1 - x0) * s, (0.0, 0.0, 0.0), invisible=True)

    c.showPage()
    c.save()
    info = {
        "text_words": len(text),
        "image_words": len(illegible),
        "image_regions": len(regions),
        "lines": len(lines),
        "font_size_pt": round(statistics.median(sizes), 1) if sizes else None,
        # Written as text but with medium confidence: worth checking against the scan.
        "to_review": [{"text": words[i]["text"], "conf": round(words[i]["conf"]),
                       "box": {k: round(words[i][k], 4) for k in ("x", "y", "w", "h")}} for i in to_review],
    }
    return buf.getvalue(), info


def _write(c, string: str, font: str, size: float, x: float, y: float, width: float,
           color: tuple, invisible: bool = False) -> None:
    """Writes `string` from (x, y) filling `width` pt: stretches the letters a little and the rest in the spaces."""
    natural = stringWidth(string, font, size) or 1.0
    scale = float(np.clip(width / natural, 0.85, 1.15))
    spaces = string.count(" ")
    extra = (width - natural * scale) / spaces if spaces else 0.0
    t = c.beginText()
    if invisible:
        t.setTextRenderMode(3)
        scale, extra = float(np.clip(width / natural, 0.2, 3.0)), 0.0
    t.setFont(font, size)
    t.setHorizScale(scale * 100.0)
    if extra > 0:
        t.setWordSpace(extra / scale)
    t.setFillColorRGB(*color)
    t.setTextOrigin(x, y)
    t.textOut(string)
    c.drawText(t)


def _line_baseline(line: list[int], words: list[dict], boxes: list, size_px: float):
    """Baseline of the line as a straight line y = a*x + b (fitted on the foot of its words)."""
    xs, ys = [], []
    for i in line:
        x0, _, x1, y1 = boxes[i]
        drop = DESCENDER * size_px if set(words[i]["text"]) & DESCENDERS else 0.0
        xs.append((x0 + x1) / 2)
        ys.append(y1 - drop)
    if len(xs) >= 3 and max(xs) - min(xs) > size_px:
        a, b = np.polyfit(xs, ys, 1)
        if abs(a) < 0.1:                                   # < ~6 degrees: plausible tilt
            return lambda x: a * x + b
    y = float(np.median(ys))
    return lambda x: y


def _segments(line: list[int], boxes: list, size_px: float) -> list[list[int]]:
    """Splits the line where there is a gap much larger than a space (columns, tabs)."""
    segments, current = [], [line[0]]
    for a, b in zip(line, line[1:]):
        if boxes[b][0] - boxes[a][2] > 1.5 * size_px:
            segments.append(current)
            current = []
        current.append(b)
    segments.append(current)
    return segments


def _union(boxes: list) -> tuple[int, int, int, int]:
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


# ---------------------------------------------------------------- measurements on the page

def _box_px(w: dict, width: int, height: int) -> tuple[int, int, int, int]:
    x0, y0 = int(round(w["x"] * width)), int(round(w["y"] * height))
    return x0, y0, x0 + max(1, int(round(w["w"] * width))), y0 + max(1, int(round(w["h"] * height)))


def _physical_lines(words: list[dict], boxes: list, indices: list[int]) -> list[list[int]]:
    """Groups words into physical lines by geometry, chaining each word to the line whose continuation
    (last baseline + slope) passes through it.

    Tesseract's line numbering is not used: with a slightly curved or fanned sheet it splits a physical
    line into pieces and mixes words of neighbouring lines (measured with a real letter).
    """
    def baseline(i):
        x0, y0, x1, y1 = boxes[i]
        return y1 - (0.21 * (y1 - y0) if set(words[i]["text"]) & DESCENDERS else 0.0)

    chains: list[dict] = []   # {"ids": [...], "x1": end, "base": y, "slope": slope, "h": height, "x0": first centre}
    for i in sorted(indices, key=lambda i: boxes[i][0]):
        x0, y0, x1, y1 = boxes[i]
        h = max(1.0, y1 - y0)
        best, best_d = None, 0.45 * h
        for chain in chains:
            gap = x0 - chain["x1"]
            if gap < -0.3 * h or gap > 12 * max(h, chain["h"]):
                continue
            expected = chain["base"] + chain["slope"] * (x0 - chain["x1"])
            d = abs(baseline(i) - expected)
            if d < best_d:
                best, best_d = chain, d
        if best is None:
            chains.append({"ids": [i], "x1": x1, "base": baseline(i), "slope": 0.0, "h": h, "x0": (x0 + x1) / 2})
            continue
        best["ids"].append(i)
        dx = (x0 + x1) / 2 - best["x0"]
        if len(best["ids"]) >= 2 and dx > 0:
            ids = best["ids"]
            xs = [(boxes[j][0] + boxes[j][2]) / 2 for j in ids]
            ys = [baseline(j) for j in ids]
            slope = float(np.polyfit(xs, ys, 1)[0]) if len(ids) >= 3 else (ys[-1] - ys[0]) / max(1.0, xs[-1] - xs[0])
            best["slope"] = float(np.clip(slope, -0.1, 0.1))
        best["x1"], best["base"], best["h"] = x1, baseline(i), (best["h"] + h) / 2
    lines = [sorted(chain["ids"], key=lambda i: boxes[i][0]) for chain in chains]
    return sorted(lines, key=lambda line: (min(boxes[i][1] for i in line), boxes[line[0]][0]))


def _line_font_size(line: list[int], words: list[dict], boxes: list, s: float) -> float:
    """Font size (pt) of a line, with Helvetica metrics: from the height of the words with capitals or
    ascenders (cap height) or, if there are none, from the x-height."""
    no_desc = [i for i in line if not (set(words[i]["text"]) & DESCENDERS)]
    tall = [i for i in no_desc if any(ch.isupper() or ch in ASCENDERS for ch in words[i]["text"])]
    if tall:
        size = float(np.median([boxes[i][3] - boxes[i][1] for i in tall])) * s / CAP_HEIGHT
    elif no_desc:
        size = float(np.median([boxes[i][3] - boxes[i][1] for i in no_desc])) * s / X_HEIGHT
    else:
        size = float(np.median([boxes[i][3] - boxes[i][1] for i in line])) * s / 0.93
    return max(4.0, round(size * 2) / 2)   # to the half point: lines of the same paragraph get the same size


def _ink_density(gray: np.ndarray, box: tuple) -> float:
    x0, y0, x1, y1 = box
    area = gray[y0:y1, x0:x1]
    return float((area < 128).mean()) if area.size else 0.0


def _mean_ink(gray: np.ndarray, boxes: list) -> float | None:
    densities = [_ink_density(gray, b) for b in boxes]
    return float(np.median(densities)) if densities else None


def _ink_color(page: np.ndarray, gray: np.ndarray, box: tuple) -> tuple[float, float, float]:
    """Black unless the ink has a clear colour (blue pen, red stamp)."""
    x0, y0, x1, y1 = box
    area, g = page[y0:y1, x0:x1], gray[y0:y1, x0:x1]
    ink = area[g < 128]
    if len(ink) < 5:
        return 0.0, 0.0, 0.0
    b, gr, r = (float(v) for v in np.median(ink, axis=0))
    if max(r, gr, b) - min(r, gr, b) < 45:
        return 0.0, 0.0, 0.0
    return r / 255.0, gr / 255.0, b / 255.0


def _on_paper(gray: np.ndarray, box: tuple) -> bool:
    """The surroundings of the word are light paper (not the dark background showing at an edge)."""
    x0, y0, x1, y1 = box
    m = max(2, (y1 - y0) // 2)
    area = gray[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m]
    return area.size > 0 and float(np.percentile(area, 90)) >= 200


def _image_regions(gray: np.ndarray, text_boxes: list, text_height: float
                   ) -> tuple[list[tuple[int, int, int, int]], np.ndarray]:
    """Areas with ink that is not written text (signature, logo, stamp, QR, rules, illegible words).

    Small leftovers attached to text lines (pieces of letters outside the OCR box) are dropped: they
    came out as duplicated fragments above the word already written.
    """
    height, width = gray.shape
    ink = (gray < INK_THRESHOLD).astype(np.uint8)
    text_band = np.zeros_like(ink)
    for x0, y0, x1, y1 in text_boxes:                      # what is already written as text, out
        m = max(2, int(0.35 * (y1 - y0)))
        ink[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m] = 0
        text_band[max(0, y0 - m):y1 + m, max(0, x0 - 3 * m):x1 + 3 * m] = 1
    k = max(3, int(0.012 * width))
    joined = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, _, stats, _ = cv2.connectedComponentsWithStats(joined, connectivity=8)
    margin = max(2, int(0.004 * width))
    minimum = max(6, int(0.006 * width))
    regions = []
    for j in range(1, n):
        x, y, w, h, area = stats[j]
        if w < minimum and h < minimum or area < 25:
            continue                                        # specks of noise
        if x <= 1 or y <= 1 or x + w >= width - 1 or y + h >= height - 1:
            continue                                        # touching the edge: background leftovers, not the document
        if h < 1.8 * text_height and w < 6 * text_height and text_band[y:y + h, x:x + w].mean() > 0.5:
            continue                                        # leftover of a word already written, not an image
        regions.append([max(0, x - margin), max(0, y - margin), min(width, x + w + margin), min(height, y + h + margin)])
    remaining = cv2.dilate(ink, np.ones((3, 3), np.uint8))          # its ink, with a softened edge
    return [tuple(r) for r in _merge(regions)], remaining


def _merge(boxes: list[list[int]]) -> list[list[int]]:
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del boxes[j]
                    changed = True
                    break
            if changed:
                break
    return boxes


# ---------------------------------------------------------------- vision-model layout (vision.py)

def _norm(word: str) -> str:
    """Lower case, no accents or punctuation (to compare model and OCR words)."""
    no_accents = "".join(ch for ch in unicodedata.normalize("NFD", word) if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in no_accents.lower() if ch.isalnum())


def _similar(a: str, pool: set[str]) -> bool:
    if a in pool:
        return True
    return len(a) >= 4 and any(abs(len(a) - len(b)) <= 2 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8
                               for b in pool)


def agreement(layout: dict, words: list[dict]) -> dict:
    """How much the model text agrees with the local OCR (detects invented or omitted text).

    - ocr_in_model: of the reliable OCR words (conf >= 70, 3+ letters), the fraction found in the model;
    - unconfirmed: model words the OCR did not see anywhere (check them against the scan).
    """
    model = [_norm(w) for b in layout["blocks"] if b["type"] == "text" for line in b["lines"] for w in line.split()]
    model_set = {w for w in model if w}
    ocr = [_norm(w["text"]) for w in words if w["conf"] >= 70]
    ocr = [w for w in ocr if len(w) >= 3]
    ocr_set = {_norm(w["text"]) for w in words}
    in_model = sum(_similar(w, model_set) for w in ocr) / len(ocr) if ocr else None
    unconfirmed = sorted({w for w in model_set if len(w) >= 4 and not _similar(w, ocr_set)})
    return {"ocr_in_model": None if in_model is None else round(in_model, 3),
            "model_words": len(model), "unconfirmed": unconfirmed[:80]}


def digitalize_layout(page: np.ndarray, layout: dict, words: list[dict], dpi: float,
                      title: str | None = None) -> tuple[bytes, dict]:
    """Digital PDF from the model layout, with the geometry fitted to the local OCR.

    1. Text: every block is placed with the OCR words that match its text (precise geometry).
    2. Images (signature, logo, stamp, photo, QR): the page rectangle, with its light strokes and its
       colour, without the neighbouring text (already written) and with clean white paper.
    3. Uniform typography: one body size (headings may be larger, never smaller) and common line spacing.
    4. Vertical flow: each element is placed relative to the one above; normal gaps between paragraphs
       are evened out and large ones (before a signature) are kept. Nothing overlaps.
    """
    if page.ndim == 2:
        page = cv2.cvtColor(page, cv2.COLOR_GRAY2BGR)
    height, width = page.shape[:2]
    s = 72.0 / dpi
    width_pt, height_pt = width * s, height * s
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    ocr_boxes = [_box_px(w, width, height) for w in words]
    letter_height = float(np.median([b[3] - b[1] for b in ocr_boxes])) if ocr_boxes else 0.012 * height

    texts, matched = _text_blocks(layout, words, ocr_boxes, width, height, letter_height, s)
    _separate(texts)
    body = _typography(texts, s)
    # To blank the text inside an image the OCR words are used, not the blocks: a block box can overlap
    # the signature (measured with a real layout) and erased almost all of it.
    word_boxes = [ocr_boxes[i] for i, w in enumerate(words) if w["conf"] >= 50 and len(_norm(w["text"])) >= 2]
    images = _image_blocks(layout, page, gray, word_boxes, letter_height)

    for t in texts:
        n = len(t["lines"])
        t["height_px"] = ((n - 1) * t["line_spacing"] + (CAP_HEIGHT + DESCENDER) * t["size"]) / s
    _flow(texts + images, body / s, height)

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(width_pt, height_pt), pageCompression=1)
    if title:
        c.setTitle(title)
    c.setCreator("scanner_pdf (LauzHack 2026) - digital document")
    for im in images:
        x0, _, x1, _ = im["box"]
        c.drawImage(ImageReader(Image.fromarray(cv2.cvtColor(im["crop"], cv2.COLOR_BGR2RGB))),
                    x0 * s, height_pt - (im["y"] + im["height_px"]) * s, width=(x1 - x0) * s, height=im["height_px"] * s)
    sizes = [_compose_block(c, t, s, height_pt, page, gray) for t in texts]
    c.showPage()
    c.save()
    info = {
        "method": "model",
        "text_blocks": len(texts),
        "ocr_matched_blocks": matched,
        "images": [im["description"] for im in images],
        "image_regions": len(images),
        "text_words": sum(len(line.split()) for t in texts for line in t["lines"]),
        "image_words": 0,
        "font_size_pt": round(statistics.median(sizes), 1) if sizes else None,
    }
    return buf.getvalue(), info


def _text_blocks(layout: dict, words: list[dict], ocr_boxes: list, width: int, height: int,
                 letter_height: float, s: float) -> tuple[list[dict], int]:
    """Box of each text block: union of the OCR words that match its text.

    Only words of 3+ letters within half a letter height of the model box (short common words of the
    neighbouring line stretched the box). Vertically the OCR rules; horizontally the box is never
    narrower than the model's (if only a few words match, the OCR box falls short).
    """
    used: set[int] = set()
    texts, matched = [], 0
    for order, b in enumerate(layout["blocks"]):
        if b["type"] != "text":
            continue
        x0, y0, x1, y1 = b["bbox"][0] * width, b["bbox"][1] * height, b["bbox"][2] * width, b["bbox"][3] * height
        own = {w for w in (_norm(w) for line in b["lines"] for w in line.split()) if len(w) >= 3}

        def search(mx: float, my: float) -> list[int]:
            found = []
            for i, (cx0, cy0, cx1, cy1) in enumerate(ocr_boxes):
                cx, cy = (cx0 + cx1) / 2, (cy0 + cy1) / 2
                if i in used or not (x0 - mx <= cx <= x1 + mx and y0 - my <= cy <= y1 + my):
                    continue
                w = _norm(words[i]["text"])
                if len(w) >= 3 and _similar(w, own):
                    found.append(i)
            return found

        hits = search(0.02 * width, 0.5 * letter_height)
        if not (hits and len(hits) >= max(1, 0.3 * min(len(own), 20))):
            # The model sometimes places a block a few % higher or lower: wider window but stricter,
            # and for each word, the occurrence closest to where the model said.
            nearest: dict[str, int] = {}
            center = (y0 + y1) / 2
            for i in search(0.05 * width, 0.06 * height):
                w = _norm(words[i]["text"])
                cy = (ocr_boxes[i][1] + ocr_boxes[i][3]) / 2
                if w not in nearest or abs(cy - center) < abs((ocr_boxes[nearest[w]][1] + ocr_boxes[nearest[w]][3]) / 2 - center):
                    nearest[w] = i
            hits = list(nearest.values()) if len(nearest) >= max(1, 0.6 * len(own)) else []
        ocr_size = None
        if hits and len(hits) >= max(1, 0.3 * min(len(own), 20)):
            used.update(hits)
            rx0, ry0, rx1, ry1 = _union([ocr_boxes[i] for i in hits])
            box = [min(rx0, x0), ry0, max(rx1, x1), ry1]
            ocr_size = _size_from_words([words[i]["text"] for i in hits], [ocr_boxes[i] for i in hits], s)
            matched += 1
        else:
            box = [x0, y0, x1, y1]
        texts.append({**b, "box": [float(v) for v in box], "ocr_size": ocr_size, "order": order})
    return texts, matched


def _image_blocks(layout: dict, page: np.ndarray, gray: np.ndarray, text_boxes: list,
                  letter_height: float) -> list[dict]:
    """Crop of each image marked by the model (signature, logo, stamp, photo, QR).

    The rectangle fitted to its strokes is taken (light and coloured ones included: a crop of only the
    dark ink lost light pen strokes and the coloured parts of a logo), the neighbouring text inside it is
    blanked (it is written separately) and near-white paper becomes white.
    """
    height, width = gray.shape
    hsv = cv2.cvtColor(page, cv2.COLOR_BGR2HSV)
    something = ((gray < 225) | (hsv[..., 1] > 60)).astype(np.uint8)
    text_mask = np.zeros_like(something)
    m_txt = max(2, int(0.3 * letter_height))
    for x0, y0, x1, y1 in text_boxes:
        text_mask[max(0, y0 - m_txt):y1 + m_txt, max(0, x0 - m_txt):x1 + m_txt] = 1
    something[text_mask > 0] = 0

    images = []
    for order, b in enumerate(layout["blocks"]):
        if b["type"] != "image":
            continue
        mx, my = int(0.02 * width), int(0.015 * height)
        zx0, zy0 = max(0, int(b["bbox"][0] * width) - mx), max(0, int(b["bbox"][1] * height) - my)
        zx1, zy1 = min(width, int(b["bbox"][2] * width) + mx), min(height, int(b["bbox"][3] * height) + my)
        zone = something[zy0:zy1, zx0:zx1]
        k = max(3, int(0.01 * width))
        joined = cv2.morphologyEx(zone, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
        n_comp, labels, stats, centers = cv2.connectedComponentsWithStats(joined, connectivity=8)
        bx0, by0 = b["bbox"][0] * width - zx0, b["bbox"][1] * height - zy0
        bx1, by1 = b["bbox"][2] * width - zx0, b["bbox"][3] * height - zy0
        # Only what has its centre in the model zone (what grazes the margin belongs to the neighbour).
        inside = [j for j in range(1, n_comp) if bx0 <= centers[j][0] <= bx1 and by0 <= centers[j][1] <= by1
                  and stats[j][cv2.CC_STAT_AREA] >= 15]
        if not inside:
            continue
        sel = np.isin(labels, inside) & (zone > 0)
        ys, xs = np.nonzero(sel)
        if len(xs) < 20:
            continue
        m = max(2, int(0.004 * width))
        x0, y0 = max(0, zx0 + int(xs.min()) - m), max(0, zy0 + int(ys.min()) - m)
        x1, y1 = min(width, zx0 + int(xs.max()) + m + 1), min(height, zy0 + int(ys.max()) + m + 1)
        crop = page[y0:y1, x0:x1].copy()
        crop[text_mask[y0:y1, x0:x1] > 0] = 255                           # the text is written separately
        paper = (gray[y0:y1, x0:x1] >= 225) & (hsv[y0:y1, x0:x1, 1] <= 60)
        crop[paper] = 255                                                 # clean white background
        images.append({"type": "image", "order": order, "box": [float(x0), float(y0), float(x1), float(y1)],
                       "height_px": float(y1 - y0), "crop": crop, "description": b.get("description", "other")})
    return images


def _size_from_words(texts: list[str], boxes: list, s: float) -> float | None:
    """Font size (pt) from the height of the words, with Helvetica metrics."""
    sizes = []
    for text, (x0, y0, x1, y1) in zip(texts, boxes):
        h = (y1 - y0) * s
        if set(text) & DESCENDERS and any(ch.isupper() or ch in ASCENDERS for ch in text):
            sizes.append(h / (CAP_HEIGHT + DESCENDER))
        elif any(ch.isupper() or ch in ASCENDERS for ch in text):
            sizes.append(h / CAP_HEIGHT)
        elif not set(text) & DESCENDERS:
            sizes.append(h / X_HEIGHT)
    return float(np.median(sizes)) if sizes else None


def _typography(texts: list[dict], s: float) -> float:
    """Font size and line spacing consistent across the document. Returns the body size (pt).

    - body size: the one that makes the longest line of each paragraph fill the width of its box
      (document median). The OCR width is precise; the letter height comes out inflated in blurry or
      fanned photos (measured: 12 pt by height vs ~10.5 by width on a real letter);
    - a block is only larger if it is a heading (bold or centred, 1-2 lines) and its width confirms it;
    - line spacing: median line-spacing/size ratio measured on the multi-line paragraphs.
    """
    if not texts:
        return 10.0
    for t in texts:
        font = BOLD_FONT if t["bold"] else FONT
        width_pt = (t["box"][2] - t["box"][0]) * s
        widest = max(stringWidth(line, font, 1.0) for line in t["lines"]) or 1.0
        t["width_size"] = width_pt / widest
        n = len(t["lines"])
        height_pt = (t["box"][3] - t["box"][1]) * s
        t["height_size"] = t.get("ocr_size") or height_pt / ((n - 1) * 1.2 + CAP_HEIGHT + DESCENDER)
    paragraphs = [t for t in texts if len(t["lines"]) >= 2]
    justified = [t for t in paragraphs if t["align"] == "justify"]
    reference = justified or paragraphs
    if reference:
        body = float(np.median([t["width_size"] for t in reference]))
    else:
        body = float(np.median([t["height_size"] for t in texts]))
    ratios = []
    for t in paragraphs:
        n = len(t["lines"])
        height_pt = (t["box"][3] - t["box"][1]) * s
        ratios.append((height_pt - (CAP_HEIGHT + DESCENDER) * body) / ((n - 1) * body))
    ratio = float(np.clip(np.median(ratios), 1.1, 1.5)) if ratios else 1.2
    for t in texts:
        heading = (t["bold"] or t["align"] == "center") and len(t["lines"]) <= 2
        t["size"] = t["width_size"] if heading and t["width_size"] > 1.1 * body else body
        t["size"] = min(t["size"], 2.5 * body)
        t["line_spacing"] = ratio * t["size"]
    return body


def _flow(elements: list[dict], size_px: float, page_height: int) -> None:
    """Vertical position ("y", px) of each element: below the element above it in the same column, with
    a gap evened out to the document's typical gap unless it is clearly larger.

    The order is the model's reading order (reliable), not the measured height: a block that could not be
    fitted to the OCR may be displaced (measured: "Signat," ended up below the signature). Gaps are
    measured between centres (robust to boxes inflated by a fanned sheet).
    """
    order = sorted(elements, key=lambda e: e.get("order", 0))
    center = {id(e): (e["box"][1] + e["box"][3]) / 2 for e in order}
    previous, gaps = {}, {}
    for k, e in enumerate(order):
        above = [p for p in order[:k] if p["box"][0] < e["box"][2] and e["box"][0] < p["box"][2]]
        if not above:
            continue
        p = above[-1]                                    # the last earlier one in reading order sharing the column
        previous[id(e)] = p
        gaps[id(e)] = (center[id(e)] - center[id(p)]) - (e["height_px"] + p["height_px"]) / 2
    between_texts = [g for e in order if id(e) in gaps and e["type"] == "text" and previous[id(e)]["type"] == "text"
                     for g in [gaps[id(e)]] if g > 0]
    typical = float(np.median(between_texts)) if between_texts else 0.8 * size_px
    typical = float(np.clip(typical, 0.4 * size_px, 2.0 * size_px))
    for e in order:
        if id(e) not in previous:
            e["y"] = center[id(e)] - e["height_px"] / 2
            continue
        p, g = previous[id(e)], gaps[id(e)]
        if e["type"] == "text" and p["type"] == "text":
            gap = typical if g < 3.0 * typical else g                 # between paragraphs: even, except big jumps
        else:
            gap = g                                                   # next to an image: the measured one
        e["y"] = p["y"] + p["height_px"] + max(gap, 0.25 * size_px)
    # If the flow goes past the bottom, everything is compressed proportionally upwards.
    bottom = max(e["y"] + e["height_px"] for e in order)
    limit = page_height * 0.985
    if bottom > limit:
        start = min(e["y"] for e in order)
        factor = (limit - start) / (bottom - start)
        for e in order:
            e["y"] = start + (e["y"] - start) * factor


def _separate(texts: list[dict]) -> None:
    """If two text boxes overlap (vertically, in crossing columns), the difference is split."""
    texts.sort(key=lambda t: t["box"][1])
    for a, b in zip(texts, texts[1:]):
        ba, bb = a["box"], b["box"]
        if ba[0] < bb[2] and bb[0] < ba[2] and ba[3] > bb[1]:
            middle = (ba[3] + bb[1]) / 2
            ba[3], bb[1] = max(ba[1] + 2, middle - 1), min(bb[3] - 2, middle + 1)


def _compose_block(c, block: dict, s: float, height_pt: float, page: np.ndarray, gray: np.ndarray) -> float:
    """Writes the block lines from its flow position; returns the size used (pt)."""
    x0, _, x1, _ = block["box"]
    y0 = block.get("y", block["box"][1])
    width_pt = (x1 - x0) * s
    lines = block["lines"]
    n = len(lines)
    font = BOLD_FONT if block["bold"] else FONT
    size, spacing = block["size"], block["line_spacing"]
    widest = max(stringWidth(line, font, size) for line in lines) or 1.0
    if block["align"] in ("left", "center") and widest > width_pt:
        # Text that does not fit its box is allowed to grow (to the right, or both ways) up to the page
        # margin before being squeezed (the box can be narrow when the OCR saw few words).
        page_width = c._pagesize[0]
        available = page_width * (1 - PAGE_MARGIN) - x0 * s
        if block["align"] == "center":
            mid = (x0 + x1) / 2 * s
            available = 2 * min(mid, page_width - mid) * (1 - PAGE_MARGIN)
            x0 = (mid - min(widest, available) / 2) / s
        width_pt = min(widest, available)
    if widest > width_pt * 1.02:                          # still does not fit: a somewhat smaller font
        factor = max(0.75, width_pt / widest)
        size, spacing = size * factor, spacing * factor
    size = max(4.0, min(size, 72.0))
    color = _ink_color(page, gray, tuple(int(round(v)) for v in block["box"]))
    for k, line in enumerate(lines):
        base = height_pt - (y0 * s + CAP_HEIGHT * size + k * spacing)
        line_width = stringWidth(line, font, size)
        scale = min(1.0, width_pt / line_width) if line_width else 1.0
        x = x0 * s
        extra = 0.0
        if block["align"] == "center":
            x += (width_pt - line_width * scale) / 2
        elif block["align"] == "right":
            x += width_pt - line_width * scale
        elif block["align"] == "justify" and k < n - 1 and line.count(" ") and line_width > 0.7 * width_pt:
            extra = (width_pt - line_width * scale) / line.count(" ")
        t = c.beginText()
        t.setFont(font, size)
        t.setHorizScale(scale * 100.0)
        if extra > 0:
            t.setWordSpace(extra / scale)
        t.setFillColorRGB(*color)
        t.setTextOrigin(x, base)
        t.textOut(line)
        c.drawText(t)
    return size
