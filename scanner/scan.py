"""Scans a document end to end: capture (capturar.py, Pau) -> searchable PDF (pdf/, Didac).

Usage:
    python scanner/scan.py                       # MX Brio -> PNG in capturas/ -> PDF in pdf/output/
    python scanner/scan.py --camera 0            # another camera (index or part of the name)
    python scanner/scan.py --png capture.png     # no camera: converts an already captured PNG
    python scanner/scan.py --json                # full result as JSON (for integration)

From Python:
    from scan import scan, scan_live
    r = scan()                        # single capture -> ScanResult(png, capture_metadata, result)
    live = capturar.CamaraViva(...)   # or with the camera always open (capture in ~0.4 s):
    r = scan_live(live)

Only uses the public interface of capturar.py and scanner_pdf; it does not touch their code.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))                      # capturar.py
if str(ROOT / "pdf" / "src") not in sys.path:     # scanner_pdf, even if it is not installed with pip
    sys.path.insert(1, str(ROOT / "pdf" / "src"))

import capturar  # noqa: E402
from scanner_pdf import Options, Result, convert  # noqa: E402

log = logging.getLogger("scan")

PDF_DIR = ROOT / "pdf" / "output"
PARTIAL_EXIT = 5       # PDF made but partial (no text, does not validate...)
APP_URL = os.environ.get("LAUZHACK_MESSAGE_URL", "http://127.0.0.1:8765/message")   # Go app (docs/INTEGRACION_SCANNER.md)
FOCUS_WAIT = 1.4       # s; longest capturar.py waits for the autofocus to settle


@dataclass
class ScanResult:
    png: Path | None
    capture_metadata: dict | None
    result: Result | None
    capture_error: dict | None = None

    @property
    def ok(self) -> bool:
        return self.result is not None and self.result.ok

    def to_dict(self) -> dict:
        return {
            "png": str(self.png) if self.png else None,
            "capture": self.capture_metadata,
            "capture_error": self.capture_error,
            "result": self.result.to_dict() if self.result else None,
        }


def scan(camera: str | None = None, *, width: int = 3840, height: int = 2160,
         focus_wait: float = FOCUS_WAIT, captures_dir: Path = capturar.CARPETA_POR_DEFECTO,
         pdf_dir: Path = PDF_DIR, options: Options | None = None) -> ScanResult:
    """Single capture (opens and closes the camera) converted into a PDF.

    Camera errors come back in `capture_error`, with the capturar.py exit codes.
    """
    try:
        cam = _pick_camera(camera)
        moment = datetime.now().astimezone()
        frame, metadata, closing = capturar.capturar(cam, width, height, focus_wait)
        try:
            # The camera closes in a thread (~0.9 s on DirectShow) while the PNG is saved.
            png = capturar.guardar(frame, metadata, Path(captures_dir), moment)
        finally:
            closing.join()
    except capturar.ErrorCaptura as e:
        return ScanResult(None, None, None, {"code": e.codigo, "message": str(e)})
    return _convert_capture(png, pdf_dir, options)


def _pick_camera(camera: str | None) -> "capturar.Camara":
    """The requested one; with no preference, the MX Brio and, if missing, the first real camera.

    Team decision (AGENTS.md, 2026-11-21): "use whatever camera there is"; the Logitech one if connected.
    If a specific camera is requested and it is not there, that is an error.
    """
    cameras = capturar.listar_camaras()
    try:
        return capturar.elegir_camara(cameras, camera)
    except capturar.ErrorCaptura:
        real = [c for c in cameras if "virtual" not in c.nombre.lower()]
        if camera is not None or not real:
            raise
        log.warning("No MX Brio: using %s", real[0].nombre)
        return real[0]


def send_to_app(result: Result, url: str = APP_URL) -> bool:
    """Sends the document to the app (POST /message, see docs/INTEGRACION_SCANNER.md).

    Carries the contract `document` payload (Result.document(): line blocks with a normalised box and
    confidence, quality with FrameIssue). Returns False if the app is not running or rejects it.
    """
    envelope = {"type": "document", "id": f"doc-{uuid.uuid4()}", "ts": int(time.time() * 1000),
                "payload": result.document()}
    request = urllib.request.Request(url, data=json.dumps(envelope, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as resp:
            return resp.status == 202
    except OSError:
        return False


def scan_live(live: "capturar.CamaraViva", *, captures_dir: Path = capturar.CARPETA_POR_DEFECTO,
              pdf_dir: Path = PDF_DIR, options: Options | None = None) -> ScanResult:
    """Scans with a camera that is already open (capturar.CamaraViva): the capture takes ~0.4 s.

    Whoever creates the CamaraViva closes it (live.cerrar()).
    """
    try:
        moment = datetime.now().astimezone()
        frame, metadata = live.capturar()
        png = capturar.guardar(frame, metadata, Path(captures_dir), moment)
    except capturar.ErrorCaptura as e:
        return ScanResult(None, None, None, {"code": e.codigo, "message": str(e)})
    return _convert_capture(png, pdf_dir, options)


def _convert_capture(png: Path, pdf_dir: Path, options: Options | None) -> ScanResult:
    # guardar() writes the capture JSON with the moment, file and bytes: that one is used, in full.
    metadata = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
    return ScanResult(png, metadata, convert_png(png, pdf_dir, options, metadata))


def convert_png(png: Path, pdf_dir: Path = PDF_DIR, options: Options | None = None,
                metadata: dict | None = None) -> Result:
    """Converts an already captured PNG. If the capturar.py JSON sits next to it, it is attached."""
    png = Path(png)
    if metadata is None and png.with_suffix(".json").is_file():
        try:
            metadata = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            metadata = None
    return convert(png, pdf_dir, options, name=png.stem, metadata=metadata)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Captures a document and makes its searchable PDF.")
    p.add_argument("--camera", help='index ("0") or part of the name. Default: "brio"')
    p.add_argument("--png", type=Path, help="do not capture: convert this PNG")
    p.add_argument("--focus-wait", type=float, default=FOCUS_WAIT,
                   help="longest wait (s) for the focus to settle (default 1.4)")
    p.add_argument("--languages", default="spa+cat+eng")
    p.add_argument("--mode", choices=["color", "gray", "bw"], default="color")
    p.add_argument("--digital", action="store_true", help="also a digital PDF: real text and images in place")
    p.add_argument("--output", type=Path, default=PDF_DIR, help="PDF folder")
    p.add_argument("--send", action="store_true", help="send the document to the app (POST /message)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    op = Options(languages=a.languages, mode=a.mode, digital=a.digital)

    if a.png:
        sr = ScanResult(a.png, None, convert_png(a.png, a.output, op))
    else:
        sr = scan(a.camera, focus_wait=a.focus_wait, pdf_dir=a.output, options=op)

    sent = None
    if a.send and sr.result is not None and sr.result.pdf:
        sent = send_to_app(sr.result)
    if a.json:
        print(json.dumps({**sr.to_dict(), "sent_to_app": sent}, ensure_ascii=False, indent=2))
    elif sr.capture_error:
        print(f"Capture error: {sr.capture_error['message']}", file=sys.stderr)
    elif sr.result.error:
        print(f"Error [{sr.result.error['code']}]: {sr.result.error['message']}", file=sys.stderr)
    else:
        r = sr.result
        print(f"{r.status.upper()}: {r.pdf}")
        print(f"  capture {sr.png}")
        if r.digital_pdf:
            print(f"  digital: {r.digital_pdf} ({len(r.digital.get('to_review', []))} words to review)")
        if sent is not None:
            print("  sent to the app" if sent else f"  NOT sent: is the app running at {APP_URL}?")
        print(f"  quality {r.quality.get('score')} {r.quality.get('issues') or ''}; warnings {r.warnings or '-'}")
    if sr.capture_error:
        return sr.capture_error["code"]
    # 2/3/4 belong to the camera (capturar.py); that is why a partial PDF is 5 and not 2.
    return 0 if sr.ok else (1 if sr.result.status == "error" else PARTIAL_EXIT)


if __name__ == "__main__":
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    for stream in (sys.stdout, sys.stderr):
        if not stream.isatty():
            stream.reconfigure(encoding="utf-8")
    sys.exit(main())
