"""CLI: python -m scanner_pdf capture.png [-o output/] [options]"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .image import MODES
from .pipeline import PAPER_SIZES, Options, convert


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="scanner_pdf", description="PNG of a document -> searchable PDF")
    p.add_argument("input", help="PNG image")
    p.add_argument("-o", "--output", default="output", help="output folder (default: output/)")
    p.add_argument("-n", "--name", help="result name (default: the file name)")
    p.add_argument("-l", "--languages", default="spa+cat+eng", help="Tesseract languages (spa+cat+eng)")
    p.add_argument("--mode", choices=MODES, default="color")
    p.add_argument("--paper-size", choices=PAPER_SIZES, default="auto", help="page paper (auto detects A4/Letter...)")
    p.add_argument("--dpi", type=float, help="DPI when it does not snap to a standard paper")
    p.add_argument("--corners", help="manual crop: x1,y1,x2,y2,x3,y3,x4,y4 in original px")
    p.add_argument("--no-crop", action="store_true", help="do not detect the sheet")
    p.add_argument("--no-lighting", action="store_true", help="do not correct shadows")
    p.add_argument("--no-enhance", action="store_true", help="do not darken the ink or sharpen (light paper)")
    p.add_argument("--no-orient", action="store_true", help="do not rotate 90/180/270")
    p.add_argument("--no-ocr", action="store_true", help="image only, no text layer")
    p.add_argument("--digital", action="store_true", help="also a digital PDF: real text and images in place")
    p.add_argument("--jpeg", action="store_true", help="embed JPEG (lighter) instead of lossless PNG")
    p.add_argument("--no-intermediates", action="store_true", help="do not save page, base PDF or detection")
    p.add_argument("--json", action="store_true", help="print the full result as JSON")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    corners = None
    if a.corners:
        v = [float(x) for x in a.corners.split(",")]
        if len(v) != 8:
            p.error("--corners needs 8 numbers")
        corners = [v[i:i + 2] for i in range(0, 8, 2)]

    op = Options(languages=a.languages, mode=a.mode, paper_size=a.paper_size, dpi=a.dpi, corners=corners,
                 crop=not a.no_crop, lighting=not a.no_lighting, enhance=not a.no_enhance, orient=not a.no_orient,
                 ocr=not a.no_ocr, image_format="jpeg" if a.jpeg else "png",
                 save_intermediates=not a.no_intermediates, digital=a.digital)
    r = convert(a.input, a.output, op, name=a.name)

    if a.json:
        print(json.dumps(r.to_dict(), ensure_ascii=False, indent=2))
    elif r.error:
        print(f"ERROR [{r.error['code']}] {r.error['message']}", file=sys.stderr)
    else:
        v = r.validation
        print(f"{r.status.upper()}: {r.pdf}")
        print(f"  page {r.page['width_px']}x{r.page['height_px']} px, {r.page['paper'] or 'no standard paper'}, "
              f"{r.page['dpi'][0]:.0f} DPI; quality {r.quality['score']} {r.quality['issues'] or ''}")
        print(f"  OCR: {r.ocr.get('words', 0)} words, confidence {r.ocr.get('mean_confidence')}; "
              f"searchable={r.searchable}, PSNR {v.get('psnr_db')} dB, offset {v.get('median_offset')}")
        if r.digital_pdf:
            d = r.digital
            print(f"  digital: {r.digital_pdf} ({d.get('method')}, {d.get('text_words')} words as text, "
                  f"{d.get('image_regions')} images)")
        if r.warnings:
            print(f"  warnings: {', '.join(r.warnings)}")
        print(f"  total time {r.timings_ms['total']:.0f} ms")
    return 0 if r.status == "ok" else (1 if r.status == "error" else 2)


if __name__ == "__main__":
    sys.exit(main())
