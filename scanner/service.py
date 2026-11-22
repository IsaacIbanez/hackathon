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
POST /pdf?name=file.pdf   body: a PDF -> {id, name, pages, lang}: kept open (the last 3) to read it page by page
GET  /pdf/<id>/page/<n>/lines   -> {page, ocr, lines: [{id, text, box, confidence}]} (n from 0; OCR if scanned)
GET  /pdf/<id>/page/<n>.jpg?width=1100   -> the page as a JPEG.  404: unknown PDF or page.
     (PDF viewer that reads a whole PDF aloud, task N4: pdf_pages.py, docs/briefs/N4.md)
GET  /health  {"ok": true, "tesseract": "5.x", "busy": false}

Only listens on 127.0.0.1. One scan at a time (the OCR already uses the CPU in parallel); others wait.
The photo, the page and the PDFs are kept in scanner/pdf/output/ (ignored by git: real documents).
"""

from __future__ import annotations

import argparse
import re
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
import pdf_pages  # noqa: E402

log = logging.getLogger("scan-service")

DEFAULT_PORT = 8770
OUTPUT_DIR = ROOT / "pdf" / "output"
MAX_BODY = 40 * 1024 * 1024        # a 4K PNG is ~10-20 MB
MAX_PDF_BODY = 200 * 1024 * 1024   # POST /pdf: long PDFs are read page by page
PDF_PAGE = re.compile(r"^/pdf/([0-9a-f]+)/page/(\d+)(/lines|\.jpg)$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
NO_PAGE_MESSAGE = "No sheet found: hold the whole page flat inside the frame, at 30-40 cm"


def default_options(query: dict) -> Options:
    """Options for one request. No intermediates: only the photo, the PDFs and result.json are kept."""
    return Options(languages=query.get("languages", "spa+cat+eng"), digital=query.get("digital") == "1",
                   save_intermediates=False)


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
    if not result.page_corners():
        return 422, {"error": "page_not_detected", "message": NO_PAGE_MESSAGE, "quality": result.document()["quality"]}
    return 200, result.document()


class ScanService:
    """The work behind the HTTP handler (also usable without HTTP, e.g. in tests)."""

    def __init__(self, output_dir: Path = OUTPUT_DIR, options=default_options):
        self.output_dir = Path(output_dir)
        self.options = options
        self.lock = threading.Lock()
        self.busy = False
        self.pdfs = pdf_pages.PdfStore(self.output_dir, to_png, self.lock)

    def scan(self, data: bytes, query: dict | None = None) -> tuple[int, dict, Result | None]:
        try:
            png = to_png(data)
            photo = load_png(png).image
        except ScannerError as e:
            return 400, {"error": e.code, "message": e.message}, None
        # Fast answer when there is no sheet (~0.2 s instead of the whole OCR): the app can ask the
        # person to hold the paper again right away.
        if not geometry.detect_page(photo).found:
            # Without a sheet the DPI is unknown: a neutral value, so only the photo's own issues show.
            quality = image.evaluate_quality(photo, area_fraction=None, touches_border=False, max_angle=None,
                                             effective_dpi=300.0)
            return 422, {"error": "page_not_detected", "message": NO_PAGE_MESSAGE,
                         "quality": {"score": quality["score"], "issues": quality["issues"]}}, None
        name = datetime.now().strftime("scan-%Y%m%d-%H%M%S-%f")[:-3]
        with self.lock:
            self.busy = True
            try:
                result = convert(png, self.output_dir, self.options(query or {}), name=name,
                                 metadata={"source": "scan-service"})
            finally:
                self.busy = False
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

        def _bytes(self, status: int, data: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/health":
                return self._json(200, {"ok": True, "tesseract": TESSERACT_VERSION, "busy": service.busy})
            m = PDF_PAGE.match(u.path)
            if not m:
                return self._json(404, {"error": "not_found"})
            pdf_id, index, what = m.group(1), int(m.group(2)), m.group(3)
            query = {k: v[0] for k, v in parse_qs(u.query).items()}
            t0 = time.perf_counter()
            try:
                if what == ".jpg":
                    return self._bytes(200, service.pdfs.page_image(pdf_id, index, int(query.get("width", 1100))),
                                       "image/jpeg")
                body = service.pdfs.page_lines(pdf_id, index)
            except KeyError:
                return self._json(404, {"error": "pdf_not_open", "message": "Open the PDF again (POST /pdf)"})
            except IndexError:
                return self._json(404, {"error": "page_not_found", "message": f"No page {index}"})
            except ScannerError as e:
                return self._json(503 if e.code == "ocr_unavailable" else 400, {"error": e.code, "message": e.message})
            except Exception as e:  # never leave Go without an answer
                log.exception("Unexpected failure")
                return self._json(500, {"error": "internal", "message": f"{type(e).__name__}: {e}"})
            ms = round((time.perf_counter() - t0) * 1000)
            log.info("GET %s -> %d lines%s in %d ms", u.path, len(body["lines"]), " (OCR)" if body["ocr"] else "", ms)
            self._json(200, body, {"X-Scan-Ms": str(ms)})

        def do_POST(self):
            u = urlparse(self.path)
            if u.path not in ("/scan", "/document", "/pdf"):
                return self._json(404, {"error": "not_found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._json(400, {"error": "input_empty", "message": "Send the photo as the request body"})
            if length > (MAX_PDF_BODY if u.path == "/pdf" else MAX_BODY):
                return self._json(413, {"error": "input_too_large", "message": f"Photo larger than {MAX_BODY} bytes"})
            data = self.rfile.read(length)
            query = {k: v[0] for k, v in parse_qs(u.query).items()}
            t0 = time.perf_counter()
            if u.path == "/pdf":
                try:
                    info = service.pdfs.open(data, query.get("name", "document.pdf"))
                except ScannerError as e:
                    return self._json(400, {"error": e.code, "message": e.message})
                log.info("POST /pdf %s -> %d pages, %s, in %d ms", info["name"], info["pages"], info["lang"],
                         round((time.perf_counter() - t0) * 1000))
                return self._json(200, info)
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
    log.info("Reading service at http://127.0.0.1:%d (POST /scan, POST /document, POST /pdf, GET /health); Ctrl+C to quit", a.port)
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
