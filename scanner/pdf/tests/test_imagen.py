import cv2
import numpy as np
import pytest

import sinteticos as s
from escaner_pdf import imagen


def test_iluminacion_iguala_la_sombra():
    hoja = s.pagina()
    sombra = s.con_sombra(hoja, fuerza=0.45)
    corregida = imagen.corregir_iluminacion(sombra)
    gris = cv2.cvtColor(corregida, cv2.COLOR_BGR2GRAY)
    # Papel sin texto: franja inferior (debajo del recuadro). Izquierda y derecha deben parecerse.
    franja = gris[int(gris.shape[0] * 0.93):, :]
    izquierda, derecha = franja[:, :100].mean(), franja[:, -100:].mean()
    antes = cv2.cvtColor(sombra, cv2.COLOR_BGR2GRAY)[int(gris.shape[0] * 0.93):, :]
    assert abs(izquierda - derecha) < 0.25 * abs(antes[:, :100].mean() - antes[:, -100:].mean())
    assert derecha > 230


def test_iluminacion_no_borra_zonas_oscuras_grandes():
    img = np.full((1200, 900, 3), 240, np.uint8)
    img[300:900, 200:700] = 30   # foto o casilla rellena, mucho más grande que un trazo
    corregida = imagen.corregir_iluminacion(img)
    assert corregida[400:800, 300:600].mean() < 80


def test_iluminacion_conserva_el_texto():
    hoja = s.pagina()
    corregida = imagen.corregir_iluminacion(hoja)
    assert cv2.cvtColor(corregida, cv2.COLOR_BGR2GRAY).min() < 60  # la tinta sigue siendo oscura


@pytest.mark.parametrize("modo, ndim", [("color", 3), ("gris", 2), ("bn", 2)])
def test_modos(modo, ndim):
    out = imagen.aplicar_modo(s.pagina(), modo)
    assert out.ndim == ndim
    if modo == "bn":
        assert set(np.unique(out)) <= {0, 255}


def test_modo_invalido():
    with pytest.raises(ValueError):
        imagen.aplicar_modo(s.pagina(), "sepia")


def test_calidad_detecta_desenfoque_y_oscuridad():
    hoja = s.pagina()
    buena = imagen.evaluar_calidad(hoja, fraccion_area=0.5, toca_borde=False, angulo_max=5, dpi_efectivo=200)
    assert buena["problemas"] == [] and buena["puntuacion"] == 1.0
    borrosa = cv2.GaussianBlur(hoja, (0, 0), 6)
    assert "blurry" in imagen.evaluar_calidad(borrosa, fraccion_area=0.5, toca_borde=False, angulo_max=5,
                                              dpi_efectivo=200)["problemas"]
    oscura = (hoja * 0.25).astype(np.uint8)
    assert "dark" in imagen.evaluar_calidad(oscura, fraccion_area=0.5, toca_borde=False, angulo_max=5,
                                            dpi_efectivo=200)["problemas"]


def test_calidad_usa_vocabulario_del_contrato():
    hoja = s.pagina()
    r = imagen.evaluar_calidad(hoja, fraccion_area=0.1, toca_borde=True, angulo_max=40, dpi_efectivo=80)
    # FrameIssue en api/openapi.yaml
    assert set(r["problemas"]) <= {"blurry", "dark", "glare", "cropped", "tilted", "too_far"}
    assert {"cropped", "tilted", "too_far"} <= set(r["problemas"])
