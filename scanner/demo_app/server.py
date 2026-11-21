"""PROVISIONAL TEST APP — not part of the product. This whole folder can be deleted.

Small server at http://localhost:8780 to try capture + PDF from the browser: camera preview, scan
button, image upload and result viewer.

    scanner\\pdf\\.venv\\Scripts\\python scanner\\demo_app\\server.py      (Windows)
    scanner/pdf/.venv/bin/python scanner/demo_app/server.py             (Linux/macOS)

Only listens on 127.0.0.1. Uses scan.scan, scan.scan_live, scan.convert_png and capturar.CamaraViva.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
SCANNER = HERE.parent
sys.path.insert(0, str(SCANNER))
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import capturar  # noqa: E402
import scan  # noqa: E402
from scanner_pdf import Options, geometry  # noqa: E402

ALLOWED_DIRS = [capturar.CARPETA_POR_DEFECTO.resolve(), scan.PDF_DIR.resolve()]
MAX_UPLOAD = 60 * 1024 * 1024


# ---------------------------------------------------------------- open camera

class Camera:
    """Wraps capturar.CamaraViva (Pau): the camera stays open, reading at full resolution.

    The preview and the capture share the same camera, so a scan takes ~0.4 s to capture and the
    preview does not have to be closed to free the device.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.live: capturar.CamaraViva | None = None

    def open(self, camera: str | None) -> dict:
        cam = capturar.elegir_camara(capturar.listar_camaras(), camera)
        with self.lock:
            if self.live is not None and self.live.camara.indice == cam.indice:
                return self.live.estado()
            self._close()
            self.live = capturar.CamaraViva(cam, 3840, 2160, scan.FOCUS_WAIT)
            return self.live.estado()

    def close(self) -> None:
        with self.lock:
            self._close()

    def _close(self) -> None:
        if self.live is not None:
            live, self.live = self.live, None
            live.cerrar()

    def _last_frame(self):
        # `recientes` is an internal attribute of capturar.py: fine for this provisional app;
        # if Pau adds a public method, use it.
        live = self.live
        if live is None:
            return None
        with live.cond:
            return live.recientes[-1].frame if live.recientes else None

    def detection(self) -> dict:
        """Sheet detection on the last frame (to draw the outline over the preview)."""
        if self.live is None:
            return {"open": False}
        frame = self._last_frame()
        if frame is None:
            return {"open": True, "found": False}
        scale = 1280 / frame.shape[1]
        small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        d = geometry.detect_page(small)
        height, width = small.shape[:2]
        corners = None if d.corners is None else [[float(x) / width, float(y) / height] for x, y in d.corners]
        return {"open": True, "found": d.found, "confidence": round(d.confidence, 2),
                "touches_border": d.touches_border, "corners": corners}

    def last_jpeg(self, width: int = 960) -> bytes | None:
        frame = self._last_frame()
        if frame is None:
            return None
        scale = width / frame.shape[1]
        small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return buf.tobytes() if ok else None


CAMERA = Camera()
SCANNING = threading.Lock()  # one scan at a time


# ---------------------------------------------------------------- helpers

def _scan_response(sr: scan.ScanResult, send: bool = False) -> dict:
    """Result + file URLs for the browser (and, if requested, sending to the Go app)."""
    d = sr.to_dict()
    r = sr.result
    if send and r is not None and r.pdf:
        d["sent_to_app"] = scan.send_to_app(r)
    if r is not None:
        urls = {k: _url(v) for k, v in r.intermediates.items()}
        if r.pdf:
            urls["pdf"] = _url(r.pdf)
        if r.digital_pdf:
            urls["digital_pdf"] = _url(r.digital_pdf)
        d["urls"] = urls
        d["document"] = r.document()
    return d


def _url(path: str) -> str:
    return "/file?path=" + path.replace("\\", "/")


def _allowed(path: Path) -> bool:
    path = path.resolve()
    return path.is_file() and any(path.is_relative_to(d) for d in ALLOWED_DIRS)


def _options(q: dict) -> Options:
    return Options(mode=q.get("mode", "color"), languages=q.get("languages", "spa+cat+eng"),
                   crop=q.get("crop", "1") != "0", lighting=q.get("lighting", "1") != "0",
                   digital=q.get("digital", "0") == "1")


# ---------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    server_version = "ScannerDemoApp/0"

    def log_message(self, fmt, *args):  # less console noise
        if "/preview.mjpg" not in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # --- responses
    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, content_type: str):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # --- GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/":
            return self._file(HERE / "index.html", "text/html; charset=utf-8")
        if u.path == "/api/cameras":
            cameras = capturar.listar_camaras()
            live = CAMERA.live
            return self._json({"cameras": [{"index": c.indice, "name": c.nombre} for c in cameras],
                               "open": live.camara.indice if live else None})
        if u.path == "/api/detection":
            return self._json(CAMERA.detection())
        if u.path == "/api/camera/state":
            live = CAMERA.live
            return self._json(live.estado() if live else {"ok": False, "open": False})
        if u.path == "/preview.mjpg":
            return self._mjpeg()
        if u.path == "/file":
            path = Path(q.get("path", ""))
            if not _allowed(path):
                return self._json({"error": "path not allowed"}, 404)
            types = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json"}
            return self._file(path, types.get(path.suffix.lower(), "application/octet-stream"))
        self._json({"error": "not found"}, 404)

    def _mjpeg(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while CAMERA.live is not None:
                jpeg = CAMERA.last_jpeg()
                if jpeg:
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                time.sleep(1 / 15)
        except (ConnectionError, OSError):
            pass  # the browser closed the connection

    # --- POST
    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/camera/open":
                return self._json(CAMERA.open(q.get("camera")))
            if u.path == "/api/camera/close":
                CAMERA.close()
                return self._json({"ok": True})
            if u.path == "/api/scan":
                return self._scan(q)
            if u.path == "/api/upload":
                return self._upload(q)
            if u.path == "/api/reprocess":
                return self._reprocess(q)
        except capturar.ErrorCaptura as e:
            return self._json({"capture_error": {"code": e.codigo, "message": str(e)}}, 400)
        self._json({"error": "not found"}, 404)

    def _scan(self, q):
        if not SCANNING.acquire(blocking=False):
            return self._json({"error": "a scan is already running"}, 409)
        try:
            live = CAMERA.live
            if live is not None:   # camera already open: capture in ~0.4 s
                sr = scan.scan_live(live, options=_options(q))
            else:                  # single capture: open, wait for focus, capture and close
                sr = scan.scan(q.get("camera"), focus_wait=float(q.get("wait", scan.FOCUS_WAIT)), options=_options(q))
            return self._json(_scan_response(sr, q.get("send") == "1"))
        finally:
            SCANNING.release()

    def _reprocess(self, q):
        """Rebuilds the PDF of a capture with hand-placed corners (normalised to [0, 1])."""
        png = Path(q.get("png", ""))
        if not (_allowed(png) and png.suffix.lower() == ".png"):
            return self._json({"error": "capture not allowed"}, 404)
        try:
            v = [float(x) for x in q.get("corners", "").split(",")]
        except ValueError:
            v = []
        if len(v) != 8 or not all(0 <= x <= 1 for x in v):
            return self._json({"error": "corners: 8 numbers between 0 and 1"}, 400)
        with Image.open(png) as im:   # only reads the header
            width, height = im.size
        op = _options(q)
        op.corners = [[v[i] * width, v[i + 1] * height] for i in range(0, 8, 2)]
        with SCANNING:
            sr = scan.ScanResult(png, None, scan.convert_png(png, options=op))
        return self._json(_scan_response(sr, q.get("send") == "1"))

    def _upload(self, q):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_UPLOAD:
            return self._json({"error": "invalid file size"}, 400)
        data = self.rfile.read(length)
        folder = capturar.CARPETA_POR_DEFECTO
        folder.mkdir(parents=True, exist_ok=True)
        png = (folder / f"upload-{datetime.now():%Y%m%d-%H%M%S-%f}"[:-3]).with_suffix(".png")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            png.write_bytes(data)
        else:
            # Convenience of the test app only (e.g. phone JPG photos): converted to PNG.
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                return self._json({"error": "not an image"}, 400)
            png.write_bytes(cv2.imencode(".png", img)[1].tobytes())
        with SCANNING:
            sr = scan.ScanResult(png, None, scan.convert_png(png, options=_options(q)))
        return self._json(_scan_response(sr, q.get("send") == "1"))


def main() -> int:
    p = argparse.ArgumentParser(description="Provisional scanner test app (localhost)")
    p.add_argument("--port", type=int, default=8780,
                   help="not 8765: used by the Wails app (WebSocket); 8766 is capturar.py --servidor")
    p.add_argument("--no-browser", action="store_true", help="do not open the browser")
    a = p.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://localhost:{a.port}/"
    print(f"Test app at {url}  (Ctrl+C to quit)")
    if not a.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        CAMERA.close()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
