import unittest

import bench


class WordsTest(unittest.TestCase):
    def test_normalises_case_and_punctuation_but_keeps_accents(self):
        self.assertEqual(bench.words("Póliza Nº 12,50 €; ¡Firme aquí!"), ["póliza", "nº", "12,50", "€", "firme", "aquí"])
        self.assertEqual(bench.words("Fecha: 15/12/2026."), ["fecha", "15/12/2026"])
        self.assertNotEqual(bench.words("Póliza"), bench.words("Poliza"))

    def test_word_accuracy(self):
        truth = bench.words("el plazo vence el quince de diciembre")
        self.assertEqual(bench.word_accuracy(truth, truth), 1.0)
        self.assertAlmostEqual(bench.word_accuracy(truth, bench.words("el plazo vence el 15 de diciembre")), 6 / 7)
        self.assertAlmostEqual(bench.word_accuracy(truth, bench.words("el plazo el quince de diciembre")), 6 / 7)
        self.assertEqual(bench.word_accuracy(truth, []), 0.0)

    def test_word_recall_ignores_the_order_of_a_table(self):
        truth = bench.words("periode import jul 18,40 set 41,15")
        rows = bench.words("periode jul set import 18,40 41,15")
        self.assertEqual(bench.word_recall(truth, rows), 1.0)
        self.assertLess(bench.word_accuracy(truth, rows), 1.0)
        self.assertAlmostEqual(bench.word_recall(bench.words("plaça bancària"), bench.words("plaga bancaria")), 0.0)


class CornersTest(unittest.TestCase):
    def sheet(self, w, h, x0=0.2, y0=0.1):
        # A portrait sheet of w x h pixels inside a 3840x2160 photo.
        X, Y = 3840, 2160
        return [{"x": x0, "y": y0}, {"x": x0 + w / X, "y": y0}, {"x": x0 + w / X, "y": y0 + h / Y}, {"x": x0, "y": y0 + h / Y}]

    def test_a4_is_ok_and_other_shapes_are_not(self):
        ok, aspect = bench.corners_check(self.sheet(1200, 1697), 3840, 2160)
        self.assertTrue(ok)
        self.assertAlmostEqual(aspect, 1.414, places=2)
        self.assertFalse(bench.corners_check(self.sheet(1200, 1200), 3840, 2160)[0])  # square: cut sheet
        self.assertFalse(bench.corners_check(None, 3840, 2160)[0])

    def test_crossed_corners_are_not_a_sheet(self):
        c = self.sheet(1200, 1697)
        c[1], c[2] = c[2], c[1]
        self.assertFalse(bench.corners_check(c, 3840, 2160)[0])

    def test_photo_names(self):
        self.assertEqual(bench.parse_photo(bench.photo_name("hand", "02", 1)), ("hand", "02", 1))
        self.assertIsNone(bench.parse_photo("scan-123.png"))


if __name__ == "__main__":
    unittest.main()
