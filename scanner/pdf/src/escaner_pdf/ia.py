"""Maqueta de una página con un modelo de visión (OpenRouter), para el documento digital.

El OCR local da la geometría precisa, pero con fotos imperfectas (hoja curvada, desenfoque) lee mal y
parte las líneas. Un modelo de visión transcribe la página entera por bloques, con sus saltos de línea,
alineación y negrita; luego digital.py ajusta cada bloque a la geometría local.

Frugalidad (criterio AXA): solo se llama si se pide el documento digital; primero el modelo barato y,
solo si su resultado no concuerda con el OCR local, el caro. Coste y tokens quedan en el resultado.
Privacidad: la imagen de la página se envía a OpenRouter. La clave se lee de OPENROUTER_API_KEY o de
scanner/.env (ignorado por git) y nunca se escribe en logs ni resultados.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from .errores import ErrorEscaner

URL = "https://openrouter.ai/api/v1/chat/completions"
MODELO_BARATO = os.environ.get("LLM_MODELO_BARATO", "anthropic/claude-haiku-5.5")   # mismos nombres que backend/llm
MODELO_CARO = os.environ.get("LLM_MODELO_CARO", "anthropic/claude-sonnet-5.5")
LADO_IMAGEN = 1568          # lado mayor que el modelo ve sin reducir más

PROMPT = """Eres un sistema de digitalización de documentos. La imagen es UNA página escaneada.
Devuelve SOLO un JSON con la maqueta de la página para reconstruirla como documento digital:
{"bloques": [
  {"tipo": "texto", "bbox": [x0, y0, x1, y1], "lineas": ["línea 1 exacta", "línea 2 exacta"],
   "alineacion": "izquierda|centro|derecha|justificado", "negrita": false},
  {"tipo": "imagen", "bbox": [x0, y0, x1, y1], "descripcion": "firma|logo|sello|foto|qr|otro"}
]}
Reglas:
- bbox en coordenadas 0-1000 relativas a la página (x hacia la derecha, y hacia abajo), ajustado al contenido.
- Un bloque de texto = un párrafo, título o línea suelta. Respeta los saltos de línea EXACTOS de la imagen:
  cada elemento de "lineas" es una línea física de la página.
- Transcribe EXACTAMENTE lo que pone, con acentos, mayúsculas y puntuación. No corrijas, no completes,
  no traduzcas. Si algo es ilegible escribe [?].
- Firmas, logos, sellos, fotos y códigos QR son bloques "imagen". Ignora lo que no sea del papel.
- Orden de lectura, de arriba a abajo.
- JSON compacto, en una sola línea, sin espacios de sangría ni texto fuera del JSON."""


def clave() -> str | None:
    """OPENROUTER_API_KEY del entorno o de un .env en scanner/ o scanner/pdf/ (nunca se registra)."""
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"].strip()
    raiz_pdf = Path(__file__).resolve().parents[2]
    for env in (raiz_pdf / ".env", raiz_pdf.parent / ".env"):
        if env.is_file():
            for linea in env.read_text(encoding="utf-8").splitlines():
                if linea.strip().startswith("OPENROUTER_API_KEY="):
                    valor = linea.split("=", 1)[1].strip().strip('"').strip("'")
                    return valor or None
    return None


def maquetar(pagina: np.ndarray, modelo: str, timeout: int = 120) -> tuple[dict, dict]:
    """Pide la maqueta de la página al modelo. Devuelve (maqueta, meta: modelo, tokens, coste, segundos)."""
    k = clave()
    if not k:
        raise ErrorEscaner("ia_sin_clave", "Falta OPENROUTER_API_KEY (entorno o scanner/.env)")
    escala = min(1.0, LADO_IMAGEN / max(pagina.shape[:2]))
    peq = cv2.resize(pagina, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA) if escala < 1 else pagina
    ok, jpg = cv2.imencode(".jpg", peq, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ErrorEscaner("ia_fallo", "No se pudo preparar la imagen para el modelo")
    cuerpo = {
        "model": modelo,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode()}},
        ]}],
        "temperature": 0,
        "max_tokens": 8000,
        "usage": {"include": True},
    }
    peticion = urllib.request.Request(URL, data=json.dumps(cuerpo).encode("utf-8"), headers={
        "Authorization": f"Bearer {k}", "Content-Type": "application/json", "X-Title": "escaner_pdf"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(peticion, timeout=timeout) as resp:
            datos = json.load(resp)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:300]
        raise ErrorEscaner("ia_fallo", f"OpenRouter respondió {e.code}: {detalle}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ErrorEscaner("ia_sin_conexion", f"No se pudo contactar con OpenRouter: {e}") from e
    segundos = time.perf_counter() - t0
    uso = datos.get("usage") or {}
    meta = {"modelo": modelo, "segundos": round(segundos, 1), "tokens_entrada": uso.get("prompt_tokens"),
            "tokens_salida": uso.get("completion_tokens"), "coste_usd": uso.get("cost")}
    try:
        texto = datos["choices"][0]["message"]["content"]
        maqueta = json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
    except (KeyError, IndexError, ValueError) as e:
        raise ErrorEscaner("ia_respuesta_invalida", f"El modelo no devolvió un JSON válido: {e}") from e
    return _limpiar(maqueta), meta


def _limpiar(maqueta: dict) -> dict:
    """Valida y normaliza la maqueta (bbox a [0, 1], tipos conocidos). Lo raro se descarta."""
    bloques = []
    for b in maqueta.get("bloques", []):
        try:
            x0, y0, x1, y1 = (float(v) / 1000.0 for v in b["bbox"])
        except (KeyError, TypeError, ValueError):
            continue
        x0, x1 = sorted((min(max(x0, 0.0), 1.0), min(max(x1, 0.0), 1.0)))
        y0, y1 = sorted((min(max(y0, 0.0), 1.0), min(max(y1, 0.0), 1.0)))
        if x1 - x0 < 0.003 or y1 - y0 < 0.003:
            continue
        if b.get("tipo") == "texto":
            lineas = [str(l) for l in b.get("lineas", []) if str(l).strip()]
            if not lineas:
                continue
            alin = b.get("alineacion") if b.get("alineacion") in ("izquierda", "centro", "derecha", "justificado") else "izquierda"
            bloques.append({"tipo": "texto", "bbox": [x0, y0, x1, y1], "lineas": lineas, "alineacion": alin,
                            "negrita": bool(b.get("negrita"))})
        elif b.get("tipo") == "imagen":
            bloques.append({"tipo": "imagen", "bbox": [x0, y0, x1, y1], "descripcion": str(b.get("descripcion", "otro"))})
    if not bloques:
        raise ErrorEscaner("ia_respuesta_invalida", "La maqueta no tiene ningún bloque utilizable")
    return {"bloques": bloques}
