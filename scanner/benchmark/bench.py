"""Scanning benchmark (task N3, Pau): how well the MX Brio + reading pipeline read the printed samples.

    scanner\\pdf\\.venv\\Scripts\\python scanner\\benchmark\\bench.py shoot --condition normal
    scanner\\pdf\\.venv\\Scripts\\python scanner\\benchmark\\bench.py analyze --label before
    scanner\\pdf\\.venv\\Scripts\\python scanner\\benchmark\\bench.py report before [after]

- shoot: opens the camera once (capturar.CamaraViva) and, for each printed sample, asks you to place it
  and press Enter; saves the photos in results/photos/<condition>-<sample>-<shot>.png.
- analyze: runs the reading pipeline (scanner_pdf.convert, the same as the service) on every saved
  photo and writes results/<label>.jsonl: words read correctly against the sample's real text, whether
  the 4 corners of the sheet were found with an A4 shape, and the time of each stage.
- report: a Markdown table per condition (to paste into docs/medidas/N3.md).

The same photos are analysed before and after each fix, so the comparison is fair. Photos and results
stay out of git (results/ is ignored): they are pictures of paper, even if the samples are invented.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCANNER = HERE.parent
SAMPLES = SCANNER / "pdf" / "samples" / "print"
RESULTS = HERE / "results"
PHOTOS = RESULTS / "photos"
for p in (SCANNER / "pdf" / "src", SCANNER):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

CONDITIONS = ("normal", "hand", "white", "dim")
CONDITION_NAMES = {"normal": "Normal (dark table, good light)", "hand": "Held by hand",
                   "white": "White table", "dim": "Low light or glare"}

# Pipeline stages (scanner_pdf.pipeline, `with t(...)`): what the reading needs vs. the PDFs.
DOCUMENT_STAGES = ("input", "geometry", "enhance", "orientation", "quality", "ocr")
PDF_STAGES = ("encoding", "base_pdf", "text_layer", "validation")
DIGITAL_STAGES = ("digital",)

A4 = math.sqrt(2)
ASPECT_TOLERANCE = 0.10  # a detected sheet whose sides are more than 10 % off A4 is a bad crop


def samples() -> dict[str, Path]:
    """'01' -> scanner/pdf/samples/print/01-....pdf"""
    return {p.name[:2]: p for p in sorted(SAMPLES.glob("*.pdf"))}


# --- words ---

_WORD = re.compile(r"[\w€$%@./:,-]+", re.UNICODE)


def words(text: str) -> list[str]:
    """Words to compare: lower case, NFC, without punctuation around them (accents are kept: a missing
    accent is a reading error). Inner punctuation stays (dates, amounts, e-mails, 12,50)."""
    out = []
    for w in _WORD.findall(unicodedata.normalize("NFC", text).lower()):
        w = w.strip(".,:;-/")
        if w:
            out.append(w)
    return out


def edit_distance(a: list[str], b: list[str]) -> int:
    """Levenshtein distance between two word lists (insertions, deletions, substitutions)."""
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def word_recall(truth: list[str], got: list[str]) -> float:
    """Share of the real words that were read, in any order (multiset): the main measure. The order
    of a table differs between the PDF's text (column by column) and a reading (row by row), and
    that is not a reading error."""
    if not truth:
        return 1.0
    left = Counter(got)
    hit = 0
    for w in truth:
        if left[w] > 0:
            left[w] -= 1
            hit += 1
    return hit / len(truth)


def word_accuracy(truth: list[str], got: list[str]) -> float:
    """1 - WER: the share of the real words read correctly, in order (0 if nothing matches)."""
    if not truth:
        return 1.0 if not got else 0.0
    return max(0.0, 1.0 - edit_distance(truth, got) / len(truth))


def truth_words(pdf: Path) -> list[str]:
    from pdfminer.high_level import extract_text
    return words(extract_text(str(pdf)))


def document_words(doc: dict) -> list[str]:
    return words("\n".join(b.get("text", "") for b in doc.get("blocks", [])))


# --- corners ---

def corners_check(corners: list[dict] | None, width: int, height: int) -> tuple[bool, float | None]:
    """Whether the 4 detected corners make an A4 sheet: convex, inside the photo, and with a long/short
    side ratio within 10 % of sqrt(2) (in pixels, so the photo's aspect does not distort it)."""
    if not corners or len(corners) != 4 or not width or not height:
        return False, None
    pts = [(c["x"] * width, c["y"] * height) for c in corners]
    sides = [math.dist(pts[i], pts[(i + 1) % 4]) for i in range(4)]
    a, b = (sides[0] + sides[2]) / 2, (sides[1] + sides[3]) / 2
    if min(a, b) <= 0:
        return False, None
    aspect = max(a, b) / min(a, b)
    cross = [(pts[(i + 1) % 4][0] - pts[i][0]) * (pts[(i + 2) % 4][1] - pts[(i + 1) % 4][1])
             - (pts[(i + 1) % 4][1] - pts[i][1]) * (pts[(i + 2) % 4][0] - pts[(i + 1) % 4][0]) for i in range(4)]
    convex = all(c > 0 for c in cross) or all(c < 0 for c in cross)
    ok = convex and abs(aspect - A4) / A4 <= ASPECT_TOLERANCE
    return ok, round(aspect, 3)


def draw_corners(photo_path: Path, corners: list[dict] | None, out: Path) -> None:
    """A smaller copy of the photo with the detected sheet drawn, to check the crop by eye."""
    import cv2
    import numpy as np
    img = cv2.imread(str(photo_path))
    if img is None:
        return
    h, w = img.shape[:2]
    if corners:
        pts = np.array([[c["x"] * w, c["y"] * h] for c in corners], np.int32)
        cv2.polylines(img, [pts], True, (0, 0, 255), max(3, w // 300))
        cv2.circle(img, tuple(int(v) for v in pts[0]), max(8, w // 150), (0, 255, 0), -1)  # first line starts here
    scale = 1280 / max(w, h)
    if scale < 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img)


# --- commands ---

def photo_name(condition: str, sample: str, shot: int) -> str:
    return f"{condition}-{sample}-{shot}.png"


def parse_photo(name: str) -> tuple[str, str, int] | None:
    m = re.fullmatch(r"([a-z]+)-(\d\d)-(\d+)\.png", name)
    return (m[1], m[2], int(m[3])) if m else None


def cmd_shoot(a) -> int:
    import cv2
    import capturar
    cams = capturar.listar_camaras()
    cam = capturar.elegir_camara(cams, a.camera)
    print(f"Camera: {cam.nombre}. Opening (the first frames take a moment)...")
    live = capturar.CamaraViva(cam, 3840, 2160, 3.0)
    PHOTOS.mkdir(parents=True, exist_ok=True)
    try:
        for sample in a.samples.split(","):
            for shot in range(1, a.shots + 1):
                input(f"[{a.condition}] Place sample {sample} (shot {shot}/{a.shots}) and press Enter...")
                t0 = time.perf_counter()
                frame, meta = live.capturar()
                ms = round((time.perf_counter() - t0) * 1000)
                path = PHOTOS / photo_name(a.condition, sample, shot)
                cv2.imwrite(str(path), frame, [cv2.IMWRITE_PNG_COMPRESSION, 1])
                (path.with_suffix(".json")).write_text(json.dumps({"capture_ms": ms, **meta}, ensure_ascii=False, indent=1),
                                                     encoding="utf-8")
                print(f"  saved {path.name} ({frame.shape[1]}x{frame.shape[0]}, {ms} ms, "
                      f"sharpness {meta['seleccion']['nitidez']})")
    finally:
        live.cerrar()
    return 0


def analyze_photo(path: Path, truth: dict[str, list[str]], digital: bool, out_dir: Path) -> dict:
    from scanner_pdf import Options, convert
    cond, sample, shot = parse_photo(path.name)
    meta_path = path.with_suffix(".json")
    capture_ms = json.loads(meta_path.read_text(encoding="utf-8")).get("capture_ms") if meta_path.exists() else None
    res = convert(path.read_bytes(), out_dir, Options(digital=digital, save_intermediates=False),
                  name=path.stem, metadata={"source": "benchmark"})
    doc = res.document() if not res.error else {}
    t = res.timings_ms
    corners = doc.get("pageCorners")
    ok, aspect = corners_check(corners, res.input.get("width"), res.input.get("height"))
    draw_corners(path, corners, out_dir / "corners" / path.name)
    got = document_words(doc)
    return {
        "photo": path.name, "condition": cond, "sample": sample, "shot": shot,
        "words_ok": round(word_recall(truth[sample], got), 4), "words_in_order": round(word_accuracy(truth[sample], got), 4),
        "words_truth": len(truth[sample]), "words_read": len(got),
        "missed": sorted((Counter(truth[sample]) - Counter(got)).elements())[:40],
        "corners_ok": ok, "aspect": aspect, "corners_found": bool(corners),
        "capture_ms": capture_ms,
        "document_ms": round(sum(t.get(k, 0) for k in DOCUMENT_STAGES)),
        "pdf_ms": round(sum(t.get(k, 0) for k in PDF_STAGES)),
        "digital_ms": round(sum(t.get(k, 0) for k in DIGITAL_STAGES)),
        "total_ms": round(t.get("total", 0)),
        "pdf": bool(res.pdf), "digital_pdf": bool(res.digital_pdf),
        "issues": doc.get("quality", {}).get("issues", []), "warnings": res.warnings,
        "error": (res.error or {}).get("code"), "timings_ms": t,
    }


def cmd_analyze(a) -> int:
    truth = {k: truth_words(p) for k, p in samples().items()}
    photos = sorted(p for p in Path(a.photos).glob("*.png") if parse_photo(p.name))
    if not photos:
        print(f"No photos in {a.photos}: take them first with `bench.py shoot`.")
        return 1
    out_dir = RESULTS / a.label
    lines = []
    for p in photos:
        r = analyze_photo(p, truth, a.digital, out_dir)
        lines.append(json.dumps(r, ensure_ascii=False))
        print(f"{p.name}: words {r['words_ok']:.1%}, corners {'ok' if r['corners_ok'] else 'BAD'} ({r['aspect']}), "
              f"document {r['document_ms']} ms, pdf {r['pdf_ms']} ms, digital {r['digital_ms']} ms"
              + (f", error {r['error']}" if r['error'] else ""))
    (RESULTS / f"{a.label}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nWrote results/{a.label}.jsonl; crops to check by eye in results/{a.label}/corners/")
    return 0


def load(label: str) -> list[dict]:
    path = RESULTS / f"{label}.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def summary(rows: list[dict]) -> dict:
    def mean(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return statistics.mean(vals) if vals else None
    capture = mean("capture_ms") or 0
    return {"n": len(rows), "words": mean("words_ok"), "corners": sum(r["corners_ok"] for r in rows),
            "to_read_s": (capture + (mean("document_ms") or 0)) / 1000, "pdf_s": (mean("pdf_ms") or 0) / 1000,
            "digital_s": (mean("digital_ms") or 0) / 1000}


def cmd_report(a) -> int:
    runs = {label: load(label) for label in a.labels}
    head = "| Condition | " + " | ".join(f"Words ({l}) | Corners ({l}) | Photo → document ({l})" for l in runs) + " |"
    print(head)
    print("|" + "---|" * (1 + 3 * len(runs)))
    for cond in CONDITIONS + ("all",):
        cells = []
        for rows in runs.values():
            rs = [r for r in rows if cond == "all" or r["condition"] == cond]
            if not rs:
                cells += ["—", "—", "—"]
                continue
            s = summary(rs)
            cells += [f"{s['words']:.1%}", f"{s['corners']}/{s['n']}", f"{s['to_read_s']:.1f} s"]
        print(f"| {CONDITION_NAMES.get(cond, 'All')} | " + " | ".join(cells) + " |")
    for label, rows in runs.items():
        s = summary(rows)
        print(f"\n{label}: PDF {s['pdf_s']:.1f} s and digital PDF {s['digital_s']:.1f} s on average, "
              f"{sum(r['pdf'] for r in rows)}/{len(rows)} PDFs, {sum(r['digital_pdf'] for r in rows)}/{len(rows)} digital PDFs.")
        worst = sorted(rows, key=lambda r: r["words_ok"])[:3]
        print("Worst: " + ", ".join(f"{r['photo']} {r['words_ok']:.0%}" for r in worst))
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Scanning benchmark (N3)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("shoot", help="take the photos with the camera")
    s.add_argument("--condition", choices=CONDITIONS, required=True)
    s.add_argument("--samples", default="01,02,03")
    s.add_argument("--shots", type=int, default=2)
    s.add_argument("--camera", default="brio", help="camera name or index (default: the MX Brio)")
    s = sub.add_parser("analyze", help="read every saved photo with the pipeline")
    s.add_argument("--label", default="before")
    s.add_argument("--photos", default=str(PHOTOS))
    s.add_argument("--digital", action="store_true", help="also the digital PDF (vision model, paid)")
    s = sub.add_parser("report", help="Markdown table per condition")
    s.add_argument("labels", nargs="+")
    a = p.parse_args(argv)
    return {"shoot": cmd_shoot, "analyze": cmd_analyze, "report": cmd_report}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
