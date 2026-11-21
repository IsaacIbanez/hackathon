import cv2
import numpy as np
import pytest

import sinteticos as s
from escaner_pdf import geometria as g

A4 = 210 / 297

# (inclinación x, inclinación y, focal px, distancia mm): poses de cámara físicamente posibles
POSES = [(0, 0, 1500, 520), (5, 3, 1500, 520), (20, -12, 1500, 520), (35, 10, 1500, 520),
         (30, -25, 1100, 520), (25, -30, 1300, 500), (40, 0, 1500, 450)]


@pytest.mark.parametrize("ix, iy, focal, dist", POSES)
def test_detecta_hoja_y_recupera_proporcion_a4(ix, iy, focal, dist):
    esquinas = s.esquinas_camara(ix, iy, focal_px=focal, distancia_mm=dist)
    img = s.con_sombra(s.en_mesa(s.pagina(), esquinas))
    d = g.detectar_pagina(img)
    assert d.encontrada
    assert np.abs(d.esquinas - esquinas).max() < 2.0          # esquinas a menos de 2 px
    proporcion = g.proporcion_real(d.esquinas, img.shape[:2])
    assert abs(proporcion - A4) / A4 < 0.02
    assert g.papel_cercano(proporcion) == "A4"


@pytest.mark.parametrize("nombre", ["textura", "negra", "hoja_llena_el_encuadre"])
def test_no_inventa_hojas(nombre):
    if nombre == "textura":
        rng = np.random.default_rng(1)
        img = cv2.GaussianBlur((rng.random((1440, 1920, 3)) * 255).astype(np.uint8), (0, 0), 3)
    elif nombre == "negra":
        img = np.zeros((1440, 1920, 3), np.uint8)
    else:  # sin fondo alrededor: no debe recortar el recuadro impreso de dentro
        img = s.pagina()
    assert not g.detectar_pagina(img).encontrada


def test_hoja_cortada_no_se_recorta_mal():
    esquinas = s.esquinas_camara(5, 3, distancia_mm=520, desplazamiento_mm=(280, 0))
    assert esquinas[:, 0].max() > 1920  # precondición: la hoja sale del encuadre por la derecha
    d = g.detectar_pagina(s.en_mesa(s.pagina(), esquinas))
    # O no se detecta (mejor no recortar) o se avisa de que toca el borde.
    assert (not d.encontrada) or d.toca_borde


def test_ordenar_esquinas_es_independiente_del_orden():
    pts = np.array([[10, 10], [100, 12], [98, 200], [8, 190]], np.float32)
    for perm in ([2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]):
        assert np.array_equal(g.ordenar_esquinas(pts[perm]), pts)


@pytest.mark.parametrize("proporcion, papel", [(A4, "A4"), (1 / A4, "A4"), (215.9 / 279.4, "Letter"), (1.0, None)])
def test_papel_cercano(proporcion, papel):
    assert g.papel_cercano(proporcion) == papel


def test_fotograma_4_3_no_es_un_papel_con_tolerancia_estricta():
    assert g.papel_cercano(4 / 3, g.TOLERANCIA_SIN_DETECCION) is None


def test_enderezar_respeta_proporcion_y_no_reduce():
    esquinas = s.esquinas_camara(20, -12)
    img = s.en_mesa(s.pagina(), esquinas)
    plana = g.enderezar(img, esquinas, A4)
    alto, ancho = plana.shape[:2]
    assert abs(ancho / alto - A4) < 0.01
    lado_vertical = max(np.linalg.norm(esquinas[3] - esquinas[0]), np.linalg.norm(esquinas[2] - esquinas[1]))
    assert alto >= 0.99 * lado_vertical
