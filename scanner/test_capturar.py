"""Tests without a camera: python -m unittest discover -s scanner"""

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


class TestListing(unittest.TestCase):
    def test_parses_only_video_in_order(self):
        camaras = c.parsear_dshow(SALIDA_FFMPEG)
        self.assertEqual([(x.indice, x.nombre) for x in camaras],
                         [(0, "ACER HD User Facing"), (1, "Logitech MX Brio")])

    def test_empty_output(self):
        self.assertEqual(c.parsear_dshow(""), [])


class TestChoice(unittest.TestCase):
    camaras = c.parsear_dshow(SALIDA_FFMPEG)

    def test_looks_for_the_brio_by_default(self):
        self.assertEqual(c.elegir_camara(self.camaras, None).indice, 1)

    def test_by_name_case_insensitive(self):
        self.assertEqual(c.elegir_camara(self.camaras, "acer").indice, 0)

    def test_by_index(self):
        self.assertEqual(c.elegir_camara(self.camaras, "1").nombre, "Logitech MX Brio")

    def test_index_without_names(self):
        self.assertEqual(c.elegir_camara([], "3").indice, 3)

    def test_missing_index_fails(self):
        with self.assertRaises(c.ErrorCaptura):
            c.elegir_camara(self.camaras, "9")

    def test_without_brio_fails_and_does_not_fall_back(self):
        solo_acer = [c.Camara(0, "ACER HD User Facing")]
        with self.assertRaises(c.ErrorCaptura) as ctx:
            c.elegir_camara(solo_acer, None)
        self.assertEqual(ctx.exception.codigo, c.ERR_CAMARA_NO_ENCONTRADA)
        self.assertIn("ACER", str(ctx.exception))


def _secuencia(texto: str) -> list[c.Muestra]:
    """'t:brightness/sharpness ...' as measured on the MX Brio."""
    muestras = []
    for trozo in texto.split():
        t, resto = trozo.split(":")
        brillo, nitidez = resto.split("/")
        muestras.append(c.Muestra(float(t), float(brillo), float(nitidez)))
    return muestras


# Real MX Brio start-ups (21/11/2026): the autofocus readjusts ~1 s after the first frame.
ARRANQUE_1 = _secuencia(
    "1.02:138/407 1.07:138/409 1.11:138/410 1.16:138/408 1.20:138/416 1.54:137/401 1.58:136/402 "
    "1.63:136/388 1.68:137/401 1.72:136/404 1.77:136/394 1.81:136/395 1.86:136/402 1.90:137/403 "
    "1.95:137/397 2.00:136/440 2.04:136/427 2.09:136/452 2.13:136/368 2.18:136/312 2.22:136/152 "
    "2.27:136/181 2.31:136/433 2.36:136/447 2.40:136/444 2.45:136/456 2.49:136/465 2.54:136/476 "
    "2.59:136/468 2.63:136/463 2.68:136/454")
ARRANQUE_2 = _secuencia(
    "1.02:135/430 1.07:136/427 1.12:136/427 1.17:136/424 1.21:136/418 1.26:137/408 1.57:136/489 "
    "1.62:136/477 1.67:136/510 1.71:136/420 1.76:136/370 1.80:136/291 1.85:136/169 1.90:136/206 "
    "1.94:135/492 1.99:135/496 2.04:135/503 2.08:135/500 2.12:135/500 2.17:135/500 2.21:135/498")


def _alimentar(est: c.Estabilizador, muestras: list[c.Muestra]) -> tuple[str, c.Muestra]:
    estado = "esperando"
    for m in muestras:
        estado = est.agregar(m)
        if estado != "esperando":
            break
    return estado, m


class TestSettler(unittest.TestCase):
    def test_waits_for_the_autofocus_readjustment(self):
        for seq, t_min in ((ARRANQUE_1, 2.31), (ARRANQUE_2, 1.94)):
            est = c.Estabilizador(max_s=3)
            estado, ultima = _alimentar(est, seq)
            self.assertEqual(estado, "listo")
            # never fires before the focus has recovered
            self.assertGreater(ultima.t, t_min)
            self.assertGreaterEqual(est.mejor().nitidez, 440)

    def test_faster_than_the_fixed_wait(self):
        # Before: a fixed 1.5 s from the first frame. Now, on these start-ups, less.
        for seq in (ARRANQUE_1, ARRANQUE_2):
            _, ultima = _alimentar(c.Estabilizador(max_s=3), seq)
            self.assertLess(ultima.t - seq[0].t, 1.5)

    def test_without_readjustment_times_out_and_uses_the_sharpest(self):
        quieta = [c.Muestra(1 + i * 0.05, 130, 300 + (i % 3)) for i in range(60)]
        est = c.Estabilizador(max_s=1.6)
        estado, ultima = _alimentar(est, quieta)
        self.assertEqual(estado, "agotado")
        self.assertAlmostEqual(ultima.t - quieta[0].t, 1.6, delta=0.06)
        self.assertEqual(est.mejor().nitidez, 302)

    def test_does_not_pick_a_frame_from_the_readjustment(self):
        est = c.Estabilizador(max_s=0.2)  # times out in the middle of the readjustment
        _alimentar(est, ARRANQUE_2[9:14])  # 420 370 291 169 206
        self.assertEqual(est.mejor().nitidez, 420)


class TestUtilities(unittest.TestCase):
    def test_fourcc(self):
        mjpg = ord("M") | ord("J") << 8 | ord("P") << 16 | ord("G") << 24
        self.assertEqual(c.fourcc_a_texto(float(mjpg)), "MJPG")
        self.assertEqual(c.fourcc_a_texto(0), "")
        self.assertEqual(c.fourcc_a_texto(-1), "")

    def test_capture_name_sorts(self):
        self.assertEqual(c.nombre_captura(datetime(2026, 11, 21, 15, 4, 5, 123456)), "20261121-150405-123")


if __name__ == "__main__":
    unittest.main()
