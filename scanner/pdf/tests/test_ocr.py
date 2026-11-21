"""Second OCR pass decision (without depending on how Tesseract reads a specific image)."""

import numpy as np

from scanner_pdf import ocr


def _w(text, conf, key=(1, 1, 1)):
    return {"key": key, "text": text, "conf": conf, "x": 0, "y": 0, "w": 10, "h": 10}


def test_doubtful_with_few_words_or_low_confidence():
    assert ocr._doubtful([])
    assert ocr._doubtful([_w("hola", 95)] * 3)
    assert ocr._doubtful([_w("hola", 40)] * 20)
    assert not ocr._doubtful([_w("hola", 90)] * 20)


def test_reliable_chars_only_counts_confident_words():
    assert ocr._reliable_chars([_w("DISCORD", 90), _w("xx", 20)]) == 7


def _simulate(monkeypatch, by_psm):
    calls = []

    def fake_pass(img, languages, dpi, psm, timeout):
        calls.append(psm)
        return f"pdf{psm}".encode(), by_psm[psm]

    monkeypatch.setattr(ocr, "_ocr_pass", fake_pass)
    return calls


IMG = np.zeros((1000, 800, 3), np.uint8)


def test_page_and_block_run_in_parallel_and_page_wins_when_it_reads_well(monkeypatch):
    calls = _simulate(monkeypatch, {3: [_w("palabra", 92)] * 30, 6: [_w("palabra", 92)] * 30, 11: []})
    r = ocr.recognize(IMG, "spa", 300)
    assert sorted(calls) == [3, 6] and r.psm == 3 and r.passes == 2 and r.text_pdf == b"pdf3"


def test_sparse_pass_when_the_first_reads_nothing(monkeypatch):
    # Real case: poster/card where psm 3 finds nothing and psm 11 reads "DISCORD SCAN TO JOIN".
    calls = _simulate(monkeypatch, {3: [], 6: [], 11: [_w("DISCORD", 93), _w("SCAN", 90), _w("JOIN", 88)]})
    r = ocr.recognize(IMG, "spa", 300)
    assert sorted(calls) == [3, 6, 11] and r.psm == 11 and r.text_pdf == b"pdf11"
    assert "ocr_sparse_text" in r.warnings and r.words == 3


def test_keeps_the_first_if_the_second_does_not_improve(monkeypatch):
    _simulate(monkeypatch, {3: [_w("hola", 80)] * 3, 6: [], 11: [_w("x", 30)] * 3})
    r = ocr.recognize(IMG, "spa", 300)
    assert r.psm == 3 and r.passes == 3


def test_filters_words_without_letters_or_digits():
    tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
           "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tDISCORD\n"
           "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90\t..,_\n"
           "5\t1\t1\t1\t1\t3\t0\t0\t10\t10\t90\tro�to\n")
    assert [w["text"] for w in ocr._read_tsv(tsv)] == ["DISCORD"]
