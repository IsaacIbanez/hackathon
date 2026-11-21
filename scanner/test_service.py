"""Tests of the reading service (POST /scan on 8770), with a real HTTP server on a free port:
python -m unittest discover -s scanner"""

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "pdf" / "tests"))

import service  # noqa: E402
import synthetic  # noqa: E402
from scanner_pdf import Options, ocr  # noqa: E402
from scanner_pdf.errors import ScannerError  # noqa: E402

try:
    ocr.prepare_tesseract()
    TESSERACT = True
except ScannerError:
    TESSERACT = False


class TestScanService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        svc = service.ScanService(Path(cls.tmp.name), lambda q: Options(save_intermediates=False))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), service.make_handler(svc))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.photo = synthetic.with_shadow(synthetic.on_desk(synthetic.page(), synthetic.PERSPECTIVE_CORNERS))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def post(self, body: bytes, path: str = "/scan", content_type: str = "image/png"):
        req = urllib.request.Request(self.url + path, data=body, method="POST", headers={"Content-Type": content_type})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e), dict(e.headers)

    @unittest.skipUnless(TESSERACT, "needs Tesseract")
    def test_png_gives_document_with_page_corners(self):
        status, body, headers = self.post(synthetic.png(self.photo))
        self.assertEqual(status, 200, body)
        self.assertTrue(body["blocks"])
        self.assertIn("siniestro", " ".join(b["text"] for b in body["blocks"]))
        got = np.array([[p["x"], p["y"]] for p in body["pageCorners"]])
        expected = synthetic.PERSPECTIVE_CORNERS / np.array([1920, 1440])
        self.assertLess(np.abs(got - expected).max(), 0.003)
        self.assertTrue(Path(headers["X-Scan-Pdf"]).is_file())
        self.assertIn("X-Scan-Ms", headers)

    @unittest.skipUnless(TESSERACT, "needs Tesseract")
    def test_jpeg_is_accepted(self):
        ok, jpg = cv2.imencode(".jpg", self.photo, [cv2.IMWRITE_JPEG_QUALITY, 90])
        status, body, _ = self.post(jpg.tobytes(), content_type="image/jpeg")
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["pageCorners"]), 4)

    def test_no_sheet_answers_422_fast(self):
        rng = np.random.default_rng(3)
        noise = cv2.GaussianBlur((rng.random((800, 1000, 3)) * 255).astype(np.uint8), (0, 0), 3)
        status, body, headers = self.post(synthetic.png(noise))
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "page_not_detected")
        self.assertIn("issues", body["quality"])
        self.assertLess(int(headers["X-Scan-Ms"]), 3000)          # no OCR when there is no sheet

    def test_not_an_image_answers_400(self):
        status, body, _ = self.post(b"this is not an image")
        self.assertEqual((status, body["error"]), (400, "input_not_png"))

    def test_empty_body_answers_400(self):
        status, body, _ = self.post(b"")
        self.assertEqual((status, body["error"]), (400, "input_empty"))

    def test_health_and_unknown_path(self):
        with urllib.request.urlopen(self.url + "/health", timeout=5) as r:
            self.assertTrue(json.load(r)["ok"])
        status, body, _ = self.post(b"x", path="/nope")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
