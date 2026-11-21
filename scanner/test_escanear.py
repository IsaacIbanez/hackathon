"""Tests del conector captura -> PDF, sin cámara: python -m unittest discover -s scanner"""

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent / "pdf" / "tests"))

import capturar  # noqa: E402
import escanear  # noqa: E402
import sinteticos  # noqa: E402
from escaner_pdf import Opciones  # noqa: E402

RAPIDO = Opciones(ocr=False, orientar=False)  # sin Tesseract: prueba la conexión, no el OCR


class TestEscanear(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.frame = sinteticos.con_sombra(sinteticos.en_mesa(sinteticos.pagina(), sinteticos.ESQUINAS_PERSPECTIVA))

    def tearDown(self):
        self.tmp.cleanup()

    META = {"camara": {"indice": 1, "nombre": "Logitech MX Brio"}, "resolucion_entregada": {"ancho": 1920, "alto": 1440}}

    def _captura_simulada(self):
        self.cierre = threading.Thread(target=lambda: None)  # capturar() devuelve el hilo que cierra la cámara
        self.cierre.start()
        return [
            mock.patch.object(capturar, "listar_camaras", return_value=[capturar.Camara(1, "Logitech MX Brio")]),
            mock.patch.object(capturar, "capturar", return_value=(self.frame, dict(self.META), self.cierre)),
        ]

    def test_captura_y_pdf(self):
        parches = self._captura_simulada()
        for p in parches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in parches])
        esc = escanear.escanear(carpeta_capturas=self.dir / "capturas", carpeta_pdf=self.dir / "pdf", opciones=RAPIDO)
        self.assertIsNone(esc.error_captura)
        self.assertTrue(esc.png.is_file())
        r = esc.resultado
        self.assertEqual(r.estado, "parcial")        # parcial = sin OCR en este test
        self.assertTrue(Path(r.pdf).is_file())
        self.assertEqual(r.pagina["papel"], "A4")
        # Los metadatos de la cámara llegan al resultado.
        self.assertEqual(r.entrada["metadatos"]["camara"]["nombre"], "Logitech MX Brio")
        self.assertEqual(Path(r.pdf).parent.name, esc.png.stem)  # mismo nombre que la captura
        self.assertFalse(self.cierre.is_alive())                  # se esperó a que la cámara se cerrara
        self.assertIn("momento", r.entrada["metadatos"])           # el JSON completo de guardar()

    def test_escanear_con_camara_viva(self):
        viva = mock.Mock()
        viva.capturar.return_value = (self.frame, dict(self.META, modo="servidor"))
        esc = escanear.escanear_viva(viva, carpeta_capturas=self.dir / "capturas", carpeta_pdf=self.dir / "pdf",
                                     opciones=RAPIDO)
        viva.capturar.assert_called_once()
        viva.cerrar.assert_not_called()                           # la cierra quien la abrió
        self.assertTrue(Path(esc.resultado.pdf).is_file())
        self.assertEqual(esc.resultado.entrada["metadatos"]["modo"], "servidor")

    def test_camara_viva_que_falla(self):
        viva = mock.Mock()
        viva.capturar.side_effect = capturar.ErrorCaptura("sin frames", capturar.ERR_SIN_FRAME)
        esc = escanear.escanear_viva(viva, carpeta_capturas=self.dir, carpeta_pdf=self.dir, opciones=RAPIDO)
        self.assertEqual(esc.error_captura["codigo"], capturar.ERR_SIN_FRAME)

    def test_sin_camara_devuelve_error_de_captura(self):
        with mock.patch.object(capturar, "listar_camaras", return_value=[capturar.Camara(0, "ACER HD")]):
            esc = escanear.escanear(carpeta_capturas=self.dir, carpeta_pdf=self.dir, opciones=RAPIDO)
        self.assertIsNone(esc.resultado)
        self.assertEqual(esc.error_captura["codigo"], capturar.ERR_CAMARA_NO_ENCONTRADA)
        self.assertFalse(esc.ok)

    def test_convertir_png_lee_el_json_de_la_captura(self):
        png = self.dir / "20261121-120000-000.png"
        png.write_bytes(sinteticos.png(self.frame))
        png.with_suffix(".json").write_text(json.dumps({"camara": {"nombre": "X"}}), encoding="utf-8")
        r = escanear.convertir_png(png, self.dir / "pdf", RAPIDO)
        self.assertEqual(r.entrada["metadatos"]["camara"]["nombre"], "X")
        self.assertTrue(Path(r.pdf).is_file())


if __name__ == "__main__":
    unittest.main()
