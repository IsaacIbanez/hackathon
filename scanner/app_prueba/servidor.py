"""APP PROVISIONAL DE PRUEBA — no es parte del producto. Se puede borrar esta carpeta entera.

Mini servidor en http://localhost:8780 para probar captura + PDF desde el navegador:
vista previa de la cámara, botón de escanear, subida de imágenes y visor de resultados.

    scanner\\pdf\\.venv\\Scripts\\python scanner\\app_prueba\\servidor.py      (Windows)
    scanner/pdf/.venv/bin/python scanner/app_prueba/servidor.py             (Linux/macOS)

Solo escucha en 127.0.0.1. Usa escanear.escanear, escanear.escanear_viva, escanear.convertir_png y capturar.CamaraViva.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AQUI = Path(__file__).resolve().parent
SCANNER = AQUI.parent
sys.path.insert(0, str(SCANNER))
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import capturar  # noqa: E402
import escanear  # noqa: E402
from escaner_pdf import Opciones, geometria  # noqa: E402

CARPETAS_PERMITIDAS = [capturar.CARPETA_POR_DEFECTO.resolve(), escanear.CARPETA_PDF.resolve()]
MAX_SUBIDA = 60 * 1024 * 1024


# ---------------------------------------------------------------- cámara abierta

class Camara:
    """Envuelve capturar.CamaraViva (Pau): la cámara queda abierta y leyendo a resolución completa.

    La vista previa y la captura comparten la misma cámara, así que escanear tarda ~0,4 s en capturar
    y no hay que cerrar la vista previa para liberar el dispositivo.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.viva: capturar.CamaraViva | None = None

    def abrir(self, camara: str | None) -> dict:
        cam = capturar.elegir_camara(capturar.listar_camaras(), camara)
        with self.lock:
            if self.viva is not None and self.viva.camara.indice == cam.indice:
                return self.viva.estado()
            self._cerrar()
            self.viva = capturar.CamaraViva(cam, 3840, 2160, escanear.ESPERA_ENFOQUE)
            return self.viva.estado()

    def cerrar(self) -> None:
        with self.lock:
            self._cerrar()

    def _cerrar(self) -> None:
        if self.viva is not None:
            viva, self.viva = self.viva, None
            viva.cerrar()

    def deteccion(self) -> dict:
        """Detección de la hoja en el último frame (para dibujar el contorno sobre la vista previa)."""
        viva = self.viva
        if viva is None:
            return {"abierta": False}
        with viva.cond:
            frame = viva.recientes[-1].frame if viva.recientes else None
        if frame is None:
            return {"abierta": True, "encontrada": False}
        escala = 1280 / frame.shape[1]
        peq = cv2.resize(frame, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
        d = geometria.detectar_pagina(peq)
        alto, ancho = peq.shape[:2]
        esquinas = None if d.esquinas is None else [[float(x) / ancho, float(y) / alto] for x, y in d.esquinas]
        return {"abierta": True, "encontrada": d.encontrada, "confianza": round(d.confianza, 2),
                "toca_borde": d.toca_borde, "esquinas": esquinas}

    def ultimo_jpeg(self, ancho: int = 960) -> bytes | None:
        viva = self.viva
        if viva is None:
            return None
        # Lee el último frame de CamaraViva. `recientes` es un atributo interno de capturar.py:
        # vale para esta app provisional; si Pau añade un método público, usarlo.
        with viva.cond:
            frame = viva.recientes[-1].frame if viva.recientes else None
        if frame is None:
            return None
        escala = ancho / frame.shape[1]
        peq = cv2.resize(frame, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", peq, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return buf.tobytes() if ok else None


CAMARA = Camara()
ESCANEANDO = threading.Lock()  # un escaneo a la vez


# ---------------------------------------------------------------- utilidades

def _respuesta_escaneo(esc: escanear.Escaneo) -> dict:
    """Resultado + URLs de los archivos para el navegador."""
    d = esc.a_dict()
    r = esc.resultado
    if r is not None:
        urls = {k: _url(v) for k, v in r.intermedios.items()}
        if r.pdf:
            urls["pdf"] = _url(r.pdf)
        if r.pdf_digital:
            urls["pdf_digital"] = _url(r.pdf_digital)
        d["urls"] = urls
        d["documento"] = r.documento()
    return d


def _url(ruta: str) -> str:
    return "/archivo?ruta=" + ruta.replace("\\", "/")


def _permitido(ruta: Path) -> bool:
    ruta = ruta.resolve()
    return ruta.is_file() and any(ruta.is_relative_to(c) for c in CARPETAS_PERMITIDAS)


def _opciones(q: dict) -> Opciones:
    return Opciones(modo=q.get("modo", "color"), idiomas=q.get("idiomas", "spa+cat+eng"),
                    recortar=q.get("recortar", "1") != "0", iluminacion=q.get("iluminacion", "1") != "0",
                    digital=q.get("digital", "0") == "1")


# ---------------------------------------------------------------- servidor

class Manejador(BaseHTTPRequestHandler):
    server_version = "AppPruebaEscaner/0"

    def log_message(self, formato, *args):  # menos ruido en la consola
        if "/vista.mjpg" not in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), formato % args))

    # --- respuestas
    def _json(self, datos, estado=200):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(estado)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _archivo(self, ruta: Path, tipo: str):
        datos = ruta.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(datos)

    # --- GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/":
            return self._archivo(AQUI / "index.html", "text/html; charset=utf-8")
        if u.path == "/api/camaras":
            camaras = capturar.listar_camaras()
            viva = CAMARA.viva
            return self._json({"camaras": [{"indice": c.indice, "nombre": c.nombre} for c in camaras],
                               "abierta": viva.camara.indice if viva else None})
        if u.path == "/api/deteccion":
            return self._json(CAMARA.deteccion())
        if u.path == "/api/camara/estado":
            viva = CAMARA.viva
            return self._json(viva.estado() if viva else {"ok": False, "abierta": False})
        if u.path == "/vista.mjpg":
            return self._mjpeg()
        if u.path == "/archivo":
            ruta = Path(q.get("ruta", ""))
            if not _permitido(ruta):
                return self._json({"error": "ruta no permitida"}, 404)
            tipos = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json"}
            return self._archivo(ruta, tipos.get(ruta.suffix.lower(), "application/octet-stream"))
        self._json({"error": "no existe"}, 404)

    def _mjpeg(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while CAMARA.viva is not None:
                jpeg = CAMARA.ultimo_jpeg()
                if jpeg:
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                time.sleep(1 / 15)
        except (ConnectionError, OSError):
            pass  # el navegador cerró la conexión

    # --- POST
    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/camara/abrir":
                return self._json(CAMARA.abrir(q.get("camara")))
            if u.path == "/api/camara/cerrar":
                CAMARA.cerrar()
                return self._json({"ok": True})
            if u.path == "/api/escanear":
                return self._escanear(q)
            if u.path == "/api/subir":
                return self._subir(q)
            if u.path == "/api/reprocesar":
                return self._reprocesar(q)
        except capturar.ErrorCaptura as e:
            return self._json({"error_captura": {"codigo": e.codigo, "mensaje": str(e)}}, 400)
        self._json({"error": "no existe"}, 404)

    def _escanear(self, q):
        if not ESCANEANDO.acquire(blocking=False):
            return self._json({"error": "ya hay un escaneo en curso"}, 409)
        try:
            viva = CAMARA.viva
            if viva is not None:   # cámara ya abierta: captura en ~0,4 s
                esc = escanear.escanear_viva(viva, opciones=_opciones(q))
            else:                  # captura única: abre, espera al enfoque, captura y cierra
                esc = escanear.escanear(q.get("camara"), espera_enfoque=float(q.get("espera", escanear.ESPERA_ENFOQUE)),
                                        opciones=_opciones(q))
            return self._json(_respuesta_escaneo(esc))
        finally:
            ESCANEANDO.release()

    def _reprocesar(self, q):
        """Regenera el PDF de una captura con esquinas puestas a mano (normalizadas a [0, 1])."""
        png = Path(q.get("png", ""))
        if not (_permitido(png) and png.suffix.lower() == ".png"):
            return self._json({"error": "captura no permitida"}, 404)
        try:
            v = [float(x) for x in q.get("esquinas", "").split(",")]
        except ValueError:
            v = []
        if len(v) != 8 or not all(0 <= x <= 1 for x in v):
            return self._json({"error": "esquinas: 8 números entre 0 y 1"}, 400)
        with Image.open(png) as im:   # solo lee la cabecera
            ancho, alto = im.size
        op = _opciones(q)
        op.esquinas = [[v[i] * ancho, v[i + 1] * alto] for i in range(0, 8, 2)]
        with ESCANEANDO:
            esc = escanear.Escaneo(png, None, escanear.convertir_png(png, opciones=op))
        return self._json(_respuesta_escaneo(esc))

    def _subir(self, q):
        largo = int(self.headers.get("Content-Length", 0))
        if not 0 < largo <= MAX_SUBIDA:
            return self._json({"error": "tamaño de archivo no válido"}, 400)
        datos = self.rfile.read(largo)
        carpeta = capturar.CARPETA_POR_DEFECTO
        carpeta.mkdir(parents=True, exist_ok=True)
        png = carpeta / f"subida-{datetime.now():%Y%m%d-%H%M%S-%f}"[:-3]
        png = png.with_suffix(".png")
        if datos.startswith(b"\x89PNG\r\n\x1a\n"):
            png.write_bytes(datos)
        else:
            # Comodidad solo de la app de prueba (p. ej. fotos JPG del móvil): se pasa a PNG.
            img = cv2.imdecode(np.frombuffer(datos, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                return self._json({"error": "no es una imagen"}, 400)
            png.write_bytes(cv2.imencode(".png", img)[1].tobytes())
        with ESCANEANDO:
            esc = escanear.Escaneo(png, None, escanear.convertir_png(png, opciones=_opciones(q)))
        return self._json(_respuesta_escaneo(esc))


def main() -> int:
    p = argparse.ArgumentParser(description="App provisional de prueba del escáner (localhost)")
    p.add_argument("--puerto", type=int, default=8780,
                   help="8765 no: lo usan la app Wails (WebSocket) y capturar.py --servidor")
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    a = p.parse_args()
    servidor = ThreadingHTTPServer(("127.0.0.1", a.puerto), Manejador)
    url = f"http://localhost:{a.puerto}/"
    print(f"App de prueba en {url}  (Ctrl+C para salir)")
    if not a.no_abrir:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        CAMARA.cerrar()
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
