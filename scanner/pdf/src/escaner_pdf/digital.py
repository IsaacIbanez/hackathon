"""Documento digital: página en blanco con el texto escrito de verdad y las imágenes en su sitio.

A partir de la página ya enderezada y realzada y de las palabras del OCR (con su caja), se crea un PDF
como si el documento se hubiera hecho en el ordenador:
- cada palabra fiable se escribe con una fuente real, en su posición, con el tamaño, la negrita y el
  color de tinta medidos en la foto;
- lo que no es texto fiable (firma, logo, sello, QR, líneas, y también las palabras dudosas) se recorta
  de la página y se coloca donde estaba.

Un error del OCR escrito como texto sería un error visible en el documento; por eso las palabras dudosas
no se reescriben: van como recorte de la imagen (y, debajo, como texto invisible para poder buscarlas).
El PDF escaneado sigue siendo la referencia fiel; este es una opción adicional.
"""

from __future__ import annotations

import difflib
import io
import statistics
import unicodedata

import cv2
import numpy as np
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

FUENTE, FUENTE_NEGRITA = "Helvetica", "Helvetica-Bold"
ALTURA_MAYUSCULA = 0.718     # Helvetica: altura de mayúsculas y ascendentes / tamaño de fuente
ALTURA_X = 0.523             # Helvetica: altura de la "x" / tamaño de fuente
DESCENDENTE = 0.207          # Helvetica: lo que baja una "p" bajo la línea base / tamaño de fuente
CONFIANZA_TEXTO = 50.0       # por debajo, la palabra es ilegible: va como recorte de la imagen
CONFIANZA_SEGURA = 75.0      # entre las dos: se escribe como texto pero se marca para revisar
MARGEN_PAGINA = 0.05        # margen derecho mínimo (fracción del ancho) al dejar crecer una línea
UMBRAL_TINTA = 170           # gris (página realzada: papel 255, tinta ~40) por debajo del cual hay "algo"
DESCENDENTES = set("gjpqyçQ,;()[]{}|/")
ASCENDENTES = set("bdfhkltß0123456789ÁÉÍÓÚÀÈÒÏÜÑÇ'\"!?%&@#")


def aplicable(pagina: np.ndarray) -> bool:
    """Solo papel claro: en un cartel oscuro o una tarjeta de color "página en blanco" no tiene sentido."""
    gris = cv2.cvtColor(pagina, cv2.COLOR_BGR2GRAY) if pagina.ndim == 3 else pagina
    return float(np.percentile(gris[::4, ::4], 50)) >= 200


def digitalizar(pagina: np.ndarray, palabras: list[dict], dpi: float, titulo: str | None = None,
                confianza_minima: float = CONFIANZA_TEXTO) -> tuple[bytes, dict]:
    """PDF digital de una página. `palabras`: ResultadoOCR.detalle (cajas normalizadas a la página)."""
    if pagina.ndim == 2:
        pagina = cv2.cvtColor(pagina, cv2.COLOR_GRAY2BGR)
    alto, ancho = pagina.shape[:2]
    s = 72.0 / dpi                                  # puntos por píxel
    ancho_pt, alto_pt = ancho * s, alto * s
    gris = cv2.cvtColor(pagina, cv2.COLOR_BGR2GRAY)

    cajas = [_caja_px(p, ancho, alto) for p in palabras]
    # Solo palabras sobre papel: lo "leído" en el fondo que asoma por un borde (teclas...) no es del documento.
    en_papel = [i for i in range(len(palabras)) if _sobre_papel(gris, cajas[i])]
    texto = [i for i in en_papel if palabras[i]["conf"] >= confianza_minima]
    ilegibles = [i for i in en_papel if palabras[i]["conf"] < confianza_minima]
    a_revisar = [i for i in texto if palabras[i]["conf"] < CONFIANZA_SEGURA]

    lineas = _lineas_fisicas(palabras, cajas, texto)
    # Ruido: una "palabra" suelta de 1-2 caracteres en una línea propia (teclas que asoman, motas).
    sueltas = {l[0] for l in lineas if len(l) == 1 and len(palabras[l[0]]["text"]) <= 2}
    lineas = [l for l in lineas if l[0] not in sueltas]
    texto = [i for i in texto if i not in sueltas]
    a_revisar = [i for i in a_revisar if i not in sueltas]
    alto_texto = float(np.median([cajas[i][3] - cajas[i][1] for i in texto])) if texto else 10.0
    regiones, restante = _regiones_imagen(gris, [cajas[i] for i in texto], alto_texto)
    tinta_media = _tinta_media(gris, [cajas[i] for i in texto])

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(ancho_pt, alto_pt), pageCompression=1)
    if titulo:
        c.setTitle(titulo)
    c.setCreator("escaner_pdf (LauzHack 2026) - documento digital")

    # 1. Imágenes (firma, logos, sellos, rayas, palabras ilegibles): solo su tinta, sobre blanco.
    for x0, y0, x1, y1 in regiones:
        mascara = restante[y0:y1, x0:x1] > 0
        trozo = np.full_like(pagina[y0:y1, x0:x1], 255)
        trozo[mascara] = pagina[y0:y1, x0:x1][mascara]
        recorte = Image.fromarray(cv2.cvtColor(trozo, cv2.COLOR_BGR2RGB))
        c.drawImage(ImageReader(recorte), x0 * s, alto_pt - y1 * s, width=(x1 - x0) * s, height=(y1 - y0) * s)

    # 2. Texto: cada línea física recta y de una pieza (como un documento hecho en el ordenador), a la
    #    altura de su centro (así las líneas no se pisan aunque en la foto vayan en abanico). Tamaño de
    #    letra común a la página salvo líneas claramente más grandes (títulos); si una línea tiene un
    #    hueco grande (columnas, tabulaciones) se parte en tramos.
    tam_linea = [_tamano_y_base(l, palabras, cajas, s)[0] for l in lineas]
    tam_comun = float(np.median(tam_linea)) if tam_linea else 10.0
    tamanos = []
    for linea, tam_l in zip(lineas, tam_linea):
        # Tamaño propio solo en líneas fiables (título): con cajas malas del OCR salían tamaños disparatados.
        fiable = len(linea) >= 2 and float(np.mean([palabras[i]["conf"] for i in linea])) >= 80
        tam = tam_l if fiable and abs(tam_l - tam_comun) > 0.25 * tam_comun else tam_comun
        tam = round(tam * 2) / 2
        tamanos.append(tam)
        base = _base_linea(linea, palabras, cajas, tam / s)
        centro_x = (cajas[linea[0]][0] + cajas[linea[-1]][2]) / 2
        base_y = base(centro_x)
        dens = float(np.median([_densidad_tinta(gris, cajas[i]) for i in linea]))
        fuente = FUENTE_NEGRITA if tinta_media and dens > 1.35 * tinta_media else FUENTE
        color = _color_tinta(pagina, gris, _union([cajas[i] for i in linea]))
        for tramo in _tramos(linea, cajas, tam / s):
            x0, x1 = cajas[tramo[0]][0], cajas[tramo[-1]][2]
            cadena = " ".join(palabras[i]["text"] for i in tramo)
            _escribir(c, cadena, fuente, tam, x0 * s, alto_pt - base_y * s, (x1 - x0) * s, color)

    # 3. Palabras ilegibles: se ven en su recorte; además texto invisible para poder buscarlas y copiarlas.
    for i in ilegibles:
        x0, y0, x1, y1 = cajas[i]
        tam = max(4.0, (y1 - y0) * s / 0.9)
        _escribir(c, palabras[i]["text"], FUENTE, tam, x0 * s, alto_pt - (y1 - 0.2 * (y1 - y0)) * s,
                  (x1 - x0) * s, (0.0, 0.0, 0.0), invisible=True)

    c.showPage()
    c.save()
    info = {
        "palabras_texto": len(texto),
        "palabras_imagen": len(ilegibles),
        "regiones_imagen": len(regiones),
        "lineas": len(lineas),
        "tamano_letra_pt": round(statistics.median(tamanos), 1) if tamanos else None,
        # Escritas como texto pero con confianza media: conviene revisarlas contra el escaneado.
        "a_revisar": [{"text": palabras[i]["text"], "conf": round(palabras[i]["conf"]),
                       "box": {k: round(palabras[i][k], 4) for k in ("x", "y", "w", "h")}} for i in a_revisar],
    }
    return buf.getvalue(), info


def _escribir(c, cadena: str, fuente: str, tam: float, x: float, y: float, ancho: float,
              color: tuple, invisible: bool = False) -> None:
    """Escribe `cadena` desde (x, y) ocupando `ancho` pt: estira la letra un poco y el resto en los espacios."""
    natural = stringWidth(cadena, fuente, tam) or 1.0
    escala = float(np.clip(ancho / natural, 0.85, 1.15))
    espacios = cadena.count(" ")
    extra = (ancho - natural * escala) / espacios if espacios else 0.0
    t = c.beginText()
    if invisible:
        t.setTextRenderMode(3)
        escala, extra = float(np.clip(ancho / natural, 0.2, 3.0)), 0.0
    t.setFont(fuente, tam)
    t.setHorizScale(escala * 100.0)
    if extra > 0:
        t.setWordSpace(extra / escala)
    t.setFillColorRGB(*color)
    t.setTextOrigin(x, y)
    t.textOut(cadena)
    c.drawText(t)


def _base_linea(linea: list[int], palabras: list[dict], cajas: list, tam_px: float):
    """Línea base de la línea como recta y = a*x + b (ajustada sobre el pie de sus palabras)."""
    xs, ys = [], []
    for i in linea:
        x0, _, x1, y1 = cajas[i]
        baja = DESCENDENTE * tam_px if set(palabras[i]["text"]) & DESCENDENTES else 0.0
        xs.append((x0 + x1) / 2)
        ys.append(y1 - baja)
    if len(xs) >= 3 and max(xs) - min(xs) > tam_px:
        a, b = np.polyfit(xs, ys, 1)
        if abs(a) < 0.1:                                   # < ~6 grados: inclinación plausible
            return lambda x: a * x + b
    y = float(np.median(ys))
    return lambda x: y


def _tramos(linea: list[int], cajas: list, tam_px: float) -> list[list[int]]:
    """Parte la línea donde hay un hueco mucho mayor que un espacio (columnas, tabulaciones)."""
    tramos, actual = [], [linea[0]]
    for a, b in zip(linea, linea[1:]):
        if cajas[b][0] - cajas[a][2] > 1.5 * tam_px:
            tramos.append(actual)
            actual = []
        actual.append(b)
    tramos.append(actual)
    return tramos


def _union(cajas: list) -> tuple[int, int, int, int]:
    return min(c[0] for c in cajas), min(c[1] for c in cajas), max(c[2] for c in cajas), max(c[3] for c in cajas)


# ---------------------------------------------------------------- medidas en la página

def _caja_px(p: dict, ancho: int, alto: int) -> tuple[int, int, int, int]:
    x0, y0 = int(round(p["x"] * ancho)), int(round(p["y"] * alto))
    return x0, y0, x0 + max(1, int(round(p["w"] * ancho))), y0 + max(1, int(round(p["h"] * alto)))


def _lineas_fisicas(palabras: list[dict], cajas: list, indices: list[int]) -> list[list[int]]:
    """Agrupa palabras en líneas físicas por geometría, encadenando cada palabra con la línea cuya
    continuación (última línea base + pendiente) pasa por ella.

    No se usa la numeración de líneas de Tesseract: con la hoja algo curvada o en abanico parte una
    línea física en trozos y mezcla palabras de líneas vecinas (medido con una carta real).
    """
    def base(i):
        x0, y0, x1, y1 = cajas[i]
        return y1 - (0.21 * (y1 - y0) if set(palabras[i]["text"]) & DESCENDENTES else 0.0)

    cadenas: list[dict] = []   # {"ids": [...], "x1": fin, "base": y, "pend": pendiente, "h": altura}
    for i in sorted(indices, key=lambda i: cajas[i][0]):
        x0, y0, x1, y1 = cajas[i]
        h = max(1.0, y1 - y0)
        mejor, mejor_d = None, 0.45 * h
        for cad in cadenas:
            hueco = x0 - cad["x1"]
            if hueco < -0.3 * h or hueco > 12 * max(h, cad["h"]):
                continue
            prevista = cad["base"] + cad["pend"] * (x0 - cad["x1"])
            d = abs(base(i) - prevista)
            if d < mejor_d:
                mejor, mejor_d = cad, d
        if mejor is None:
            cadenas.append({"ids": [i], "x1": x1, "base": base(i), "pend": 0.0, "h": h, "x0": (x0 + x1) / 2})
            continue
        mejor["ids"].append(i)
        dx = (x0 + x1) / 2 - mejor["x0"]
        if len(mejor["ids"]) >= 2 and dx > 0:
            ids = mejor["ids"]
            xs = [(cajas[j][0] + cajas[j][2]) / 2 for j in ids]
            ys = [base(j) for j in ids]
            pend = float(np.polyfit(xs, ys, 1)[0]) if len(ids) >= 3 else (ys[-1] - ys[0]) / max(1.0, xs[-1] - xs[0])
            mejor["pend"] = float(np.clip(pend, -0.1, 0.1))
        mejor["x1"], mejor["base"], mejor["h"] = x1, base(i), (mejor["h"] + h) / 2
    lineas = [sorted(c["ids"], key=lambda i: cajas[i][0]) for c in cadenas]
    return sorted(lineas, key=lambda l: (min(cajas[i][1] for i in l), cajas[l[0]][0]))


def _lineas(palabras: list[dict], cajas: list, indices: list[int]) -> list[list[int]]:
    grupos: dict[tuple, list[int]] = {}
    for i in indices:
        grupos.setdefault(tuple(palabras[i]["linea"]), []).append(i)
    return [sorted(g, key=lambda i: cajas[i][0]) for g in grupos.values()]


def _tamano_y_base(linea: list[int], palabras: list[dict], cajas: list, s: float) -> tuple[float, float]:
    """Tamaño de fuente (pt) y línea base (px) de una línea, con las métricas de Helvetica.

    La línea base es el pie de las palabras sin descendentes; el tamaño sale de la altura de las palabras
    con mayúsculas o ascendentes (altura de mayúscula) o, si no hay, de la altura de la "x".
    """
    sin_desc = [i for i in linea if not (set(palabras[i]["text"]) & DESCENDENTES)]
    pies = [cajas[i][3] for i in (sin_desc or linea)]
    base = float(np.median(pies))
    if not sin_desc:
        base -= 0.2 * float(np.median([cajas[i][3] - cajas[i][1] for i in linea]))
    altas = [i for i in sin_desc if any(ch.isupper() or ch in ASCENDENTES for ch in palabras[i]["text"])]
    if altas:
        tam = float(np.median([cajas[i][3] - cajas[i][1] for i in altas])) * s / ALTURA_MAYUSCULA
    elif sin_desc:
        tam = float(np.median([cajas[i][3] - cajas[i][1] for i in sin_desc])) * s / ALTURA_X
    else:
        tam = float(np.median([cajas[i][3] - cajas[i][1] for i in linea])) * s / 0.93
    return max(4.0, round(tam * 2) / 2), base   # al medio punto: líneas del mismo párrafo, mismo tamaño


def _densidad_tinta(gris: np.ndarray, caja: tuple) -> float:
    x0, y0, x1, y1 = caja
    zona = gris[y0:y1, x0:x1]
    return float((zona < 128).mean()) if zona.size else 0.0


def _tinta_media(gris: np.ndarray, cajas: list) -> float | None:
    dens = [_densidad_tinta(gris, c) for c in cajas]
    return float(np.median(dens)) if dens else None


def _color_tinta(pagina: np.ndarray, gris: np.ndarray, caja: tuple) -> tuple[float, float, float]:
    """Negro salvo que la tinta tenga un color claro (bolígrafo azul, sello rojo)."""
    x0, y0, x1, y1 = caja
    zona, g = pagina[y0:y1, x0:x1], gris[y0:y1, x0:x1]
    tinta = zona[g < 128]
    if len(tinta) < 5:
        return 0.0, 0.0, 0.0
    b, gr, r = (float(v) for v in np.median(tinta, axis=0))
    if max(r, gr, b) - min(r, gr, b) < 45:
        return 0.0, 0.0, 0.0
    return r / 255.0, gr / 255.0, b / 255.0


def _sobre_papel(gris: np.ndarray, caja: tuple) -> bool:
    """El entorno de la palabra es papel claro (no el fondo oscuro que asoma por un borde)."""
    x0, y0, x1, y1 = caja
    m = max(2, (y1 - y0) // 2)
    zona = gris[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m]
    return zona.size > 0 and float(np.percentile(zona, 90)) >= 200


def _regiones_imagen(gris: np.ndarray, cajas_texto: list, alto_texto: float
                     ) -> tuple[list[tuple[int, int, int, int]], np.ndarray]:
    """Zonas con tinta que no es texto escrito (firma, logo, sello, QR, rayas, palabras ilegibles).

    Los restos pequeños pegados a líneas de texto (trozos de letra fuera de la caja del OCR) se descartan:
    salían como fragmentos duplicados encima de la palabra ya escrita.
    """
    alto, ancho = gris.shape
    tinta = (gris < UMBRAL_TINTA).astype(np.uint8)
    banda_texto = np.zeros_like(tinta)
    for x0, y0, x1, y1 in cajas_texto:                     # lo que ya va como texto, fuera
        m = max(2, int(0.35 * (y1 - y0)))
        tinta[max(0, y0 - m):y1 + m, max(0, x0 - m):x1 + m] = 0
        banda_texto[max(0, y0 - m):y1 + m, max(0, x0 - 3 * m):x1 + 3 * m] = 1
    k = max(3, int(0.012 * ancho))
    unida = cv2.morphologyEx(tinta, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, _, est, _ = cv2.connectedComponentsWithStats(unida, connectivity=8)
    margen = max(2, int(0.004 * ancho))
    minimo = max(6, int(0.006 * ancho))
    regiones = []
    for j in range(1, n):
        x, y, w, h, area = est[j]
        if w < minimo and h < minimo or area < 25:
            continue                                        # motas de ruido
        if x <= 1 or y <= 1 or x + w >= ancho - 1 or y + h >= alto - 1:
            continue                                        # pegado al borde: restos del fondo, no del documento
        if h < 1.8 * alto_texto and w < 6 * alto_texto and banda_texto[y:y + h, x:x + w].mean() > 0.5:
            continue                                        # resto de una palabra ya escrita, no una imagen
        regiones.append([max(0, x - margen), max(0, y - margen), min(ancho, x + w + margen), min(alto, y + h + margen)])
    restante = cv2.dilate(tinta, np.ones((3, 3), np.uint8))          # su tinta, con el borde suavizado
    return [tuple(r) for r in _fusionar(regiones)], restante


def _fusionar(cajas: list[list[int]]) -> list[list[int]]:
    cambiado = True
    while cambiado:
        cambiado = False
        for i in range(len(cajas)):
            for j in range(i + 1, len(cajas)):
                a, b = cajas[i], cajas[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    cajas[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del cajas[j]
                    cambiado = True
                    break
            if cambiado:
                break
    return cajas


# ---------------------------------------------------------------- maqueta del modelo de visión (ia.py)

def _norm(palabra: str) -> str:
    """Minúsculas, sin acentos ni puntuación (para comparar palabras del modelo y del OCR)."""
    sin_acentos = "".join(ch for ch in unicodedata.normalize("NFD", palabra) if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in sin_acentos.lower() if ch.isalnum())


def _parecida(a: str, conjunto: set[str]) -> bool:
    if a in conjunto:
        return True
    return len(a) >= 4 and any(abs(len(a) - len(b)) <= 2 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8
                               for b in conjunto)


def concordancia(maqueta: dict, palabras: list[dict]) -> dict:
    """Cuánto coincide el texto del modelo con el OCR local (detector de invenciones u omisiones).

    - ocr_en_modelo: de las palabras fiables del OCR (conf >= 70, 3+ letras), cuántas están en el modelo;
    - sin_confirmar: palabras del modelo que el OCR no ha visto en ningún sitio (revisar contra el escaneado).
    """
    modelo = [_norm(w) for b in maqueta["bloques"] if b["tipo"] == "texto" for l in b["lineas"] for w in l.split()]
    modelo_set = {w for w in modelo if w}
    ocr = [_norm(p["text"]) for p in palabras if p["conf"] >= 70]
    ocr = [w for w in ocr if len(w) >= 3]
    ocr_set = {_norm(p["text"]) for p in palabras}
    en_modelo = sum(_parecida(w, modelo_set) for w in ocr) / len(ocr) if ocr else None
    sin_confirmar = sorted({w for w in modelo_set if len(w) >= 4 and not _parecida(w, ocr_set)})
    return {"ocr_en_modelo": None if en_modelo is None else round(en_modelo, 3),
            "palabras_modelo": len(modelo), "sin_confirmar": sin_confirmar[:80]}


def digitalizar_maqueta(pagina: np.ndarray, maqueta: dict, palabras: list[dict], dpi: float,
                        titulo: str | None = None) -> tuple[bytes, dict]:
    """PDF digital a partir de la maqueta del modelo, con la geometría ajustada al OCR local.

    1. Texto: cada bloque se sitúa con las palabras del OCR que coinciden con su texto (geometría precisa).
    2. Imágenes (firma, logo, sello, foto, QR): el rectángulo de la página, con sus trazos claros y su
       color, sin el texto vecino (que ya va escrito) y con el papel blanco limpio.
    3. Tipografía uniforme: un tamaño de cuerpo (los títulos pueden ser mayores, nunca menores) e
       interlineado común.
    4. Flujo vertical: cada elemento se coloca respecto al de encima; los huecos normales entre párrafos
       se igualan al típico del documento y los grandes (antes de una firma) se conservan. Nada se pisa.
    """
    if pagina.ndim == 2:
        pagina = cv2.cvtColor(pagina, cv2.COLOR_GRAY2BGR)
    alto, ancho = pagina.shape[:2]
    s = 72.0 / dpi
    ancho_pt, alto_pt = ancho * s, alto * s
    gris = cv2.cvtColor(pagina, cv2.COLOR_BGR2GRAY)
    cajas_ocr = [_caja_px(p, ancho, alto) for p in palabras]
    alto_letra = float(np.median([c[3] - c[1] for c in cajas_ocr])) if cajas_ocr else 0.012 * alto

    textos, ajustados = _bloques_texto(maqueta, palabras, cajas_ocr, ancho, alto, alto_letra, s)
    _separar(textos)
    comun = _tipografia(textos, s)
    # Para blanquear el texto dentro de una imagen se usan las palabras del OCR, no los bloques: la caja de
    # un bloque puede solapar la firma (medido con una maqueta real) y la borraba casi entera.
    palabras_ocr = [cajas_ocr[i] for i, p in enumerate(palabras) if p["conf"] >= 50 and len(_norm(p["text"])) >= 2]
    imagenes = _bloques_imagen(maqueta, pagina, gris, palabras_ocr, alto_letra)

    elementos = []
    for t_ in textos:
        n = len(t_["lineas"])
        t_["alto_px"] = ((n - 1) * t_["interlineado"] + (ALTURA_MAYUSCULA + DESCENDENTE) * t_["tam"]) / s
        elementos.append(t_)
    elementos += imagenes
    _flujo(elementos, comun / s, alto)

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(ancho_pt, alto_pt), pageCompression=1)
    if titulo:
        c.setTitle(titulo)
    c.setCreator("escaner_pdf (LauzHack 2026) - documento digital")
    for im in imagenes:
        x0, _, x1, _ = im["caja"]
        c.drawImage(ImageReader(Image.fromarray(cv2.cvtColor(im["recorte"], cv2.COLOR_BGR2RGB))),
                    x0 * s, alto_pt - (im["y"] + im["alto_px"]) * s, width=(x1 - x0) * s, height=im["alto_px"] * s)
    tamanos = [_componer_bloque(c, t_, s, alto_pt, pagina, gris) for t_ in textos]
    c.showPage()
    c.save()
    info = {
        "metodo": "modelo",
        "bloques_texto": len(textos),
        "bloques_ajustados_ocr": ajustados,
        "imagenes": [im["descripcion"] for im in imagenes],
        "regiones_imagen": len(imagenes),
        "palabras_texto": sum(len(l.split()) for t_ in textos for l in t_["lineas"]),
        "palabras_imagen": 0,
        "tamano_letra_pt": round(statistics.median(tamanos), 1) if tamanos else None,
    }
    return buf.getvalue(), info


def _bloques_texto(maqueta: dict, palabras: list[dict], cajas_ocr: list, ancho: int, alto: int,
                   alto_letra: float, s: float) -> tuple[list[dict], int]:
    """Caja de cada bloque de texto: unión de las palabras del OCR que coinciden con su texto.

    Solo palabras de 3+ letras y a menos de media altura de letra de la caja del modelo (las cortas y
    comunes de la línea vecina estiraban la caja). En vertical manda el OCR; en horizontal la caja nunca
    es más estrecha que la del modelo (si coinciden pocas palabras, la del OCR se queda corta).
    """
    usadas: set[int] = set()
    textos, ajustados = [], 0
    for orden, b in enumerate(maqueta["bloques"]):
        if b["tipo"] != "texto":
            continue
        x0, y0, x1, y1 = b["bbox"][0] * ancho, b["bbox"][1] * alto, b["bbox"][2] * ancho, b["bbox"][3] * alto
        suyas = {w for w in (_norm(w) for l in b["lineas"] for w in l.split()) if len(w) >= 3}

        def buscar(mx: float, my: float) -> list[int]:
            encontradas = []
            for i, (cx0, cy0, cx1, cy1) in enumerate(cajas_ocr):
                cx, cy = (cx0 + cx1) / 2, (cy0 + cy1) / 2
                if i in usadas or not (x0 - mx <= cx <= x1 + mx and y0 - my <= cy <= y1 + my):
                    continue
                w = _norm(palabras[i]["text"])
                if len(w) >= 3 and _parecida(w, suyas):
                    encontradas.append(i)
            return encontradas

        coinciden = buscar(0.02 * ancho, 0.5 * alto_letra)
        if not (coinciden and len(coinciden) >= max(1, 0.3 * min(len(suyas), 20))):
            # El modelo a veces sitúa un bloque unos % más arriba o abajo: ventana amplia pero más exigente,
            # y de cada palabra, la aparición más cercana a donde dijo el modelo.
            cercanas: dict[str, int] = {}
            for i in buscar(0.05 * ancho, 0.06 * alto):
                w = _norm(palabras[i]["text"])
                cy = (cajas_ocr[i][1] + cajas_ocr[i][3]) / 2
                if w not in cercanas or abs(cy - (y0 + y1) / 2) < abs(
                        (cajas_ocr[cercanas[w]][1] + cajas_ocr[cercanas[w]][3]) / 2 - (y0 + y1) / 2):
                    cercanas[w] = i
            coinciden = list(cercanas.values()) if len(cercanas) >= max(1, 0.6 * len(suyas)) else []
        tam_ocr = None
        if coinciden and len(coinciden) >= max(1, 0.3 * min(len(suyas), 20)):
            usadas.update(coinciden)
            rx0, ry0, rx1, ry1 = _union([cajas_ocr[i] for i in coinciden])
            caja = [min(rx0, x0), ry0, max(rx1, x1), ry1]
            tam_ocr = _tamano_por_palabras([palabras[i]["text"] for i in coinciden],
                                           [cajas_ocr[i] for i in coinciden], s)
            ajustados += 1
        else:
            caja = [x0, y0, x1, y1]
        textos.append({**b, "tipo": "texto", "caja": [float(v) for v in caja], "tam_ocr": tam_ocr, "orden": orden,
                       "ajustado": tam_ocr is not None})
    return textos, ajustados


def _bloques_imagen(maqueta: dict, pagina: np.ndarray, gris: np.ndarray, cajas_texto: list,
                    alto_letra: float) -> list[dict]:
    """Recorte de cada imagen que marca el modelo (firma, logo, sello, foto, QR).

    Se toma el rectángulo ajustado a sus trazos (incluidos los claros y de color: un recorte solo de la
    tinta oscura perdía el bolígrafo suave y las partes de color de un logo), se blanquea el texto vecino
    que cae dentro (ya va escrito aparte) y el papel casi blanco pasa a blanco.
    """
    alto, ancho = gris.shape
    hsv = cv2.cvtColor(pagina, cv2.COLOR_BGR2HSV)
    algo = ((gris < 225) | (hsv[..., 1] > 60)).astype(np.uint8)
    texto_mask = np.zeros_like(algo)
    m_txt = max(2, int(0.3 * alto_letra))
    for x0, y0, x1, y1 in cajas_texto:
        texto_mask[max(0, y0 - m_txt):y1 + m_txt, max(0, x0 - m_txt):x1 + m_txt] = 1
    algo[texto_mask > 0] = 0

    imagenes = []
    for orden, b in enumerate(maqueta["bloques"]):
        if b["tipo"] != "imagen":
            continue
        mx, my = int(0.02 * ancho), int(0.015 * alto)
        zx0, zy0 = max(0, int(b["bbox"][0] * ancho) - mx), max(0, int(b["bbox"][1] * alto) - my)
        zx1, zy1 = min(ancho, int(b["bbox"][2] * ancho) + mx), min(alto, int(b["bbox"][3] * alto) + my)
        zona = algo[zy0:zy1, zx0:zx1]
        k = max(3, int(0.01 * ancho))
        unida = cv2.morphologyEx(zona, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
        n_comp, etiquetas, est, centros = cv2.connectedComponentsWithStats(unida, connectivity=8)
        bx0, by0 = b["bbox"][0] * ancho - zx0, b["bbox"][1] * alto - zy0
        bx1, by1 = b["bbox"][2] * ancho - zx0, b["bbox"][3] * alto - zy0
        # Solo lo que tiene su centro en la zona del modelo (lo que roza el margen es del vecino).
        dentro = [j for j in range(1, n_comp) if bx0 <= centros[j][0] <= bx1 and by0 <= centros[j][1] <= by1
                  and est[j][cv2.CC_STAT_AREA] >= 15]
        if not dentro:
            continue
        sel = np.isin(etiquetas, dentro) & (zona > 0)
        ys, xs = np.nonzero(sel)
        if len(xs) < 20:
            continue
        m = max(2, int(0.004 * ancho))
        x0, y0 = max(0, zx0 + int(xs.min()) - m), max(0, zy0 + int(ys.min()) - m)
        x1, y1 = min(ancho, zx0 + int(xs.max()) + m + 1), min(alto, zy0 + int(ys.max()) + m + 1)
        recorte = pagina[y0:y1, x0:x1].copy()
        recorte[texto_mask[y0:y1, x0:x1] > 0] = 255                       # el texto va escrito aparte
        g = gris[y0:y1, x0:x1]
        papel = (g >= 225) & (hsv[y0:y1, x0:x1, 1] <= 60)
        recorte[papel] = 255                                              # fondo blanco limpio
        imagenes.append({"tipo": "imagen", "orden": orden, "caja": [float(x0), float(y0), float(x1), float(y1)],
                         "alto_px": float(y1 - y0), "recorte": recorte, "descripcion": b.get("descripcion", "otro")})
    return imagenes


def _tamano_por_palabras(textos: list[str], cajas: list, s: float) -> float | None:
    """Tamaño de fuente (pt) a partir de la altura de las palabras, con las métricas de Helvetica."""
    tams = []
    for texto, (x0, y0, x1, y1) in zip(textos, cajas):
        h = (y1 - y0) * s
        if set(texto) & DESCENDENTES and any(ch.isupper() or ch in ASCENDENTES for ch in texto):
            tams.append(h / (ALTURA_MAYUSCULA + DESCENDENTE))
        elif any(ch.isupper() or ch in ASCENDENTES for ch in texto):
            tams.append(h / ALTURA_MAYUSCULA)
        elif not set(texto) & DESCENDENTES:
            tams.append(h / ALTURA_X)
    return float(np.median(tams)) if tams else None


def _tipografia(textos: list[dict], s: float) -> float:
    """Tamaño de letra e interlineado coherentes en todo el documento. Devuelve el tamaño de cuerpo (pt).

    - tamaño de cuerpo: el que hace que la línea más larga de cada párrafo llene el ancho de su caja
      (mediana del documento). El ancho del OCR es preciso; la altura de las letras sale inflada en
      fotos borrosas o en abanico (medido: 12 pt por altura frente a ~10,5 por ancho en una carta real);
    - un bloque solo es mayor si es un título (negrita o centrado, 1-2 líneas) y su ancho lo confirma;
    - interlineado: proporción mediana interlineado/tamaño medida en los párrafos de varias líneas.
    """
    if not textos:
        return 10.0
    for t_ in textos:
        fuente = FUENTE_NEGRITA if t_["negrita"] else FUENTE
        ancho_pt = (t_["caja"][2] - t_["caja"][0]) * s
        mas_ancha = max(stringWidth(l, fuente, 1.0) for l in t_["lineas"]) or 1.0
        t_["tam_ancho"] = ancho_pt / mas_ancha
        n = len(t_["lineas"])
        alto = (t_["caja"][3] - t_["caja"][1]) * s
        t_["tam_alto"] = t_.get("tam_ocr") or alto / ((n - 1) * 1.2 + ALTURA_MAYUSCULA + DESCENDENTE)
    parrafos = [t_ for t_ in textos if len(t_["lineas"]) >= 2]
    justificados = [t_ for t_ in parrafos if t_["alineacion"] == "justificado"]
    base = justificados or parrafos
    if base:
        comun = float(np.median([t_["tam_ancho"] for t_ in base]))
    else:
        comun = float(np.median([t_["tam_alto"] for t_ in textos]))
    razones = []
    for t_ in parrafos:
        n = len(t_["lineas"])
        alto = (t_["caja"][3] - t_["caja"][1]) * s
        razones.append((alto - (ALTURA_MAYUSCULA + DESCENDENTE) * comun) / ((n - 1) * comun))
    razon = float(np.clip(np.median(razones), 1.1, 1.5)) if razones else 1.2
    for t_ in textos:
        titulo = (t_["negrita"] or t_["alineacion"] == "centro") and len(t_["lineas"]) <= 2
        t_["tam"] = t_["tam_ancho"] if titulo and t_["tam_ancho"] > 1.1 * comun else comun
        t_["tam"] = min(t_["tam"], 2.5 * comun)
        t_["interlineado"] = razon * t_["tam"]
    return comun


def _flujo(elementos: list[dict], tam_px: float, alto_pagina: int) -> None:
    """Posición vertical ("y", en px) de cada elemento: debajo del elemento de encima con el que comparte
    columna, con un hueco que se iguala al típico del documento salvo que sea claramente mayor.

    El orden es el de lectura del modelo (fiable), no la altura medida: la de un bloque que no se pudo
    ajustar al OCR puede estar desplazada (medido: "Signat," quedaba debajo de la firma). Los huecos se
    miden entre centros (robusto a cajas infladas por una hoja en abanico).
    """
    orden = sorted(elementos, key=lambda e: e.get("orden", 0))
    centro = {id(e): (e["caja"][1] + e["caja"][3]) / 2 for e in orden}
    previo, huecos = {}, {}
    for k, e in enumerate(orden):
        encima = [p for p in orden[:k] if p["caja"][0] < e["caja"][2] and e["caja"][0] < p["caja"][2]]
        if not encima:
            continue
        p = encima[-1]                                   # el último anterior en lectura que comparte columna
        previo[id(e)] = p
        huecos[id(e)] = (centro[id(e)] - centro[id(p)]) - (e["alto_px"] + p["alto_px"]) / 2
    entre_textos = [h for e in orden if id(e) in huecos and e["tipo"] == "texto" and previo[id(e)]["tipo"] == "texto"
                    for h in [huecos[id(e)]] if h > 0]
    tipico = float(np.median(entre_textos)) if entre_textos else 0.8 * tam_px
    tipico = float(np.clip(tipico, 0.4 * tam_px, 2.0 * tam_px))
    for e in orden:
        if id(e) not in previo:
            e["y"] = centro[id(e)] - e["alto_px"] / 2
            continue
        p, h = previo[id(e)], huecos[id(e)]
        if e["tipo"] == "texto" and p["tipo"] == "texto":
            hueco = tipico if h < 3.0 * tipico else h                 # entre párrafos: uniforme salvo saltos grandes
        else:
            hueco = h                                                 # junto a una imagen: el medido
        e["y"] = p["y"] + p["alto_px"] + max(hueco, 0.25 * tam_px)
    # Si el flujo se sale por abajo, se comprime todo proporcionalmente hacia arriba.
    fondo = max(e["y"] + e["alto_px"] for e in orden)
    limite = alto_pagina * 0.985
    if fondo > limite:
        inicio = min(e["y"] for e in orden)
        factor = (limite - inicio) / (fondo - inicio)
        for e in orden:
            e["y"] = inicio + (e["y"] - inicio) * factor


def _separar(textos: list[dict]) -> None:
    """Si dos cajas de texto se solapan (en vertical, con columnas que se cruzan), se parte la diferencia."""
    textos.sort(key=lambda t: t["caja"][1])
    for a, b in zip(textos, textos[1:]):
        ca, cb = a["caja"], b["caja"]
        if ca[0] < cb[2] and cb[0] < ca[2] and ca[3] > cb[1]:
            medio = (ca[3] + cb[1]) / 2
            ca[3], cb[1] = max(ca[1] + 2, medio - 1), min(cb[3] - 2, medio + 1)


def _componer_bloque(c, bloque: dict, s: float, alto_pt: float, pagina: np.ndarray, gris: np.ndarray) -> float:
    """Escribe las líneas del bloque a partir de su posición del flujo; devuelve el tamaño usado (pt)."""
    x0, _, x1, _ = bloque["caja"]
    y0 = bloque.get("y", bloque["caja"][1])
    ancho_pt = (x1 - x0) * s
    lineas = bloque["lineas"]
    n = len(lineas)
    fuente = FUENTE_NEGRITA if bloque["negrita"] else FUENTE
    tam, interlineado = bloque["tam"], bloque["interlineado"]
    mas_ancha = max(stringWidth(l, fuente, tam) for l in lineas) or 1.0
    if bloque["alineacion"] in ("izquierda", "centro") and mas_ancha > ancho_pt:
        # Texto que no cabe en su caja: se deja crecer (hacia la derecha o a ambos lados) hasta el margen
        # de la página antes que comprimirlo (la caja puede ser estrecha si el OCR vio pocas palabras).
        disponible = (c._pagesize[0] * (1 - MARGEN_PAGINA)) - x0 * s
        if bloque["alineacion"] == "centro":
            centro = (x0 + x1) / 2 * s
            disponible = 2 * min(centro, c._pagesize[0] - centro) * (1 - MARGEN_PAGINA)
            x0 = (centro - min(mas_ancha, disponible) / 2) / s
        ancho_pt = min(mas_ancha, disponible)
    if mas_ancha > ancho_pt * 1.02:                       # no cabe ni así: letra algo más pequeña
        factor = max(0.75, ancho_pt / mas_ancha)
        tam, interlineado = tam * factor, interlineado * factor
    tam = max(4.0, min(tam, 72.0))
    color = _color_tinta(pagina, gris, tuple(int(round(v)) for v in bloque["caja"]))
    for k, linea in enumerate(lineas):
        base = alto_pt - (y0 * s + ALTURA_MAYUSCULA * tam + k * interlineado)
        ancho_linea = stringWidth(linea, fuente, tam)
        escala = min(1.0, ancho_pt / ancho_linea) if ancho_linea else 1.0
        x = x0 * s
        extra = 0.0
        if bloque["alineacion"] == "centro":
            x += (ancho_pt - ancho_linea * escala) / 2
        elif bloque["alineacion"] == "derecha":
            x += ancho_pt - ancho_linea * escala
        elif (bloque["alineacion"] == "justificado" and k < n - 1 and linea.count(" ")
              and ancho_linea > 0.7 * ancho_pt):
            extra = (ancho_pt - ancho_linea * escala) / linea.count(" ")
        t = c.beginText()
        t.setFont(fuente, tam)
        t.setHorizScale(escala * 100.0)
        if extra > 0:
            t.setWordSpace(extra / escala)
        t.setFillColorRGB(*color)
        t.setTextOrigin(x, base)
        t.textOut(linea)
        c.drawText(t)
    return tam
