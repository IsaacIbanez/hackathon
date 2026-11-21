"""Captura un frame completo de la webcam (pensado para la Logitech MX Brio).

Uso:
    python scanner/capturar.py                 # busca una cámara "Brio" y guarda una captura
    python scanner/capturar.py --listar        # lista las cámaras que ve el sistema
    python scanner/capturar.py --camara 0      # usa la cámara con índice 0
    python scanner/capturar.py --camara acer   # usa la primera cámara cuyo nombre contenga "acer"
    python scanner/capturar.py --probar        # hace la captura completa, pero no guarda nada
    python scanner/capturar.py --servidor      # deja la cámara abierta; cada captura con
                                               #   curl http://127.0.0.1:8766/captura

Guarda el frame tal cual (sin recortar ni procesar, a la resolución máxima) en PNG sin pérdida y,
al lado, un JSON con los metadatos de la captura (cámara, resolución, formato, nitidez...).
La última línea de la salida es la ruta del PNG (o un JSON con --json).

Calidad: no se elige un frame cualquiera. Se espera a que el autoenfoque termine de ajustarse
(la MX Brio lo reajusta ~1 s después de abrir) y se guarda el más nítido de los últimos frames.
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
PUERTO_POR_DEFECTO = 8766  # 8765 lo usa la app Wails (WebSocket)
# Una nitidez por debajo de esta fracción de la de referencia indica que el autoenfoque reajusta.
UMBRAL_CAIDA = 0.65

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


# ---------- Calidad: nitidez y estabilización (lógica pura, testeable sin cámara) ----------

@dataclass
class Muestra:
    t: float          # segundos (time.monotonic)
    brillo: float     # media de gris, 0-255
    nitidez: float    # varianza del laplaciano (más alto = más nítido)
    frame: object = field(default=None, repr=False)


def metricas(frame) -> tuple[float, float]:
    """(brillo, nitidez) sobre una versión reducida del frame: ~5 ms en 4K."""
    alto, ancho = frame.shape[:2]
    peque = frame
    if ancho > 960:  # solo se reduce; ampliar no aporta nada
        peque = cv2.resize(frame, (960, max(1, round(alto * 960 / ancho))), interpolation=cv2.INTER_AREA)
    gris = cv2.cvtColor(peque, cv2.COLOR_BGR2GRAY) if peque.ndim == 3 else peque
    return float(gris.mean()), float(cv2.Laplacian(gris, cv2.CV_64F).var())


def mas_nitida(muestras: list[Muestra]) -> Muestra:
    return max(muestras, key=lambda m: m.nitidez)


class Estabilizador:
    """Decide cuándo la imagen ya es buena tras abrir la cámara.

    Medido en la MX Brio: el brillo es estable desde el primer frame, pero el autoenfoque
    reajusta entre 1,1 y 1,25 s después del primer frame (la nitidez cae a un ~35 % unos 4 frames
    y vuelve) cuando la escena ha cambiado; si ya estaba enfocada, no hay reajuste grande.
    Antes de ese reajuste el foco puede ser el de la sesión anterior (malo si el papel se movió).

    Está "listo" cuando, pasado `min_s`, se ha visto el reajuste (una caída de nitidez) y los
    últimos `ventana` frames posteriores son estables en brillo y nitidez. Si el reajuste no llega
    en `max_s`, se da por "agotado" y se usa el frame más nítido reciente.
    """

    def __init__(self, min_s: float = 0.3, max_s: float = 1.4, ventana: int = 4,
                 caida: float = UMBRAL_CAIDA, tol_nitidez: float = 0.12, tol_brillo: float = 3.0):
        self.min_s, self.max_s, self.ventana = min_s, max_s, ventana
        self.caida, self.tol_nitidez, self.tol_brillo = caida, tol_nitidez, tol_brillo
        self.muestras: deque[Muestra] = deque(maxlen=ventana * 2)
        self.t0: float | None = None
        self.maxima = 0.0
        self.indice_caida: int | None = None  # nº de muestra donde se vio el reajuste
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
            return False  # la ventana tiene que ser entera posterior a la caída
        v = self._ultimas()
        nit = [m.nitidez for m in v]
        bri = [m.brillo for m in v]
        tol = max(self.tol_nitidez * max(nit), 2.0)  # suelo absoluto para escenas sin textura
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


# ---------- Cámara ----------

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
    """Abre la cámara a la resolución pedida en MJPG. Devuelve (cap, nombre_backend)."""
    backend, nombre_backend = _backend()
    # MJPG es el formato que permite resoluciones altas por USB (YUY2 a 4K va a ~5 fps).
    # Se pasan al abrir: con cap.set() cada ajuste reinicia el stream (~1 s cada uno en la
    # MX Brio) y, si el formato va antes que el tamaño, se queda en YUY2 (comprobado).
    params = [cv2.CAP_PROP_FRAME_WIDTH, ancho, cv2.CAP_PROP_FRAME_HEIGHT, alto,
              cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")]
    cap = cv2.VideoCapture(camara.indice, backend, params)
    if not cap.isOpened():
        raise ErrorCaptura(f"No se puede abrir la cámara {camara.indice} ({camara.nombre}).", ERR_NO_ABRE)
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
    """Captura única: abre, espera a que el enfoque se asiente y devuelve (frame, metadatos, cierre).

    `cierre` es un hilo que ya está liberando la cámara: en DirectShow cap.release() tarda ~0,9 s,
    así que se hace en paralelo con el guardado. Hay que hacer cierre.join() antes de salir.
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
                    raise ErrorCaptura("La cámara se abrió pero no entregó ningún frame.", ERR_SIN_FRAME)
                time.sleep(0.02)  # sin pausa, un read() que falla al instante ocuparía una CPU
                continue
            estado = est.agregar(m)
        mejor = est.mejor()
        metadatos = metadatos_camara(cap, camara, backend, ancho, alto, mejor.frame)
        duracion = est.muestras[-1].t - est.t0
        metadatos["modo"] = "unica"
        metadatos["seleccion"] = {
            "estado": estado,  # "listo" (enfoque asentado) o "agotado" (se usó el tiempo máximo)
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
    # Compresión 1: sigue siendo sin pérdida, pero mucho más rápida a 4K.
    ok, datos = cv2.imencode(".png", frame, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    if not ok:
        raise ErrorCaptura("No se pudo codificar el frame como PNG.", ERR_SIN_FRAME)
    # Se escribe con write_bytes para que funcionen rutas con acentos en Windows.
    ruta_png.write_bytes(datos.tobytes())
    metadatos = {**metadatos, "momento": momento.isoformat(timespec="milliseconds"),
                 "archivo": ruta_png.name, "bytes": ruta_png.stat().st_size}
    base.with_suffix(".json").write_text(json.dumps(metadatos, ensure_ascii=False, indent=2), encoding="utf-8")
    return ruta_png


# ---------- Modo servidor: cámara siempre abierta ----------

class CamaraViva:
    """Mantiene la cámara abierta y leyendo, para que cada captura sea casi inmediata."""

    def __init__(self, camara: Camara, ancho: int, alto: int, espera_max_s: float):
        self.camara, self.ancho, self.alto = camara, ancho, alto
        self.cap, self.backend = abrir(camara, ancho, alto)
        # Con frame: ~25 MB cada uno a 4K. 6 (~0,2 s) bastan para elegir entre los `frescos`.
        self.recientes: deque[Muestra] = deque(maxlen=6)
        self.historial: deque[tuple[float, float]] = deque(maxlen=60)  # (t, nitidez), ~3 s
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
                        self.error = "la cámara ha dejado de entregar frames"
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
                    raise ErrorCaptura("La cámara se abrió pero no entregó frames.", ERR_SIN_FRAME)
                self.cond.wait(0.2)
                nuevas = [m for m in self.recientes if m.t > visto]
                for m in nuevas:
                    est.agregar(m)
                    visto = m.t

    def capturar(self, frescos: int = 3, espera_max_s: float = 1.0):
        """Mejor frame tomado DESPUÉS de la orden (así el papel ya está donde toca).

        Espera `frescos` frames nuevos (~0,15 s) y coge el más nítido. Si en ese momento el
        autoenfoque está reajustando (nitidez muy por debajo de la de los últimos 3 s), espera
        hasta `espera_max_s` a que se recupere.
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
                    raise ErrorCaptura("No llegan frames nuevos de la cámara.", ERR_SIN_FRAME)
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
                print(f"Captura {png.name} ({segundos:.2f} s)", file=sys.stderr, flush=True)
                return self._responder(200, {"ok": True, "png": str(png), "json": str(png.with_suffix(".json")),
                                             **res, "segundos": round(segundos, 3)})
            self._responder(404, {"ok": False, "error": "rutas: /captura, /estado"})

        def log_message(self, *args):  # sin ruido por cada petición
            pass

    # Solo en 127.0.0.1: no se expone la cámara a la red.
    servidor = HTTPServer(("127.0.0.1", puerto), Manejador)
    print(f"Listo. Captura con: curl http://127.0.0.1:{puerto}/captura  (Ctrl+C para salir)",
          file=sys.stderr, flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Captura un frame completo de la webcam (MX Brio).")
    p.add_argument("--listar", action="store_true", help="lista las cámaras y sale")
    p.add_argument("--camara", help='índice ("0") o parte del nombre ("brio"). Por defecto: "brio"')
    p.add_argument("--ancho", type=int, default=3840, help="ancho pedido (la cámara puede entregar otro)")
    p.add_argument("--alto", type=int, default=2160, help="alto pedido (la cámara puede entregar otro)")
    p.add_argument("--calentamiento", type=float, default=1.4,
                   help="espera máxima (s) a que se asiente el enfoque tras abrir (por defecto 1.4)")
    p.add_argument("--salida", type=Path, default=CARPETA_POR_DEFECTO, help="carpeta de salida")
    p.add_argument("--probar", action="store_true", help="captura pero no guarda (comprueba la cámara)")
    p.add_argument("--servidor", action="store_true",
                   help="deja la cámara abierta y captura con GET http://127.0.0.1:<puerto>/captura")
    p.add_argument("--puerto", type=int, default=PUERTO_POR_DEFECTO, help="puerto del modo servidor")
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
        print(f"Cámara {camara.indice}: {camara.nombre}", file=sys.stderr, flush=True)

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
            print(f"Frame {res['ancho']}x{res['alto']} ({metadatos['formato'] or 'formato desconocido'}), "
                  f"nitidez {sel['nitidez']}, "
                  f"{'tras reajustar el enfoque' if sel['enfoque_reajustado'] else 'enfoque sin reajuste'} "
                  f"({sel['segundos_desde_primer_frame']} s)", file=sys.stderr)

            if args.probar:
                print(json.dumps({"ok": True, **metadatos}, ensure_ascii=False) if args.json
                      else "Prueba correcta (no se guarda nada).")
                return OK

            ruta = guardar(frame, metadatos, args.salida, momento)  # mientras se cierra la cámara
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
    # Por código y no con OPENCV_LOG_LEVEL: esa variable ya no se lee tras importar cv2 (comprobado).
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    # En una tubería (Git Bash, el agente...) Windows usaría cp1252 y rompería los acentos.
    for flujo in (sys.stdout, sys.stderr):
        if not flujo.isatty():
            flujo.reconfigure(encoding="utf-8")
    sys.exit(main())
