"""Send one contract message to the app (POST /message). Standard library only.

    python api/examples/send_message.py api/fixtures/document.json
    python api/examples/send_message.py --demo-ocr

The answer (speak + stats) is not returned here: the app broadcasts it to the UI over the
WebSocket. Start the app (task dev) or the real server (task server) first.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid

APP_URL = "http://127.0.0.1:8765/message"


def post(envelope: dict, url: str = APP_URL) -> None:
    """POSTs one envelope {type, id, ts, payload}. Raises on HTTP errors."""
    body = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        print(resp.status, resp.read().decode("utf-8"))


def document_from_ocr_lines(lines: list[dict], image_w: int, image_h: int, quality: float,
                            issues: list[str] | None = None, lang: str = "es") -> dict:
    """Builds a `document` envelope from OCR lines in PIXELS of the cropped page.

    Each line: {"text": str, "left": int, "top": int, "width": int, "height": int, "conf": 0-100}
    (the shape of pytesseract.image_to_data grouped by line). Boxes are normalized to [0, 1].
    """
    blocks = []
    for i, ln in enumerate(lines, start=1):
        if not ln["text"].strip():
            continue
        blocks.append({
            "id": f"b{i}",
            "text": ln["text"].strip(),
            "box": {"x": ln["left"] / image_w, "y": ln["top"] / image_h,
                    "w": ln["width"] / image_w, "h": ln["height"] / image_h},
            "confidence": max(0.0, min(1.0, ln["conf"] / 100)),
        })
    return {
        "type": "document",
        "id": f"doc-{uuid.uuid4()}",
        "ts": int(time.time() * 1000),
        "payload": {"blocks": blocks, "quality": {"score": quality, "issues": issues or []},
                    "imageWidth": image_w, "imageHeight": image_h, "lang": lang},
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("file", nargs="?", help="JSON file with one envelope")
    p.add_argument("--demo-ocr", action="store_true", help="send a document built from sample OCR lines")
    p.add_argument("--url", default=APP_URL)
    a = p.parse_args()

    if a.demo_ocr:
        lines = [
            {"text": "AXA Seguros - Declaración de siniestro", "left": 100, "top": 90, "width": 1040, "height": 100, "conf": 96},
            {"text": "Nombre y apellidos: ____________", "left": 100, "top": 320, "width": 740, "height": 70, "conf": 91},
            {"text": "Número de póliza: ______", "left": 100, "top": 440, "width": 600, "height": 70, "conf": 88},
        ]
        envelope = document_from_ocr_lines(lines, image_w=1240, image_h=1754, quality=0.85)
    elif a.file:
        with open(a.file, encoding="utf-8") as f:
            envelope = json.load(f)
    else:
        p.print_help()
        return 2

    try:
        post(envelope, a.url)
    except urllib.error.URLError as e:
        print(f"Could not reach the app at {a.url}: {e}. Is `task server` or `task dev` running?", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
