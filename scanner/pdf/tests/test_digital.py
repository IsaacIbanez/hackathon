"""Documento digital: página en blanco con texto real e imágenes en su sitio."""

import io

import cv2
import numpy as np
import pikepdf
import pytest
from pdfminer.high_level import extract_text

import sinteticos as s
from escaner_pdf import Opciones, convertir, digital


def _con_firma(hoja: np.ndarray) -> np.ndarray:
    """Añade una "firma" (trazo curvo azul) dentro del recuadro inferior."""
    hoja = hoja.copy()
    alto, ancho = hoja.shape[:2]
    t = np.linspace(0, 4 * np.pi, 400)
    xs = (ancho * 0.2 + t / (4 * np.pi) * ancho * 0.35).astype(np.int32)
    ys = (alto * 0.82 + np.sin(t * 1.5) * alto * 0.025).astype(np.int32)
    cv2.polylines(hoja, [np.stack([xs, ys], axis=1).reshape(-1, 1, 2)], False, (150, 40, 20), 5)
    return hoja


def _imagenes(pdf_ruta: str) -> list[tuple[int, int]]:
    with pikepdf.open(pdf_ruta) as pdf:
        pagina = pdf.pages[0]
        return [(int(i.Width), int(i.Height)) for i in pagina.get_images().values()]


@pytest.mark.ocr
def test_texto_real_y_sin_foto_de_pagina(tmp_path):
    img = s.con_sombra(s.en_mesa(_con_firma(s.pagina()), s.ESQUINAS_PERSPECTIVA))
    r = convertir(s.png(img), tmp_path, Opciones(digital=True, digital_ia=False))
    assert r.estado == "ok" and r.pdf_digital, (r.avisos, r.digital)
    assert r.digital["valido"] and r.digital["palabras_texto"] >= 25
    texto = extract_text(r.pdf_digital)
    for palabra in ("siniestro", "Barcelona", "asegurado", "Dirección"):
        assert palabra in texto
    # Ninguna imagen ocupa la página: solo recortes (firma, recuadro).
    ancho, alto = r.pagina["ancho_px"], r.pagina["alto_px"]
    for w, h in _imagenes(r.pdf_digital):
        assert w * h < 0.35 * ancho * alto
    # El PDF escaneado sigue generándose igual.
    assert r.pdf and r.validacion["ok"]


@pytest.mark.ocr
def test_la_firma_va_como_imagen(tmp_path):
    r = convertir(s.png(_con_firma(s.pagina())), tmp_path, Opciones(digital=True, digital_ia=False))
    assert r.pdf_digital and r.digital["regiones_imagen"] >= 1
    assert _imagenes(r.pdf_digital)


@pytest.mark.ocr
def test_cartel_oscuro_no_se_digitaliza(tmp_path):
    cartel = np.full((1754, 1240, 3), (30, 35, 60), np.uint8)
    for i in range(6):
        cv2.putText(cartel, f"Concierto {i}", (100, 200 + i * 220), cv2.FONT_HERSHEY_SIMPLEX, 3, (230, 240, 240), 6)
    r = convertir(s.png(cartel), tmp_path, Opciones(digital=True, digital_ia=False))
    assert r.pdf and r.pdf_digital is None
    assert "digital_no_aplicable" in r.avisos


def test_sin_ocr_no_hay_digital(tmp_path):
    r = convertir(s.png(s.pagina()), tmp_path, Opciones(digital=True, digital_ia=False, ocr=False, orientar=False))
    assert r.pdf_digital is None and "digital_sin_texto" in r.avisos


def test_lineas_fisicas_con_texto_inclinado():
    # Dos líneas de 6 palabras inclinadas ~3°: Tesseract las parte a veces; aquí deben salir 2 líneas.
    palabras, cajas = [], []
    for fila in range(2):
        for k in range(6):
            x0 = 100 + k * 120
            y1 = 300 + fila * 60 + int(k * 120 * 0.05)
            palabras.append({"text": "palabra", "conf": 90, "linea": [1, 1, 7]})
            cajas.append((x0, y1 - 20, x0 + 100, y1))
    lineas = digital._lineas_fisicas(palabras, cajas, list(range(len(palabras))))
    assert len(lineas) == 2 and all(len(l) == 6 for l in lineas)


def test_aplicable_solo_en_papel_claro():
    assert digital.aplicable(np.full((100, 100, 3), 250, np.uint8))
    assert not digital.aplicable(np.full((100, 100, 3), 60, np.uint8))


# ---------------------------------------------------------------- con modelo de visión (simulado: sin red)

from escaner_pdf import ia  # noqa: E402
from escaner_pdf.errores import ErrorEscaner  # noqa: E402

MAQUETA = {"bloques": [
    {"tipo": "texto", "bbox": [70, 70, 500, 100], "lineas": ["DECLARACIÓN DE PRUEBA"], "alineacion": "izquierda", "negrita": False},
    {"tipo": "texto", "bbox": [70, 120, 600, 390], "lineas": [
        "Nombre y apellidos: María Peña Güell", "Dirección: Carrer de la Pau 12, Barcelona",
        "Fecha del siniestro: 21/11/2026", "Descripción: el vehículo sufrió daños leves.", "Firma del asegurado"],
     "alineacion": "izquierda", "negrita": False},
    {"tipo": "imagen", "bbox": [180, 780, 600, 870], "descripcion": "firma"},
]}


def _simular_modelo(monkeypatch, respuestas):
    llamadas = []

    def maquetar(pagina, modelo, timeout=120):
        llamadas.append(modelo)
        r = respuestas[modelo]
        if isinstance(r, Exception):
            raise r
        return ia._limpiar(r), {"modelo": modelo, "segundos": 0.1, "tokens_entrada": 1, "tokens_salida": 1, "coste_usd": 0.001}

    monkeypatch.setattr(ia, "maquetar", maquetar)
    return llamadas


@pytest.mark.ocr
def test_digital_con_modelo_barato(tmp_path, monkeypatch):
    llamadas = _simular_modelo(monkeypatch, {ia.MODELO_BARATO: MAQUETA, ia.MODELO_CARO: MAQUETA})
    r = convertir(s.png(_con_firma(s.pagina())), tmp_path, Opciones(digital=True))
    assert r.pdf_digital and r.digital["metodo"] == "modelo"
    assert llamadas == [ia.MODELO_BARATO]                       # concuerda con el OCR: no se escala
    assert r.digital["concordancia_ocr"] >= 0.9 and r.digital["coste_ia_usd"] == 0.001
    texto = extract_text(r.pdf_digital)
    assert "Güell" in texto and "siniestro" in texto            # el texto del modelo, con su diéresis
    assert r.digital["regiones_imagen"] == 1                    # la firma
    assert (tmp_path / r.pdf_digital).exists() or r.pdf_digital


@pytest.mark.ocr
def test_digital_escala_al_modelo_caro_si_no_concuerda(tmp_path, monkeypatch):
    inventada = {"bloques": [{"tipo": "texto", "bbox": [100, 100, 900, 300], "lineas": ["Texto que no está en la hoja"],
                              "alineacion": "izquierda", "negrita": False}]}
    llamadas = _simular_modelo(monkeypatch, {ia.MODELO_BARATO: inventada, ia.MODELO_CARO: MAQUETA})
    r = convertir(s.png(s.pagina()), tmp_path, Opciones(digital=True))
    assert llamadas == [ia.MODELO_BARATO, ia.MODELO_CARO]
    assert r.digital["concordancia_ocr"] >= 0.9


@pytest.mark.ocr
def test_digital_sin_conexion_usa_el_ocr_local(tmp_path, monkeypatch):
    _simular_modelo(monkeypatch, {ia.MODELO_BARATO: ErrorEscaner("ia_sin_conexion", "simulado"),
                                  ia.MODELO_CARO: ErrorEscaner("ia_sin_conexion", "simulado")})
    r = convertir(s.png(s.pagina()), tmp_path, Opciones(digital=True))
    assert r.pdf_digital and r.digital["metodo"] == "ocr_local"
    assert "digital_ia_no_disponible:ia_sin_conexion" in r.avisos


def test_maqueta_invalida_se_rechaza():
    with pytest.raises(ErrorEscaner):
        ia._limpiar({"bloques": [{"tipo": "texto", "bbox": [1, 2], "lineas": ["x"]}]})
    m = ia._limpiar({"bloques": [{"tipo": "texto", "bbox": [100, 100, 900, 200], "lineas": ["hola"], "alineacion": "rara"}]})
    assert m["bloques"][0]["bbox"] == [0.1, 0.1, 0.9, 0.2] and m["bloques"][0]["alineacion"] == "izquierda"


def test_bloques_no_se_pisan():
    import io as _io
    pagina = np.full((1754, 1240, 3), 255, np.uint8)
    solapados = {"bloques": [
        {"tipo": "texto", "bbox": [100, 100, 900, 200], "lineas": ["uno uno uno", "dos dos dos", "tres tres"], "alineacion": "justificado", "negrita": False},
        {"tipo": "texto", "bbox": [100, 170, 900, 250], "lineas": ["cuatro cuatro", "cinco cinco"], "alineacion": "izquierda", "negrita": False},
    ]}
    datos, info = digital.digitalizar_maqueta(pagina, ia._limpiar(solapados), [], 150.0)
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer
    cajas = [e.bbox for pag in extract_pages(_io.BytesIO(datos)) for e in pag if isinstance(e, LTTextContainer)]
    cajas.sort(key=lambda b: -b[3])
    for a, b in zip(cajas, cajas[1:]):
        assert b[3] <= a[1] + 0.5                               # cada bloque empieza por debajo del anterior


def _pagina_con_bloques():
    """Página blanca: un párrafo arriba, "Signat," y una firma de trazo claro debajo."""
    pagina = np.full((1754, 1240, 3), 255, np.uint8)
    t = np.linspace(0, 4 * np.pi, 400)
    xs = (300 + t / (4 * np.pi) * 300).astype(np.int32)
    ys = (1100 + np.sin(t * 1.5) * 40).astype(np.int32)
    cv2.polylines(pagina, [np.stack([xs, ys], axis=1).reshape(-1, 1, 2)], False, (205, 190, 160), 3)  # bolígrafo suave
    return pagina


def test_firma_de_trazo_claro_sale_entera():
    maqueta = ia._limpiar({"bloques": [{"tipo": "imagen", "bbox": [230, 600, 510, 660], "descripcion": "firma"}]})
    datos, info = digital.digitalizar_maqueta(_pagina_con_bloques(), maqueta, [], 150.0)
    assert info["regiones_imagen"] == 1
    with pikepdf.open(io.BytesIO(datos)) as pdf:
        (w, h), = [(int(i.Width), int(i.Height)) for i in pdf.pages[0].get_images().values()]
    assert w >= 290 and h >= 70                                   # toda la firma (300 x 80 px), no solo lo oscuro


def test_manda_el_orden_de_lectura_aunque_la_caja_venga_desplazada():
    # El modelo sitúa "Signat," por debajo de la firma, pero lo lista antes: debe quedar encima.
    maqueta = ia._limpiar({"bloques": [
        {"tipo": "texto", "bbox": [230, 640, 320, 650], "lineas": ["Signat,"], "alineacion": "izquierda", "negrita": False},
        {"tipo": "imagen", "bbox": [230, 600, 510, 660], "descripcion": "firma"},
    ]})
    pagina = _pagina_con_bloques()
    alto = pagina.shape[0]
    textos, _ = digital._bloques_texto(maqueta, [], [], 1240, alto, 20.0, 72 / 150)
    digital._tipografia(textos, 72 / 150)
    imagenes = digital._bloques_imagen(maqueta, pagina, cv2.cvtColor(pagina, cv2.COLOR_BGR2GRAY), [], 20.0)
    for t_ in textos:
        t_["alto_px"] = ((len(t_["lineas"]) - 1) * t_["interlineado"] + 0.925 * t_["tam"]) / (72 / 150)
    digital._flujo(textos + imagenes, 20.0, alto)
    assert textos[0]["y"] + textos[0]["alto_px"] <= imagenes[0]["y"]


def test_cabecera_corta_no_sale_mas_pequena_que_el_cuerpo():
    textos = [
        {"lineas": ["Un párrafo normal con bastantes palabras para llenar la línea entera",
                    "y una segunda línea del mismo párrafo justificado"], "alineacion": "justificado",
         "negrita": False, "caja": [100, 300, 1100, 360], "tam_ocr": None},
        {"lineas": ["CERTIFICA"], "alineacion": "izquierda", "negrita": True, "caja": [100, 250, 180, 262], "tam_ocr": 6.0},
    ]
    comun = digital._tipografia(textos, 72 / 150)
    assert textos[1]["tam"] == comun
