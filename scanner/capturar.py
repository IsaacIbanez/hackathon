"""Captures a full frame from the webcam (meant for the Logitech MX Brio).

Usage (the flags keep their original Spanish names, other scripts use them):
    python scanner/capturar.py                 # looks for a "Brio" camera and saves a capture
    python scanner/capturar.py --listar        # lists the cameras the system sees
    python scanner/capturar.py --camara 0      # uses the camera with index 0
    python scanner/capturar.py --camara acer   # uses the first camera whose name contains "acer"
    python scanner/capturar.py --probar        # does the full capture, but saves nothing
    python scanner/capturar.py --servidor      # keeps the camera open; each capture with
                                               #   curl http://127.0.0.1:8766/captura

Saves the frame as it is (no cropping or processing, at the maximum resolution) as a lossless PNG and,
next to it, a JSON with the capture's metadata (camera, resolution, format, sharpness...).
The last line of the output is the PNG's path (or a JSON with --json).

Quality: not just any frame is chosen. It waits for the autofocus to finish adjusting
(the MX Brio readjusts it ~1 s after opening) and saves the sharpest of the last frames.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import cv2

CARPETA_POR_DEFECTO = Path(__file__).resolve().parent / "capturas"
PREFERENCIA_POR_DEFECTO = "brio"
PUERTO_POR_DEFECTO = 8766  # 8765 is used by the Wails app (WebSocket)
# A sharpness below this fraction of the reference one means the autofocus is readjusting.
UMBRAL_CAIDA = 0.65

# Exit codes
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


# ---------- Listing the cameras ----------

_RE_DSHOW_VIDEO = re.compile(r'"(?P<nombre>[^"]+)"\s+\(video\)')


def parsear_dshow(salida_ffmpeg: str) -> list[Camara]:
    """Extracts the video cameras from `ffmpeg -list_devices true -f dshow -i dummy`.

    ffmpeg's order (DirectShow) matches OpenCV's index with CAP_DSHOW.
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
    dispositivos = sorted(
        (int(d.name[5:]), d)
        for d in Path("/sys/class/video4linux").glob("video*")
        if d.name[5:].isdigit()
    )
    camaras = []
    for indice, d in dispositivos:
        try:
            camaras.append(Camara(indice, (d / "name").read_text().strip()))
        except OSError:
            continue
    return camaras


def listar_camaras() -> list[Camara]:
    """Cameras with a name. An empty list if the system does not let us know the names."""
    sistema = platform.system()
    if sistema == "Windows":
        return _listar_windows()
    if sistema == "Linux":
        return _listar_linux()
    return []


def elegir_camara(camaras: list[Camara], preferencia: str | None) -> Camara:
    """Picks by index ("0"), by part of the name ("brio") or, with no preference, the Brio.

    It never silently falls back to another camera: if it does not find the requested one, it fails.
    """
    pref = PREFERENCIA_POR_DEFECTO if preferencia is None else preferencia.strip()
    if pref.isdigit():
        indice = int(pref)
        for c in camaras:
            if c.indice == indice:
                return c
        if not camaras:
            # No names available (macOS, no ffmpeg...): the index is accepted blindly.
            return Camara(indice, "(unknown name)")
    else:
        for c in camaras:
            if pref.lower() in c.nombre.lower():
                return c
    disponibles = ", ".join(f"{c.indice}: {c.nombre}" for c in camaras) or "none with a name"
    raise ErrorCaptura(
        f'No camera contains "{pref}". Available: {disponibles}. '
        f"Connect the MX Brio or use --camara <index>.",
        ERR_CAMARA_NO_ENCONTRADA,
    )


# ---------- Quality: sharpness and settling (pure logic, testable without a camera) ----------

@dataclass
class Muestra:
    t: float          # seconds (time.monotonic)
    brillo: float     # mean grey, 0-255
    nitidez: float    # variance of the Laplacian (higher = sharper)
    frame: object = field(default=None, repr=False)


def metricas(frame) -> tuple[float, float]:
    """(brightness, sharpness) on a reduced version of the frame: ~5 ms at 4K."""
    alto, ancho = frame.shape[:2]
    peque = frame
    if ancho > 960:  # only shrink; enlarging adds nothing
        peque = cv2.resize(frame, (960, max(1, round(alto * 960 / ancho))), interpolation=cv2.INTER_AREA)
    gris = cv2.cvtColor(peque, cv2.COLOR_BGR2GRAY) if peque.ndim == 3 else peque
    return float(gris.mean()), float(cv2.Laplacian(gris, cv2.CV_64F).var())


def mas_nitida(muestras: list[Muestra]) -> Muestra:
    return max(muestras, key=lambda m: m.nitidez)


class Estabilizador:
    """Decides when the image is good after opening the camera.

    Measured on the MX Brio: the brightness is stable from the first frame, but the autofocus
    readjusts between 1.1 and 1.25 s after the first frame (the sharpness drops to ~35 % for about 4 frames
    and comes back) when the scene has changed; if it was already in focus, there is no big readjustment.
    Before that readjustment the focus may be the previous session's (bad if the paper moved).

    It is "listo" (ready) when, after `min_s`, the readjustment (a drop in sharpness) has been seen and the
    last `ventana` frames after it are stable in brightness and sharpness. If the readjustment does not come
    within `max_s`, it is "agotado" (timed out) and the sharpest recent frame is used.
    """

    def __init__(self, min_s: float = 0.3, max_s: float = 1.4, ventana: int = 4,
                 caida: float = UMBRAL_CAIDA, tol_nitidez: float = 0.12, tol_brillo: float = 3.0):
        self.min_s, self.max_s, self.ventana = min_s, max_s, ventana
        self.caida, self.tol_nitidez, self.tol_brillo = caida, tol_nitidez, tol_brillo
        self.muestras: deque[Muestra] = deque(maxlen=ventana * 2)
        self.t0: float | None = None
        self.maxima = 0.0
        self.indice_caida: int | None = None  # number of the sample where the readjustment was seen
        self.n = 0

    def agregar(self, m: Muestra) -> str:
        if self.t0 is None:
            self.t0 = m.t
        self.muestras.append(m)
        self.n += 1
        if self.indice_caida is None and self.maxima > 0 and m.nitidez < self.caida * self.maxima:
            self.indice_caida = self.n
        self.maxima = max(self.maxima, m.nitidez)
        return self.estado()

    def _ultimas(self) -> list[Muestra]:
        return list(self.muestras)[-self.ventana:]

    def _ventana_estable(self) -> bool:
        if self.indice_caida is None or self.n - self.indice_caida < self.ventana:
            return False  # the whole window has to come after the drop
        v = self._ultimas()
        nit = [m.nitidez for m in v]
        bri = [m.brillo for m in v]
        tol = max(self.tol_nitidez * max(nit), 2.0)  # an absolute floor for scenes without texture
        return max(nit) - min(nit) <= tol and max(bri) - min(bri) <= self.tol_brillo

    def estado(self) -> str:
        if self.t0 is None:
            return "esperando"
        transcurrido = self.muestras[-1].t - self.t0
        if transcurrido >= self.min_s and self._ventana_estable():
            return "listo"
        if transcurrido >= self.max_s:
            return "agotado"
        return "esperando"

    def mejor(self) -> Muestra:
        if self.estado() == "listo":
            return mas_nitida(self._ultimas())
        return mas_nitida(list(self.muestras))


# ---------- Camera ----------

def fourcc_a_texto(valor: float) -> str:
    v = int(valor)
    if v <= 0:
        return ""
    return "".join(chr((v >> (8 * i)) & 0xFF) for i in range(4)).strip("\x00")


def nombre_captura(momento: datetime) -> str:
    return momento.strftime("%Y%m%d-%H%M%S-") + f"{momento.microsecond // 1000:03d}"


def _backend():
    sistema = platform.system()
    if sistema == "Windows":
        return cv2.CAP_DSHOW, "DSHOW"
    if sistema == "Linux":
        return cv2.CAP_V4L2, "V4L2"
    return cv2.CAP_ANY, "ANY"


def abrir(camara: Camara, ancho: int, alto: int):
    """Opens the camera at the requested resolution in MJPG. Returns (cap, backend_name)."""
    backend, nombre_backend = _backend()
    # MJPG is the format that allows high resolutions over USB (YUY2 at 4K runs at ~5 fps).
    # They are passed when opening: with cap.set() each setting restarts the stream (~1 s each on the
    # MX Brio) and, if the format goes before the size, it stays in YUY2 (verified).
    params = [cv2.CAP_PROP_FRAME_WIDTH, ancho, cv2.CAP_PROP_FRAME_HEIGHT, alto,
              cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")]
    cap = cv2.VideoCapture(camara.indice, backend, params)
    if not cap.isOpened():
        raise ErrorCaptura(f"Cannot open camera {camara.indice} ({camara.nombre}).", ERR_NO_ABRE)
    return cap, nombre_backend


def leer_muestra(cap) -> Muestra | None:
    ok, frame = cap.read()
    if not ok or frame is None:
        return None
    brillo, nitidez = metricas(frame)
    return Muestra(time.monotonic(), brillo, nitidez, frame)


def metadatos_camara(cap, camara: Camara, backend: str, ancho: int, alto: int, frame) -> dict:
    alto_real, ancho_real = frame.shape[:2]
    return {
        "camara": {"indice": camara.indice, "nombre": camara.nombre},
        "backend": backend,
        "sistema": platform.system(),
        "opencv": cv2.__version__,
        "resolucion_pedida": {"ancho": ancho, "alto": alto},
        "resolucion_entregada": {"ancho": int(ancho_real), "alto": int(alto_real)},
        "canales": int(frame.shape[2]) if frame.ndim == 3 else 1,
        "formato": fourcc_a_texto(cap.get(cv2.CAP_PROP_FOURCC)),
        "ajustes_camara": {
            "autoenfoque": cap.get(cv2.CAP_PROP_AUTOFOCUS),
            "enfoque": cap.get(cv2.CAP_PROP_FOCUS),
            "auto_exposicion": cap.get(cv2.CAP_PROP_AUTO_EXPOSURE),
            "exposicion": cap.get(cv2.CAP_PROP_EXPOSURE),
            "brillo": cap.get(cv2.CAP_PROP_BRIGHTNESS),
        },
    }


def capturar(camara: Camara, ancho: int, alto: int, espera_max_s: float):
    """Single capture: opens, waits for the focus to settle and returns (frame, metadata, closer).

    `closer` is a thread that is already releasing the camera: on DirectShow cap.release() takes ~0.9 s,
    so it is done in parallel with the saving. Call closer.join() before exiting.
    """
    cap, backend = abrir(camara, ancho, alto)
    try:
        est = Estabilizador(max_s=espera_max_s)
        t_abierta = time.monotonic()
        estado = "esperando"
        while estado == "esperando":
            m = leer_muestra(cap)
            if m is None:
                if time.monotonic() - t_abierta > espera_max_s + 3:
                    raise ErrorCaptura("The camera opened but delivered no frame.", ERR_SIN_FRAME)
                time.sleep(0.02)  # without a pause, a read() that fails instantly would take a whole CPU
                continue
            estado = est.agregar(m)
        mejor = est.mejor()
        metadatos = metadatos_camara(cap, camara, backend, ancho, alto, mejor.frame)
        duracion = est.muestras[-1].t - est.t0
        metadatos["modo"] = "unica"
        metadatos["seleccion"] = {
            "estado": estado,  # "listo" (focus settled) or "agotado" (the maximum time was used)
            "enfoque_reajustado": est.indice_caida is not None,
            "segundos_desde_primer_frame": round(duracion, 3),
            "frames_leidos": est.n,
            "fps": round((est.n - 1) / duracion, 1) if duracion > 0 else None,
            "nitidez": round(mejor.nitidez, 1),
            "brillo": round(mejor.brillo, 1),
        }
    except BaseException:
        cap.release()
        raise
    cierre = threading.Thread(target=cap.release)
    cierre.start()
    return mejor.frame, metadatos, cierre


def guardar(frame, metadatos: dict, carpeta: Path, momento: datetime) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    base = carpeta / nombre_captura(momento)
    ruta_png = base.with_suffix(".png")
    # Compression 1: still lossless, but much faster at 4K.
    ok, datos = cv2.imencode(".png", frame, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    if not ok:
        raise ErrorCaptura("Could not encode the frame as PNG.", ERR_SIN_FRAME)
    # Written with write_bytes so that paths with accents work on Windows.
    ruta_png.write_bytes(datos.tobytes())
    metadatos = {**metadatos, "momento": momento.isoformat(timespec="milliseconds"),
                 "archivo": ruta_png.name, "bytes": ruta_png.stat().st_size}
    base.with_suffix(".json").write_text(json.dumps(metadatos, ensure_ascii=False, indent=2), encoding="utf-8")
    return ruta_png


# ---------- Server mode: camera always open ----------

class CamaraViva:
    """Keeps the camera open and reading, so that each capture is almost immediate."""

    def __init__(self, camara: Camara, ancho: int, alto: int, espera_max_s: float):
        self.camara, self.ancho, self.alto = camara, ancho, alto
        self.cap, self.backend = abrir(camara, ancho, alto)
        # With the frame: ~25 MB each at 4K. 6 (~0.2 s) are enough to choose among the `frescos`.
        self.recientes: deque[Muestra] = deque(maxlen=6)
        self.historial: deque[tuple[float, float]] = deque(maxlen=60)  # (t, sharpness), ~3 s
        self.cond = threading.Condition()
        self.parar = False
        self.error: str | None = None
        self.hilo = threading.Thread(target=self._bucle, daemon=True)
        self.hilo.start()
        self._esperar_enfoque_inicial(espera_max_s)

    def _bucle(self):
        fallos = 0
        while not self.parar:
            m = leer_muestra(self.cap)
            if m is None:
                fallos += 1
                if fallos > 50:
                    with self.cond:
                        self.error = "the camera has stopped delivering frames"
                        self.cond.notify_all()
                    return
                time.sleep(0.02)
                continue
            fallos = 0
            with self.cond:
                self.recientes.append(m)
                self.historial.append((m.t, m.nitidez))
                self.cond.notify_all()

    def _esperar_enfoque_inicial(self, espera_max_s: float):
        est = Estabilizador(max_s=espera_max_s)
        visto = 0
        limite = time.monotonic() + espera_max_s + 5
        with self.cond:
            while est.estado() == "esperando":
                if self.error or time.monotonic() > limite:
                    raise ErrorCaptura("The camera opened but delivered no frames.", ERR_SIN_FRAME)
                self.cond.wait(0.2)
                nuevas = [m for m in self.recientes if m.t > visto]
                for m in nuevas:
                    est.agregar(m)
                    visto = m.t

    def capturar(self, frescos: int = 3, espera_max_s: float = 1.0):
        """The best frame taken AFTER the command (so the paper is already where it should be).

        Waits for `frescos` new frames (~0.15 s) and takes the sharpest. If at that moment the
        autofocus is readjusting (sharpness well below that of the last 3 s), it waits
        up to `espera_max_s` for it to recover.
        """
        t_orden = time.monotonic()
        limite = t_orden + espera_max_s
        with self.cond:
            while True:
                if self.error:
                    raise ErrorCaptura(self.error, ERR_SIN_FRAME)
                candidatos = [m for m in self.recientes if m.t >= t_orden]
                if len(candidatos) >= frescos:
                    mejor = mas_nitida(candidatos)
                    referencia = max(n for t, n in self.historial if t >= t_orden - 3.0)
                    enfocada = mejor.nitidez >= UMBRAL_CAIDA * referencia
                    if enfocada or time.monotonic() >= limite:
                        break
                elif time.monotonic() >= limite + 2.0:
                    raise ErrorCaptura("No new frames are arriving from the camera.", ERR_SIN_FRAME)
                self.cond.wait(0.1)
        metadatos = metadatos_camara(self.cap, self.camara, self.backend, self.ancho, self.alto, mejor.frame)
        metadatos["modo"] = "servidor"
        metadatos["seleccion"] = {
            "estado": "listo" if enfocada else "agotado",
            "segundos_desde_orden": round(mejor.t - t_orden, 3),
            "frames_candidatos": len(candidatos),
            "nitidez": round(mejor.nitidez, 1),
            "nitidez_referencia_3s": round(referencia, 1),
            "brillo": round(mejor.brillo, 1),
        }
        return mejor.frame, metadatos

    def estado(self) -> dict:
        with self.cond:
            h = list(self.historial)
            fps = round((len(h) - 1) / (h[-1][0] - h[0][0]), 1) if len(h) > 1 and h[-1][0] > h[0][0] else None
            return {"ok": self.error is None, "error": self.error, "camara": self.camara.nombre,
                    "fps": fps, "nitidez": round(h[-1][1], 1) if h else None}

    def cerrar(self):
        self.parar = True
        self.hilo.join(timeout=2)
        self.cap.release()


def servir(viva: CamaraViva, carpeta: Path, puerto: int):
    class Manejador(BaseHTTPRequestHandler):
        def _responder(self, codigo: int, cuerpo: dict):
            datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def do_GET(self):
            ruta = self.path.split("?")[0]
            if ruta == "/estado":
                return self._responder(200, viva.estado())
            if ruta == "/captura":
                t = time.monotonic()
                try:
                    momento = datetime.now().astimezone()
                    frame, metadatos = viva.capturar()
                    png = guardar(frame, metadatos, carpeta, momento)
                except ErrorCaptura as e:
                    return self._responder(500, {"ok": False, "error": str(e), "codigo": e.codigo})
                res = metadatos["resolucion_entregada"]
                segundos = time.monotonic() - t
                print(f"Capture {png.name} ({segundos:.2f} s)", file=sys.stderr, flush=True)
                return self._responder(200, {"ok": True, "png": str(png), "json": str(png.with_suffix(".json")),
                                             **res, "segundos": round(segundos, 3)})
            self._responder(404, {"ok": False, "error": "routes: /captura, /estado"})

        def log_message(self, *args):  # no noise for every request
            pass

    # Only on 127.0.0.1: the camera is not exposed to the network.
    servidor = HTTPServer(("127.0.0.1", puerto), Manejador)
    print(f"Ready. Capture with: curl http://127.0.0.1:{puerto}/captura  (Ctrl+C to quit)",
          file=sys.stderr, flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Captures a full frame from the webcam (MX Brio).")
    p.add_argument("--listar", action="store_true", help="list the cameras and exit")
    p.add_argument("--camara", help='index ("0") or part of the name ("brio"). Default: "brio"')
    p.add_argument("--ancho", type=int, default=3840, help="requested width (the camera may deliver another)")
    p.add_argument("--alto", type=int, default=2160, help="requested height (the camera may deliver another)")
    p.add_argument("--calentamiento", type=float, default=1.4,
                   help="maximum wait (s) for the focus to settle after opening (default 1.4)")
    p.add_argument("--salida", type=Path, default=CARPETA_POR_DEFECTO, help="output folder")
    p.add_argument("--probar", action="store_true", help="capture but do not save (checks the camera)")
    p.add_argument("--servidor", action="store_true",
                   help="keep the camera open and capture with GET http://127.0.0.1:<port>/captura")
    p.add_argument("--puerto", type=int, default=PUERTO_POR_DEFECTO, help="server mode port")
    p.add_argument("--json", action="store_true", help="print the result as JSON")
    args = p.parse_args(argv)

    try:
        camaras = listar_camaras()
        if args.listar:
            if not camaras:
                print("Cannot get camera names on this system; use --camara <index>.")
            for c in camaras:
                print(f"{c.indice}: {c.nombre}")
            return OK

        camara = elegir_camara(camaras, args.camara)
        print(f"Camera {camara.indice}: {camara.nombre}", file=sys.stderr, flush=True)

        if args.servidor:
            viva = CamaraViva(camara, args.ancho, args.alto, args.calentamiento)
            try:
                servir(viva, args.salida, args.puerto)
            finally:
                viva.cerrar()
            return OK

        momento = datetime.now().astimezone()
        frame, metadatos, cierre = capturar(camara, args.ancho, args.alto, args.calentamiento)
        try:
            res, sel = metadatos["resolucion_entregada"], metadatos["seleccion"]
            print(f"Frame {res['ancho']}x{res['alto']} ({metadatos['formato'] or 'unknown format'}), "
                  f"sharpness {sel['nitidez']}, "
                  f"{'after the focus readjusted' if sel['enfoque_reajustado'] else 'focus without readjustment'} "
                  f"({sel['segundos_desde_primer_frame']} s)", file=sys.stderr)

            if args.probar:
                print(json.dumps({"ok": True, **metadatos}, ensure_ascii=False) if args.json
                      else "Test OK (nothing is saved).")
                return OK

            ruta = guardar(frame, metadatos, args.salida, momento)  # while the camera closes
            print(json.dumps({"ok": True, "png": str(ruta), "json": str(ruta.with_suffix(".json")),
                              **res}, ensure_ascii=False) if args.json else ruta, flush=True)
            return OK
        finally:
            cierre.join()
    except ErrorCaptura as e:
        if args.json:
            print(json.dumps({"ok": False, "error": str(e), "codigo": e.codigo}, ensure_ascii=False))
        else:
            print(f"Error: {e}", file=sys.stderr)
        return e.codigo


if __name__ == "__main__":
    # In code and not with OPENCV_LOG_LEVEL: that variable is no longer read after importing cv2 (verified).
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    # In a pipe (Git Bash, the agent...) Windows would use cp1252 and break the accents.
    for flujo in (sys.stdout, sys.stderr):
        if not flujo.isatty():
            flujo.reconfigure(encoding="utf-8")
    sys.exit(main())
