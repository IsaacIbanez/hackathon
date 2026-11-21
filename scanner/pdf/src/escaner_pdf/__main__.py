"""CLI: python -m escaner_pdf captura.png [-o salida/] [opciones]"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .pipeline import TAMANOS, Opciones, convertir


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="escaner_pdf", description="PNG de un documento -> PDF buscable")
    p.add_argument("entrada", help="imagen PNG")
    p.add_argument("-o", "--salida", default="salida", help="carpeta de salida (por defecto: salida/)")
    p.add_argument("-n", "--nombre", help="nombre del resultado (por defecto: el del archivo)")
    p.add_argument("-l", "--idiomas", default="spa+cat+eng", help="idiomas de Tesseract (spa+cat+eng)")
    p.add_argument("--modo", choices=["color", "gris", "bn"], default="color")
    p.add_argument("--tamano", choices=TAMANOS, default="auto", help="papel de la página (auto detecta A4/Letter...)")
    p.add_argument("--dpi", type=float, help="DPI si no se ajusta a un papel estándar")
    p.add_argument("--esquinas", help="recorte manual: x1,y1,x2,y2,x3,y3,x4,y4 en px del original")
    p.add_argument("--sin-recorte", action="store_true", help="no detectar la hoja")
    p.add_argument("--sin-iluminacion", action="store_true", help="no corregir sombras")
    p.add_argument("--sin-orientar", action="store_true", help="no girar 90/180/270")
    p.add_argument("--sin-ocr", action="store_true", help="solo imagen, sin capa de texto")
    p.add_argument("--jpeg", action="store_true", help="incrustar JPEG (más ligero) en vez de PNG sin pérdidas")
    p.add_argument("--sin-intermedios", action="store_true", help="no guardar página, PDF base ni detección")
    p.add_argument("--json", action="store_true", help="imprime el resultado completo en JSON")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    esquinas = None
    if a.esquinas:
        v = [float(x) for x in a.esquinas.split(",")]
        if len(v) != 8:
            p.error("--esquinas necesita 8 números")
        esquinas = [v[i:i + 2] for i in range(0, 8, 2)]

    op = Opciones(idiomas=a.idiomas, modo=a.modo, tamano=a.tamano, dpi=a.dpi, esquinas=esquinas,
                  recortar=not a.sin_recorte, iluminacion=not a.sin_iluminacion, orientar=not a.sin_orientar,
                  ocr=not a.sin_ocr, formato_imagen="jpeg" if a.jpeg else "png",
                  guardar_intermedios=not a.sin_intermedios)
    r = convertir(a.entrada, a.salida, op, nombre=a.nombre)

    if a.json:
        print(json.dumps(r.a_dict(), ensure_ascii=False, indent=2))
    elif r.error:
        print(f"ERROR [{r.error['codigo']}] {r.error['mensaje']}", file=sys.stderr)
    else:
        v = r.validacion
        print(f"{r.estado.upper()}: {r.pdf}")
        print(f"  página {r.pagina['ancho_px']}x{r.pagina['alto_px']} px, {r.pagina['papel'] or 'sin papel estándar'}, "
              f"{r.pagina['dpi'][0]:.0f} DPI; calidad {r.calidad['puntuacion']} {r.calidad['problemas'] or ''}")
        print(f"  OCR: {r.ocr.get('palabras', 0)} palabras, confianza {r.ocr.get('confianza_media')}; "
              f"buscable={r.buscable}, PSNR {v.get('psnr_db')} dB, desfase {v.get('desfase_mediano')}")
        if r.avisos:
            print(f"  avisos: {', '.join(r.avisos)}")
        print(f"  tiempo total {r.tiempos_ms['total']:.0f} ms")
    return 0 if r.estado == "ok" else (1 if r.estado == "error" else 2)


if __name__ == "__main__":
    sys.exit(main())
