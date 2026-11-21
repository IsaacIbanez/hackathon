"""Component entry point: PNG -> searchable PDF + structured result."""

from __future__ import annotations

import json
import logging
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import digital, geometry, image, ocr, pdf, vision
from .errors import ScannerError
from .input_image import load_png

log = logging.getLogger(__name__)

DEFAULT_DPI = 200.0              # when there is no standard paper and no DPI in the PNG
MIN_AGREEMENT = 0.6              # below this, the cheap model layout is retried with the expensive one
PAPER_SIZES = ("auto", "image", *geometry.PAPER_SIZES_MM)
BCP47 = {"spa": "es", "cat": "ca", "eng": "en"}


@dataclass
class Options:
    languages: str = "spa+cat+eng"
    mode: str = "color"                  # color | gray | bw (bw only on request: it is destructive)
    crop: bool = True                    # detect the sheet and correct the perspective
    corners: list[list[float]] | None = None    # manual crop: 4 points [x, y] in original px
    lighting: bool = True                # even out shadows and colour casts (limited gain)
    enhance: bool = True                 # scanner look on light paper: black ink, white paper, sharpness
    orient: bool = True                  # rotate 90/180/270 (OSD on the area with most text + check reading)
    paper_size: str = "auto"             # auto | image | A4 | Letter | A5 | Legal
    fov_diagonal: float = geometry.WEBCAM_DIAGONAL_FOV  # camera field of view (degrees)
    dpi: float | None = None             # forces the DPI when it does not snap to a standard paper
    image_format: str = "png"            # png (lossless) | jpeg
    jpeg_quality: int = 92
    block_level: str = "line"            # line | paragraph
    ocr: bool = True
    digital: bool = False                # also a digital PDF: blank page with real text and images
    digital_ai: bool = True              # the digital PDF uses a vision model (OpenRouter) if there is a key; otherwise local OCR
    save_intermediates: bool = True
    title: str | None = None

    def validate(self) -> None:
        if self.mode not in image.MODES:
            raise ScannerError("options_invalid", f"mode must be one of {image.MODES}")
        if self.paper_size not in PAPER_SIZES:
            raise ScannerError("options_invalid", f"paper_size must be one of {PAPER_SIZES}")
        if self.image_format not in ("png", "jpeg"):
            raise ScannerError("options_invalid", "image_format must be png or jpeg")
        if self.block_level not in ("line", "paragraph"):
            raise ScannerError("options_invalid", "block_level must be line or paragraph")
        if self.corners is not None and np.asarray(self.corners).shape != (4, 2):
            raise ScannerError("options_invalid", "corners must be a list of 4 points [x, y]")
        if self.dpi is not None and not (30 <= self.dpi <= 2400):
            raise ScannerError("options_invalid", "dpi out of range (30..2400)")


@dataclass
class Result:
    status: str                          # ok | partial (there is a PDF but it is not searchable or not valid) | error
    pdf: str | None = None
    digital_pdf: str | None = None       # if Options.digital: rebuilt document (real text + images)
    folder: str | None = None
    pages: int = 0
    languages: str | None = None
    searchable: bool = False
    warnings: list[str] = field(default_factory=list)
    error: dict | None = None
    input: dict = field(default_factory=dict)
    detection: dict | None = None
    page: dict = field(default_factory=dict)          # size in px, DPI, paper, rotation
    quality: dict = field(default_factory=dict)       # score, issues (FrameIssue), measures
    ocr: dict = field(default_factory=dict)           # engine, words, mean confidence, blocks
    validation: dict = field(default_factory=dict)
    digital: dict = field(default_factory=dict)
    intermediates: dict = field(default_factory=dict)
    timings_ms: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict:
        return asdict(self)

    def document(self) -> dict:
        """Payload of the contract `document` message (api/openapi.yaml, DocumentPayload)."""
        d = {
            "blocks": self.ocr.get("blocks", []),
            "quality": {"score": self.quality.get("score", 0.0), "issues": self.quality.get("issues", [])},
        }
        if self.page.get("width_px"):
            d["imageWidth"], d["imageHeight"] = self.page["width_px"], self.page["height_px"]
        languages = (self.languages or "").split("+")
        if len(languages) == 1 and languages[0] in BCP47:
            d["lang"] = BCP47[languages[0]]
        return d


def convert(source: str | Path | bytes, output_dir: str | Path, options: Options | None = None,
            name: str | None = None, metadata: dict | None = None) -> Result:
    """Converts a PNG into a searchable PDF inside `output_dir/<name>/`.

    Never raises for expected errors: returns a Result with status 'error' and `error.code`.
    """
    op = options or Options()
    r = Result(status="error")
    t = _Stopwatch(r.timings_ms)
    try:
        op.validate()
        with t("input"):
            inp = load_png(source)
        r.input = {**inp.info, "png_dpi": inp.dpi, "metadata": metadata or {}}

        folder = _unique_folder(Path(output_dir), name or _default_name(source))
        name = folder.name
        r.folder = str(folder)
        original = folder / "original.png"
        original.write_bytes(inp.original_bytes)  # the original is always kept, untouched
        r.intermediates["original"] = str(original)
        (folder / "input.json").write_text(json.dumps(r.input, ensure_ascii=False, indent=2), encoding="utf-8")

        tess = _tesseract_if_needed(op, r)

        with t("geometry"):
            page, paper = _prepare_geometry(inp.image, op, r, folder)
        det = r.detection or {}

        with t("enhance"):
            # Only light, cropped paper: on dark posters or the whole scene brightening spoils it.
            even = op.lighting and bool(det.get("found")) and image.light_paper(page)
            r.page["lighting_corrected"] = even
            corrected = image.correct_lighting(page) if even else page
            if even and op.enhance:
                corrected, r.page["enhancement"] = image.enhance_document(corrected)

        # Orientation looks at the enhanced page: with the camera's grey text it sometimes reads nothing.
        if op.orient and tess:
            with t("orientation"):
                corrected, degrees, conf = ocr.orient(corrected)
            page = ocr.rotate(page, degrees)
            r.page["rotation_degrees"], r.page["rotation_confidence"] = degrees, conf
        dpi = _dpi(page, paper, op, inp.dpi)
        height, width = page.shape[:2]
        r.page.update({"width_px": width, "height_px": height, "dpi": [round(dpi[0], 2), round(dpi[1], 2)],
                       "paper": paper, "size_mm": [round(width / dpi[0] * 25.4, 1), round(height / dpi[1] * 25.4, 1)]})

        with t("quality"):
            r.quality = image.evaluate_quality(
                page, area_fraction=det.get("area_fraction") if det.get("found") else None,
                touches_border=bool(det.get("touches_border")), effective_dpi=float(np.mean(dpi)),
                max_angle=geometry.max_angle_deviation(np.asarray(det["corners"])) if det.get("found") else None)

        with t("encoding"):
            final = image.apply_mode(corrected, op.mode)
            encoded = pdf.encode_image(final, dpi, op.image_format, op.jpeg_quality, binary=op.mode == "bw")
        if op.save_intermediates:
            ext = "jpg" if op.image_format == "jpeg" and op.mode != "bw" else "png"
            (folder / f"page.{ext}").write_bytes(encoded)
            r.intermediates["page"] = str(folder / f"page.{ext}")

        with t("base_pdf"):
            base = pdf.build_base_pdf(encoded, dpi)
        if op.save_intermediates:
            (folder / "base.pdf").write_bytes(base)
            r.intermediates["base_pdf"] = str(folder / "base.pdf")

        # Digital document with a model: the call (the slowest step, ~14 s) starts now, in parallel with
        # the local OCR, because it only needs the page; the OCR is needed later to place the blocks.
        layout_future = None
        if op.digital and op.digital_ai and op.ocr and tess and vision.api_key() and digital.applicable(corrected):
            workers = ThreadPoolExecutor(max_workers=1)
            layout_future = workers.submit(vision.page_layout, corrected, vision.CHEAP_MODEL)
            workers.shutdown(wait=False)

        final_pdf, blocks, res = base, None, None
        if op.ocr and tess:
            try:
                languages, warnings = ocr.resolve_languages(op.languages, tess.languages)
                r.warnings += warnings
                r.languages = languages
                with t("ocr"):
                    # The OCR reads the corrected page (not binarised): same geometry, better reading.
                    res = ocr.recognize(corrected, languages, float(np.mean(dpi)), op.block_level)
                r.warnings += res.warnings
                blocks = res.blocks
                r.ocr = {"engine": f"tesseract {tess.version}", "psm": res.psm, "passes": res.passes,
                         "words": res.words, "mean_confidence": res.mean_confidence, "blocks": blocks}
                with t("text_layer"):
                    final_pdf = pdf.overlay_text(base, res.text_pdf, op.title or name)
            except ScannerError as e:
                r.warnings.append(f"no_ocr_layer:{e.code}")
                log.warning("OCR unavailable, image-only PDF: %s", e.message)
        if final_pdf is base:
            final_pdf = pdf.add_metadata(base, op.title or name)

        out = folder / f"{name}.pdf"
        out.write_bytes(final_pdf)
        r.pdf, r.pages = str(out), 1

        with t("validation"):
            r.validation = pdf.validate(final_pdf, final, dpi, blocks)
        r.searchable = bool(r.validation.get("searchable"))
        r.status = "ok" if r.validation.get("ok") and r.searchable else "partial"

        if op.digital:
            with t("digital"):
                _digital_document(r, op, corrected, res, float(np.mean(dpi)), folder, name, layout_future)
        if not r.validation.get("ok"):
            r.warnings.append("validation_failed")
    except ScannerError as e:
        r.error = e.to_dict()
    except Exception as e:  # unexpected: still reported, with a generic code
        log.exception("Unexpected failure")
        r.error = {"code": "internal", "message": f"{type(e).__name__}: {e}"}
    finally:
        r.timings_ms["total"] = round(sum(v for k, v in r.timings_ms.items() if k != "total"), 1)
        if r.folder:
            Path(r.folder, "result.json").write_text(json.dumps(r.to_dict(), ensure_ascii=False, indent=2),
                                                     encoding="utf-8")
    return r


# ---------------------------------------------------------------- steps

def _digital_document(r: Result, op: Options, page: np.ndarray, res, dpi: float, folder: Path,
                      name: str, layout_future: Future | None = None) -> None:
    """Digital PDF (real text + images in place). If it cannot be made: a warning, and the scan is unchanged."""
    if res is None or not res.words_detail:
        r.warnings.append("digital_no_text")
        r.digital = {"generated": False, "reason": "no recognised text"}
        return
    if not digital.applicable(page):
        r.warnings.append("digital_not_applicable")
        r.digital = {"generated": False, "reason": "the background is not light paper (poster, card or scene)"}
        return
    data, info = None, {}
    if op.digital_ai:
        try:
            data, info = _digital_with_model(page, res.words_detail, dpi, op, name, folder, layout_future)
        except ScannerError as e:
            r.warnings.append(f"digital_ai_unavailable:{e.code}")
            info = {"ai_error": e.to_dict()}
            log.warning("Digital document without a model (%s): using the local OCR", e.code)
    if data is None:
        data, local = digital.digitalize(page, res.words_detail, dpi, op.title or name)
        info = {**info, "method": "local_ocr", **local}
    path = folder / f"{name}-digital.pdf"
    path.write_bytes(data)
    r.digital_pdf = str(path)
    checked = res.words_detail if info.get("method") == "local_ocr" else []
    r.digital = {"generated": True, **info, **pdf.validate_digital(data, checked)}


def _digital_with_model(page: np.ndarray, words: list[dict], dpi: float, op: Options, name: str,
                        folder: Path, layout_future: Future | None = None) -> tuple[bytes, dict]:
    """Layout from the cheap model; if it does not agree with the local OCR (or the JSON fails), the
    expensive one (frugal).

    `layout_future`: the cheap-model call already started in parallel with the OCR (if any).
    """
    calls = []
    layout = agreement = None
    for model in (vision.CHEAP_MODEL, vision.EXPENSIVE_MODEL):
        try:
            if model == vision.CHEAP_MODEL and layout_future is not None:
                candidate, meta = layout_future.result()
            else:
                candidate, meta = vision.page_layout(page, model)
        except ScannerError as e:
            calls.append({"model": model, "error": e.code})
            if e.code in ("ai_no_key", "ai_no_connection"):
                raise
            continue
        a = digital.agreement(candidate, words)
        calls.append({**meta, "agreement": a["ocr_in_model"]})
        layout, agreement = candidate, a
        if a["ocr_in_model"] is None or a["ocr_in_model"] >= MIN_AGREEMENT:
            break
    if layout is None:
        raise ScannerError("ai_failed", "No model returned a valid layout")
    if op.save_intermediates:
        (folder / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8")
    data, info = digital.digitalize_layout(page, layout, words, dpi, op.title or name)
    cost = sum(c.get("cost_usd") or 0 for c in calls)
    return data, {**info, "model_calls": calls, "ai_cost_usd": round(cost, 5),
                  "ocr_agreement": agreement["ocr_in_model"], "to_review": agreement["unconfirmed"]}


def _tesseract_if_needed(op: Options, r: Result) -> ocr.Tesseract | None:
    if not (op.ocr or op.orient):
        return None
    try:
        return ocr.prepare_tesseract()
    except ScannerError as e:
        r.warnings.append(f"no_ocr_layer:{e.code}")
        log.warning("%s", e.message)
        return None


def _prepare_geometry(img: np.ndarray, op: Options, r: Result, folder: Path) -> tuple[np.ndarray, str | None]:
    """Crops and rectifies the sheet if possible. Returns (page, standard paper or None)."""
    det = None
    if op.corners is not None:
        corners = geometry.order_corners(np.asarray(op.corners, dtype=np.float32))
        det = geometry.Detection(True, 1.0, corners, "manual",
                                 area_fraction=cv2.contourArea(corners) / float(img.shape[0] * img.shape[1]))
    elif op.crop:
        det = geometry.detect_page(img)
        if not det.found:
            r.warnings.append("page_not_detected")  # the whole image is used: better than a bad crop

    if det is not None:
        r.detection = det.to_dict()
        if op.save_intermediates and det.corners is not None:
            _save_detection(img, det, folder / "detection.jpg")
            r.intermediates["detection"] = str(folder / "detection.jpg")

    if det is not None and det.found:
        aspect = geometry.real_aspect_ratio(det.corners, img.shape[:2], op.fov_diagonal)
        # Sheet cut off by the frame: its corners are not the paper's, so no standard size is forced.
        paper = _paper(aspect, "image" if det.touches_border and op.paper_size == "auto" else op.paper_size)
        if paper:
            aspect = _paper_aspect(paper, landscape=aspect > 1)
        return geometry.rectify(img, det.corners, aspect), paper

    # No crop: the image is treated as the page (e.g. the capture comes already cropped).
    # Strict tolerance: a 4:3 frame without a sheet must not become "Letter".
    height, width = img.shape[:2]
    paper = _paper(width / height, op.paper_size, geometry.UNDETECTED_PAPER_TOLERANCE)
    if paper:
        img = geometry.fit_to_aspect(img, _paper_aspect(paper, landscape=width > height))
    return img, paper


def _paper(aspect: float, size: str, tolerance: float = geometry.PAPER_TOLERANCE) -> str | None:
    if size == "image":
        return None
    if size == "auto":
        return geometry.nearest_paper(aspect, tolerance)
    return size


def _paper_aspect(paper: str, landscape: bool) -> float:
    w, h = geometry.PAPER_SIZES_MM[paper]
    return h / w if landscape else w / h


def _dpi(page: np.ndarray, paper: str | None, op: Options, png_dpi: float | None) -> tuple[float, float]:
    """Page DPI: with a standard paper it is derived from it (the PDF measures what the paper measures)."""
    height, width = page.shape[:2]
    if paper:
        w, h = geometry.PAPER_SIZES_MM[paper]
        if width > height:
            w, h = h, w
        # One DPI for both axes (square pixels): rounding to whole pixels moves the size less than
        # 0.2 mm from the paper, and the image is neither distorted nor rescaled when displayed.
        dpi = (width / (w / 25.4) + height / (h / 25.4)) / 2
        return dpi, dpi
    value = op.dpi or png_dpi or DEFAULT_DPI
    return value, value


def _save_detection(img: np.ndarray, det: geometry.Detection, path: Path) -> None:
    """Debug image with the detected sheet drawn on top."""
    view = img.copy()
    color = (0, 200, 0) if det.found else (0, 0, 255)
    thickness = max(2, int(max(img.shape[:2]) / 400))
    cv2.polylines(view, [det.corners.astype(np.int32).reshape(-1, 1, 2)], True, color, thickness)
    scale = min(1.0, 1600.0 / max(img.shape[:2]))
    view = cv2.resize(view, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), view, [cv2.IMWRITE_JPEG_QUALITY, 85])


def _default_name(source) -> str:
    if isinstance(source, (str, Path)):
        return Path(source).stem
    return datetime.now().strftime("scan-%Y%m%d-%H%M%S")


def _unique_folder(base: Path, name: str) -> Path:
    """Creates a new folder; if it exists, adds -2, -3... (a result is never overwritten)."""
    clean = "".join(c if c.isalnum() or c in "-_." else "_" for c in name).strip("._") or "scan"
    base.mkdir(parents=True, exist_ok=True)
    for i in range(1, 1000):
        folder = base / (clean if i == 1 else f"{clean}-{i}")
        try:
            folder.mkdir()
            return folder
        except FileExistsError:
            continue
    raise ScannerError("output_unavailable", f"Could not create an output folder in {base}")


class _Stopwatch:
    def __init__(self, target: dict):
        self.target = target

    def __call__(self, stage: str):
        return _Stage(self.target, stage)


class _Stage:
    def __init__(self, target: dict, stage: str):
        self.target, self.stage = target, stage

    def __enter__(self):
        self.t0 = time.perf_counter()

    def __exit__(self, *exc):
        self.target[self.stage] = round((time.perf_counter() - self.t0) * 1000, 1)
        return False
