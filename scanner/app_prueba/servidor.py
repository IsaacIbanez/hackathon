"""APP PROVISIONAL DE PRUEBA — no es parte del producto. Se puede borrar esta carpeta entera.

Mini servidor en http://localhost:8765 para probar captura + PDF desde el navegador:
vista previa de la cámara, botón de escanear, subida de imágenes y visor de resultados.

    scanner\\pdf\\.venv\\Scripts\\python scanner\\app_prueba\\servidor.py      (Windows)
    scanner/pdf/.venv/bin/python scanner/app_prueba/servidor.py             (Linux/macOS)

Solo escucha en 127.0.0.1. Usa únicamente la interfaz pública: escanear.escanear y escanear.convertir_png.
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

import capturar  # noqa: E402
import escanear  # noqa: E402
from escaner_pdf import Opciones  # noqa: E402

CARPETAS_PERMITIDAS = [capturar.CARPETA_POR_DEFECTO.resolve(), escanear.CARPETA_PDF.resolve()]
MAX_SUBIDA = 60 * 1024 * 1024


# ---------------------------------------------------------------- vista previa

class VistaPrevia:
    """Lee la cámara a baja resolución en un hilo y guarda el último JPEG.

    La cámara solo la puede usar un proceso/handle a la vez: antes de escanear se para.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.jpeg: bytes | None = None
        self.indice: int | None = None
        self._parar = threading.Event()
        self._hilo: threading.Thread | None = None

    def iniciar(self, indice: int) -> None:
        self.parar()
        self._parar.clear()
        self.indice = indice
        self._hilo = threading.Thread(target=self._bucle, args=(indice,), daemon=True)
        self._hilo.start()

    def parar(self) -> None:
        self._parar.set()
        if self._hilo:
            self._hilo.join(timeout=5)
        self._hilo, self.jpeg, self.indice = None, None, None

    def _bucle(self, indice: int) -> None:
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        cap = cv2.VideoCapture(indice, backend, [cv2.CAP_PROP_FRAME_WIDTH, 1280, cv2.CAP_PROP_FRAME_HEIGHT, 720,
                                                 cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")])
        try:
            while not self._parar.is_set() and cap.isOpened():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                escala = 960 / frame.shape[1]
                frame = cv2.resize(frame, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if ok:
                    with self.lock:
                        self.jpeg = buf.tobytes()
        finally:
            cap.release()


VISTA = VistaPrevia()
ESCANEANDO = threading.Lock()  # un escaneo a la vez


# ---------------------------------------------------------------- utilidades

def _indice(camara: str | None) -> int:
    return capturar.elegir_camara(capturar.listar_camaras(), camara).indice


def _respuesta_escaneo(esc: escanear.Escaneo) -> dict:
    """Resultado + URLs de los archivos para el navegador."""
    d = esc.a_dict()
    r = esc.resultado
    if r is not None:
        urls = {k: _url(v) for k, v in r.intermedios.items()}
        if r.pdf:
            urls["pdf"] = _url(r.pdf)
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
                    recortar=q.get("recortar", "1") != "0", iluminacion=q.get("iluminacion", "1") != "0")


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
            return self._json({"camaras": [{"indice": c.indice, "nombre": c.nombre} for c in camaras],
                               "vista": VISTA.indice})
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
            while VISTA.indice is not None:
                with VISTA.lock:
                    jpeg = VISTA.jpeg
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
            if u.path == "/api/vista/iniciar":
                VISTA.iniciar(_indice(q.get("camara")))
                return self._json({"ok": True, "indice": VISTA.indice})
            if u.path == "/api/vista/parar":
                VISTA.parar()
                return self._json({"ok": True})
            if u.path == "/api/escanear":
                return self._escanear(q)
            if u.path == "/api/subir":
                return self._subir(q)
        except capturar.ErrorCaptura as e:
            return self._json({"error_captura": {"codigo": e.codigo, "mensaje": str(e)}}, 400)
        self._json({"error": "no existe"}, 404)

    def _escanear(self, q):
        if not ESCANEANDO.acquire(blocking=False):
            return self._json({"error": "ya hay un escaneo en curso"}, 409)
        try:
            VISTA.parar()  # libera la cámara para la captura a resolución completa
            esc = escanear.escanear(q.get("camara"), calentamiento=float(q.get("calentamiento", 1.5)),
                                    opciones=_opciones(q))
            return self._json(_respuesta_escaneo(esc))
        finally:
            ESCANEANDO.release()

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
    p.add_argument("--puerto", type=int, default=8765)
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
        VISTA.parar()
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
