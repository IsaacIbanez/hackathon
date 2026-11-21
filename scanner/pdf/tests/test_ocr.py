"""Decisión del segundo pase de OCR (sin depender de cómo lea Tesseract una imagen concreta)."""

import numpy as np

from escaner_pdf import ocr


def _p(texto, conf, clave=(1, 1, 1)):
    return {"clave": clave, "text": texto, "conf": conf, "x": 0, "y": 0, "w": 10, "h": 10}


def test_duda_con_pocas_palabras_o_confianza_baja():
    assert ocr._duda([])
    assert ocr._duda([_p("hola", 95)] * 3)
    assert ocr._duda([_p("hola", 40)] * 20)
    assert not ocr._duda([_p("hola", 90)] * 20)


def test_fiables_solo_cuenta_lo_seguro():
    assert ocr._fiables([_p("DISCORD", 90), _p("xx", 20)]) == 7


def _simular(monkeypatch, por_psm):
    llamadas = []

    def pase(img, idiomas, dpi, psm, timeout):
        llamadas.append(psm)
        return f"pdf{psm}".encode(), por_psm[psm]

    monkeypatch.setattr(ocr, "_pase", pase)
    return llamadas


IMG = np.zeros((1000, 800, 3), np.uint8)


def test_un_solo_pase_si_el_primero_va_bien(monkeypatch):
    llamadas = _simular(monkeypatch, {3: [_p("palabra", 92)] * 30, 11: []})
    r = ocr.reconocer(IMG, "spa", 300)
    assert llamadas == [3] and r.psm == 3 and r.pases == 1 and r.pdf_texto == b"pdf3"


def test_segundo_pase_disperso_cuando_el_primero_no_lee(monkeypatch):
    # Caso real: cartel/tarjeta donde psm 3 no encuentra nada y psm 11 lee "DISCORD SCAN TO JOIN".
    llamadas = _simular(monkeypatch, {3: [], 11: [_p("DISCORD", 93), _p("SCAN", 90), _p("JOIN", 88)]})
    r = ocr.reconocer(IMG, "spa", 300)
    assert llamadas == [3, 11] and r.psm == 11 and r.pdf_texto == b"pdf11"
    assert "ocr_texto_disperso" in r.avisos and r.palabras == 3


def test_se_queda_con_el_primero_si_el_segundo_no_mejora(monkeypatch):
    _simular(monkeypatch, {3: [_p("hola", 80)] * 3, 11: [_p("x", 30)] * 3})
    r = ocr.reconocer(IMG, "spa", 300)
    assert r.psm == 3 and r.pases == 2


def test_filtra_palabras_sin_letras_ni_numeros():
    tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
           "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tDISCORD\n"
           "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90\t..,_\n"
           "5\t1\t1\t1\t1\t3\t0\t0\t10\t10\t90\tro�to\n")
    assert [p["text"] for p in ocr._leer_tsv(tsv)] == ["DISCORD"]
