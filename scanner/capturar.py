"""Captura un frame completo de la webcam (pensado para la Logitech MX Brio).

Uso:
    python scanner/capturar.py                 # busca una cámara "Brio" y guarda una captura
    python scanner/capturar.py --listar        # lista las cámaras que ve el sistema
    python scanner/capturar.py --camara 0      # usa la cámara con índice 0
    python scanner/capturar.py --camara acer   # usa la primera cámara cuyo nombre contenga "acer"
    python scanner/capturar.py --probar        # abre la cámara y lee un frame, pero no guarda nada

Guarda el frame tal cual (sin recortar ni procesar) en PNG sin pérdida y, al lado, un JSON
con los metadatos de la captura (cámara, resolución pedida y entregada, formato...).
La última línea de la salida es la ruta del PNG (o un JSON con --json).
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

CARPETA_POR_DEFECTO = Path(__file__).resolve().parent / "capturas"
PREFERENCIA_POR_DEFECTO = "brio"

# Códigos de salida
OK = 0
ERR_CAMARA_NO_ENCONTRADA = 2
ERR_NO_ABRE = 3
ERR_SIN_FRAME = 4


@dataclass
class Camara:
    indice: int
    nombre: str


class ErrorCaptura(Exception):
    def __init__(self, mensaje: str, codigo: int):
        super().__init__(mensaje)
        self.codigo = codigo


# ---------- Listado de cámaras ----------

_RE_DSHOW_VIDEO = re.compile(r'"(?P<nombre>[^"]+)"\s+\(video\)')


def parsear_dshow(salida_ffmpeg: str) -> list[Camara]:
    """Extrae las cámaras de vídeo de `ffmpeg -list_devices true -f dshow -i dummy`.

    El orden de ffmpeg (DirectShow) coincide con el índice de OpenCV con CAP_DSHOW.
    """
    nombres = [m.group("nombre") for m in _RE_DSHOW_VIDEO.finditer(salida_ffmpeg)]
    return [Camara(i, n) for i, n in enumerate(nombres)]


def _listar_windows() -> list[Camara]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return []
    r = subprocess.run(
        [ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
    )
    return parsear_dshow(r.stderr + r.stdout)


def _listar_linux() -> list[Camara]:
    camaras = []
    for d in sorted(Path("/sys/class/video4linux").glob("video*"),
                    key=lambda p: int(p.name[5:]) if p.name[5:].isdigit() else 1_000_000):
        try:
            nombre = (d / "name").read_text().strip()
        except OSError:
            continue
        if d.name[5:].isdigit():
            camaras.append(Camara(int(d.name[5:]), nombre))
    return camaras


def listar_camaras() -> list[Camara]:
    """Cámaras con nombre. Lista vacía si el sistema no permite saber los nombres."""
    sistema = platform.system()
    if sistema == "Windows":
        return _listar_windows()
    if sistema == "Linux":
        return _listar_linux()
    return []


def elegir_camara(camaras: list[Camara], preferencia: str | None) -> Camara:
    """Elige por índice ("0"), por parte del nombre ("brio") o, sin preferencia, la Brio.

    Nunca cae en silencio en otra cámara: si no encuentra la pedida, falla.
    """
    pref = PREFERENCIA_POR_DEFECTO if preferencia is None else preferencia.strip()
    if pref.isdigit():
        indice = int(pref)
        for c in camaras:
            if c.indice == indice:
                return c
        if not camaras:
            # Sin nombres disponibles (macOS, ffmpeg ausente...) se acepta el índice a ciegas.
            return Camara(indice, "(nombre desconocido)")
    else:
        for c in camaras:
            if pref.lower() in c.nombre.lower():
                return c
    disponibles = ", ".join(f"{c.indice}: {c.nombre}" for c in camaras) or "ninguna con nombre"
    raise ErrorCaptura(
        f'No encuentro ninguna cámara que contenga "{pref}". Disponibles: {disponibles}. '
        f"Conecta la MX Brio o usa --camara <índice>.",
        ERR_CAMARA_NO_ENCONTRADA,
    )


# ---------- Captura ----------

def fourcc_a_texto(valor: float) -> str:
    v = int(valor)
    if v <= 0:
        return ""
    return "".join(chr((v >> (8 * i)) & 0xFF) for i in range(4)).strip("\x00")


def nombre_captura(momento: datetime) -> str:
    return momento.strftime("%Y%m%d-%H%M%S-") + f"{momento.microsecond // 1000:03d}"


def _backend(cv2):
    sistema = platform.system()
    if sistema == "Windows":
        return cv2.CAP_DSHOW, "DSHOW"
    if sistema == "Linux":
        return cv2.CAP_V4L2, "V4L2"
    return cv2.CAP_ANY, "ANY"


def capturar(camara: Camara, ancho: int, alto: int, calentamiento_s: float):
    """Abre la cámara, deja que se ajusten exposición y enfoque, y devuelve (frame, metadatos)."""
    import cv2  # importación tardía: --listar y los tests no necesitan OpenCV

    backend, nombre_backend = _backend(cv2)
    cap = cv2.VideoCapture(camara.indice, backend)
    if not cap.isOpened():
        raise ErrorCaptura(f"No se puede abrir la cámara {camara.indice} ({camara.nombre}).", ERR_NO_ABRE)
    try:
        # MJPG es el formato que permite resoluciones altas por USB (YUY2 a 4K no cabe).
        # El orden importa en DirectShow: primero el formato y después el tamaño.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, ancho)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, alto)

        # Calentamiento: los primeros frames suelen salir oscuros o desenfocados.
        frames_descartados = 0
        fin = time.monotonic() + calentamiento_s
        while time.monotonic() < fin:
            if cap.read()[0]:
                frames_descartados += 1

        ok, frame = cap.read()
        if not ok or frame is None:
            raise ErrorCaptura("La cámara se abrió pero no entregó ningún frame.", ERR_SIN_FRAME)

        alto_real, ancho_real = frame.shape[:2]
        metadatos = {
            "camara": {"indice": camara.indice, "nombre": camara.nombre},
            "backend": nombre_backend,
            "sistema": platform.system(),
            "opencv": cv2.__version__,
            "resolucion_pedida": {"ancho": ancho, "alto": alto},
            "resolucion_entregada": {"ancho": int(ancho_real), "alto": int(alto_real)},
            "canales": int(frame.shape[2]) if frame.ndim == 3 else 1,
            "formato": fourcc_a_texto(cap.get(cv2.CAP_PROP_FOURCC)),
            "fps": cap.get(cv2.CAP_PROP_FPS),
            "ajustes_camara": {
                "autoenfoque": cap.get(cv2.CAP_PROP_AUTOFOCUS),
                "enfoque": cap.get(cv2.CAP_PROP_FOCUS),
                "auto_exposicion": cap.get(cv2.CAP_PROP_AUTO_EXPOSURE),
                "exposicion": cap.get(cv2.CAP_PROP_EXPOSURE),
                "brillo": cap.get(cv2.CAP_PROP_BRIGHTNESS),
            },
            "calentamiento": {"segundos": calentamiento_s, "frames_descartados": frames_descartados},
        }
        return frame, metadatos
    finally:
        cap.release()


def guardar(frame, metadatos: dict, carpeta: Path, momento: datetime) -> Path:
    import cv2

    carpeta.mkdir(parents=True, exist_ok=True)
    base = carpeta / nombre_captura(momento)
    ruta_png = base.with_suffix(".png")
    # Se escribe con imencode + write_bytes para que funcionen rutas con acentos en Windows.
    ok, datos = cv2.imencode(".png", frame)
    if not ok:
        raise ErrorCaptura("No se pudo codificar el frame como PNG.", ERR_SIN_FRAME)
    ruta_png.write_bytes(datos.tobytes())
    metadatos = {**metadatos, "momento": momento.isoformat(timespec="milliseconds"),
                 "archivo": ruta_png.name, "bytes": ruta_png.stat().st_size}
    base.with_suffix(".json").write_text(json.dumps(metadatos, ensure_ascii=False, indent=2), encoding="utf-8")
    return ruta_png


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Captura un frame completo de la webcam (MX Brio).")
    p.add_argument("--listar", action="store_true", help="lista las cámaras y sale")
    p.add_argument("--camara", help='índice ("0") o parte del nombre ("brio"). Por defecto: "brio"')
    p.add_argument("--ancho", type=int, default=3840, help="ancho pedido (la cámara puede entregar otro)")
    p.add_argument("--alto", type=int, default=2160, help="alto pedido (la cámara puede entregar otro)")
    p.add_argument("--calentamiento", type=float, default=1.5,
                   help="segundos para que se ajusten exposición y enfoque (por defecto 1.5)")
    p.add_argument("--salida", type=Path, default=CARPETA_POR_DEFECTO, help="carpeta de salida")
    p.add_argument("--probar", action="store_true", help="captura pero no guarda (comprueba la cámara)")
    p.add_argument("--json", action="store_true", help="imprime el resultado como JSON")
    args = p.parse_args(argv)

    try:
        camaras = listar_camaras()
        if args.listar:
            if not camaras:
                print("No puedo obtener nombres de cámaras en este sistema; usa --camara <índice>.")
            for c in camaras:
                print(f"{c.indice}: {c.nombre}")
            return OK

        camara = elegir_camara(camaras, args.camara)
        print(f"Cámara {camara.indice}: {camara.nombre}", file=sys.stderr)
        momento = datetime.now().astimezone()
        frame, metadatos = capturar(camara, args.ancho, args.alto, args.calentamiento)
        res = metadatos["resolucion_entregada"]
        print(f"Frame {res['ancho']}x{res['alto']} ({metadatos['formato'] or 'formato desconocido'})",
              file=sys.stderr)

        if args.probar:
            print(json.dumps(metadatos, ensure_ascii=False) if args.json else "Prueba correcta (no se guarda nada).")
            return OK

        ruta = guardar(frame, metadatos, args.salida, momento)
        print(json.dumps({"ok": True, "png": str(ruta), "json": str(ruta.with_suffix(".json")),
                          **res}, ensure_ascii=False) if args.json else ruta)
        return OK
    except ErrorCaptura as e:
        if args.json:
            print(json.dumps({"ok": False, "error": str(e), "codigo": e.codigo}, ensure_ascii=False))
        else:
            print(f"Error: {e}", file=sys.stderr)
        return e.codigo


if __name__ == "__main__":
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    # En una tubería (Git Bash, el agente...) Windows usaría cp1252 y rompería los acentos.
    for flujo in (sys.stdout, sys.stderr):
        if not flujo.isatty():
            flujo.reconfigure(encoding="utf-8")
    sys.exit(main())
