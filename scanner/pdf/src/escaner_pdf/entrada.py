"""Carga y valida la imagen PNG de entrada.

La imagen la genera la parte de captura (compañero). Aquí solo se asume que es un PNG;
se normaliza a BGR de 8 bits sin alfa y se conservan los bytes originales sin tocar.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .errores import ErrorEscaner

FIRMA_PNG = b"\x89PNG\r\n\x1a\n"
LADO_MINIMO = 200          # px; por debajo no se puede leer nada útil
MEGAPIXELES_MAXIMOS = 100  # protege la memoria ante imágenes absurdas


@dataclass
class ImagenEntrada:
    imagen: np.ndarray            # BGR uint8, sin alfa
    bytes_originales: bytes       # el PNG tal cual llegó
    dpi: float | None             # del chunk pHYs, si lo trae
    info: dict = field(default_factory=dict)  # canales, profundidad, alfa...

    @property
    def ancho(self) -> int:
        return int(self.imagen.shape[1])

    @property
    def alto(self) -> int:
        return int(self.imagen.shape[0])


def cargar_png(origen: str | Path | bytes) -> ImagenEntrada:
    """Lee un PNG desde ruta o bytes. Lanza ErrorEscaner si no es válido."""
    if isinstance(origen, (bytes, bytearray)):
        datos = bytes(origen)
    else:
        ruta = Path(origen)
        if not ruta.is_file():
            raise ErrorEscaner("entrada_no_encontrada", f"No existe el archivo: {ruta}")
        datos = ruta.read_bytes()

    if not datos.startswith(FIRMA_PNG):
        raise ErrorEscaner("entrada_no_png", "La entrada no es un PNG (firma incorrecta)")

    bruto = cv2.imdecode(np.frombuffer(datos, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if bruto is None or bruto.size == 0:
        raise ErrorEscaner("entrada_ilegible", "El PNG está dañado o no se puede decodificar")

    alto, ancho = bruto.shape[:2]
    if min(alto, ancho) < LADO_MINIMO:
        raise ErrorEscaner(
            "entrada_demasiado_pequena",
            f"Imagen de {ancho}x{alto}; el lado menor debe ser al menos {LADO_MINIMO} px",
        )
    if alto * ancho > MEGAPIXELES_MAXIMOS * 1_000_000:
        raise ErrorEscaner("entrada_demasiado_grande", f"Imagen de {ancho}x{alto} (> {MEGAPIXELES_MAXIMOS} MP)")

    canales = 1 if bruto.ndim == 2 else bruto.shape[2]
    info = {"ancho": ancho, "alto": alto, "canales": canales, "profundidad_bits": bruto.dtype.itemsize * 8,
            "tenia_alfa": canales in (2, 4)}

    return ImagenEntrada(imagen=_a_bgr8(bruto), bytes_originales=datos, dpi=_leer_dpi(datos), info=info)


def _a_bgr8(img: np.ndarray) -> np.ndarray:
    """Convierte cualquier PNG decodificado (gris/BGR/BGRA, 8 o 16 bits) a BGR uint8."""
    if img.dtype == np.uint16:
        img = (img.astype(np.float32) / 257.0 + 0.5).astype(np.uint8)
    elif img.dtype != np.uint8:
        raise ErrorEscaner("entrada_formato_no_soportado", f"Profundidad de color no soportada: {img.dtype}")

    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 2:  # gris + alfa (OpenCV lo entrega raramente, pero por si acaso)
        gris, alfa = img[..., 0], img[..., 1]
        return cv2.cvtColor(_sobre_blanco(gris[..., None], alfa)[..., 0], cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return _sobre_blanco(img[..., :3], img[..., 3])
    return img


def _sobre_blanco(color: np.ndarray, alfa: np.ndarray) -> np.ndarray:
    """Compone sobre fondo blanco (el papel), para que las zonas transparentes no salgan negras."""
    a = alfa.astype(np.float32)[..., None] / 255.0
    return (color.astype(np.float32) * a + 255.0 * (1.0 - a) + 0.5).astype(np.uint8)


def _leer_dpi(datos: bytes) -> float | None:
    try:
        dpi = Image.open(io.BytesIO(datos)).info.get("dpi")
    except Exception:
        return None
    if not dpi:
        return None
    valor = float(dpi[0])
    return valor if 30 <= valor <= 2400 else None  # valores fuera de rango = metadato basura
