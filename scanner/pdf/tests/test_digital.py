"""Documento digital: página en blanco con texto real e imágenes en su sitio."""

import io

import cv2
import numpy as np
import pikepdf
import pytest
from pdfminer.high_level import extract_text

import sinteticos as s
from escaner_pdf import Opciones, convertir, digital


def _con_firma(hoja: np.ndarray) -> np.ndarray:
    """Añade una "firma" (trazo curvo azul) dentro del recuadro inferior."""
    hoja = hoja.copy()
    alto, ancho = hoja.shape[:2]
    t = np.linspace(0, 4 * np.pi, 400)
    xs = (ancho * 0.2 + t / (4 * np.pi) * ancho * 0.35).astype(np.int32)
    ys = (alto * 0.82 + np.sin(t * 1.5) * alto * 0.025).astype(np.int32)
    cv2.polylines(hoja, [np.stack([xs, ys], axis=1).reshape(-1, 1, 2)], False, (150, 40, 20), 5)
    return hoja


def _imagenes(pdf_ruta: str) -> list[tuple[int, int]]:
    with pikepdf.open(pdf_ruta) as pdf:
        pagina = pdf.pages[0]
        return [(int(i.Width), int(i.Height)) for i in pagina.get_images().values()]


@pytest.mark.ocr
def test_texto_real_y_sin_foto_de_pagina(tmp_path):
    img = s.con_sombra(s.en_mesa(_con_firma(s.pagina()), s.ESQUINAS_PERSPECTIVA))
    r = convertir(s.png(img), tmp_path, Opciones(digital=True))
    assert r.estado == "ok" and r.pdf_digital, (r.avisos, r.digital)
    assert r.digital["valido"] and r.digital["palabras_texto"] >= 25
    texto = extract_text(r.pdf_digital)
    for palabra in ("siniestro", "Barcelona", "asegurado", "Dirección"):
        assert palabra in texto
    # Ninguna imagen ocupa la página: solo recortes (firma, recuadro).
    ancho, alto = r.pagina["ancho_px"], r.pagina["alto_px"]
    for w, h in _imagenes(r.pdf_digital):
        assert w * h < 0.35 * ancho * alto
    # El PDF escaneado sigue generándose igual.
    assert r.pdf and r.validacion["ok"]


@pytest.mark.ocr
def test_la_firma_va_como_imagen(tmp_path):
    r = convertir(s.png(_con_firma(s.pagina())), tmp_path, Opciones(digital=True))
    assert r.pdf_digital and r.digital["regiones_imagen"] >= 1
    assert _imagenes(r.pdf_digital)


@pytest.mark.ocr
def test_cartel_oscuro_no_se_digitaliza(tmp_path):
    cartel = np.full((1754, 1240, 3), (30, 35, 60), np.uint8)
    for i in range(6):
        cv2.putText(cartel, f"Concierto {i}", (100, 200 + i * 220), cv2.FONT_HERSHEY_SIMPLEX, 3, (230, 240, 240), 6)
    r = convertir(s.png(cartel), tmp_path, Opciones(digital=True))
    assert r.pdf and r.pdf_digital is None
    assert "digital_no_aplicable" in r.avisos


def test_sin_ocr_no_hay_digital(tmp_path):
    r = convertir(s.png(s.pagina()), tmp_path, Opciones(digital=True, ocr=False, orientar=False))
    assert r.pdf_digital is None and "digital_sin_texto" in r.avisos


def test_lineas_fisicas_con_texto_inclinado():
    # Dos líneas de 6 palabras inclinadas ~3°: Tesseract las parte a veces; aquí deben salir 2 líneas.
    palabras, cajas = [], []
    for fila in range(2):
        for k in range(6):
            x0 = 100 + k * 120
            y1 = 300 + fila * 60 + int(k * 120 * 0.05)
            palabras.append({"text": "palabra", "conf": 90, "linea": [1, 1, 7]})
            cajas.append((x0, y1 - 20, x0 + 100, y1))
    lineas = digital._lineas_fisicas(palabras, cajas, list(range(len(palabras))))
    assert len(lineas) == 2 and all(len(l) == 6 for l in lineas)


def test_aplicable_solo_en_papel_claro():
    assert digital.aplicable(np.full((100, 100, 3), 250, np.uint8))
    assert not digital.aplicable(np.full((100, 100, 3), 60, np.uint8))
