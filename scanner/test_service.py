"""Tests of the reading service (POST /scan on 8770), with a real HTTP server on a free port:
python -m unittest discover -s scanner"""

import json
import sys
import tempfile
import threading
import time
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


class ServiceServer(unittest.TestCase):
    """A real reading service on a free port (shared by the test classes)."""

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


class TestScanService(ServiceServer):
    @unittest.skipUnless(TESSERACT, "needs Tesseract")
    def test_png_gives_document_with_page_corners(self):
        status, body, headers = self.post(synthetic.png(self.photo))
        self.assertEqual(status, 200, body)
        self.assertTrue(body["blocks"])
        self.assertIn("siniestro", " ".join(b["text"] for b in body["blocks"]))
        got = np.array([[p["x"], p["y"]] for p in body["pageCorners"]])
        expected = synthetic.PERSPECTIVE_CORNERS / np.array([1920, 1440])
        self.assertLess(np.abs(got - expected).max(), 0.003)
        # The answer comes before the PDFs (they are finished in the background, N3): wait for them.
        folder = Path(headers["X-Scan-Folder"])
        deadline = time.monotonic() + 30
        while not list(folder.glob("*.pdf")) and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertTrue(list(folder.glob("*.pdf")))
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


def _pdf(pages: list[list[str]], text: bool = True) -> bytes:
    """A small A4 PDF: one list of lines per page. text=False draws the page as an image (a scan)."""
    import io

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for lines in pages:
        if text:
            c.setFont("Helvetica", 14)
            for i, line in enumerate(lines):
                c.drawString(72, A4[1] - 100 - i * 24, line)
        else:
            img = np.full((1754, 1240, 3), 255, np.uint8)
            for i, line in enumerate(lines):
                cv2.putText(img, line, (120, 250 + i * 90), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 4, cv2.LINE_AA)
            ok, png = cv2.imencode(".png", img)
            c.drawImage(ImageReader(io.BytesIO(png.tobytes())), 0, 0, *A4)
        c.showPage()
    c.save()
    return buf.getvalue()


class TestDocumentEndpoint(ServiceServer):
    """POST /document: files from the computer (overlay option "Read a file")."""

    def test_pdf_with_text_gives_its_lines_page_by_page(self):
        pdf = _pdf([["Renewal of your home policy", "Deadline: 15 December 2026"], ["Second page line"]])
        status, body, headers = self.post(pdf, "/document?name=letter.pdf", "application/pdf")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["source"], "pdf_text")
        texts = [b["text"] for b in sorted(body["blocks"], key=lambda b: b["box"]["y"])]
        self.assertEqual(texts, ["Renewal of your home policy", "Deadline: 15 December 2026", "Second page line"])
        self.assertEqual(body["blocks"][-1]["id"], "p2-l1")
        for b in body["blocks"]:
            self.assertTrue(all(0 <= b["box"][k] <= 1 for k in "xywh"), b)
        self.assertGreaterEqual(body["blocks"][-1]["box"]["y"], 0.5)     # page 2 is in the lower half

    def test_print_sample_letter(self):
        pdf = (Path(__file__).resolve().parent / "pdf" / "samples" / "print" / "01-carta-renovacion.pdf").read_bytes()
        status, body, _ = self.post(pdf, "/document?name=carta.pdf", "application/pdf")
        self.assertEqual(status, 200, body)
        joined = " ".join(b["text"] for b in body["blocks"])
        self.assertIn("284,60 euros", joined)
        self.assertGreater(len(body["blocks"]), 15)

    @unittest.skipUnless(TESSERACT, "needs Tesseract")
    def test_scanned_pdf_goes_through_ocr(self):
        pdf = _pdf([["DECLARACION DE SINIESTRO", "Numero de poliza"]], text=False)
        status, body, _ = self.post(pdf, "/document?name=scan.pdf", "application/pdf")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["source"], "pdf_scanned")
        self.assertIn("SINIESTRO", " ".join(b["text"] for b in body["blocks"]).upper())

    def test_not_a_document(self):
        status, body, _ = self.post(b"hello, not a pdf", "/document?name=x.bin", "application/octet-stream")
        self.assertEqual(status, 400, body)


SAMPLES = Path(__file__).resolve().parent / "pdf" / "samples" / "print"


class TestPdfPages(ServiceServer):
    """POST /pdf and GET /pdf/<id>/page/<n>: a PDF read page by page (task N4)."""

    def get(self, path: str):
        try:
            with urllib.request.urlopen(self.url + path, timeout=120) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def open_pdf(self, name: str) -> dict:
        status, body, _ = self.post((SAMPLES / name).read_bytes(), f"/pdf?name={name}", "application/pdf")
        self.assertEqual(status, 200, body)
        return body

    def test_long_pdf_has_no_page_limit(self):
        info = self.open_pdf("04-condiciones-40-paginas.pdf")
        self.assertEqual(info["pages"], 40)
        self.assertEqual(info["lang"], "es-ES")
        status, raw, _ = self.get(f"/pdf/{info['id']}/page/39/lines")      # the last page, beyond the old 30
        self.assertEqual(status, 200, raw)
        page = json.loads(raw)
        self.assertFalse(page["ocr"])
        texts = [line["text"] for line in page["lines"]]
        self.assertIn("Página 40 de 40", " ".join(texts))
        self.assertTrue(texts[0].startswith("S"))                      # reading order: the logo letter first
        ys = [line["box"]["y"] for line in page["lines"]]
        self.assertEqual(ys, sorted(ys))
        for line in page["lines"]:
            self.assertTrue(all(0 <= line["box"][k] <= 1 for k in "xywh"), line)
            self.assertTrue(line["id"].startswith("p40-l"))

    def test_page_image(self):
        info = self.open_pdf("01-carta-renovacion.pdf")
        status, jpg, headers = self.get(f"/pdf/{info['id']}/page/0.jpg?width=600")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/jpeg")
        img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(img.shape[1], 600)
        self.assertAlmostEqual(img.shape[0] / img.shape[1], 297 / 210, places=2)

    def test_catalan_is_detected(self):
        self.assertEqual(self.open_pdf("03-avis-rebut-ca.pdf")["lang"], "ca-ES")

    @unittest.skipUnless(TESSERACT, "needs Tesseract")
    def test_scanned_page_goes_through_ocr(self):
        info = self.open_pdf("05-escaneado-3-paginas.pdf")
        self.assertEqual(info["pages"], 3)
        status, raw, _ = self.get(f"/pdf/{info['id']}/page/1/lines")
        page = json.loads(raw)
        self.assertEqual(status, 200, page)
        self.assertTrue(page["ocr"])
        self.assertIn("SINIESTRO", " ".join(line["text"] for line in page["lines"]).upper())

    def test_errors(self):
        status, body, _ = self.post(b"not a pdf", "/pdf?name=x.pdf", "application/pdf")
        self.assertEqual((status, body["error"]), (400, "input_not_pdf"))
        info = self.open_pdf("01-carta-renovacion.pdf")
        status, raw, _ = self.get(f"/pdf/{info['id']}/page/5/lines")
        self.assertEqual((status, json.loads(raw)["error"]), (404, "page_not_found"))
        status, raw, _ = self.get("/pdf/0123abcd/page/0/lines")
        self.assertEqual((status, json.loads(raw)["error"]), (404, "pdf_not_open"))

    def test_only_the_last_pdfs_stay_open(self):
        ids = [self.open_pdf("01-carta-renovacion.pdf")["id"] for _ in range(4)]
        self.assertEqual(self.get(f"/pdf/{ids[0]}/page/0/lines")[0], 404)
        self.assertEqual(self.get(f"/pdf/{ids[-1]}/page/0/lines")[0], 200)
