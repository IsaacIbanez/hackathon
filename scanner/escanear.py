"""Escanea un documento de punta a punta: captura (capturar.py, Pau) -> PDF buscable (pdf/, Didac).

Uso:
    python scanner/escanear.py                       # MX Brio -> PNG en capturas/ -> PDF en pdf/salida/
    python scanner/escanear.py --camara 0            # otra cámara (índice o parte del nombre)
    python scanner/escanear.py --png captura.png     # sin cámara: convierte un PNG ya capturado
    python scanner/escanear.py --json                # resultado completo en JSON (para integrar)

Desde Python:
    from escanear import escanear, escanear_viva
    r = escanear()                    # captura única -> Escaneo(png, metadatos_captura, resultado)
    viva = capturar.CamaraViva(...)   # o con la cámara siempre abierta (captura en ~0,4 s):
    r = escanear_viva(viva)

Solo usa la interfaz pública de capturar.py y de escaner_pdf; no toca su código.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))                      # capturar.py
if str(RAIZ / "pdf" / "src") not in sys.path:     # escaner_pdf, aunque no esté instalado con pip
    sys.path.insert(1, str(RAIZ / "pdf" / "src"))

import capturar  # noqa: E402
from escaner_pdf import Opciones, Resultado, convertir  # noqa: E402

CARPETA_PDF = RAIZ / "pdf" / "salida"
ESPERA_ENFOQUE = 1.4   # s; máximo que capturar.py espera a que se asiente el autoenfoque


@dataclass
class Escaneo:
    png: Path | None
    metadatos_captura: dict | None
    resultado: Resultado | None
    error_captura: dict | None = None

    @property
    def ok(self) -> bool:
        return self.resultado is not None and self.resultado.ok

    def a_dict(self) -> dict:
        return {
            "png": str(self.png) if self.png else None,
            "captura": self.metadatos_captura,
            "error_captura": self.error_captura,
            "resultado": self.resultado.a_dict() if self.resultado else None,
        }


def escanear(camara: str | None = None, *, ancho: int = 3840, alto: int = 2160,
             espera_enfoque: float = ESPERA_ENFOQUE, carpeta_capturas: Path = capturar.CARPETA_POR_DEFECTO,
             carpeta_pdf: Path = CARPETA_PDF, opciones: Opciones | None = None) -> Escaneo:
    """Captura única (abre y cierra la cámara) y la convierte en PDF.

    Los errores de cámara vuelven en `error_captura`, con los códigos de capturar.py.
    """
    try:
        cam = capturar.elegir_camara(capturar.listar_camaras(), camara)
        momento = datetime.now().astimezone()
        frame, metadatos, cierre = capturar.capturar(cam, ancho, alto, espera_enfoque)
        try:
            # La cámara se cierra en un hilo (~0,9 s en DirectShow) mientras se guarda el PNG.
            png = capturar.guardar(frame, metadatos, Path(carpeta_capturas), momento)
        finally:
            cierre.join()
    except capturar.ErrorCaptura as e:
        return Escaneo(None, None, None, {"codigo": e.codigo, "mensaje": str(e)})
    return _convertir_captura(png, carpeta_pdf, opciones)


def escanear_viva(viva: "capturar.CamaraViva", *, carpeta_capturas: Path = capturar.CARPETA_POR_DEFECTO,
                  carpeta_pdf: Path = CARPETA_PDF, opciones: Opciones | None = None) -> Escaneo:
    """Escanea con una cámara que ya está abierta (capturar.CamaraViva): la captura tarda ~0,4 s.

    Quien crea la CamaraViva es quien la cierra (viva.cerrar()).
    """
    try:
        momento = datetime.now().astimezone()
        frame, metadatos = viva.capturar()
        png = capturar.guardar(frame, metadatos, Path(carpeta_capturas), momento)
    except capturar.ErrorCaptura as e:
        return Escaneo(None, None, None, {"codigo": e.codigo, "mensaje": str(e)})
    return _convertir_captura(png, carpeta_pdf, opciones)


def _convertir_captura(png: Path, carpeta_pdf: Path, opciones: Opciones | None) -> Escaneo:
    # guardar() escribe el JSON de la captura con momento, archivo y bytes: se usa ese, completo.
    metadatos = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
    return Escaneo(png, metadatos, convertir_png(png, carpeta_pdf, opciones, metadatos))


def convertir_png(png: Path, carpeta_pdf: Path = CARPETA_PDF, opciones: Opciones | None = None,
                  metadatos: dict | None = None) -> Resultado:
    """Convierte un PNG ya capturado. Si tiene al lado el JSON de capturar.py, lo adjunta."""
    png = Path(png)
    if metadatos is None and png.with_suffix(".json").is_file():
        try:
            metadatos = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            metadatos = None
    return convertir(png, carpeta_pdf, opciones, nombre=png.stem, metadatos=metadatos)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Captura un documento y genera su PDF buscable.")
    p.add_argument("--camara", help='índice ("0") o parte del nombre. Por defecto: "brio"')
    p.add_argument("--png", type=Path, help="no capturar: convertir este PNG")
    p.add_argument("--calentamiento", type=float, default=ESPERA_ENFOQUE,
                   help="espera máxima (s) a que se asiente el enfoque (por defecto 1.4)")
    p.add_argument("--idiomas", default="spa+cat+eng")
    p.add_argument("--modo", choices=["color", "gris", "bn"], default="color")
    p.add_argument("--salida", type=Path, default=CARPETA_PDF, help="carpeta de los PDF")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    op = Opciones(idiomas=a.idiomas, modo=a.modo)

    if a.png:
        esc = Escaneo(a.png, None, convertir_png(a.png, a.salida, op))
    else:
        esc = escanear(a.camara, espera_enfoque=a.calentamiento, carpeta_pdf=a.salida, opciones=op)

    if a.json:
        print(json.dumps(esc.a_dict(), ensure_ascii=False, indent=2))
    elif esc.error_captura:
        print(f"Error de captura: {esc.error_captura['mensaje']}", file=sys.stderr)
    elif esc.resultado.error:
        print(f"Error [{esc.resultado.error['codigo']}]: {esc.resultado.error['mensaje']}", file=sys.stderr)
    else:
        r = esc.resultado
        print(f"{r.estado.upper()}: {r.pdf}")
        print(f"  captura {esc.png}")
        print(f"  calidad {r.calidad.get('puntuacion')} {r.calidad.get('problemas') or ''}; avisos {r.avisos or '-'}")
    if esc.error_captura:
        return esc.error_captura["codigo"]
    return 0 if esc.ok else (1 if esc.resultado.estado == "error" else 2)


if __name__ == "__main__":
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    for flujo in (sys.stdout, sys.stderr):
        if not flujo.isatty():
            flujo.reconfigure(encoding="utf-8")
    sys.exit(main())
