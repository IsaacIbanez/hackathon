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

from .errores import ErrorEscaner

RUTAS_WINDOWS = (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")
TESSDATA_LOCAL = Path(__file__).resolve().parents[2] / "tessdata"   # scanner/pdf/tessdata (ignorado por git)
CONFIANZA_OSD = 2.0     # por debajo, no se gira (Tesseract no está seguro)
DPI_OCR = 300.0         # resolución a la que Tesseract lee mejor
FACTOR_MAXIMO = 3.0     # no ampliar más (coste ~ factor² y no inventa detalle)
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
    """Gira la página 90/180/270° si Tesseract (OSD) está seguro. Devuelve (imagen, grados, confianza)."""
    escala = min(1.0, 2000.0 / max(img.shape[:2]))
    peq = cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA) if escala < 1 else img
    try:
        osd = pytesseract.image_to_osd(_a_rgb(peq), output_type=pytesseract.Output.DICT, timeout=30)
    except Exception:
        return img, 0, None  # poco texto o sin osd.traineddata: se deja como está
    grados, confianza = int(osd.get("rotate", 0)) % 360, float(osd.get("orientation_conf", 0.0))
    if grados in GIROS and confianza >= CONFIANZA_OSD:
        return cv2.rotate(img, GIROS[grados]), grados, confianza
    return img, 0, confianza


def reconocer(img: np.ndarray, idiomas: str, dpi: float, nivel: str = "linea", timeout: int = 180) -> ResultadoOCR:
    """Un pase de Tesseract: PDF de texto invisible + TSV de palabras.

    Si la página tiene poca resolución, Tesseract lee una copia ampliada hasta ~DPI_OCR (lee mucho
    mejor a 300 DPI). La capa de texto mide lo mismo en puntos, así que el PDF conserva la imagen
    original sin ampliar.
    """
    factor = min(FACTOR_MAXIMO, max(1.0, DPI_OCR / dpi))
    if factor > 1.05:
        img = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        dpi *= factor
    with tempfile.TemporaryDirectory(prefix="escaner_ocr_") as tmp:
        entrada, base = Path(tmp, "pagina.png"), Path(tmp, "salida")
        if not cv2.imwrite(str(entrada), img):  # PNG sin pérdidas: Tesseract lee exactamente la página
            raise ErrorEscaner("ocr_fallo", "No se pudo preparar la imagen para Tesseract")
        orden = [pytesseract.pytesseract.tesseract_cmd, str(entrada), str(base), "-l", idiomas,
                 "--dpi", str(int(round(dpi))), "--psm", "3", "-c", "textonly_pdf=1", "pdf", "tsv"]
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
        pdf = pdf_ruta.read_bytes()
        tsv = tsv_ruta.read_text(encoding="utf-8", errors="replace")

    palabras = _leer_tsv(tsv)
    alto, ancho = img.shape[:2]
    bloques = _agrupar(palabras, ancho, alto, nivel)
    total = sum(len(p["text"]) for p in palabras)
    media = sum(p["conf"] * len(p["text"]) for p in palabras) / total / 100.0 if total else None
    avisos = [] if palabras else ["ocr_sin_texto"]
    return ResultadoOCR(pdf, bloques, len(palabras),
                        None if media is None else round(media, 3), avisos)


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
