"""Tests of the capture -> PDF connector, without a camera: python -m unittest discover -s scanner"""

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent / "pdf" / "tests"))

import capturar  # noqa: E402
import scan  # noqa: E402
import synthetic  # noqa: E402
from scanner_pdf import Options  # noqa: E402

FAST = Options(ocr=False, orient=False)  # no Tesseract: tests the wiring, not the OCR


class TestScan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.frame = synthetic.with_shadow(synthetic.on_desk(synthetic.page(), synthetic.PERSPECTIVE_CORNERS))

    def tearDown(self):
        self.tmp.cleanup()

    META = {"camara": {"indice": 1, "nombre": "Logitech MX Brio"}, "resolucion_entregada": {"ancho": 1920, "alto": 1440}}

    def _simulated_capture(self):
        self.closing = threading.Thread(target=lambda: None)  # capturar() returns the thread closing the camera
        self.closing.start()
        return [
            mock.patch.object(capturar, "listar_camaras", return_value=[capturar.Camara(1, "Logitech MX Brio")]),
            mock.patch.object(capturar, "capturar", return_value=(self.frame, dict(self.META), self.closing)),
        ]

    def test_capture_and_pdf(self):
        patches = self._simulated_capture()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        sr = scan.scan(captures_dir=self.dir / "capturas", pdf_dir=self.dir / "pdf", options=FAST)
        self.assertIsNone(sr.capture_error)
        self.assertTrue(sr.png.is_file())
        r = sr.result
        self.assertEqual(r.status, "partial")        # partial = no OCR in this test
        self.assertTrue(Path(r.pdf).is_file())
        self.assertEqual(r.page["paper"], "A4")
        # The camera metadata reaches the result.
        self.assertEqual(r.input["metadata"]["camara"]["nombre"], "Logitech MX Brio")
        self.assertEqual(Path(r.pdf).parent.name, sr.png.stem)   # same name as the capture
        self.assertFalse(self.closing.is_alive())                # it waited for the camera to close
        self.assertIn("momento", r.input["metadata"])             # the full JSON from guardar()

    def test_scan_with_live_camera(self):
        live = mock.Mock()
        live.capturar.return_value = (self.frame, dict(self.META, modo="servidor"))
        sr = scan.scan_live(live, captures_dir=self.dir / "capturas", pdf_dir=self.dir / "pdf", options=FAST)
        live.capturar.assert_called_once()
        live.cerrar.assert_not_called()                          # whoever opened it closes it
        self.assertTrue(Path(sr.result.pdf).is_file())
        self.assertEqual(sr.result.input["metadata"]["modo"], "servidor")

    def test_failing_live_camera(self):
        live = mock.Mock()
        live.capturar.side_effect = capturar.ErrorCaptura("no frames", capturar.ERR_SIN_FRAME)
        sr = scan.scan_live(live, captures_dir=self.dir, pdf_dir=self.dir, options=FAST)
        self.assertEqual(sr.capture_error["code"], capturar.ERR_SIN_FRAME)

    def test_no_camera_returns_capture_error(self):
        with mock.patch.object(capturar, "listar_camaras", return_value=[]):
            sr = scan.scan(captures_dir=self.dir, pdf_dir=self.dir, options=FAST)
        self.assertIsNone(sr.result)
        self.assertEqual(sr.capture_error["code"], capturar.ERR_CAMARA_NO_ENCONTRADA)
        self.assertFalse(sr.ok)

    def test_convert_png_reads_the_capture_json(self):
        png = self.dir / "20261121-120000-000.png"
        png.write_bytes(synthetic.png(self.frame))
        png.with_suffix(".json").write_text(json.dumps({"camara": {"nombre": "X"}}), encoding="utf-8")
        r = scan.convert_png(png, self.dir / "pdf", FAST)
        self.assertEqual(r.input["metadata"]["camara"]["nombre"], "X")
        self.assertTrue(Path(r.pdf).is_file())


class TestSendToApp(unittest.TestCase):
    """POST /message to the app (docs/INTEGRACION_SCANNER.md), with a local server acting as the app."""

    def setUp(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        received = self.received = []

        class App(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(202)
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), App)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/message"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _result(self):
        result = mock.Mock()
        result.document.return_value = {"blocks": [], "quality": {"score": 1.0, "issues": []}}
        return result

    def test_sends_the_contract_document(self):
        self.assertTrue(scan.send_to_app(self._result(), self.url))
        envelope = self.received[0]
        self.assertEqual(envelope["type"], "document")
        self.assertTrue(envelope["id"].startswith("doc-") and isinstance(envelope["ts"], int))
        self.assertEqual(envelope["payload"]["quality"]["score"], 1.0)

    def test_closed_app_returns_false(self):
        self.assertFalse(scan.send_to_app(self._result(), "http://127.0.0.1:9/message"))


class TestAvailableCamera(unittest.TestCase):
    """Team decision: without an MX Brio, whatever camera there is gets used (not the virtual one)."""

    def test_without_brio_uses_the_first_real_one(self):
        cameras = [capturar.Camara(0, "USB2.0 HD UVC WebCam"), capturar.Camara(1, "Windows Virtual Camera")]
        with mock.patch.object(capturar, "listar_camaras", return_value=cameras):
            self.assertEqual(scan._pick_camera(None).indice, 0)

    def test_requested_camera_that_is_missing_is_an_error(self):
        with mock.patch.object(capturar, "listar_camaras", return_value=[capturar.Camara(0, "USB2.0 HD UVC WebCam")]):
            with self.assertRaises(capturar.ErrorCaptura):
                scan._pick_camera("brio")


if __name__ == "__main__":
    unittest.main()
