"""Generadores de imágenes de prueba (sin documentos reales ni datos personales)."""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

LINEAS = [
    "DECLARACIÓN DE PRUEBA",
    "Nombre y apellidos: María Peña Güell",
    "Dirección: Carrer de la Pau 12, Barcelona",
    "Fecha del siniestro: 21/11/2026",
    "Descripción: el vehículo sufrió daños leves.",
    "Firma del asegurado",
]


FUENTES = ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
           "/usr/share/fonts/TTF/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")


def fuente(tam: int) -> ImageFont.FreeTypeFont | None:
    """Una fuente del sistema con acentos (la de Pillow por defecto no los tiene). None si no hay."""
    for ruta in FUENTES:
        try:
            return ImageFont.truetype(ruta, tam)
        except OSError:
            continue
    return None


def pagina(ancho: int = 1240, alto: int = 1754, lineas: list[str] = LINEAS, tam_letra: int = 40) -> np.ndarray:
    """Hoja blanca (A4 a 150 DPI por defecto) con texto negro y un recuadro. BGR uint8."""
    img = Image.new("RGB", (ancho, alto), (250, 250, 248))
    d = ImageDraw.Draw(img)
    fuente_ = fuente(tam_letra)
    if fuente_ is None:  # sin fuente del sistema: texto sin acentos para que siga siendo legible
        import unicodedata
        lineas = ["".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn") for t in lineas]
        fuente_ = ImageFont.load_default(size=tam_letra)
    y = int(alto * 0.08)
    for texto in lineas:
        d.text((int(ancho * 0.08), y), texto, fill=(15, 15, 15), font=fuente_)
        y += int(tam_letra * 2.2)
    d.rectangle([int(ancho * 0.08), int(alto * 0.75), int(ancho * 0.92), int(alto * 0.9)], outline=(30, 30, 30), width=3)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def en_mesa(hoja: np.ndarray, esquinas_destino: np.ndarray, tam: tuple[int, int] = (1920, 1440),
            fondo: tuple[int, int, int] = (60, 45, 35)) -> np.ndarray:
    """Coloca la hoja sobre un fondo oscuro con la perspectiva dada (esquinas sup-izq, sup-der, inf-der, inf-izq)."""
    ancho, alto = tam
    h, w = hoja.shape[:2]
    origen = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(origen, esquinas_destino.astype(np.float32))
    mesa = np.full((alto, ancho, 3), fondo, np.uint8)
    ruido = np.random.default_rng(0).normal(0, 6, mesa.shape)
    mesa = np.clip(mesa + ruido, 0, 255).astype(np.uint8)
    return cv2.warpPerspective(hoja, m, (ancho, alto), dst=mesa, borderMode=cv2.BORDER_TRANSPARENT)


def con_sombra(img: np.ndarray, fuerza: float = 0.45) -> np.ndarray:
    """Oscurece en degradado de izquierda (sombra) a derecha (luz)."""
    ancho = img.shape[1]
    grad = np.linspace(1.0 - fuerza, 1.0, ancho, dtype=np.float32)[None, :, None]
    return np.clip(img.astype(np.float32) * grad, 0, 255).astype(np.uint8)


def png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def esquinas_camara(inclinacion_x: float = 20.0, inclinacion_y: float = -12.0, giro_z: float = 4.0,
                    distancia_mm: float = 520.0, focal_px: float = 1500.0, tam: tuple[int, int] = (1920, 1440),
                    papel_mm: tuple[float, float] = (210.0, 297.0), desplazamiento_mm: tuple[float, float] = (0.0, 0.0)
                    ) -> np.ndarray:
    """Esquinas en la imagen de una hoja real vista por una cámara estenopeica (centro óptico en el centro).

    Así la perspectiva es físicamente posible, como en una foto de verdad.
    """
    w, h = papel_mm
    hoja = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], dtype=np.float64)
    hoja[:, 0] += desplazamiento_mm[0]
    hoja[:, 1] += desplazamiento_mm[1]
    rx, ry, rz = np.radians([inclinacion_x, inclinacion_y, giro_z])
    rot_x = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    rot_y = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    rot_z = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    puntos = hoja @ (rot_z @ rot_y @ rot_x).T + np.array([0, 0, distancia_mm])
    u = focal_px * puntos[:, 0] / puntos[:, 2] + tam[0] / 2
    v = focal_px * puntos[:, 1] / puntos[:, 2] + tam[1] / 2
    return np.stack([u, v], axis=1).astype(np.float32)


ESQUINAS_PERSPECTIVA = esquinas_camara()
