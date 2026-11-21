"""Detección de la hoja, corrección de perspectiva y tamaño físico de la página."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

LADO_ANALISIS = 1000       # px: la detección trabaja sobre una copia reducida
AREA_MINIMA = 0.08         # la hoja debe ocupar al menos el 8 % del encuadre (si es poco, aviso too_far)
CONFIANZA_MINIMA = 0.55    # por debajo, no se recorta (mejor sin recortar que mal recortado)
MARGEN_BORDE = 0.01        # esquina a menos del 1 % del borde = hoja posiblemente cortada
CONTRASTE_MINIMO = 25.0    # niveles de gris entre la hoja y lo que la rodea
FOV_DIAGONAL_WEBCAM = 78.0 # grados; focal supuesta cuando la perspectiva no permite estimarla

# Tamaños de papel (ancho, alto) en mm, en vertical.
PAPELES_MM = {"A4": (210.0, 297.0), "Letter": (215.9, 279.4), "A5": (148.0, 210.0), "Legal": (215.9, 355.6)}
TOLERANCIA_PAPEL = 0.035   # si la proporción está a menos del 3,5 %, se ajusta al papel estándar
TOLERANCIA_SIN_DETECCION = 0.015  # sin hoja detectada solo se ajusta si casi coincide (captura ya recortada)


@dataclass
class Deteccion:
    encontrada: bool
    confianza: float
    esquinas: np.ndarray | None   # 4x2 float32 en px de la imagen original: sup-izq, sup-der, inf-der, inf-izq
    metodo: str
    toca_borde: bool = False
    fraccion_area: float = 0.0

    def a_dict(self) -> dict:
        return {
            "encontrada": self.encontrada,
            "confianza": round(self.confianza, 3),
            "esquinas": None if self.esquinas is None else [[round(float(x), 1), round(float(y), 1)] for x, y in self.esquinas],
            "metodo": self.metodo,
            "toca_borde": self.toca_borde,
            "fraccion_area": round(self.fraccion_area, 3),
        }


# ---------------------------------------------------------------- detección

def detectar_pagina(img: np.ndarray) -> Deteccion:
    """Busca el cuadrilátero de la hoja. Prueba bordes (Canny) y umbral (Otsu) y se queda con el mejor."""
    alto, ancho = img.shape[:2]
    escala = LADO_ANALISIS / max(alto, ancho)
    peq = cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA) if escala < 1 else img.copy()
    escala = min(escala, 1.0)
    gris = cv2.GaussianBlur(cv2.cvtColor(peq, cv2.COLOR_BGR2GRAY), (5, 5), 0)

    bordes = _mascara_bordes(gris)
    candidatos: list[tuple[float, np.ndarray, str]] = []
    for metodo, mascara in (("bordes", bordes), ("umbral", _mascara_umbral(gris))):
        for quad in _cuadrilateros(mascara):
            puntuacion = _puntuar(quad, gris, bordes)
            if puntuacion > 0:
                candidatos.append((puntuacion, quad, metodo))

    if not candidatos:
        return Deteccion(False, 0.0, None, "ninguno")

    puntuacion, quad, metodo = max(candidatos, key=lambda c: c[0])
    gris_completo = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (0, 0), 1.0)
    esquinas = refinar_esquinas(gris_completo, ordenar_esquinas(quad / escala))
    area = cv2.contourArea(esquinas.astype(np.float32)) / float(alto * ancho)
    margen = MARGEN_BORDE * max(alto, ancho)
    toca = bool(np.any(esquinas[:, 0] < margen) or np.any(esquinas[:, 0] > ancho - margen)
                or np.any(esquinas[:, 1] < margen) or np.any(esquinas[:, 1] > alto - margen))
    return Deteccion(puntuacion >= CONFIANZA_MINIMA, float(puntuacion), esquinas, metodo, toca, float(area))


def _mascara_bordes(gris: np.ndarray) -> np.ndarray:
    mediana = float(np.median(gris))
    bordes = cv2.Canny(gris, int(max(0, 0.66 * mediana)), int(min(255, 1.33 * mediana)))
    return cv2.dilate(bordes, np.ones((3, 3), np.uint8), iterations=2)


def _mascara_umbral(gris: np.ndarray) -> np.ndarray:
    _, mascara = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    nucleo = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    return cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, nucleo)


def _cuadrilateros(mascara: np.ndarray, maximo: int = 8) -> list[np.ndarray]:
    contornos, _ = cv2.findContours(mascara, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    area_img = mascara.shape[0] * mascara.shape[1]
    grandes = sorted((c for c in contornos if cv2.contourArea(c) > AREA_MINIMA * area_img),
                     key=cv2.contourArea, reverse=True)[:maximo]
    quads = []
    for c in grandes:
        casco = cv2.convexHull(c)
        perimetro = cv2.arcLength(casco, True)
        for eps in (0.02, 0.03, 0.05):
            aprox = cv2.approxPolyDP(casco, eps * perimetro, True)
            if len(aprox) == 4:
                quads.append(aprox.reshape(4, 2).astype(np.float32))
                break
    return quads


def _puntuar(quad: np.ndarray, gris: np.ndarray, bordes: np.ndarray) -> float:
    """0..1: qué tanto parece una hoja. 0 = descartado.

    - soporte (30 %): fracción del perímetro que cae sobre bordes reales de la imagen;
    - contraste (20 %): la hoja se distingue de lo que la rodea (descarta texturas y recuadros
      impresos dentro de una hoja que llena el encuadre);
    - ángulos (30 %): una hoja en perspectiva tiene ángulos entre ~55° y ~125°;
    - tamaño (20 %): a partir de un 25 % del encuadre cuenta como completo.
    """
    if not cv2.isContourConvex(quad.reshape(-1, 1, 2).astype(np.int32)):
        return 0.0
    area = cv2.contourArea(quad) / float(gris.shape[0] * gris.shape[1])
    if area < AREA_MINIMA or area > 0.995:
        return 0.0  # > 99,5 %: es el propio marco de la imagen, no una hoja
    contraste = _contraste(quad, gris)
    if contraste < CONTRASTE_MINIMO:
        return 0.0
    q = ordenar_esquinas(quad)
    cosenos = []
    for i in range(4):
        a, b, c = q[i - 1], q[i], q[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cosenos.append(abs(float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))))
    peor = max(cosenos)          # 0 = ángulo recto
    if peor > 0.6:               # algún ángulo fuera de ~53°..127°: no es una hoja plausible
        return 0.0
    angulos = 1.0 - max(0.0, peor - 0.2) / 0.4   # hasta ~78°/102° puntúa entero
    tam = min(1.0, area / 0.25)
    return float(0.30 * _soporte_bordes(q, bordes) + 0.20 * min(1.0, contraste / 80.0)
                 + 0.30 * angulos + 0.20 * tam)


def _contraste(quad: np.ndarray, gris: np.ndarray) -> float:
    """|mediana dentro - mediana en un anillo exterior| en niveles de gris."""
    lado = max(3, int(0.03 * min(gris.shape)))
    dentro = np.zeros(gris.shape, np.uint8)
    cv2.fillConvexPoly(dentro, quad.astype(np.int32), 255)
    fuera = cv2.dilate(dentro, np.ones((lado, lado), np.uint8)) & ~dentro
    dentro = cv2.erode(dentro, np.ones((lado, lado), np.uint8))
    if cv2.countNonZero(fuera) < 50 or cv2.countNonZero(dentro) < 50:
        return 0.0
    return abs(float(np.median(gris[dentro > 0])) - float(np.median(gris[fuera > 0])))


def _soporte_bordes(q: np.ndarray, bordes: np.ndarray, muestras: int = 60) -> float:
    """Fracción de puntos del perímetro (menos las esquinas) que coinciden con un borde detectado."""
    alto, ancho = bordes.shape
    aciertos = total = 0
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        for t in np.linspace(0.05, 0.95, muestras):
            x, y = (a + (b - a) * t).round().astype(int)
            if 0 <= x < ancho and 0 <= y < alto:
                total += 1
                aciertos += bordes[y, x] > 0
    return aciertos / total if total else 0.0


def refinar_esquinas(gris: np.ndarray, esquinas: np.ndarray) -> np.ndarray:
    """Ajusta cada lado al borde real (máximo gradiente perpendicular) a resolución completa.

    La detección trabaja en una copia reducida y con bordes dilatados, lo que desplaza las esquinas
    unos píxeles hacia fuera. Aquí se busca el borde a lo largo de la normal de cada lado, se ajusta
    una recta robusta y las esquinas salen de cortar rectas consecutivas. Si algo no cuadra, se
    conserva la esquina original.
    """
    radio = max(6.0, 0.012 * max(gris.shape))
    pasos = np.arange(-radio, radio + 1.0)
    gris = gris.astype(np.float32)
    rectas = []
    for i in range(4):
        a, b = esquinas[i], esquinas[(i + 1) % 4]
        d = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-d[1], d[0]], dtype=np.float32)
        ts = np.linspace(0.1, 0.9, 40, dtype=np.float32)
        centros = a[None, :] + (b - a)[None, :] * ts[:, None]                       # (40, 2)
        muestras = centros[:, None, :] + pasos[None, :, None] * n[None, None, :]     # (40, P, 2)
        perfil = cv2.remap(gris, muestras[..., 0].astype(np.float32), muestras[..., 1].astype(np.float32),
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        derivada = np.abs(np.gradient(perfil, axis=1))
        mejor = derivada.argmax(axis=1)
        validos = derivada[np.arange(len(ts)), mejor] > 4.0          # borde con contraste suficiente
        if validos.sum() < 10:
            return esquinas
        puntos = muestras[np.arange(len(ts)), mejor][validos]
        vx, vy, x0, y0 = cv2.fitLine(puntos.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        rectas.append((np.array([x0, y0]), np.array([vx, vy])))

    nuevas = []
    for i in range(4):
        (p1, v1), (p2, v2) = rectas[i - 1], rectas[i]   # lado anterior y lado que empieza en la esquina i
        m = np.array([v1, -v2]).T
        if abs(np.linalg.det(m)) < 1e-6:
            return esquinas
        s = np.linalg.solve(m, p2 - p1)
        nuevas.append(p1 + s[0] * v1)
    nuevas = np.array(nuevas, dtype=np.float32)
    if np.abs(nuevas - esquinas).max() > 2 * radio:
        return esquinas  # el ajuste se ha ido lejos: no fiarse
    return nuevas


def ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos como sup-izq, sup-der, inf-der, inf-izq."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    centro = pts.mean(axis=0)
    angulos = np.arctan2(pts[:, 1] - centro[1], pts[:, 0] - centro[0])
    pts = pts[np.argsort(angulos)]               # en sentido horario empezando por arriba-izquierda aprox.
    inicio = int(np.argmin(pts.sum(axis=1)))     # sup-izq = menor x+y
    return np.roll(pts, -inicio, axis=0)


# ---------------------------------------------------------------- perspectiva

def proporcion_real(esquinas: np.ndarray, forma_imagen: tuple[int, int],
                    fov_diagonal: float = FOV_DIAGONAL_WEBCAM) -> float:
    """Ancho/alto real de la hoja.

    Usa el modelo de cámara de Zhang y He (2007, "Whiteboard scanning and image enhancement"),
    que corrige el acortamiento por perspectiva. La focal se estima de la propia hoja; cuando la
    perspectiva es de un solo punto de fuga (inclinada en un único eje) no se puede estimar y se
    usa la de una webcam típica (FOV_DIAGONAL_WEBCAM). Si todo falla, el cociente de lados medidos.
    """
    sup_izq, sup_der, inf_der, inf_izq = [np.array([p[0], p[1], 1.0]) for p in esquinas]
    ancho_img = (np.linalg.norm(sup_der[:2] - sup_izq[:2]) + np.linalg.norm(inf_der[:2] - inf_izq[:2])) / 2
    alto_img = (np.linalg.norm(inf_izq[:2] - sup_izq[:2]) + np.linalg.norm(inf_der[:2] - sup_der[:2])) / 2
    afin = ancho_img / alto_img

    u0, v0 = forma_imagen[1] / 2.0, forma_imagen[0] / 2.0
    m1, m2, m3, m4 = sup_izq, sup_der, inf_izq, inf_der
    with np.errstate(all="ignore"):
        k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
        k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
        n2 = k2 * m2 - m1
        n3 = k3 * m3 - m1
        if not (np.all(np.isfinite(n2)) and np.all(np.isfinite(n3))):
            return float(afin)

        focal = None
        # n2[2] y n3[2] ~ 0 en la dirección sin fuga; la tolerancia es relativa al tamaño en píxeles.
        escala = max(np.linalg.norm(n2[:2]), np.linalg.norm(n3[:2]))
        if abs(n2[2]) * max(forma_imagen) > 0.02 * escala and abs(n3[2]) * max(forma_imagen) > 0.02 * escala:
            f2 = -((n2[0] - n2[2] * u0) * (n3[0] - n3[2] * u0)
                   + (n2[1] - n2[2] * v0) * (n3[1] - n3[2] * v0)) / (n2[2] * n3[2])
            diagonal = float(np.hypot(*forma_imagen))
            if np.isfinite(f2) and f2 > 0 and 0.3 * diagonal < np.sqrt(f2) < 5 * diagonal:
                focal = float(np.sqrt(f2))
        if focal is None:
            focal = float(np.hypot(*forma_imagen)) / (2 * np.tan(np.radians(fov_diagonal) / 2))

        a_inv = np.linalg.inv(np.array([[focal, 0, u0], [0, focal, v0], [0, 0, 1]]))
        w = a_inv.T @ a_inv
        real = float(np.sqrt((n2 @ w @ n2) / (n3 @ w @ n3)))
    if not np.isfinite(real) or not (0.5 * afin < real < 2.0 * afin):
        return float(afin)  # estimación absurda: no fiarse
    return real


def papel_cercano(proporcion: float, tolerancia: float = TOLERANCIA_PAPEL) -> str | None:
    """Nombre del papel estándar cuya proporción (en vertical u horizontal) coincide, si alguno."""
    mejor, error_mejor = None, tolerancia
    for nombre, (w, h) in PAPELES_MM.items():
        for p in (w / h, h / w):
            error = abs(proporcion - p) / p
            if error < error_mejor:
                mejor, error_mejor = nombre, error
    return mejor


def enderezar(img: np.ndarray, esquinas: np.ndarray, proporcion: float, recorte_interior: float = 0.0025) -> np.ndarray:
    """Corrige la perspectiva sin perder resolución: el alto de salida es el lado vertical más largo."""
    sup_izq, sup_der, inf_der, inf_izq = esquinas
    alto = max(np.linalg.norm(inf_izq - sup_izq), np.linalg.norm(inf_der - sup_der))
    ancho_med = max(np.linalg.norm(sup_der - sup_izq), np.linalg.norm(inf_der - inf_izq))
    # Se conserva el lado con más píxeles y el otro se deduce de la proporción real.
    if ancho_med / proporcion > alto:
        ancho, alto = ancho_med, ancho_med / proporcion
    else:
        ancho = alto * proporcion
    ancho, alto = int(round(ancho)), int(round(alto))

    destino = np.array([[0, 0], [ancho - 1, 0], [ancho - 1, alto - 1], [0, alto - 1]], dtype=np.float32)
    h = cv2.getPerspectiveTransform(esquinas.astype(np.float32), destino)
    plana = cv2.warpPerspective(img, h, (ancho, alto), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    # Recorte mínimo hacia dentro para no dejar una línea de fondo en los bordes.
    dx, dy = int(round(ancho * recorte_interior)), int(round(alto * recorte_interior))
    return plana[dy:alto - dy, dx:ancho - dx] if dx and dy else plana


def ajustar_a_proporcion(img: np.ndarray, proporcion: float) -> np.ndarray:
    """Reescala un eje (nunca reduce el lado mayor) para que ancho/alto sea exactamente `proporcion`."""
    alto, ancho = img.shape[:2]
    if abs(ancho / alto - proporcion) / proporcion < 1e-3:
        return img
    if ancho / alto < proporcion:
        nuevo = (int(round(alto * proporcion)), alto)
    else:
        nuevo = (ancho, int(round(ancho / proporcion)))
    return cv2.resize(img, nuevo, interpolation=cv2.INTER_CUBIC)


def angulo_maximo(esquinas: np.ndarray) -> float:
    """Mayor desviación (grados) respecto a 90° de los ángulos del cuadrilátero en la imagen."""
    peor = 0.0
    for i in range(4):
        a, b, c = esquinas[i - 1], esquinas[i], esquinas[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        peor = max(peor, abs(90.0 - np.degrees(np.arccos(np.clip(cos, -1, 1)))))
    return peor
