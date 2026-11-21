import io

import cv2
import numpy as np
import pytest
from PIL import Image

from escaner_pdf.entrada import cargar_png
from escaner_pdf.errores import ErrorEscaner


def _png(arr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", arr)
    assert ok
    return buf.tobytes()


def test_carga_png_color_y_conserva_bytes():
    datos = _png(np.full((300, 400, 3), 200, np.uint8))
    e = cargar_png(datos)
    assert (e.ancho, e.alto) == (400, 300)
    assert e.imagen.dtype == np.uint8 and e.imagen.shape == (300, 400, 3)
    assert e.bytes_originales == datos


def test_desde_ruta(tmp_path):
    ruta = tmp_path / "a.png"
    ruta.write_bytes(_png(np.zeros((250, 250, 3), np.uint8)))
    assert cargar_png(ruta).ancho == 250


@pytest.mark.parametrize("datos, codigo", [
    (b"GIF89a" + b"\0" * 100, "entrada_no_png"),
    (b"\x89PNG\r\n\x1a\n" + b"basura" * 20, "entrada_ilegible"),
])
def test_rechaza_entradas_invalidas(datos, codigo):
    with pytest.raises(ErrorEscaner) as e:
        cargar_png(datos)
    assert e.value.codigo == codigo


def test_rechaza_archivo_inexistente(tmp_path):
    with pytest.raises(ErrorEscaner) as e:
        cargar_png(tmp_path / "no.png")
    assert e.value.codigo == "entrada_no_encontrada"


def test_rechaza_imagen_diminuta():
    with pytest.raises(ErrorEscaner) as e:
        cargar_png(_png(np.zeros((50, 500, 3), np.uint8)))
    assert e.value.codigo == "entrada_demasiado_pequena"


def test_alfa_se_compone_sobre_blanco():
    rgba = np.zeros((300, 300, 4), np.uint8)  # negro totalmente transparente
    e = cargar_png(_png(rgba))
    assert e.imagen.min() == 255 and e.info["tenia_alfa"]


def test_16_bits_gris_se_convierte_a_bgr8():
    gris16 = np.full((300, 300), 65535 // 2, np.uint16)
    e = cargar_png(_png(gris16))
    assert e.imagen.shape == (300, 300, 3) and e.imagen.dtype == np.uint8
    assert abs(int(e.imagen[0, 0, 0]) - 128) <= 1
    assert e.info["profundidad_bits"] == 16


def test_lee_dpi_del_png():
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, "PNG", dpi=(300, 300))
    assert round(cargar_png(buf.getvalue()).dpi) == 300
