"""Punto de entrada del componente: PNG -> PDF buscable + resultado estructurado."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import geometria, imagen, ocr, pdf
from .entrada import cargar_png
from .errores import ErrorEscaner

log = logging.getLogger(__name__)

DPI_POR_DEFECTO = 200.0          # si no hay papel estándar ni DPI en el PNG
TAMANOS = ("auto", "imagen", *geometria.PAPELES_MM)
BCP47 = {"spa": "es", "cat": "ca", "eng": "en"}


@dataclass
class Opciones:
    idiomas: str = "spa+cat+eng"
    modo: str = "color"                  # color | gris | bn (bn solo si se pide: es destructivo)
    recortar: bool = True                # detectar la hoja y corregir perspectiva
    esquinas: list[list[float]] | None = None   # recorte manual: 4 puntos [x, y] en px del original
    iluminacion: bool = True             # igualar sombras y dominantes (ganancia limitada)
    orientar: bool = True                # girar 90/180/270 si Tesseract está seguro
    tamano: str = "auto"                 # auto | imagen | A4 | Letter | A5 | Legal
    fov_diagonal: float = geometria.FOV_DIAGONAL_WEBCAM  # campo de visión de la cámara (grados)
    dpi: float | None = None             # fuerza el DPI cuando no se ajusta a un papel estándar
    formato_imagen: str = "png"          # png (sin pérdidas) | jpeg
    calidad_jpeg: int = 92
    nivel_bloques: str = "linea"         # linea | parrafo
    ocr: bool = True
    guardar_intermedios: bool = True
    titulo: str | None = None

    def validar(self) -> None:
        if self.modo not in imagen.MODOS:
            raise ErrorEscaner("opciones_invalidas", f"modo debe ser uno de {imagen.MODOS}")
        if self.tamano not in TAMANOS:
            raise ErrorEscaner("opciones_invalidas", f"tamano debe ser uno de {TAMANOS}")
        if self.formato_imagen not in ("png", "jpeg"):
            raise ErrorEscaner("opciones_invalidas", "formato_imagen debe ser png o jpeg")
        if self.esquinas is not None and np.asarray(self.esquinas).shape != (4, 2):
            raise ErrorEscaner("opciones_invalidas", "esquinas debe ser una lista de 4 puntos [x, y]")
        if self.dpi is not None and not (30 <= self.dpi <= 2400):
            raise ErrorEscaner("opciones_invalidas", "dpi fuera de rango (30..2400)")


@dataclass
class Resultado:
    estado: str                          # ok | parcial (hay PDF pero no buscable o no valida) | error
    pdf: str | None = None
    carpeta: str | None = None
    paginas: int = 0
    idiomas: str | None = None
    buscable: bool = False
    avisos: list[str] = field(default_factory=list)
    error: dict | None = None
    entrada: dict = field(default_factory=dict)
    deteccion: dict | None = None
    pagina: dict = field(default_factory=dict)        # tamaño en px, DPI, papel, giro
    calidad: dict = field(default_factory=dict)       # puntuacion, problemas (FrameIssue), medidas
    ocr: dict = field(default_factory=dict)           # motor, palabras, confianza media, bloques
    validacion: dict = field(default_factory=dict)
    intermedios: dict = field(default_factory=dict)
    tiempos_ms: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.estado == "ok"

    def a_dict(self) -> dict:
        return asdict(self)

    def documento(self) -> dict:
        """Payload del mensaje `document` del contrato (api/openapi.yaml, DocumentPayload)."""
        d = {
            "blocks": self.ocr.get("bloques", []),
            "quality": {"score": self.calidad.get("puntuacion", 0.0), "issues": self.calidad.get("problemas", [])},
        }
        if self.pagina.get("ancho_px"):
            d["imageWidth"], d["imageHeight"] = self.pagina["ancho_px"], self.pagina["alto_px"]
        idiomas = (self.idiomas or "").split("+")
        if len(idiomas) == 1 and idiomas[0] in BCP47:
            d["lang"] = BCP47[idiomas[0]]
        return d


def convertir(origen: str | Path | bytes, carpeta_salida: str | Path, opciones: Opciones | None = None,
              nombre: str | None = None, metadatos: dict | None = None) -> Resultado:
    """Convierte un PNG en un PDF buscable dentro de `carpeta_salida/<nombre>/`.

    Nunca lanza por errores esperables: devuelve Resultado con estado 'error' y `error.codigo`.
    """
    op = opciones or Opciones()
    r = Resultado(estado="error")
    t = _Cronometro(r.tiempos_ms)
    try:
        op.validar()
        with t("entrada"):
            ent = cargar_png(origen)
        r.entrada = {**ent.info, "dpi_png": ent.dpi, "metadatos": metadatos or {}}

        carpeta = _carpeta_unica(Path(carpeta_salida), nombre or _nombre_por_defecto(origen))
        nombre = carpeta.name
        r.carpeta = str(carpeta)
        original = carpeta / "original.png"
        original.write_bytes(ent.bytes_originales)  # el original se guarda siempre, sin tocar
        r.intermedios["original"] = str(original)
        (carpeta / "entrada.json").write_text(json.dumps(r.entrada, ensure_ascii=False, indent=2), encoding="utf-8")

        tess = _tesseract_si_hace_falta(op, r)

        with t("geometria"):
            pagina, papel = _preparar_geometria(ent.imagen, op, r, carpeta)
        if op.orientar and tess:
            with t("orientacion"):
                pagina, grados, conf = ocr.orientar(pagina)
            r.pagina["giro_grados"], r.pagina["giro_confianza"] = grados, conf
        dpi = _dpi(pagina, papel, op, ent.dpi)
        alto, ancho = pagina.shape[:2]
        r.pagina.update({"ancho_px": ancho, "alto_px": alto, "dpi": [round(dpi[0], 2), round(dpi[1], 2)],
                         "papel": papel, "tamano_mm": [round(ancho / dpi[0] * 25.4, 1), round(alto / dpi[1] * 25.4, 1)]})

        with t("calidad"):
            det = r.deteccion or {}
            r.calidad = imagen.evaluar_calidad(
                pagina, fraccion_area=det.get("fraccion_area") if det.get("encontrada") else None,
                toca_borde=bool(det.get("toca_borde")), dpi_efectivo=float(np.mean(dpi)),
                angulo_max=geometria.angulo_maximo(np.asarray(det["esquinas"])) if det.get("encontrada") else None)

        with t("mejora"):
            # Solo papel claro y recortado: en carteles oscuros o en la escena entera aclarar lo estropea.
            igualar = op.iluminacion and bool(det.get("encontrada")) and imagen.papel_claro(pagina)
            r.pagina["iluminacion_corregida"] = igualar
            corregida = imagen.corregir_iluminacion(pagina) if igualar else pagina
            final = imagen.aplicar_modo(corregida, op.modo)
            codificada = pdf.codificar_imagen(final, dpi, op.formato_imagen, op.calidad_jpeg, binaria=op.modo == "bn")
        if op.guardar_intermedios:
            ext = "jpg" if op.formato_imagen == "jpeg" and op.modo != "bn" else "png"
            (carpeta / f"pagina.{ext}").write_bytes(codificada)
            r.intermedios["pagina"] = str(carpeta / f"pagina.{ext}")

        with t("pdf_base"):
            base = pdf.construir_pdf_base(codificada, dpi)
        if op.guardar_intermedios:
            (carpeta / "base.pdf").write_bytes(base)
            r.intermedios["base_pdf"] = str(carpeta / "base.pdf")

        final_pdf, bloques = base, None
        if op.ocr and tess:
            try:
                idiomas, avisos = ocr.resolver_idiomas(op.idiomas, tess.idiomas)
                r.avisos += avisos
                r.idiomas = idiomas
                with t("ocr"):
                    # El OCR lee la página corregida (sin binarizar): misma geometría, mejor lectura.
                    res = ocr.reconocer(corregida, idiomas, float(np.mean(dpi)), op.nivel_bloques)
                r.avisos += res.avisos
                bloques = res.bloques
                r.ocr = {"motor": f"tesseract {tess.version}", "psm": res.psm, "pases": res.pases,
                         "palabras": res.palabras, "confianza_media": res.confianza_media, "bloques": bloques}
                with t("capa_texto"):
                    final_pdf = pdf.superponer_texto(base, res.pdf_texto, op.titulo or nombre)
            except ErrorEscaner as e:
                r.avisos.append(f"sin_capa_ocr:{e.codigo}")
                log.warning("OCR no disponible, PDF solo imagen: %s", e.mensaje)
        if final_pdf is base:
            final_pdf = pdf.anadir_metadatos(base, op.titulo or nombre)

        salida = carpeta / f"{nombre}.pdf"
        salida.write_bytes(final_pdf)
        r.pdf, r.paginas = str(salida), 1

        with t("validacion"):
            r.validacion = pdf.validar(final_pdf, final, dpi, bloques)
        r.buscable = bool(r.validacion.get("buscable"))
        r.estado = "ok" if r.validacion.get("ok") and r.buscable else "parcial"
        if not r.validacion.get("ok"):
            r.avisos.append("validacion_fallida")
    except ErrorEscaner as e:
        r.error = e.a_dict()
    except Exception as e:  # inesperado: se informa igual, con código genérico
        log.exception("Fallo inesperado")
        r.error = {"codigo": "interno", "mensaje": f"{type(e).__name__}: {e}"}
    finally:
        r.tiempos_ms["total"] = round(sum(v for k, v in r.tiempos_ms.items() if k != "total"), 1)
        if r.carpeta:
            Path(r.carpeta, "resultado.json").write_text(json.dumps(r.a_dict(), ensure_ascii=False, indent=2),
                                                         encoding="utf-8")
    return r


# ---------------------------------------------------------------- pasos

def _tesseract_si_hace_falta(op: Opciones, r: Resultado) -> ocr.Tesseract | None:
    if not (op.ocr or op.orientar):
        return None
    try:
        return ocr.preparar_tesseract()
    except ErrorEscaner as e:
        r.avisos.append(f"sin_capa_ocr:{e.codigo}")
        log.warning("%s", e.mensaje)
        return None


def _preparar_geometria(img: np.ndarray, op: Opciones, r: Resultado, carpeta: Path) -> tuple[np.ndarray, str | None]:
    """Recorta y endereza la hoja si se puede. Devuelve (página, papel estándar o None)."""
    det = None
    if op.esquinas is not None:
        esquinas = geometria.ordenar_esquinas(np.asarray(op.esquinas, dtype=np.float32))
        det = geometria.Deteccion(True, 1.0, esquinas, "manual",
                                  fraccion_area=cv2.contourArea(esquinas) / float(img.shape[0] * img.shape[1]))
    elif op.recortar:
        det = geometria.detectar_pagina(img)
        if not det.encontrada:
            r.avisos.append("pagina_no_detectada")  # se usa la imagen entera: mejor eso que un mal recorte

    if det is not None:
        r.deteccion = det.a_dict()
        if op.guardar_intermedios and det.esquinas is not None:
            _guardar_deteccion(img, det, carpeta / "deteccion.jpg")
            r.intermedios["deteccion"] = str(carpeta / "deteccion.jpg")

    if det is not None and det.encontrada:
        proporcion = geometria.proporcion_real(det.esquinas, img.shape[:2], op.fov_diagonal)
        # Hoja cortada por el encuadre: sus esquinas no son las del papel, no se fuerza un tamaño estándar.
        papel = _papel(proporcion, "imagen" if det.toca_borde and op.tamano == "auto" else op.tamano)
        if papel:
            proporcion = _proporcion_papel(papel, horizontal=proporcion > 1)
        return geometria.enderezar(img, det.esquinas, proporcion), papel

    # Sin recorte: la imagen se trata como la página (p. ej. la captura ya viene recortada).
    # Tolerancia estricta: un fotograma 4:3 sin hoja no debe convertirse en "Letter".
    alto, ancho = img.shape[:2]
    papel = _papel(ancho / alto, op.tamano, geometria.TOLERANCIA_SIN_DETECCION)
    if papel:
        img = geometria.ajustar_a_proporcion(img, _proporcion_papel(papel, horizontal=ancho > alto))
    return img, papel


def _papel(proporcion: float, tamano: str, tolerancia: float = geometria.TOLERANCIA_PAPEL) -> str | None:
    if tamano == "imagen":
        return None
    if tamano == "auto":
        return geometria.papel_cercano(proporcion, tolerancia)
    return tamano


def _proporcion_papel(papel: str, horizontal: bool) -> float:
    w, h = geometria.PAPELES_MM[papel]
    return h / w if horizontal else w / h


def _dpi(pagina: np.ndarray, papel: str | None, op: Opciones, dpi_png: float | None) -> tuple[float, float]:
    """DPI de la página: si hay papel estándar se deduce de él (el PDF mide lo que mide el papel)."""
    alto, ancho = pagina.shape[:2]
    if papel:
        w, h = geometria.PAPELES_MM[papel]
        if ancho > alto:
            w, h = h, w
        return ancho / (w / 25.4), alto / (h / 25.4)
    valor = op.dpi or dpi_png or DPI_POR_DEFECTO
    return valor, valor


def _guardar_deteccion(img: np.ndarray, det: geometria.Deteccion, ruta: Path) -> None:
    """Imagen de depuración con la hoja detectada dibujada encima."""
    vista = img.copy()
    color = (0, 200, 0) if det.encontrada else (0, 0, 255)
    grosor = max(2, int(max(img.shape[:2]) / 400))
    cv2.polylines(vista, [det.esquinas.astype(np.int32).reshape(-1, 1, 2)], True, color, grosor)
    escala = min(1.0, 1600.0 / max(img.shape[:2]))
    vista = cv2.resize(vista, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(ruta), vista, [cv2.IMWRITE_JPEG_QUALITY, 85])


def _nombre_por_defecto(origen) -> str:
    if isinstance(origen, (str, Path)):
        return Path(origen).stem
    return datetime.now().strftime("escaneo-%Y%m%d-%H%M%S")


def _carpeta_unica(base: Path, nombre: str) -> Path:
    """Crea una carpeta nueva; si ya existe, añade -2, -3... (nunca sobrescribe un resultado)."""
    limpio = "".join(c if c.isalnum() or c in "-_." else "_" for c in nombre).strip("._") or "escaneo"
    base.mkdir(parents=True, exist_ok=True)
    for i in range(1, 1000):
        carpeta = base / (limpio if i == 1 else f"{limpio}-{i}")
        try:
            carpeta.mkdir()
            return carpeta
        except FileExistsError:
            continue
    raise ErrorEscaner("salida_no_disponible", f"No se pudo crear una carpeta de salida en {base}")


class _Cronometro:
    def __init__(self, destino: dict):
        self.destino = destino

    def __call__(self, etapa: str):
        return _Etapa(self.destino, etapa)


class _Etapa:
    def __init__(self, destino: dict, etapa: str):
        self.destino, self.etapa = destino, etapa

    def __enter__(self):
        self.t0 = time.perf_counter()

    def __exit__(self, *exc):
        self.destino[self.etapa] = round((time.perf_counter() - self.t0) * 1000, 1)
        return False
