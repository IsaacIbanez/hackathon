"""Reading service (T13): photo in, contract `document` out. http://127.0.0.1:8770

    scanner\\pdf\\.venv\\Scripts\\python scanner\\service.py        (Windows)
    scanner/pdf/.venv/bin/python scanner/service.py               (Linux/macOS)

    curl --data-binary @photo.png http://127.0.0.1:8770/scan

POST /scan   body: the photo (PNG or JPEG; the type is sniffed from the bytes, Content-Type is optional)
             query: `languages=spa+cat+eng`, `digital=1` (also the digital PDF; slower, uses the vision model)
  200  DocumentPayload (blocks, quality, imageWidth, imageHeight, lang) + `pageCorners`: the 4 sheet corners
       on the photo, normalised, document top-left first ([{x, y}] x4, TL, TR, BR, BL).
       Headers: X-Scan-Pdf (searchable PDF path), X-Scan-Digital-Pdf (if requested), X-Scan-Ms (total time).
  422  {"error": "page_not_detected", "message", "quality"}: no sheet found with confidence. `quality.issues`
       says why when it can (too_far, blurry, dark...), so the app can tell the person how to hold the paper.
  400  {"error": "input_*", "message"}: not a PNG/JPEG, unreadable, too small...
  413  photo larger than MAX_BODY.  503  {"error": "ocr_unavailable"}: Tesseract is missing.  500: internal.
POST /document?name=file.pdf   body: a file from the computer (PDF with or without text, PNG, JPEG)
  200  DocumentPayload: its lines in reading order, pages stacked top to bottom (documents.py; overlay option
       "Read a file", docs/OVERLAY.md).  400 input_*  503 ocr_unavailable (a scanned page without Tesseract)
GET  /health  {"ok": true, "tesseract": "5.x", "busy": false}

Only listens on 127.0.0.1. One scan at a time (the OCR already uses the CPU in parallel); others wait.
The photo, the page and the PDFs are kept in scanner/pdf/output/ (ignored by git: real documents).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
if str(ROOT / "pdf" / "src") not in sys.path:     # scanner_pdf, even if it is not installed with pip
    sys.path.insert(0, str(ROOT / "pdf" / "src"))
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from scanner_pdf import Options, Result, convert, geometry, image, ocr  # noqa: E402
from scanner_pdf.errors import ScannerError  # noqa: E402
from scanner_pdf.input_image import load_png  # noqa: E402

import documents  # noqa: E402

log = logging.getLogger("scan-service")

DEFAULT_PORT = 8770
OUTPUT_DIR = ROOT / "pdf" / "output"
MAX_BODY = 40 * 1024 * 1024        # a 4K PNG is ~10-20 MB
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
NO_PAGE_MESSAGE = "No sheet found: hold the whole page flat inside the frame, at 30-40 cm"


def default_options(query: dict) -> Options:
    """Options for one request. No intermediates: only the photo, the PDFs and result.json are kept.

    The digital PDF (vision model, ~0.002 USD a page) is on by default (task N3): it is made in the
    background and does not delay the answer. `digital=0` or SCANNER_DIGITAL=0 turn it off."""
    digital = query.get("digital", os.environ.get("SCANNER_DIGITAL", "1")) == "1"
    return Options(languages=query.get("languages", "spa+cat+eng"), digital=digital, save_intermediates=False)


def to_png(data: bytes) -> bytes:
    """PNG bytes for the pipeline. A JPEG (browser `captureStill`, phone) is decoded once and stored as a
    fast PNG; its EXIF orientation is applied by OpenCV, so the corners match the photo as displayed."""
    if data.startswith(PNG_SIGNATURE):
        return data
    if not data.startswith(JPEG_SIGNATURE):
        raise ScannerError("input_not_png", "The body is not a PNG or JPEG image")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ScannerError("input_unreadable", "The JPEG is damaged or cannot be decoded")
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    if not ok:
        raise ScannerError("input_unreadable", "Could not convert the JPEG")
    return buf.tobytes()


def respond(result: Result) -> tuple[int, dict]:
    """HTTP status and JSON body for a pipeline result."""
    if result.error:
        code = result.error["code"]
        return (400 if code.startswith("input_") else 500), {"error": code, "message": result.error["message"]}
    if any(w.startswith("no_ocr_layer:ocr_unavailable") for w in result.warnings):
        return 503, {"error": "ocr_unavailable", "message": "Tesseract is not installed (scanner/pdf/scripts/install.*)"}
    doc = result.document()
    if not result.page_corners() and not doc.get("blocks"):
        return 422, {"error": "page_not_detected", "message": NO_PAGE_MESSAGE, "quality": doc["quality"]}
    # Without corners but with text (sheet on a white desk or held in the hand: the main block of text
    # was read, N3): the document goes without pageCorners, which the contract makes optional.
    return 200, doc


class ScanService:
    """The work behind the HTTP handler (also usable without HTTP, e.g. in tests)."""

    def __init__(self, output_dir: Path = OUTPUT_DIR, options=default_options):
        self.output_dir = Path(output_dir)
        self.options = options
        self.lock = threading.Lock()
        self.busy = False

    def scan(self, data: bytes, query: dict | None = None) -> tuple[int, dict, Result | None]:
        try:
            png = to_png(data)
            photo = load_png(png).image
        except ScannerError as e:
            return 400, {"error": e.code, "message": e.message}, None
        # Fast answer when there is no sheet (~0.2 s instead of the whole OCR): the app can ask the
        # person to hold the paper again right away.
        if not geometry.detect_page(photo).found and geometry.text_region(photo)[0] is photo:
            # Without a sheet the DPI is unknown: a neutral value, so only the photo's own issues show.
            quality = image.evaluate_quality(photo, area_fraction=None, touches_border=False, max_angle=None,
                                             effective_dpi=300.0)
            return 422, {"error": "page_not_detected", "message": NO_PAGE_MESSAGE,
                         "quality": {"score": quality["score"], "issues": quality["issues"]}}, None
        name = datetime.now().strftime("scan-%Y%m%d-%H%M%S-%f")[:-3]
        options = self.options(query or {})
        # The answer goes out as soon as the document is ready (after the OCR); the searchable and the
        # digital PDF are finished in the background (N3: the digital one took 6-30 s more). The lock
        # (one OCR at a time) is released at that moment too, so the next photo does not wait for them.
        ready, released = threading.Event(), threading.Event()
        state: dict = {}

        def release():
            if not released.is_set():
                released.set()
                self.busy = False
                self.lock.release()

        def document_ready(res: Result):
            state["answer"] = respond(res)
            state["result"] = res
            release()
            ready.set()

        def work():
            try:
                state["final"] = convert(png, self.output_dir, options, name=name, metadata={"source": "scan-service"})
            except Exception as e:  # convert reports its errors; this is only a safety net
                log.exception("Unexpected failure")
                state["crash"] = e
            finally:
                release()
                ready.set()

        options.on_document = document_ready
        self.lock.acquire()
        self.busy = True
        threading.Thread(target=work, name=f"scan-{name}", daemon=True).start()
        ready.wait()
        if "answer" in state:
            status, body = state["answer"]
            return status, body, state["result"]
        if "crash" in state:
            raise state["crash"]
        result = state["final"]
        status, body = respond(result)
        return status, body, result

    def document(self, data: bytes, query: dict | None = None) -> tuple[int, dict]:
        """A file from the computer -> its lines (documents.py)."""
        query = query or {}
        try:
            body = documents.read_document(data, self.output_dir, to_png, query.get("languages", "spa+cat+eng"),
                                           ocr_lock=self.lock)
        except ScannerError as e:
            return (503 if e.code == "ocr_unavailable" else 400), {"error": e.code, "message": e.message}
        return 200, body


def make_handler(service: ScanService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ScannerService/1"

        def log_message(self, fmt, *args):
            log.debug(fmt, *args)

        def _json(self, status: int, data: dict, headers: dict | None = None):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if urlparse(self.path).path == "/health":
                return self._json(200, {"ok": True, "tesseract": TESSERACT_VERSION, "busy": service.busy})
            self._json(404, {"error": "not_found"})

        def do_POST(self):
            u = urlparse(self.path)
            if u.path not in ("/scan", "/document"):
                return self._json(404, {"error": "not_found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._json(400, {"error": "input_empty", "message": "Send the photo as the request body"})
            if length > MAX_BODY:
                return self._json(413, {"error": "input_too_large", "message": f"Photo larger than {MAX_BODY} bytes"})
            data = self.rfile.read(length)
            query = {k: v[0] for k, v in parse_qs(u.query).items()}
            t0 = time.perf_counter()
            if u.path == "/document":
                try:
                    status, body = service.document(data, query)
                except Exception as e:  # never leave Go without an answer
                    log.exception("Unexpected failure")
                    return self._json(500, {"error": "internal", "message": f"{type(e).__name__}: {e}"})
                ms = round((time.perf_counter() - t0) * 1000)
                log.info("POST /document %s -> %s in %d ms (%s lines)", query.get("name", ""), status, ms,
                         len(body.get("blocks", [])))
                return self._json(status, body, {"X-Scan-Ms": str(ms)})
            try:
                status, body, result = service.scan(data, query)
            except Exception as e:  # never leave Go without an answer
                log.exception("Unexpected failure")
                return self._json(500, {"error": "internal", "message": f"{type(e).__name__}: {e}"})
            ms = round((time.perf_counter() - t0) * 1000)
            headers = {"X-Scan-Ms": str(ms)}
            if result is not None and result.folder:
                headers["X-Scan-Folder"] = Path(result.folder).as_posix()   # the PDFs end up here
            if result is not None and result.pdf:
                headers["X-Scan-Pdf"] = Path(result.pdf).as_posix()
            if result is not None and result.digital_pdf:
                headers["X-Scan-Digital-Pdf"] = Path(result.digital_pdf).as_posix()
            log.info("POST /scan -> %s in %d ms (%s blocks%s)", status, ms, len(body.get("blocks", [])),
                     f", {body['error']}" if "error" in body else "")
            self._json(status, body, headers)

    return Handler


TESSERACT_VERSION: str | None = None


def main(argv: list[str] | None = None) -> int:
    global TESSERACT_VERSION
    p = argparse.ArgumentParser(description="Reading service: photo -> contract document (POST /scan)")
    p.add_argument("--port", type=int, default=int(os.environ.get("SCANNER_SERVICE_PORT", DEFAULT_PORT)))
    p.add_argument("--output", type=Path, default=OUTPUT_DIR, help="folder for photos, PDFs and result.json")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        TESSERACT_VERSION = ocr.prepare_tesseract().version
    except ScannerError as e:
        log.error("%s: scans will answer 503 until it is installed", e.message)
    server = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(ScanService(a.output)))
    log.info("Reading service at http://127.0.0.1:%d (POST /scan, POST /document, GET /health); Ctrl+C to quit", a.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if not stream.isatty():
            stream.reconfigure(encoding="utf-8")
    sys.exit(main())
