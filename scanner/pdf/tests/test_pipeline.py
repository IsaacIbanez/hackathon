import json

import cv2
import numpy as np
import pytest
from pdfminer.high_level import extract_text

import sinteticos as s
from escaner_pdf import Opciones, convertir, ocr
from escaner_pdf.errores import ErrorEscaner


@pytest.fixture(scope="module")
def mesa_png() -> bytes:
    return s.png(s.con_sombra(s.en_mesa(s.pagina(), s.ESQUINAS_PERSPECTIVA)))


@pytest.mark.ocr
def test_extremo_a_extremo(tmp_path, mesa_png):
    r = convertir(mesa_png, tmp_path, nombre="prueba")
    assert r.estado == "ok", (r.error, r.avisos, r.validacion)
    assert r.buscable and r.paginas == 1
    assert r.pagina["papel"] == "A4"
    v = r.validacion
    assert v["tamano_correcto"] and v["imagen_resolucion_completa"]
    assert v["psnr_db"] >= 40                      # la imagen del PDF es la página, sin recodificar
    assert v["palabras_encontradas"] > 0.95
    assert v["desfase_mediano"] < 0.01             # capa de texto alineada con la imagen

    texto = extract_text(r.pdf)
    for palabra in ("siniestro", "Barcelona", "asegurado", "Dirección"):
        assert palabra in texto

    # Original intacto, intermedios y resultado guardados.
    assert open(r.intermedios["original"], "rb").read() == mesa_png
    for clave in ("pagina", "base_pdf", "deteccion"):
        assert r.intermedios[clave]
    guardado = json.loads((tmp_path / "prueba" / "resultado.json").read_text(encoding="utf-8"))
    assert guardado["estado"] == "ok"


@pytest.mark.ocr
def test_documento_encaja_con_el_contrato(tmp_path, mesa_png):
    r = convertir(mesa_png, tmp_path)
    d = r.documento()
    assert set(d) >= {"blocks", "quality"}
    assert 0 <= d["quality"]["score"] <= 1
    assert d["imageWidth"] == r.pagina["ancho_px"]
    assert d["blocks"], "debe haber bloques"
    for b in d["blocks"]:
        assert set(b) == {"id", "text", "box", "confidence"}
        assert 0 <= b["confidence"] <= 1
        box = b["box"]
        assert all(0 <= box[k] <= 1 for k in "xywh")
        assert box["x"] + box["w"] <= 1.0001 and box["y"] + box["h"] <= 1.0001
    assert len({b["id"] for b in d["blocks"]}) == len(d["blocks"])


@pytest.mark.ocr
@pytest.mark.parametrize("giro_foto, correccion", [(cv2.ROTATE_90_CLOCKWISE, 270), (cv2.ROTATE_90_COUNTERCLOCKWISE, 90),
                                                  (cv2.ROTATE_180, 180)])
def test_pagina_girada_se_endereza(tmp_path, giro_foto, correccion):
    # Caso real: hoja vertical fotografiada en horizontal (90/270) o del revés sobre la mesa (180).
    girada = cv2.rotate(s.pagina(), giro_foto)
    r = convertir(s.png(girada), tmp_path)
    assert r.estado == "ok", (r.error, r.avisos)
    assert r.pagina["giro_grados"] == correccion
    assert r.pagina["alto_px"] > r.pagina["ancho_px"]
    assert "siniestro" in extract_text(r.pdf)


@pytest.mark.ocr
def test_hoja_vertical_fotografiada_en_horizontal_sobre_la_mesa(tmp_path):
    hoja = cv2.rotate(s.pagina(), cv2.ROTATE_90_CLOCKWISE)          # la hoja está tumbada en la mesa
    esquinas = s.esquinas_camara(10, -5, distancia_mm=480, papel_mm=(297.0, 210.0))
    r = convertir(s.png(s.en_mesa(hoja, esquinas)), tmp_path)
    assert r.estado == "ok", (r.error, r.avisos)
    assert r.deteccion["encontrada"] and r.pagina["giro_grados"] == 270
    assert r.pagina["papel"] == "A4" and r.pagina["alto_px"] > r.pagina["ancho_px"]
    assert "siniestro" in extract_text(r.pdf)


@pytest.mark.ocr
@pytest.mark.parametrize("modo, formato", [("gris", "png"), ("bn", "png"), ("color", "jpeg")])
def test_modos_y_formatos(tmp_path, mesa_png, modo, formato):
    r = convertir(mesa_png, tmp_path, Opciones(modo=modo, formato_imagen=formato))
    assert r.estado == "ok", (r.error, r.avisos, r.validacion)
    assert "siniestro" in extract_text(r.pdf)


def test_sin_ocr_da_pdf_solo_imagen(tmp_path, mesa_png):
    r = convertir(mesa_png, tmp_path, Opciones(ocr=False, orientar=False))
    assert r.estado == "parcial" and not r.buscable
    assert r.validacion["paginas"] == 1 and r.validacion["imagen_resolucion_completa"]


def test_sin_tesseract_sigue_generando_pdf(tmp_path, mesa_png, monkeypatch):
    def falla():
        raise ErrorEscaner("ocr_no_disponible", "simulado")
    monkeypatch.setattr(ocr, "preparar_tesseract", falla)
    r = convertir(mesa_png, tmp_path)
    assert r.estado == "parcial" and r.pdf
    assert "sin_capa_ocr:ocr_no_disponible" in r.avisos


def test_entrada_invalida_devuelve_error_sin_lanzar(tmp_path):
    r = convertir(b"esto no es un png", tmp_path)
    assert r.estado == "error" and r.error["codigo"] == "entrada_no_png" and r.pdf is None


def test_opciones_invalidas(tmp_path, mesa_png):
    r = convertir(mesa_png, tmp_path, Opciones(modo="sepia"))
    assert r.error["codigo"] == "opciones_invalidas"


def test_no_sobrescribe_resultados(tmp_path, mesa_png):
    op = Opciones(ocr=False, orientar=False, guardar_intermedios=False)
    a = convertir(mesa_png, tmp_path, op, nombre="doc")
    b = convertir(mesa_png, tmp_path, op, nombre="doc")
    assert a.carpeta != b.carpeta and b.carpeta.endswith("doc-2")


def test_recorte_manual(tmp_path):
    esquinas = s.esquinas_camara(20, -12)
    img = s.en_mesa(s.pagina(), esquinas)
    r = convertir(s.png(img), tmp_path, Opciones(esquinas=esquinas.tolist(), ocr=False, orientar=False))
    assert r.deteccion["metodo"] == "manual" and r.pagina["papel"] == "A4"


def test_sin_hoja_usa_imagen_entera_y_avisa(tmp_path):
    rng = np.random.default_rng(3)
    ruido = cv2.GaussianBlur((rng.random((800, 1000, 3)) * 255).astype(np.uint8), (0, 0), 3)
    r = convertir(s.png(ruido), tmp_path, Opciones(ocr=False, orientar=False))
    assert "pagina_no_detectada" in r.avisos
    assert (r.pagina["ancho_px"], r.pagina["alto_px"]) == (1000, 800)
