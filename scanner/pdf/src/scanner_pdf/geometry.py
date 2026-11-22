"""Page detection, perspective correction and physical page size."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import image

ANALYSIS_SIDE = 1000       # px: detection works on a downscaled copy
MIN_AREA = 0.08            # the sheet must fill at least 8 % of the frame (if less, too_far warning)
MIN_CONFIDENCE = 0.65      # below this the page is not cropped (better uncropped than badly cropped).
                           # Real sheets: >= 0.71 in tests; bad candidates in real captures: 0.58
MIN_EDGE_SUPPORT = 0.40    # fraction of the perimeter on real edges. Phone held in hand: 0.75;
                           # casual quadrilaterals (hand + background) in real captures: 0.30-0.33
BORDER_MARGIN = 0.01       # corner within 1 % of the frame = sheet possibly cut off
MIN_CONTRAST = 25.0        # grey levels between the sheet and its surroundings
MIN_SIDE_STEP = 18.0       # minimum contrast across each side (grey levels)
MIN_CONTENT = 0.002        # fraction of letter pixels inside: empty desk ~0, letter with small text > 0.005
CANNY_LOW, CANNY_HIGH = 40, 120   # fixed thresholds: thresholds derived from the median brightness were
                           # far too high on a white desk and the document outline disappeared
MAX_DARK_HOLE = 0.15       # share of a light quadrilateral covered by large dark areas. A sheet only has
                           # letters and thin lines; a quad that took in the dark jacket next to the sheet
                           # had ~45 % (N3 benchmark, MX Brio): cropping it read 2-6 % of the words
MAX_SIDE_RATIO = 1.75      # longer / shorter opposite side; a sheet tilted ~45 degrees gives ~1.7.
                           # More = a clipped shape (e.g. a panel cut by a drawing or a hand)
WEBCAM_DIAGONAL_FOV = 78.0 # degrees; focal length assumed when the perspective does not allow estimating it

# Paper sizes (width, height) in mm, portrait.
PAPER_SIZES_MM = {"A4": (210.0, 297.0), "Letter": (215.9, 279.4), "A5": (148.0, 210.0), "Legal": (215.9, 355.6)}
PAPER_TOLERANCE = 0.035          # within 3.5 % of a standard aspect ratio, snap to that paper
UNDETECTED_PAPER_TOLERANCE = 0.015  # with no detected sheet, snap only if it almost matches (already cropped)


@dataclass
class Detection:
    found: bool
    confidence: float
    corners: np.ndarray | None    # 4x2 float32 in original image px: top-left, top-right, bottom-right, bottom-left
    method: str
    touches_border: bool = False
    area_fraction: float = 0.0

    def to_dict(self) -> dict:
        return {
            "found": self.found,
            "confidence": round(self.confidence, 3),
            "corners": None if self.corners is None else [[round(float(x), 1), round(float(y), 1)] for x, y in self.corners],
            "method": self.method,
            "touches_border": self.touches_border,
            "area_fraction": round(self.area_fraction, 3),
        }


# ---------------------------------------------------------------- detection

def detect_page(img: np.ndarray) -> Detection:
    """Finds the sheet quadrilateral from three candidate sources and keeps the best reliable one."""
    height, width = img.shape[:2]
    scale = ANALYSIS_SIDE / max(height, width)
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img.copy()
    scale = min(scale, 1.0)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)

    canny = cv2.Canny(gray, CANNY_LOW, CANNY_HIGH)
    edges = cv2.dilate(canny, np.ones((3, 3), np.uint8), iterations=2)
    # The image frame counts as an edge: a document cut by the frame also closes its outline
    # (what is visible is cropped and flagged as "cropped").
    cv2.rectangle(edges, (0, 0), (edges.shape[1] - 1, edges.shape[0] - 1), 255, 2)
    # Letters: on the unblurred grey image (Gaussian blur erases small text).
    letters = image.letter_mask(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    candidates: list[tuple[float, np.ndarray, str]] = []
    sources = (("edges", _quads(edges)), ("threshold", _quads(_threshold_mask(gray))),
               ("lines", _line_quads(canny, edges)))
    for method, quads in sources:
        for quad in quads:
            score = _score(quad, gray, edges, letters)
            if score > 0:
                candidates.append((score, quad, method))

    if not candidates:
        return Detection(False, 0.0, None, "none")

    # Among reliable candidates the largest wins: a piece of the document (e.g. the area between two
    # rows of text) is always smaller than the whole document that contains it.
    reliable = [c for c in candidates if c[0] >= MIN_CONFIDENCE]
    if reliable:
        score, quad, method = max(reliable, key=lambda c: cv2.contourArea(c[1]))
    else:
        score, quad, method = max(candidates, key=lambda c: c[0])
    full_gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (0, 0), 1.0)
    corners = refine_corners(full_gray, order_corners(quad / scale))
    area = cv2.contourArea(corners.astype(np.float32)) / float(height * width)
    margin = BORDER_MARGIN * max(height, width)
    touches = bool(np.any(corners[:, 0] < margin) or np.any(corners[:, 0] > width - margin)
                   or np.any(corners[:, 1] < margin) or np.any(corners[:, 1] > height - margin))
    return Detection(score >= MIN_CONFIDENCE, float(score), corners, method, touches, float(area))


def _threshold_mask(gray: np.ndarray) -> np.ndarray:
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def _quads(mask: np.ndarray, maximum: int = 8) -> list[np.ndarray]:
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = mask.shape[0] * mask.shape[1]
    large = sorted((c for c in contours if cv2.contourArea(c) > MIN_AREA * image_area),
                   key=cv2.contourArea, reverse=True)[:maximum]
    quads = []
    for c in large:
        hull = cv2.convexHull(c)
        perimeter = cv2.arcLength(hull, True)
        for eps in (0.02, 0.03, 0.05):
            approx = cv2.approxPolyDP(hull, eps * perimeter, True)
            if len(approx) == 4:
                quads.append(approx.reshape(4, 2).astype(np.float32))
                break
    return quads


def _line_quads(canny: np.ndarray, edges: np.ndarray, per_group: int = 10, maximum: int = 30) -> list[np.ndarray]:
    """Quadrilaterals formed by long straight lines (Hough): two near-horizontal x two near-vertical.

    This is what works for documents held in the hand: fingers break the closed outline, but the
    paper edges are still long straight lines. Candidates are ranked by (vectorised) edge support and
    only the best go through the full scoring.
    """
    height, width = canny.shape
    side = max(height, width)
    segs = cv2.HoughLinesP(canny, 1, np.pi / 180, 60, minLineLength=int(0.08 * side), maxLineGap=int(0.02 * side))
    if segs is None:
        return []
    lines: list[list[float]] = []   # [direction angle in [0, pi), rho, accumulated length]
    for x1, y1, x2, y2 in segs.reshape(-1, 4).astype(np.float64):
        ang = np.arctan2(y2 - y1, x2 - x1) % np.pi
        rho = -np.sin(ang) * x1 + np.cos(ang) * y1
        length = float(np.hypot(x2 - x1, y2 - y1))
        for line in lines:  # merge segments of the same line
            diff = abs(line[0] - ang)
            if min(diff, np.pi - diff) < np.radians(4):
                rho_c = rho if diff < np.pi / 2 else -rho
                if abs(line[1] - rho_c) < 0.015 * side:
                    line[2] += length
                    break
        else:
            lines.append([ang, rho, length])
    lines.sort(key=lambda line: -line[2])
    horizontal = [line for line in lines if min(line[0], np.pi - line[0]) < np.radians(45)][:per_group]
    vertical = [line for line in lines if min(line[0], np.pi - line[0]) >= np.radians(45)][:per_group]

    def intersect(r1, r2):
        a = np.array([[-np.sin(r1[0]), np.cos(r1[0])], [-np.sin(r2[0]), np.cos(r2[0])]])
        if abs(np.linalg.det(a)) < 1e-6:
            return None
        return np.linalg.solve(a, np.array([r1[1], r2[1]]))

    margin = 0.01 * side
    quads = []
    for i in range(len(horizontal)):
        for j in range(i + 1, len(horizontal)):
            for k in range(len(vertical)):
                for m in range(k + 1, len(vertical)):
                    pts = [intersect(horizontal[i], vertical[k]), intersect(horizontal[i], vertical[m]),
                           intersect(horizontal[j], vertical[m]), intersect(horizontal[j], vertical[k])]
                    if any(p is None for p in pts):
                        continue
                    q = np.array(pts, dtype=np.float32)
                    if (q[:, 0].min() < -margin or q[:, 1].min() < -margin
                            or q[:, 0].max() > width - 1 + margin or q[:, 1].max() > height - 1 + margin):
                        continue  # the line method only proposes whole documents inside the frame
                    q = order_corners(np.clip(q, 0, [width - 1, height - 1]))
                    if cv2.contourArea(q) < MIN_AREA * height * width:
                        continue
                    quads.append(q)
    if not quads:
        return []
    supports = [_fast_support(q, edges) for q in quads]
    order = np.argsort(supports)[::-1][:maximum]
    return [quads[i] for i in order if supports[i] >= MIN_EDGE_SUPPORT]


def _fast_support(q: np.ndarray, edges: np.ndarray, samples: int = 40) -> float:
    t = np.linspace(0.05, 0.95, samples, dtype=np.float32)[:, None]
    pts = np.concatenate([q[i] + (q[(i + 1) % 4] - q[i]) * t for i in range(4)]).round().astype(int)
    pts[:, 0] = pts[:, 0].clip(0, edges.shape[1] - 1)
    pts[:, 1] = pts[:, 1].clip(0, edges.shape[0] - 1)
    return float((edges[pts[:, 1], pts[:, 0]] > 0).mean())


def _score(quad: np.ndarray, gray: np.ndarray, edges: np.ndarray, letters: np.ndarray) -> float:
    """0..1: how much it looks like a sheet. 0 = rejected.

    Hard filters (measured with real captures) and then a weighted score:
    - edge support (20 %): fraction of the perimeter on real edges (not on the image frame);
    - contrast (10 %): the sheet stands out from its surroundings;
    - side step (25 %): contrast across the weakest side (a row of text inside a poster has none);
    - content (10 %): letters inside (rejects an empty piece of desk next to the document);
    - angles (20 %): a sheet in perspective has angles between ~55 and ~125 degrees;
    - size (15 %): from 25 % of the frame it counts as full.
    """
    if not cv2.isContourConvex(quad.reshape(-1, 1, 2).astype(np.int32)):
        return 0.0
    area = cv2.contourArea(quad) / float(gray.shape[0] * gray.shape[1])
    if area < MIN_AREA or area > 0.995:
        return 0.0  # > 99.5 %: it is the image frame itself, not a sheet
    contrast = _contrast(quad, gray)
    if contrast < MIN_CONTRAST:
        return 0.0
    q = order_corners(quad)
    cosines = []
    for i in range(4):
        a, b, c = q[i - 1], q[i], q[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cosines.append(abs(float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))))
    worst = max(cosines)         # 0 = right angle
    if worst > 0.6:              # some angle outside ~53..127 degrees: not a plausible sheet
        return 0.0
    sides = [float(np.linalg.norm(q[(i + 1) % 4] - q[i])) for i in range(4)]
    if min(sides) < 1 or max(max(sides[0], sides[2]) / min(sides[0], sides[2]),
                             max(sides[1], sides[3]) / min(sides[1], sides[3])) > MAX_SIDE_RATIO:
        return 0.0               # opposite sides too different: a clipped shape, not a sheet
    on_frame = [_on_frame(q[i], q[(i + 1) % 4], gray.shape) for i in range(4)]
    opposite = on_frame in ([True, False, True, False], [False, True, False, True])
    if sum(on_frame) >= 3 or (sum(on_frame) == 2 and not opposite):
        return 0.0               # a corner of the frame = a background region, not a document
    # Two opposite sides on the frame: a sheet taller (or wider) than the frame. Accepted only if the
    # other two sides are real, clear edges (stricter support and side step in this case).
    support = _edge_support(q, edges, skip=on_frame)
    if support < MIN_EDGE_SUPPORT:
        return 0.0
    if sum(on_frame) == 2 and support < 0.7:
        return 0.0
    step = _side_step(q, gray, skip=on_frame)
    if step < (2 * MIN_SIDE_STEP if sum(on_frame) == 2 else MIN_SIDE_STEP):
        return 0.0               # some side separates nothing (e.g. a row of text inside the document)
    content = _content(quad, letters)
    if content < MIN_CONTENT:
        return 0.0
    if _dark_hole(quad, gray) > MAX_DARK_HOLE:
        return 0.0               # a light sheet plus a piece of dark table or clothes next to it
    angles = 1.0 - max(0.0, worst - 0.2) / 0.4   # up to ~78/102 degrees scores in full
    size = min(1.0, area / 0.25)
    return float(0.20 * support + 0.10 * min(1.0, contrast / 80.0) + 0.25 * min(1.0, step / 60.0)
                 + 0.10 * min(1.0, content / 0.02) + 0.20 * angles + 0.15 * size)


def _side_step(q: np.ndarray, gray: np.ndarray, skip: list[bool] | None = None, samples: int = 30) -> float:
    """Contrast across the weakest side: |grey just inside - grey just outside|, median per side.

    This is what tells the real document edge (dark poster | white desk) from an inner line
    (a row of text: the same document on both sides).
    """
    center = q.mean(axis=0)
    step = max(3.0, 0.012 * max(gray.shape))
    gray = gray.astype(np.float32)
    t = np.linspace(0.1, 0.9, samples, dtype=np.float32)[:, None]
    steps = []
    for i in range(4):
        if skip and skip[i]:
            continue
        a, b = q[i], q[(i + 1) % 4]
        d = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-d[1], d[0]], dtype=np.float32)
        if np.dot(n, (a + b) / 2 - center) < 0:
            n = -n                                   # outward normal
        pts = a + (b - a) * t
        outside = [cv2.remap(gray, (pts[:, 0] + n[0] * k).reshape(1, -1), (pts[:, 1] + n[1] * k).reshape(1, -1),
                             cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for k in (step, 2 * step)]
        inside = [cv2.remap(gray, (pts[:, 0] - n[0] * k).reshape(1, -1), (pts[:, 1] - n[1] * k).reshape(1, -1),
                            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for k in (step, 2 * step)]
        steps.append(float(np.median(np.abs((outside[0] + outside[1]) / 2 - (inside[0] + inside[1]) / 2))))
    return min(steps) if steps else 0.0


def _content(quad: np.ndarray, letters: np.ndarray) -> float:
    """Fraction of letter pixels (image.letter_mask) inside the quadrilateral, without its outline.

    With Canny edges a letter with small grey text gave ~0 (measured with real MX Brio captures) and
    was rejected as an empty desk; letter-sized blobs do see it.
    """
    inside = np.zeros(letters.shape, np.uint8)
    cv2.fillConvexPoly(inside, quad.astype(np.int32), 255)
    side = max(3, int(0.02 * min(letters.shape)))
    inside = cv2.erode(inside, np.ones((side, side), np.uint8)) > 0
    n = int(inside.sum())
    return float(letters[inside].sum()) / n if n else 0.0


def _dark_hole(quad: np.ndarray, gray: np.ndarray) -> float:
    """Share of a light quadrilateral covered by large dark areas (letters and lines removed by an
    opening). 0 for dark quadrilaterals (a dark poster or a phone screen is all dark on purpose)."""
    inside = np.zeros(gray.shape, np.uint8)
    cv2.fillConvexPoly(inside, quad.astype(np.int32), 255)
    side = max(3, int(0.02 * min(gray.shape)))
    inside = cv2.erode(inside, np.ones((side, side), np.uint8)) > 0
    values = gray[inside]
    if values.size < 100:
        return 0.0
    light = float(np.percentile(values, 90))
    if light < 120 or float(np.median(values)) < 120:
        return 0.0               # a dark document (poster, screen), not a light sheet
    dark = ((gray < light * 0.55) & inside).astype(np.uint8)
    k = max(5, int(0.04 * min(gray.shape)))     # wider than any letter or line
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    return float(dark[inside].mean())


def text_region(img: np.ndarray, margin: float = 0.03) -> tuple[np.ndarray, list[int], float | None]:
    """When no sheet was found: the main block of text (the group with most letters, with a margin)
    and its resolution estimated from the letter height. Returns (crop, [x0, y0, x1, y1], dpi or None).

    OCR on a whole 4K frame read the cans, cables and keyboards around the paper, and could not
    upscale the small letters (size cap); the text block alone can be upscaled to ~300 DPI.
    """
    gray, scale = image.gray_1600(img)
    letters = (image.letter_mask(gray) > 0).astype(np.uint8)
    # Only letters on a light background (printed paper): the letter detector also fires on fleece,
    # hair or a crowd behind a sheet held in the hand (measured: the crop went to the jacket).
    background = cv2.dilate(gray, np.ones((15, 15), np.uint8))   # the paper around each letter
    letters &= (background >= max(100.0, 0.85 * float(np.percentile(background, 85)))).astype(np.uint8)
    if letters.sum() < 200:
        return img, [0, 0, img.shape[1], img.shape[0]], None
    # Already a page (a scan, a cropped photo): its border is paper as light as the paper around the
    # letters, so there is nothing around it to remove (the margins and the signature must stay).
    # A white desk is darker than the paper on it (measured: ~10 %).
    paper = float(np.median(background[letters > 0]))
    b = max(2, int(0.04 * min(gray.shape)))
    ring = np.concatenate([background[:b].ravel(), background[-b:].ravel(),
                           background[:, :b].ravel(), background[:, -b:].ravel()])
    if float(np.median(ring)) >= 0.95 * paper and float((ring >= 0.85 * paper).mean()) > 0.9:
        return img, [0, 0, img.shape[1], img.shape[0]], None
    k = max(9, int(0.03 * max(gray.shape)))
    blocks = cv2.morphologyEx(cv2.dilate(letters, np.ones((k // 3, k // 3), np.uint8)), cv2.MORPH_CLOSE,
                              np.ones((k, k), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(blocks, connectivity=8)
    if n <= 1:
        return img, [0, 0, img.shape[1], img.shape[0]], None
    counts = np.bincount(labels[letters > 0], minlength=n)
    counts[0] = 0
    # Every block with a fair share of the letters: a form is split into several blocks by its boxes.
    keep = np.flatnonzero(counts >= 0.15 * counts.max())
    x = int(stats[keep, 0].min())
    y = int(stats[keep, 1].min())
    w = int((stats[keep, 0] + stats[keep, 2]).max()) - x
    h = int((stats[keep, 1] + stats[keep, 3]).max()) - y
    m = margin * max(gray.shape)
    x0, y0 = int(max(0, (x - m) / scale)), int(max(0, (y - m) / scale))
    x1 = int(min(img.shape[1], (x + w + m) / scale))
    y1 = int(min(img.shape[0], (y + h + m) / scale))
    # Letter height -> DPI: the median letter blob (lower case and capitals of body text) is ~2 mm.
    _, _, cstats, _ = cv2.connectedComponentsWithStats((letters * np.isin(labels, keep)).astype(np.uint8), connectivity=8)
    heights = cstats[1:, cv2.CC_STAT_HEIGHT]
    dpi = None
    if heights.size >= 20:
        dpi = float(np.clip(np.median(heights) / scale / (2.0 / 25.4), 72.0, 400.0))
    return img[y0:y1, x0:x1], [x0, y0, x1, y1], dpi


def _contrast(quad: np.ndarray, gray: np.ndarray) -> float:
    """|median inside - median in an outer ring| in grey levels."""
    side = max(3, int(0.03 * min(gray.shape)))
    inside = np.zeros(gray.shape, np.uint8)
    cv2.fillConvexPoly(inside, quad.astype(np.int32), 255)
    outside = cv2.dilate(inside, np.ones((side, side), np.uint8)) & ~inside
    inside = cv2.erode(inside, np.ones((side, side), np.uint8))
    if cv2.countNonZero(outside) < 50 or cv2.countNonZero(inside) < 50:
        return 0.0
    return abs(float(np.median(gray[inside > 0])) - float(np.median(gray[outside > 0])))


def _on_frame(a: np.ndarray, b: np.ndarray, shape: tuple[int, int], tolerance: float = 4.0) -> bool:
    """Does side a-b run along an image border?"""
    height, width = shape[:2]
    return bool((a[0] < tolerance and b[0] < tolerance) or (a[1] < tolerance and b[1] < tolerance)
                or (a[0] > width - 1 - tolerance and b[0] > width - 1 - tolerance)
                or (a[1] > height - 1 - tolerance and b[1] > height - 1 - tolerance))


def _edge_support(q: np.ndarray, edges: np.ndarray, samples: int = 60, skip: list[bool] | None = None) -> float:
    """Fraction of perimeter points (corners excluded) that lie on a detected edge.

    Sides in `skip` (along the frame) do not count: the frame is no evidence of a document.
    """
    height, width = edges.shape
    hits = total = 0
    for i in range(4):
        if skip and skip[i]:
            continue
        a, b = q[i], q[(i + 1) % 4]
        for t in np.linspace(0.05, 0.95, samples):
            x, y = (a + (b - a) * t).round().astype(int)
            if 0 <= x < width and 0 <= y < height:
                total += 1
                hits += edges[y, x] > 0
    return hits / total if total else 0.0


def refine_corners(gray: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """Fits each side to the real edge (maximum perpendicular gradient) at full resolution.

    Detection works on a downscaled copy with dilated edges, which pushes the corners a few pixels
    outwards. Here the edge is searched along each side's normal, a robust line is fitted and the
    corners come from intersecting consecutive lines. If anything looks wrong, the original corner
    is kept.
    """
    radius = max(6.0, 0.012 * max(gray.shape))
    steps = np.arange(-radius, radius + 1.0)
    gray = gray.astype(np.float32)
    lines = []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        d = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-d[1], d[0]], dtype=np.float32)
        ts = np.linspace(0.1, 0.9, 40, dtype=np.float32)
        centers = a[None, :] + (b - a)[None, :] * ts[:, None]                       # (40, 2)
        samples = centers[:, None, :] + steps[None, :, None] * n[None, None, :]     # (40, P, 2)
        profile = cv2.remap(gray, samples[..., 0].astype(np.float32), samples[..., 1].astype(np.float32),
                            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        derivative = np.abs(np.gradient(profile, axis=1))
        best = derivative.argmax(axis=1)
        valid = derivative[np.arange(len(ts)), best] > 4.0          # edge with enough contrast
        if valid.sum() < 10:
            lines.append((a.astype(np.float64), d.astype(np.float64)))  # no visible edge (e.g. the frame):
            continue                                                      # keep the detected side
        points = samples[np.arange(len(ts)), best][valid]
        vx, vy, x0, y0 = cv2.fitLine(points.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))

    refined = []
    for i in range(4):
        (p1, v1), (p2, v2) = lines[i - 1], lines[i]   # previous side and the side starting at corner i
        m = np.array([v1, -v2]).T
        if abs(np.linalg.det(m)) < 1e-6:
            return corners
        s = np.linalg.solve(m, p2 - p1)
        refined.append(p1 + s[0] * v1)
    refined = np.array(refined, dtype=np.float32)
    if np.abs(refined - corners).max() > 2 * radius:
        return corners  # the fit went far away: do not trust it
    return refined


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Orders 4 points as top-left, top-right, bottom-right, bottom-left."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    pts = pts[np.argsort(angles)]               # clockwise starting roughly at the top-left
    start = int(np.argmin(pts.sum(axis=1)))     # top-left = smallest x + y
    return np.roll(pts, -start, axis=0)


# ---------------------------------------------------------------- perspective

def real_aspect_ratio(corners: np.ndarray, image_shape: tuple[int, int],
                      fov_diagonal: float = WEBCAM_DIAGONAL_FOV) -> float:
    """Real width/height of the sheet.

    Uses the camera model of Zhang and He (2007, "Whiteboard scanning and image enhancement"), which
    corrects perspective foreshortening. The focal length is estimated from the sheet itself; with
    one-point perspective (tilted around a single axis) it cannot be estimated and a typical webcam is
    assumed (WEBCAM_DIAGONAL_FOV). If everything fails, the ratio of the measured sides.
    """
    top_left, top_right, bottom_right, bottom_left = [np.array([p[0], p[1], 1.0]) for p in corners]
    width_img = (np.linalg.norm(top_right[:2] - top_left[:2]) + np.linalg.norm(bottom_right[:2] - bottom_left[:2])) / 2
    height_img = (np.linalg.norm(bottom_left[:2] - top_left[:2]) + np.linalg.norm(bottom_right[:2] - top_right[:2])) / 2
    affine = width_img / height_img

    u0, v0 = image_shape[1] / 2.0, image_shape[0] / 2.0
    m1, m2, m3, m4 = top_left, top_right, bottom_left, bottom_right
    with np.errstate(all="ignore"):
        k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
        k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
        n2 = k2 * m2 - m1
        n3 = k3 * m3 - m1
        if not (np.all(np.isfinite(n2)) and np.all(np.isfinite(n3))):
            return float(affine)

        focal = None
        # n2[2] and n3[2] ~ 0 along the direction without vanishing point; tolerance relative to pixel size.
        scale = max(np.linalg.norm(n2[:2]), np.linalg.norm(n3[:2]))
        if abs(n2[2]) * max(image_shape) > 0.02 * scale and abs(n3[2]) * max(image_shape) > 0.02 * scale:
            f2 = -((n2[0] - n2[2] * u0) * (n3[0] - n3[2] * u0)
                   + (n2[1] - n2[2] * v0) * (n3[1] - n3[2] * v0)) / (n2[2] * n3[2])
            diagonal = float(np.hypot(*image_shape))
            if np.isfinite(f2) and f2 > 0 and 0.3 * diagonal < np.sqrt(f2) < 5 * diagonal:
                focal = float(np.sqrt(f2))
        if focal is None:
            focal = float(np.hypot(*image_shape)) / (2 * np.tan(np.radians(fov_diagonal) / 2))

        a_inv = np.linalg.inv(np.array([[focal, 0, u0], [0, focal, v0], [0, 0, 1]]))
        w = a_inv.T @ a_inv
        real = float(np.sqrt((n2 @ w @ n2) / (n3 @ w @ n3)))
    if not np.isfinite(real) or not (0.5 * affine < real < 2.0 * affine):
        return float(affine)  # absurd estimate: do not trust it
    return real


def nearest_paper(aspect: float, tolerance: float = PAPER_TOLERANCE) -> str | None:
    """Name of the standard paper whose aspect ratio (portrait or landscape) matches, if any."""
    best, best_error = None, tolerance
    for name, (w, h) in PAPER_SIZES_MM.items():
        for p in (w / h, h / w):
            error = abs(aspect - p) / p
            if error < best_error:
                best, best_error = name, error
    return best


def rectify(img: np.ndarray, corners: np.ndarray, aspect: float, inner_crop: float = 0.0025) -> np.ndarray:
    """Corrects the perspective without losing resolution: output height is the longer vertical side."""
    top_left, top_right, bottom_right, bottom_left = corners
    height = max(np.linalg.norm(bottom_left - top_left), np.linalg.norm(bottom_right - top_right))
    measured_width = max(np.linalg.norm(top_right - top_left), np.linalg.norm(bottom_right - bottom_left))
    # Keep the side with more pixels and derive the other from the real aspect ratio.
    if measured_width / aspect > height:
        width, height = measured_width, measured_width / aspect
    else:
        width = height * aspect
    width, height = int(round(width)), int(round(height))

    target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    h = cv2.getPerspectiveTransform(corners.astype(np.float32), target)
    flat = cv2.warpPerspective(img, h, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    # Minimal inward crop so no line of background is left at the edges.
    dx, dy = int(round(width * inner_crop)), int(round(height * inner_crop))
    return flat[dy:height - dy, dx:width - dx] if dx and dy else flat


def fit_to_aspect(img: np.ndarray, aspect: float) -> np.ndarray:
    """Rescales one axis (never shrinks the longer side) so that width/height is exactly `aspect`."""
    height, width = img.shape[:2]
    if abs(width / height - aspect) / aspect < 1e-3:
        return img
    if width / height < aspect:
        new_size = (int(round(height * aspect)), height)
    else:
        new_size = (width, int(round(width / aspect)))
    return cv2.resize(img, new_size, interpolation=cv2.INTER_CUBIC)


def max_angle_deviation(corners: np.ndarray) -> float:
    """Largest deviation (degrees) from 90 of the quadrilateral's angles in the image."""
    worst = 0.0
    for i in range(4):
        a, b, c = corners[i - 1], corners[i], corners[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        worst = max(worst, abs(90.0 - np.degrees(np.arccos(np.clip(cos, -1, 1)))))
    return worst
