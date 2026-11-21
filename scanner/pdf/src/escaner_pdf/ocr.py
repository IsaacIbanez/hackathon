"""OCR local con Tesseract: localización, orientación y reconocimiento en un solo pase.

Un pase de Tesseract produce a la vez:
- un PDF solo con la capa de texto invisible (`textonly_pdf=1`, el mismo renderizador
  "sandwich" que usa OCRmyPDF), que luego se superpone a la página de imagen;
- el TSV con cada palabra, su caja y su confianza, para el resultado y el mensaje `document`.
"""

from __future__ import annotations

import csv
import io
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pytesseract

from . import imagen
from .errores import ErrorEscaner

RUTAS_WINDOWS = (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")
TESSDATA_LOCAL = Path(__file__).resolve().parents[2] / "tessdata"   # scanner/pdf/tessdata (ignorado por git)
CONFIANZA_OSD = 2.5     # OSD sobre el recorte de texto: a partir de aquí se le hace caso (fallo medido: 1,96)
PALABRAS_DERECHA = 15   # palabras seguras en el recorte para dar la orientación por buena
DPI_OCR = 300.0         # resolución a la que Tesseract lee mejor
FACTOR_MAXIMO = 3.0     # no ampliar más (coste ~ factor² y no inventa detalle)
MEGAPIXELES_OCR_MAX = 8.5   # tamaño máximo que lee Tesseract: un fotograma 4K entero (8,3 MP) no se amplía
GIROS = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}


@dataclass
class Tesseract:
    ejecutable: str
    tessdata: str | None
    version: str
    idiomas: list[str]


@dataclass
class ResultadoOCR:
    pdf_texto: bytes                 # PDF con solo la capa de texto invisible
    bloques: list[dict]              # TextBlock del contrato: id, text, box (normalizada), confidence
    palabras: int
    confianza_media: float | None    # 0..1, ponderada por longitud de palabra
    avisos: list[str] = field(default_factory=list)
    psm: int = 3                     # modo de segmentación usado (3 = página, 11 = texto disperso)
    pases: int = 1


def preparar_tesseract() -> Tesseract:
    """Localiza Tesseract y sus idiomas. Lanza ErrorEscaner('ocr_no_disponible') si no está."""
    ejecutable = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if not ejecutable:
        ejecutable = next((r for r in RUTAS_WINDOWS if Path(r).is_file()), None)
    if not ejecutable:
        raise ErrorEscaner("ocr_no_disponible", "No se encuentra Tesseract (instálalo o define TESSERACT_CMD)")

    if not os.environ.get("TESSDATA_PREFIX") and TESSDATA_LOCAL.is_dir():
        os.environ["TESSDATA_PREFIX"] = str(TESSDATA_LOCAL)
    pytesseract.pytesseract.tesseract_cmd = ejecutable
    try:
        version = str(pytesseract.get_tesseract_version())
        idiomas = sorted(pytesseract.get_languages(config=""))
    except Exception as e:  # ejecutable roto, sin permisos...
        raise ErrorEscaner("ocr_no_disponible", f"Tesseract no responde: {e}") from e
    return Tesseract(ejecutable, os.environ.get("TESSDATA_PREFIX"), version, idiomas)


def resolver_idiomas(pedidos: str, disponibles: list[str]) -> tuple[str, list[str]]:
    """Filtra 'spa+cat+eng' a los instalados. Devuelve (cadena para Tesseract, avisos)."""
    lista = [i for i in pedidos.split("+") if i]
    validos = [i for i in lista if i in disponibles]
    avisos = [f"idioma_no_instalado:{i}" for i in lista if i not in disponibles]
    if not validos:
        raise ErrorEscaner("ocr_sin_idiomas", f"Ninguno de los idiomas pedidos está instalado: {pedidos}")
    return "+".join(validos), avisos


def orientar(img: np.ndarray) -> tuple[np.ndarray, int, float | None]:
    """Gira la página 90/180/270° si hace falta. Devuelve (imagen, grados, confianza del OSD).

    Medido con capturas reales (hoja vertical fotografiada en horizontal, carta y cartel del revés):
    el OSD sobre la página entera reducida falla mucho; sobre un recorte de la zona con más letras a
    resolución nativa acierta con confianza alta (8-15) en ~0,5 s. Así que:
    1. OSD sobre ese recorte; si está seguro (>= CONFIANZA_OSD), se le hace caso.
    2. Si duda, se lee de verdad: primero tal cual (lo normal es que ya esté derecha y se para ahí);
       si no se lee bien, la que sugiere el OSD, 180° y el resto, parando en cuanto una gana claro.
    """
    recorte = _recorte_texto(img, 800)
    if recorte is None:
        return img, 0, None  # no hay letras que mirar
    grados_osd, confianza = 0, None
    try:
        osd = pytesseract.image_to_osd(_a_rgb(recorte), output_type=pytesseract.Output.DICT, timeout=30)
        grados_osd, confianza = int(osd.get("rotate", 0)) % 360, float(osd.get("orientation_conf", 0.0))
    except Exception:
        pass  # poco texto en el recorte: se decide leyendo
    if confianza is not None and confianza >= CONFIANZA_OSD:
        return girar(img, grados_osd), grados_osd, confianza

    base = _palabras_seguras(recorte)
    if base >= PALABRAS_DERECHA:
        return img, 0, confianza
    mejor, mejor_n = 0, base
    probadas = 0
    for g in dict.fromkeys([grados_osd, 180, 90, 270]):
        if g == 0:
            continue
        n = _palabras_seguras(girar(recorte, g))
        probadas += 1
        if n > mejor_n:
            mejor, mejor_n = g, n
        if mejor and mejor_n >= max(PALABRAS_DERECHA, 2 * base + 3):
            break
        if probadas >= 2 and mejor_n <= 2:
            break  # no se lee en ninguna: texto ilegible (foto desenfocada); no se gasta más tiempo
    if mejor and mejor_n >= 2 * base + 3:
        return girar(img, mejor), mejor, confianza
    return img, 0, confianza


def girar(img: np.ndarray, grados: int) -> np.ndarray:
    return img if grados == 0 else cv2.rotate(img, GIROS[grados])


def _recorte_texto(img: np.ndarray, lado: int = 1000) -> np.ndarray | None:
    """Recorte cuadrado, a resolución nativa, de la zona con más letras (para leer rápido y legible)."""
    gris, escala = imagen.gris_1600(img)
    lado = min(lado, *img.shape[:2])
    k = max(3, int(lado * escala))
    densidad = cv2.boxFilter(imagen.mascara_letras(gris), -1, (k, k))
    if float(densidad.max()) < 0.005:
        return None
    y, x = np.unravel_index(int(np.argmax(densidad)), densidad.shape)
    y0 = int(np.clip(y / escala - lado / 2, 0, img.shape[0] - lado))
    x0 = int(np.clip(x / escala - lado / 2, 0, img.shape[1] - lado))
    return img[y0:y0 + lado, x0:x0 + lado]


def _palabras_seguras(img: np.ndarray) -> int:
    """Palabras de 3+ letras leídas con confianza alta (inglés basta: mismo alfabeto). Solo para comparar."""
    try:
        d = pytesseract.image_to_data(_a_rgb(img), lang="eng", config="--psm 6",
                                      output_type=pytesseract.Output.DICT, timeout=2)
    except Exception:
        return 0
    return sum(1 for w, c in zip(d["text"], d["conf"])
               if float(c) >= 80 and sum(ch.isalpha() for ch in str(w)) >= 3)


def reconocer(img: np.ndarray, idiomas: str, dpi: float, nivel: str = "linea", timeout: int = 180) -> ResultadoOCR:
    """OCR con Tesseract: PDF de texto invisible + TSV de palabras.

    - Si la página tiene poca resolución, Tesseract lee una copia ampliada hasta ~DPI_OCR (lee mucho
      mejor a 300 DPI). La capa de texto mide lo mismo en puntos: el PDF conserva la imagen original.
    - Primer pase con segmentación de página (psm 3), la buena para cartas y formularios. Solo si
      duda (casi nada leído o confianza baja), un segundo pase de texto disperso (psm 11), que lee
      carteles, tarjetas y pantallas donde psm 3 no encuentra nada (medido con capturas reales).
      Se queda con el que tenga más caracteres fiables.
    """
    factor = min(FACTOR_MAXIMO, max(1.0, DPI_OCR / dpi))
    # Tope de tamaño: sin hoja detectada el DPI es una suposición y ampliar un fotograma 4K entero
    # solo cuesta tiempo (medido con la MX Brio: 12 MP y dos pases -> 4,5 s de OCR).
    factor = min(factor, max(1.0, (MEGAPIXELES_OCR_MAX * 1e6 / (img.shape[0] * img.shape[1])) ** 0.5))
    if factor > 1.05:
        img = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        dpi *= factor

    psm = 3
    pdf, palabras = _pase(img, idiomas, dpi, psm, timeout)
    pases = 1
    if _duda(palabras):
        pdf2, palabras2 = _pase(img, idiomas, dpi, 11, timeout)
        pases = 2
        if _fiables(palabras2) > _fiables(palabras):
            pdf, palabras, psm = pdf2, palabras2, 11

    alto, ancho = img.shape[:2]
    bloques = _agrupar(palabras, ancho, alto, nivel)
    total = sum(len(p["text"]) for p in palabras)
    media = sum(p["conf"] * len(p["text"]) for p in palabras) / total / 100.0 if total else None
    avisos = [] if palabras else ["ocr_sin_texto"]
    if psm == 11:
        avisos.append("ocr_texto_disperso")
    return ResultadoOCR(pdf, bloques, len(palabras), None if media is None else round(media, 3), avisos,
                        psm=psm, pases=pases)


PALABRAS_MINIMAS = 8        # menos que esto en una página = el primer pase probablemente no ha segmentado bien
CONFIANZA_DUDOSA = 70.0     # confianza media (0-100) por debajo de la cual se prueba el segundo pase
CONFIANZA_FIABLE = 60.0


def _duda(palabras: list[dict]) -> bool:
    if len(palabras) < PALABRAS_MINIMAS:
        return True
    total = sum(len(p["text"]) for p in palabras)
    return sum(p["conf"] * len(p["text"]) for p in palabras) / total < CONFIANZA_DUDOSA


def _fiables(palabras: list[dict]) -> int:
    """Caracteres en palabras con confianza alta: lo que de verdad aporta un pase."""
    return sum(len(p["text"]) for p in palabras if p["conf"] >= CONFIANZA_FIABLE)


def _pase(img: np.ndarray, idiomas: str, dpi: float, psm: int, timeout: int) -> tuple[bytes, list[dict]]:
    with tempfile.TemporaryDirectory(prefix="escaner_ocr_") as tmp:
        entrada, base = Path(tmp, "pagina.png"), Path(tmp, "salida")
        if not cv2.imwrite(str(entrada), img):  # PNG sin pérdidas: Tesseract lee exactamente la página
            raise ErrorEscaner("ocr_fallo", "No se pudo preparar la imagen para Tesseract")
        orden = [pytesseract.pytesseract.tesseract_cmd, str(entrada), str(base), "-l", idiomas,
                 "--dpi", str(int(round(dpi))), "--psm", str(psm), "-c", "textonly_pdf=1", "pdf", "tsv"]
        try:
            proc = subprocess.run(orden, capture_output=True, timeout=timeout, env=os.environ.copy())
        except subprocess.TimeoutExpired as e:
            raise ErrorEscaner("ocr_timeout", f"Tesseract superó {timeout} s") from e
        except OSError as e:
            raise ErrorEscaner("ocr_no_disponible", f"No se pudo ejecutar Tesseract: {e}") from e
        pdf_ruta, tsv_ruta = base.with_suffix(".pdf"), base.with_suffix(".tsv")
        if proc.returncode != 0 or not pdf_ruta.is_file() or not tsv_ruta.is_file():
            detalle = proc.stderr.decode("utf-8", "replace").strip()[-500:]
            raise ErrorEscaner("ocr_fallo", f"Tesseract falló (código {proc.returncode}): {detalle}")
        return pdf_ruta.read_bytes(), _leer_tsv(tsv_ruta.read_text(encoding="utf-8", errors="replace"))


def _leer_tsv(tsv: str) -> list[dict]:
    palabras = []
    for fila in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
        texto = (fila.get("text") or "").strip()
        try:
            conf = float(fila.get("conf", -1))
        except ValueError:
            continue
        if fila.get("level") != "5" or not texto or conf < 0:
            continue
        if "�" in texto or not any(c.isalnum() for c in texto):
            continue  # ruido: solo signos o caracteres no decodificables
        palabras.append({
            "clave": (int(fila["block_num"]), int(fila["par_num"]), int(fila["line_num"])),
            "text": texto, "conf": conf,
            "x": int(fila["left"]), "y": int(fila["top"]), "w": int(fila["width"]), "h": int(fila["height"]),
        })
    return palabras


def _agrupar(palabras: list[dict], ancho: int, alto: int, nivel: str) -> list[dict]:
    """Agrupa palabras en líneas o párrafos con caja normalizada a [0, 1] (como TextBlock)."""
    if nivel not in ("linea", "parrafo"):
        raise ValueError("nivel debe ser 'linea' o 'parrafo'")
    grupos: dict[tuple, list[dict]] = {}
    for p in palabras:
        clave = p["clave"] if nivel == "linea" else p["clave"][:2]
        grupos.setdefault(clave, []).append(p)

    bloques = []
    for i, (_, ps) in enumerate(sorted(grupos.items()), start=1):
        x0, y0 = min(p["x"] for p in ps), min(p["y"] for p in ps)
        x1, y1 = max(p["x"] + p["w"] for p in ps), max(p["y"] + p["h"] for p in ps)
        letras = sum(len(p["text"]) for p in ps)
        conf = sum(p["conf"] * len(p["text"]) for p in ps) / letras / 100.0
        bloques.append({
            "id": f"b{i}",
            "text": " ".join(p["text"] for p in ps),
            "box": {"x": round(x0 / ancho, 4), "y": round(y0 / alto, 4),
                    "w": round((x1 - x0) / ancho, 4), "h": round((y1 - y0) / alto, 4)},
            "confidence": round(min(1.0, max(0.0, conf)), 3),
        })
    return bloques


def _a_rgb(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
