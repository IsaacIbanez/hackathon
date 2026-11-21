"""Page layout from a vision model (OpenRouter), for the digital document.

Local OCR gives precise geometry, but with imperfect photos (curved sheet, blur) it misreads and
splits lines. A vision model transcribes the whole page by blocks, with its line breaks, alignment
and bold; digital.py then fits each block to the local geometry.

Frugality (AXA criterion): only called when the digital document is requested; first the cheap model
and, only if its result does not agree with the local OCR, the expensive one. Cost and tokens end up
in the result. Privacy: the page image is sent to OpenRouter. The key is read from OPENROUTER_API_KEY
or from scanner/.env (ignored by git) and is never written to logs or results.
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

from .errors import ScannerError

URL = "https://openrouter.ai/api/v1/chat/completions"
CHEAP_MODEL = os.environ.get("LLM_CHEAP_MODEL", "anthropic/claude-haiku-5.5")          # same names as backend/llm
EXPENSIVE_MODEL = os.environ.get("LLM_EXPENSIVE_MODEL", "anthropic/claude-sonnet-5.5")
IMAGE_SIDE = 1568           # longest side the model sees without further downscaling
ALIGNMENTS = ("left", "center", "right", "justify")

PROMPT = """You are a document digitisation system. The image is ONE scanned page.
Return ONLY a JSON object with the page layout, to rebuild it as a digital document:
{"blocks": [
  {"type": "text", "bbox": [x0, y0, x1, y1], "lines": ["exact line 1", "exact line 2"],
   "align": "left|center|right|justify", "bold": false},
  {"type": "image", "bbox": [x0, y0, x1, y1], "description": "signature|logo|stamp|photo|qr|other"}
]}
Rules:
- bbox in 0-1000 coordinates relative to the page (x to the right, y down), tight around the content.
- A text block = a paragraph, a heading or a single line. Keep the EXACT line breaks of the image:
  each item of "lines" is one physical line of the page.
- Transcribe EXACTLY what is written, in its original language, with accents, capitals and punctuation.
  Do not correct, complete or translate. Write [?] for anything illegible.
- Signatures, logos, stamps, photos and QR codes are "image" blocks. Ignore anything that is not on the paper.
- Reading order, top to bottom.
- Compact JSON on a single line, no indentation and no text outside the JSON."""


def api_key() -> str | None:
    """OPENROUTER_API_KEY from the environment or from a .env in scanner/ or scanner/pdf/ (never logged)."""
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"].strip()
    pdf_root = Path(__file__).resolve().parents[2]
    for env in (pdf_root / ".env", pdf_root.parent / ".env"):
        if env.is_file():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("OPENROUTER_API_KEY="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return value or None
    return None


def page_layout(page: np.ndarray, model: str, timeout: int = 120) -> tuple[dict, dict]:
    """Asks the model for the page layout. Returns (layout, meta: model, tokens, cost, seconds)."""
    key = api_key()
    if not key:
        raise ScannerError("ai_no_key", "OPENROUTER_API_KEY is missing (environment or scanner/.env)")
    scale = min(1.0, IMAGE_SIDE / max(page.shape[:2]))
    small = cv2.resize(page, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else page
    ok, jpg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ScannerError("ai_failed", "Could not prepare the image for the model")
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode()}},
        ]}],
        "temperature": 0,
        "max_tokens": 8000,
        "usage": {"include": True},
    }
    request = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"), headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "scanner_pdf"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ScannerError("ai_failed", f"OpenRouter answered {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ScannerError("ai_no_connection", f"Could not reach OpenRouter: {e}") from e
    seconds = time.perf_counter() - t0
    usage = data.get("usage") or {}
    meta = {"model": model, "seconds": round(seconds, 1), "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"), "cost_usd": usage.get("cost")}
    try:
        text = data["choices"][0]["message"]["content"]
        layout = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except (KeyError, IndexError, ValueError) as e:
        raise ScannerError("ai_invalid_response", f"The model did not return valid JSON: {e}") from e
    return clean_layout(layout), meta


def clean_layout(layout: dict) -> dict:
    """Validates and normalises the layout (bbox to [0, 1], known types). Anything odd is dropped."""
    blocks = []
    for b in layout.get("blocks", []):
        try:
            x0, y0, x1, y1 = (float(v) / 1000.0 for v in b["bbox"])
        except (KeyError, TypeError, ValueError):
            continue
        x0, x1 = sorted((min(max(x0, 0.0), 1.0), min(max(x1, 0.0), 1.0)))
        y0, y1 = sorted((min(max(y0, 0.0), 1.0), min(max(y1, 0.0), 1.0)))
        if x1 - x0 < 0.003 or y1 - y0 < 0.003:
            continue
        if b.get("type") == "text":
            lines = [str(line) for line in b.get("lines", []) if str(line).strip()]
            if not lines:
                continue
            align = b.get("align") if b.get("align") in ALIGNMENTS else "left"
            blocks.append({"type": "text", "bbox": [x0, y0, x1, y1], "lines": lines, "align": align,
                           "bold": bool(b.get("bold"))})
        elif b.get("type") == "image":
            blocks.append({"type": "image", "bbox": [x0, y0, x1, y1], "description": str(b.get("description", "other"))})
    if not blocks:
        raise ScannerError("ai_invalid_response", "The layout has no usable block")
    return {"blocks": blocks}
