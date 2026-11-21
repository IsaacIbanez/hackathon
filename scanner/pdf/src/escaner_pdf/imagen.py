"""Mejora conservadora de la página y medida de calidad.

Regla: nada destructivo por defecto. La iluminación se corrige con una ganancia limitada
(no borra zonas oscuras grandes como fotos, sellos o casillas rellenas) y el blanco y negro
solo se aplica si se pide explícitamente.
"""

from __future__ import annotations

import cv2
import numpy as np

MODOS = ("color", "gris", "bn")
BLANCO_PAPEL = 245.0       # nivel al que se lleva el papel (no 255, para no quemar detalle)
GANANCIA_MAXIMA = 1.8      # suficiente para sombras normales; las zonas negras grandes siguen oscuras
GANANCIA_MINIMA = 0.85
TINTA_OBJETIVO = 40.0      # gris al que se lleva la tinta típica (no 0: no se aplastan trazos)
BLANCO_REALCE = 250.0
REALCE_MAXIMO = 3.0        # más ganancia amplifica el ruido y las sombras (medido con capturas reales)
GANANCIA_PAPEL = 2.0       # tope al blanquear el papel localmente: un relleno oscuro grande no se borra
NITIDEZ = 0.5              # cantidad de la máscara de enfoque
MEDIANA_PAPEL_CLARO = 150.0  # mediana de gris de la página para considerarla papel claro


def papel_claro(img: np.ndarray) -> bool:
    """¿La página es papel claro (donde igualar la luz ayuda)? Carteles oscuros, tarjetas de color o
    una escena entera no lo son: aclararlos los deja lavados y quemados (visto con capturas reales)."""
    gris = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    escala = 400.0 / max(gris.shape[:2])
    peq = cv2.resize(gris, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
    return float(np.median(peq)) >= MEDIANA_PAPEL_CLARO


def gris_1600(img: np.ndarray) -> tuple[np.ndarray, float]:
    """Gris reducido a 1600 px de lado mayor (para análisis rápido) y la escala usada."""
    gris = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    escala = 1600.0 / max(gris.shape[:2])
    return cv2.resize(gris, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA), escala


def mascara_letras(gris: np.ndarray) -> np.ndarray:
    """Píxeles de manchas oscuras con tamaño de letra (sobre gris de ~1600 px). Teclas, ratón y
    sombras (manchas grandes) quedan fuera."""
    b = cv2.adaptiveThreshold(gris, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15)
    _, etiquetas, est, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    alto, ancho, area = est[:, cv2.CC_STAT_HEIGHT], est[:, cv2.CC_STAT_WIDTH], est[:, cv2.CC_STAT_AREA]
    letra = (alto >= 3) & (alto <= 40) & (ancho <= 60) & (area >= 4) & (area <= 600)
    letra[0] = False
    return letra[etiquetas].astype(np.float32)


def realzar_documento(img: np.ndarray) -> tuple[np.ndarray, dict]:
    """Aspecto de escáner para papel claro: papel blanco uniforme, tinta casi negra y nitidez suave.

    1. Papel blanco local: el blanco del papel se estima a una escala de ~3 alturas de letra (máximo local
       por canal) y se divide por él. Así desaparecen las manchas del papel (luz irregular, compresión de
       la cámara) que, con un simple estiramiento global, se volvían un moteado gris (medido con cartas
       reales de la MX Brio). La ganancia está limitada: un relleno oscuro grande (logo) no se borra.
    2. Tinta: el gris típico de las letras se lleva a TINTA_OBJETIVO (estiramiento con el papel fijo en 255).
    3. Papel sin color residual y máscara de enfoque suave.
    """
    g, escala = gris_1600(img)
    letras = mascara_letras(g)
    if letras.sum() < 200:
        return img, {"aplicado": False, "motivo": "sin texto"}
    alto_letra = _altura_letra(letras) / escala                      # en píxeles de la imagen original

    # 1. Blanco del papel local, calculado en una copia reducida (rápido) y ampliado.
    reduccion = min(1.0, 12.0 / max(alto_letra, 1.0))                # letra de ~12 px en la copia
    peq = cv2.resize(img, None, fx=reduccion, fy=reduccion, interpolation=cv2.INTER_AREA)
    k = max(7, int(3 * alto_letra * reduccion) | 1)
    fondo = cv2.dilate(peq, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    fondo = cv2.GaussianBlur(fondo, (0, 0), k / 2.0)
    fondo = cv2.resize(fondo, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    ganancia = np.clip(255.0 / np.maximum(fondo, 1.0), 1.0, GANANCIA_PAPEL)
    f = img.astype(np.float32) * ganancia

    # 2. Tinta: estiramiento con el papel (255) fijo.
    gris_norm = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
    letras_full = cv2.resize(letras, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    tinta = float(np.median(gris_norm[letras_full]))
    if 255.0 - tinta < 15:
        return img, {"aplicado": False, "motivo": "sin contraste", "tinta": round(tinta)}
    k_tinta = float(np.clip((255.0 - TINTA_OBJETIVO) / (255.0 - tinta), 1.0, REALCE_MAXIMO))
    f = 255.0 - (255.0 - f) * k_tinta

    # 3. Papel y sombras sin color; la tinta oscura (firma azul, sello) conserva su color.
    lum = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    papelidad = np.clip((lum - 140.0) / 80.0, 0.0, 1.0)[..., None]
    f = f * (1.0 - papelidad) + lum[..., None] * papelidad
    f = f + (255.0 - f) * np.clip((f - 205.0) / 35.0, 0.0, 1.0)      # casi blanco -> blanco (papel liso, sin halos)
    sigma = max(0.8, alto_letra / 25.0)
    f = f + NITIDEZ * (f - cv2.GaussianBlur(f, (0, 0), sigma))
    return np.clip(f + 0.5, 0, 255).astype(np.uint8), {"aplicado": True, "tinta": round(tinta),
                                                        "ganancia_tinta": round(k_tinta, 2),
                                                        "altura_letra_px": round(alto_letra, 1)}


def _altura_letra(letras: np.ndarray) -> float:
    """Altura mediana (px) de las manchas con tamaño de letra."""
    _, _, est, _ = cv2.connectedComponentsWithStats((letras > 0).astype(np.uint8), connectivity=8)
    alturas = est[1:, cv2.CC_STAT_HEIGHT]
    return float(np.median(alturas)) if len(alturas) else 10.0


def corregir_iluminacion(img: np.ndarray) -> np.ndarray:
    """Iguala la iluminación del papel (sombras, degradados, dominante de color) canal a canal."""
    alto, ancho = img.shape[:2]
    escala = 512.0 / max(alto, ancho)
    peq = cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)

    # Fondo = papel sin tinta: dilatar borra los trazos oscuros, la mediana suaviza.
    lado = max(7, int(min(peq.shape[:2]) / 20) | 1)
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (lado, lado))
    fondo = cv2.dilate(peq, nucleo)
    fondo = cv2.medianBlur(fondo, lado * 2 + 1)  # lado es impar y pequeño (imagen de 512 px)
    fondo = cv2.GaussianBlur(fondo, (0, 0), lado / 2.0)
    fondo = cv2.resize(fondo, (ancho, alto), interpolation=cv2.INTER_LINEAR).astype(np.float32)

    ganancia = np.clip(BLANCO_PAPEL / np.maximum(fondo, 1.0), GANANCIA_MINIMA, GANANCIA_MAXIMA)
    return np.clip(img.astype(np.float32) * ganancia + 0.5, 0, 255).astype(np.uint8)


def aplicar_modo(img: np.ndarray, modo: str) -> np.ndarray:
    """color: sin cambios; gris: luminancia; bn: binarización adaptativa (solo si se pide)."""
    if modo == "color":
        return img
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if modo == "gris":
        return gris
    if modo == "bn":
        bloque = max(15, int(min(gris.shape) / 30) | 1)
        return cv2.adaptiveThreshold(gris, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, bloque, 12)
    raise ValueError(f"Modo desconocido: {modo!r} (válidos: {', '.join(MODOS)})")


def nitidez(img: np.ndarray) -> float:
    """Varianza del laplaciano sobre una copia de 1000 px de ancho (comparable entre tamaños)."""
    gris = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    escala = 1000.0 / gris.shape[1]
    gris = cv2.resize(gris, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(gris, cv2.CV_64F).var())


def evaluar_calidad(pagina_sin_corregir: np.ndarray, *, fraccion_area: float | None, toca_borde: bool,
                    angulo_max: float | None, dpi_efectivo: float) -> dict:
    """Puntuación 0..1 y problemas con el vocabulario de FrameIssue (api/openapi.yaml).

    Los umbrales son heurísticos iniciales: hay que calibrarlos con muestras reales de la cámara.
    """
    gris = cv2.cvtColor(pagina_sin_corregir, cv2.COLOR_BGR2GRAY)
    medidas = {
        "nitidez": round(nitidez(gris), 1),
        "brillo_medio": round(float(gris.mean()), 1),
        "fraccion_saturada": round(float((gris >= 250).mean()), 4),
        "brillo_papel": round(float(np.percentile(gris, 90)), 1),
        "dpi_efectivo": round(dpi_efectivo, 1),
    }
    problemas: list[str] = []
    penal = 0.0
    if medidas["nitidez"] < 60:
        problemas.append("blurry"); penal += 0.35
    if medidas["brillo_medio"] < 90:
        problemas.append("dark"); penal += 0.25
    if medidas["fraccion_saturada"] > 0.01 and medidas["brillo_papel"] < 240:
        problemas.append("glare"); penal += 0.15  # manchas quemadas sobre un papel que no es blanco puro
    if toca_borde:
        problemas.append("cropped"); penal += 0.2
    if angulo_max is not None and angulo_max > 25:
        problemas.append("tilted"); penal += 0.1
    if (fraccion_area is not None and fraccion_area < 0.3) or dpi_efectivo < 120:
        problemas.append("too_far"); penal += 0.2
    return {"puntuacion": round(max(0.0, 1.0 - penal), 2), "problemas": problemas, "medidas": medidas}
