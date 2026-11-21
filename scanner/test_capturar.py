"""Tests sin cámara: python -m unittest discover -s scanner"""

import unittest
from datetime import datetime

import capturar as c

SALIDA_FFMPEG = '''
[in#0 @ 000001ad38878ec0] "ACER HD User Facing" (video)
[in#0 @ 000001ad38878ec0]   Alternative name "@device_pnp_\\\\?\\usb#vid_0408&pid_403a"
[in#0 @ 000001ad38878ec0] "Logitech MX Brio" (video)
[in#0 @ 000001ad38878ec0]   Alternative name "@device_pnp_\\\\?\\usb#vid_046d&pid_0944"
[in#0 @ 000001ad38878ec0] "Micrófono (Realtek(R) Audio)" (audio)
Error opening input file dummy.
'''


class TestListado(unittest.TestCase):
    def test_parsea_solo_video_en_orden(self):
        camaras = c.parsear_dshow(SALIDA_FFMPEG)
        self.assertEqual([(x.indice, x.nombre) for x in camaras],
                         [(0, "ACER HD User Facing"), (1, "Logitech MX Brio")])

    def test_salida_vacia(self):
        self.assertEqual(c.parsear_dshow(""), [])


class TestEleccion(unittest.TestCase):
    camaras = c.parsear_dshow(SALIDA_FFMPEG)

    def test_por_defecto_busca_la_brio(self):
        self.assertEqual(c.elegir_camara(self.camaras, None).indice, 1)

    def test_por_nombre_sin_mayusculas(self):
        self.assertEqual(c.elegir_camara(self.camaras, "acer").indice, 0)

    def test_por_indice(self):
        self.assertEqual(c.elegir_camara(self.camaras, "1").nombre, "Logitech MX Brio")

    def test_indice_sin_nombres(self):
        self.assertEqual(c.elegir_camara([], "3").indice, 3)

    def test_indice_inexistente_falla(self):
        with self.assertRaises(c.ErrorCaptura):
            c.elegir_camara(self.camaras, "9")

    def test_sin_brio_falla_y_no_cae_en_otra(self):
        solo_acer = [c.Camara(0, "ACER HD User Facing")]
        with self.assertRaises(c.ErrorCaptura) as ctx:
            c.elegir_camara(solo_acer, None)
        self.assertEqual(ctx.exception.codigo, c.ERR_CAMARA_NO_ENCONTRADA)
        self.assertIn("ACER", str(ctx.exception))


class TestUtilidades(unittest.TestCase):
    def test_fourcc(self):
        mjpg = ord("M") | ord("J") << 8 | ord("P") << 16 | ord("G") << 24
        self.assertEqual(c.fourcc_a_texto(float(mjpg)), "MJPG")
        self.assertEqual(c.fourcc_a_texto(0), "")
        self.assertEqual(c.fourcc_a_texto(-1), "")

    def test_nombre_captura_ordenable(self):
        self.assertEqual(c.nombre_captura(datetime(2026, 11, 21, 15, 4, 5, 123456)), "20261121-150405-123")


if __name__ == "__main__":
    unittest.main()
